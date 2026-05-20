import { AilyHost } from '../core/host';
import type { TurnResponseFollowup, TurnResponseTurn } from 'aily-lex/browser';
import { cloneSessionRequestContextSnapshot } from '../helpers/turn-request-prompt-context';

import type {
  HostSessionRecord,
  HostSessionSidecar,
  PersistedHostResponseData,
  PersistedHostTurnResponse,
  SessionMetadata,
} from './chat-history.service';

function cloneContinuationBudgets(
  continuation: TurnResponseTurn['response']['continuation'] | undefined,
): Record<string, unknown> | undefined {
  const budgets = (continuation as (TurnResponseTurn['response']['continuation'] & {
    budgets?: Record<string, unknown>;
  }) | undefined)?.budgets;

  return budgets && typeof budgets === 'object'
    ? { ...budgets }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clonePersistedValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => clonePersistedValue(item)) as T;
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, clonePersistedValue(entryValue)]),
    ) as T;
  }

  return value;
}

function normalizeActiveSkillNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const names = Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim()),
  )).sort((left, right) => left.localeCompare(right));

  return names.length > 0 ? names : undefined;
}

function cloneContinuationDiagnostics(
  continuation: TurnResponseTurn['response']['continuation'] | undefined,
): Record<string, unknown> | undefined {
  const diagnostics = (continuation as (TurnResponseTurn['response']['continuation'] & {
    diagnostics?: Record<string, unknown>;
  }) | undefined)?.diagnostics;

  if (!isRecord(diagnostics)) {
    return undefined;
  }

  const identity = isRecord(diagnostics['identity']) ? { ...diagnostics['identity'] } : undefined;
  const trace = isRecord(diagnostics['trace']) ? { ...diagnostics['trace'] } : undefined;
  const usage = isRecord(diagnostics['usage']) ? { ...diagnostics['usage'] } : undefined;
  const runtime = isRecord(diagnostics['runtime']) ? { ...diagnostics['runtime'] } : undefined;
  const budget = isRecord(diagnostics['budget']) ? { ...diagnostics['budget'] } : undefined;
  const outcome = isRecord(diagnostics['outcome']) ? { ...diagnostics['outcome'] } : undefined;
  const behavior = isRecord(diagnostics['behavior']) ? { ...diagnostics['behavior'] } : undefined;

  return {
    ...(identity ? { identity } : {}),
    ...(trace ? { trace } : {}),
    ...(usage ? { usage } : {}),
    ...(runtime ? { runtime } : {}),
    ...(budget ? { budget } : {}),
    ...(outcome ? { outcome } : {}),
    ...(behavior ? { behavior } : {}),
  };
}

function normalizeRoundSummary(summary: unknown): string | undefined {
  return typeof summary === 'string' && summary.trim()
    ? summary.trim()
    : undefined;
}

function cloneTurnRound(round: TurnResponseTurn['rounds'][number]): TurnResponseTurn['rounds'][number] {
  const summary = normalizeRoundSummary(round.summary);

  return {
    id: round.id,
    assistantText: round.assistantText,
    toolCalls: round.toolCalls.map(toolCall => ({
      ...toolCall,
      input: { ...toolCall.input },
    })),
    timestamp: round.timestamp,
    ...(summary ? { summary } : {}),
  };
}

export interface HostSessionRecordStoreOptions {
  projectChatDir: string;
  getGlobalChatDataDir: () => string;
  getGlobalProjectRootPath: () => string | null;
  joinPath: (...parts: string[]) => string;
  isSamePath: (a: string | null | undefined, b: string | null | undefined) => boolean;
}

/**
 * Host-side persistence adapter for chat history records.
 *
 * Keeps host record disk IO and compatibility normalization out of ChatHistoryService.
 */
export class HostSessionRecordStore {
  constructor(private readonly options: HostSessionRecordStoreOptions) {}

  createFullMetadata(metadata: Partial<SessionMetadata> & { sessionId: string }): SessionMetadata {
    const now = Date.now();
    return {
      sessionId: metadata.sessionId,
      title: metadata.title || '',
      projectPath: metadata.projectPath ?? null,
      createdAt: metadata.createdAt || now,
      updatedAt: now,
      mode: metadata.mode || 'agent',
      model: metadata.model ?? null,
      contextBudget: metadata.contextBudget,
      requestContext: cloneSessionRequestContextSnapshot(metadata.requestContext),
      activeSkillNames: normalizeActiveSkillNames(metadata.activeSkillNames),
      toolCallingIteration: metadata.toolCallingIteration || 0,
    };
  }

  createRecord(
    metadata: SessionMetadata,
    turnResponses?: PersistedHostTurnResponse[],
    sidecar?: HostSessionSidecar,
  ): HostSessionRecord {
    const record: HostSessionRecord = {
      metadata,
    };

    const normalizedTurnResponses = this.normalizeTurnResponses(turnResponses);
    if (normalizedTurnResponses?.length) {
      record.turnResponses = normalizedTurnResponses;
    }

    const normalizedSidecar = this.normalizeSidecar(sidecar);
    if (normalizedSidecar) {
      record.sidecar = normalizedSidecar;
    }

    return record;
  }

  write(sessionId: string, data: HostSessionRecord): void {
    if (!this.hasFs()) return;

    let projectPath = data.metadata.projectPath;
    if (projectPath) {
      const rootPath = this.options.getGlobalProjectRootPath();
      if (rootPath && this.options.isSamePath(projectPath, rootPath)) {
        console.warn(`[ChatHistory] 检测到 projectPath 等于 projectRootPath，降级为全局兜底: ${projectPath}`);
        projectPath = null;
        data.metadata.projectPath = null;
      }
    }

    try {
      if (projectPath) {
        const dir = this.options.joinPath(projectPath, this.options.projectChatDir);
        this.ensureDir(dir);
        const filePath = this.options.joinPath(dir, `${sessionId}.json`);
        this.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return;
      }

      const dir = this.options.getGlobalChatDataDir();
      this.ensureDir(dir);
      const filePath = this.options.joinPath(dir, `${sessionId}.json`);
      this.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[ChatHistory] 写入宿主持久化记录失败 (${sessionId}):`, error);
    }
  }

  read(sessionId: string, projectPath: string | null): HostSessionRecord | null {
    if (!this.hasFs()) return null;

    const paths: string[] = [];
    if (projectPath) {
      paths.push(this.options.joinPath(projectPath, this.options.projectChatDir, `${sessionId}.json`));
    }
    paths.push(this.options.joinPath(this.options.getGlobalChatDataDir(), `${sessionId}.json`));

    for (const filePath of paths) {
      try {
        if (!this.fileExists(filePath)) {
          continue;
        }

        const content = this.readFileSync(filePath);
        const parsed = JSON.parse(content);

        if (Array.isArray(parsed)) {
          console.warn(`[ChatHistory] 忽略旧版 chatList-only 宿主持久化记录 (${filePath})`);
          continue;
        }

        if (parsed.metadata && Array.isArray(parsed.turnResponses)) {
          return this.normalizeRecord(parsed, sessionId, projectPath);
        }
      } catch (error) {
        console.warn(`[ChatHistory] 读取宿主持久化记录失败 (${filePath}):`, error);
      }
    }

    return null;
  }

  private normalizeRecord(raw: any, sessionId: string, projectPath: string | null): HostSessionRecord | null {
    if (!raw || !Array.isArray(raw.turnResponses)) {
      return null;
    }

    const turnResponses = raw.turnResponses;
    const hostRecord: HostSessionRecord = {
      metadata: this.normalizeMetadata(raw.metadata, sessionId, projectPath),
    };

    const normalizedTurnResponses = this.normalizeTurnResponses(turnResponses);
    if (normalizedTurnResponses?.length) {
      hostRecord.turnResponses = normalizedTurnResponses;
    }

    const normalizedSidecar = this.normalizeSidecar(raw.sidecar);
    if (normalizedSidecar) {
      hostRecord.sidecar = normalizedSidecar;
    }

    return hostRecord;
  }

  private normalizeTurnResponses(turnResponses?: readonly PersistedHostTurnResponse[]): PersistedHostTurnResponse[] | undefined {
    return turnResponses?.length ? turnResponses.map(turn => this.cloneTurnResponse(turn)) : undefined;
  }

  private cloneTurnResponse(turn: PersistedHostTurnResponse): PersistedHostTurnResponse {
    const {
      followups,
      responseId,
      responseMarkdownInfo,
      modelState,
      vote,
      timestamp,
      elapsedMs,
      timeSpentWaiting,
      completionTokens,
      continuation,
      ...responseWithoutPersistedData
    } = turn.response as TurnResponseTurn['response'] & PersistedHostResponseData & {
      followups?: readonly TurnResponseFollowup[];
      continuation?: TurnResponseTurn['response']['continuation'];
    };

    return {
      ...turn,
      request: {
        ...turn['request'],
        ...(turn.request?.metadata ? { metadata: clonePersistedValue(turn.request.metadata) } : {}),
        ...(Array.isArray(turn.request?.attachments)
          ? { attachments: turn.request.attachments.map(attachment => clonePersistedValue(attachment)) }
          : {}),
      },
      rounds: turn['rounds'].map(round => cloneTurnRound(round)),
      ...(turn['usage'] ? { usage: { ...turn['usage'] } } : {}),
      response: {
        ...responseWithoutPersistedData,
        ...(turn.response.usedContext
          ? {
            usedContext: {
              ...turn.response.usedContext,
              documents: turn.response.usedContext.documents.map(document => ({
                ...document,
                ranges: document.ranges.map(range => ({ ...range })),
              })),
            },
          }
          : {}),
        contentReferences: (turn.response.contentReferences ?? []).map(reference => ({
          ...reference,
          ...(reference.options
            ? {
              options: {
                ...reference.options,
                ...(reference.options.status ? { status: { ...reference.options.status } } : {}),
                ...(reference.options.diffMeta ? { diffMeta: { ...reference.options.diffMeta } } : {}),
              },
            }
            : {}),
        })),
        codeCitations: (turn.response.codeCitations ?? []).map(citation => ({ ...citation })),
        progressMessages: (turn.response.progressMessages ?? []).map(message => ({ ...message })),
        parts: turn.response.parts.map(part => clonePersistedValue(part)),
        ...(continuation
          ? {
              continuation: {
                ...continuation,
                ...(cloneContinuationBudgets(continuation) ? { budgets: cloneContinuationBudgets(continuation) } : {}),
                ...(cloneContinuationDiagnostics(continuation) ? { diagnostics: cloneContinuationDiagnostics(continuation) } : {}),
                ...(continuation.pendingState ? { pendingState: { ...continuation.pendingState } } : {}),
              },
            }
          : {}),
        ...(typeof responseId === 'string' && responseId.length > 0 ? { responseId } : {}),
        ...(Array.isArray(responseMarkdownInfo)
          ? {
              responseMarkdownInfo: responseMarkdownInfo
                .filter(info => !!info && typeof info.suggestionId === 'string' && info.suggestionId.length > 0)
                .map(info => ({ suggestionId: info.suggestionId })),
            }
          : {}),
        ...(Array.isArray(followups) ? { followups: followups.map(followup => ({ ...followup })) } : {}),
        ...(modelState && typeof modelState.value === 'number' ? { modelState: { ...modelState } } : {}),
        ...(vote === 0 || vote === 1 ? { vote } : {}),
        ...(typeof timestamp === 'number' ? { timestamp } : {}),
        ...(typeof elapsedMs === 'number' ? { elapsedMs } : {}),
        ...(typeof timeSpentWaiting === 'number' ? { timeSpentWaiting } : {}),
        ...(typeof completionTokens === 'number' ? { completionTokens } : {}),
      },
    } satisfies PersistedHostTurnResponse;
  }

  private normalizeSidecar(sidecar: HostSessionSidecar | undefined): HostSessionSidecar | undefined {
    const compatMessages = Array.isArray(sidecar?.response?.compatMessages)
      ? [...sidecar.response.compatMessages]
      : undefined;

    if (!compatMessages?.length) {
      return undefined;
    }

    return {
      response: {
        ...(compatMessages?.length ? { compatMessages } : {}),
      },
    };
  }

  private normalizeMetadata(raw: any, sessionId: string, projectPath: string | null): SessionMetadata {
    const now = Date.now();
    const metadata = raw && typeof raw === 'object' ? raw : {};
    const rawToolSourceTokens = metadata.contextBudget?.toolSourceTokens;
    const toolSourceTokens = rawToolSourceTokens && typeof rawToolSourceTokens === 'object'
      ? Object.fromEntries(
          Object.entries(rawToolSourceTokens)
            .filter((entry): entry is [string, number] => (
              typeof entry[0] === 'string'
              && entry[0].length > 0
              && typeof entry[1] === 'number'
              && Number.isFinite(entry[1])
              && entry[1] > 0
            )),
        )
      : {};
    return {
      sessionId: typeof metadata.sessionId === 'string' && metadata.sessionId ? metadata.sessionId : sessionId,
      title: typeof metadata.title === 'string' ? metadata.title : '',
      projectPath: metadata.projectPath ?? projectPath ?? null,
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
      mode: typeof metadata.mode === 'string' && metadata.mode ? metadata.mode : 'agent',
      model: typeof metadata.model === 'string' ? metadata.model : null,
      contextBudget: metadata.contextBudget && typeof metadata.contextBudget === 'object'
        ? {
            currentTokens: typeof metadata.contextBudget.currentTokens === 'number' ? metadata.contextBudget.currentTokens : 0,
            maxContextTokens: typeof metadata.contextBudget.maxContextTokens === 'number'
              ? metadata.contextBudget.maxContextTokens
              : 0,
            usagePercent: typeof metadata.contextBudget.usagePercent === 'number' ? metadata.contextBudget.usagePercent : 0,
            systemTokens: typeof metadata.contextBudget.systemTokens === 'number' ? metadata.contextBudget.systemTokens : 0,
            baseSystemTokens: typeof metadata.contextBudget.baseSystemTokens === 'number' ? metadata.contextBudget.baseSystemTokens : 0,
            instructionTokens: typeof metadata.contextBudget.instructionTokens === 'number' ? metadata.contextBudget.instructionTokens : 0,
            skillTokens: typeof metadata.contextBudget.skillTokens === 'number' ? metadata.contextBudget.skillTokens : 0,
            toolsTokens: typeof metadata.contextBudget.toolsTokens === 'number' ? metadata.contextBudget.toolsTokens : 0,
            toolSourceTokens,
            messagesTokens: typeof metadata.contextBudget.messagesTokens === 'number' ? metadata.contextBudget.messagesTokens : 0,
            toolResultsTokens: typeof metadata.contextBudget.toolResultsTokens === 'number' ? metadata.contextBudget.toolResultsTokens : 0,
            messageCount: typeof metadata.contextBudget.messageCount === 'number' ? metadata.contextBudget.messageCount : 0,
          }
        : undefined,
      requestContext: cloneSessionRequestContextSnapshot(metadata.requestContext),
      activeSkillNames: normalizeActiveSkillNames(metadata.activeSkillNames),
      toolCallingIteration: typeof metadata.toolCallingIteration === 'number' ? metadata.toolCallingIteration : 0,
    };
  }

  private hasFs(): boolean {
    return typeof window !== 'undefined' && !!AilyHost.get().fs;
  }

  private fileExists(path: string): boolean {
    try {
      return AilyHost.get().fs.existsSync(path);
    } catch {
      return false;
    }
  }

  private readFileSync(path: string): string {
    return AilyHost.get().fs.readFileSync(path, 'utf-8');
  }

  private writeFileSync(path: string, content: string): void {
    AilyHost.get().fs.writeFileSync(path, content, 'utf-8');
  }

  private ensureDir(dirPath: string): void {
    if (!this.fileExists(dirPath)) {
      AilyHost.get().fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}