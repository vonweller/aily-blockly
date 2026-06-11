import type { TurnRequest, TurnResponseTurn, SessionSnapshot } from 'aily-lex/browser';
import { DEFAULT_CHAT_SESSION_TYPE, normalizeChatSelectedMode, normalizeChatSessionType, normalizeChatSurfaceModeId } from '../core/chat-mode';
import {
  normalizeChatAgentRuntimeMode,
  readChatAgentRuntimeModeSourceFromMetadata,
  readChatAgentRuntimeModeFromMetadata,
  type ChatAgentRuntimeMode,
  type ChatAgentRuntimeModeSource,
} from '../core/chat-agent-runtime-mode';

import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import {
  buildHostProjectionStateFromPersistedRecord,
  buildTurnNativeRestoreChatList,
  type HostResponseProjection,
  type HostTurnResponseState,
} from './host-turn-response-state';
import { ChatViewWriteBridge, type ChatViewWriteBridgeContext } from './chat-view-write-bridge';
import { projectTurnResponsesToHistory } from './turn-response-history-projector';
import { normalizeTurnResponseSummaryPreview } from './turn-response-response-model';
import {
  resolveHostSessionModeDescriptorFromMetadata,
  resolveHostSessionProviderOptions,
  resolveHostSessionSelectedModeFromMetadata,
} from './host-session-input-state';
import { cloneHostSessionRuntimeAuxiliary } from './host-session-runtime-auxiliary';
import { HostSessionContentProvider } from './host-session-content-provider';
import type { HostSessionContent } from './host-session-content-provider';
import { type ChatSessionTitleSource } from '../core/chat-session-title';
import { resolveHostSessionRequestRoutingSummary } from './host-session-request-routing';
import { normalizeHostSessionRequestRoutingSummary } from './host-session-request-routing';
import type { LexSessionStoredSnapshotState, ResolvedLexSessionRestorePlan } from './host-session-restore-resolver';

import type { HostSessionRecord } from '../services/chat-history.service';
import type { ChatSessionRuntimeState } from '../services/chat-session-runtime-store.service';
import type { AskUserAnswer, AskUserQuestion } from '../core/ask-user';
import type { ConfirmationPart, QuestionPart } from '../core/chat-parts';
import type { RuntimePlanReviewAction, RuntimePlanReviewDecision } from '../services/chat-runtime-interaction-host.service';

type LexInteractionAction = NonNullable<TurnRequest['metadata']>['interactionAction'];
type LexTurnContinuation = NonNullable<TurnResponseTurn['response']['continuation']>;
type LexSessionInteractionContinuation = NonNullable<
  NonNullable<SessionSnapshot['requestContext']>['interactionContinuation']
>;

function applyCurrentSessionTitle(
  chatService: {
    currentSessionTitle?: string;
    setCurrentSessionTitle?: (candidate: { text: string; source: ChatSessionTitleSource }) => void;
  },
  candidate: { text: string; source: ChatSessionTitleSource },
): void {
  if (typeof chatService.setCurrentSessionTitle === 'function') {
    chatService.setCurrentSessionTitle(candidate);
    return;
  }

  chatService.currentSessionTitle = candidate.text;
}

const KNOWN_PLAN_REVIEW_ACTIONS: Readonly<Record<string, {
  readonly label: string;
  readonly description: string;
  readonly permissionLevel?: 'autopilot';
}>> = {
  autopilot: {
    label: 'Implement with Autopilot',
    description: 'Auto-approve all tool calls and continue until the task is done.',
    permissionLevel: 'autopilot',
  },
  autopilot_fleet: {
    label: 'Implement with Autopilot Fleet',
    description: 'Auto-approve all tool calls, including fleet management actions, and continue until the task is done.',
    permissionLevel: 'autopilot',
  },
  interactive: {
    label: 'Implement Plan',
    description: 'Implement the plan, asking for input and approval for each action.',
  },
  exit_only: {
    label: 'Approve Plan Only',
    description: 'Approve the plan without executing it. I will implement it myself.',
  },
};

function readInteractionPendingRecord(
  continuation: LexSessionInteractionContinuation | LexTurnContinuation | undefined,
): Record<string, unknown> | undefined {
  const pending = continuation?.pendingState;
  return pending && typeof pending === 'object' ? pending : undefined;
}

function resolveRestoredSessionTitle(sessionContent?: HostSessionContent | null): { text: string; source: ChatSessionTitleSource } {
  const persistedTitle = typeof sessionContent?.title === 'string'
    ? sessionContent.title.trim()
    : '';
  if (isMeaningfulRestoredSessionTitle(persistedTitle)) {
    return {
      text: persistedTitle,
      source: 'restored-custom',
    };
  }

  const fallbackDefaultTitle = deriveDefaultTitleFromTurnResponses(sessionContent?.hostRecord?.turnResponses);
  return isMeaningfulRestoredSessionTitle(fallbackDefaultTitle)
    ? {
      text: fallbackDefaultTitle,
      source: 'default-first-request',
    }
    : {
      text: '',
      source: 'empty',
    };
}

function deriveDefaultTitleFromTurnResponses(turnResponses: readonly unknown[] | null | undefined): string {
  if (!Array.isArray(turnResponses) || turnResponses.length === 0) {
    return '';
  }

  for (const turnResponse of turnResponses) {
    const request = (turnResponse as { request?: unknown })?.request;
    const title = deriveDefaultTitleFromRequest(request);
    if (title) {
      return title;
    }
  }

  return '';
}

function deriveDefaultTitleFromRequest(request: unknown): string {
  const direct = readRequestTextCandidate(request);
  if (direct) {
    return direct;
  }

  if (request && typeof request === 'object') {
    const nested = readRequestTextCandidate((request as { message?: unknown }).message);
    if (nested) {
      return nested;
    }
  }

  return '';
}

function readRequestTextCandidate(candidate: unknown): string {
  const text = typeof candidate === 'string'
    ? candidate
    : candidate && typeof candidate === 'object'
      ? ((candidate as { messageText?: unknown }).messageText
        ?? (candidate as { prompt?: unknown }).prompt
        ?? (candidate as { text?: unknown }).text
        ?? (candidate as { content?: unknown }).content)
      : undefined;

  if (typeof text !== 'string') {
    return '';
  }

  const normalized = text.trim();
  if (!normalized) {
    return '';
  }

  return normalized.split('\n')[0]?.trim().substring(0, 200) ?? '';
}

function isMeaningfulRestoredSessionTitle(title: unknown): boolean {
  if (typeof title !== 'string') {
    return false;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return false;
  }

  const normalizedLower = normalizedTitle.toLowerCase();
  if (/^lex-\d{6,}$/i.test(normalizedTitle)) {
    return false;
  }
  if (/^untitled(?:\s+chat)?(?:\s*\d+)?$/i.test(normalizedTitle)) {
    return false;
  }

  return normalizedLower !== 'new session'
    && normalizedLower !== 'new chat'
    && normalizedTitle !== '新会话'
    && normalizedTitle !== '新对话'
    && normalizedTitle !== '无标题会话';
}
type HostSessionRestoreContext = ChatViewWriteBridgeContext
  & Pick<IAgentLifecycle, 'toolCallingIteration'>
  & Pick<IProjectContext, 'currentMode'>
  & Pick<ISessionAccess, 'conversationMessages' | 'chatService'>
  & Pick<IChatServiceAccess, 'contextBudgetService' | 'editCheckpointService' | 'ailyChatConfigService' | 'runtimeInteractionHost'>
  & Pick<IChatCoordination, 'lexStream'>
  & {
    readSessionRuntimeState?(sessionId?: string | null): Readonly<ChatSessionRuntimeState> | undefined;
    projectRestoredRuntimeAuxiliary?(
      sessionId: string,
      auxiliary: HostSessionRecord['auxiliary'] | null | undefined,
    ): void;
    readCurrentViewSessionResource?(): string | null;
    projectRestoredHostProjection?(
      sessionId: string,
      turnResponses: readonly TurnResponseTurn[],
      hostProjectionState: HostTurnResponseState,
      options: { readonly attachedView: boolean },
    ): void;
    resumeRestoredInteraction?(
      content: string,
      interactionAction: LexInteractionAction,
      options?: {
        readonly sessionId?: string | null;
        readonly requestMetadata?: TurnRequest['metadata'];
      },
    ): Promise<void>;
    restoreSharedHostProjectionState?(
      state: HostTurnResponseState | null,
      options: { readonly sessionId: string | null; readonly attachedView?: boolean },
    ): void;
    replaceSharedHostProjectionState?(
      state: HostTurnResponseState | null,
      options: { readonly sessionId: string | null; readonly attachedView?: boolean },
    ): void;
  };

type HostSessionRestoreViewWriteContext = ConstructorParameters<typeof ChatViewWriteBridge>[0];

type HostSessionRestoreViewWriteAccess = Pick<
  ChatViewWriteBridge,
  'restoreLegacyHistoryList' | 'restoreTurnNativeHistoryList'
>;

export interface RuntimeRestoreHostRecordRequest {
  readonly target: {
    readonly sessionId: string;
    readonly sessionType: string;
    readonly projectPath: string | null;
    readonly agentRuntimeMode?: ChatAgentRuntimeMode;
    readonly agentRuntimeModeSource?: ChatAgentRuntimeModeSource;
    readonly inputState?: HostSessionContent['inputState'];
  };
  readonly sessionContent: HostSessionContent;
  readonly hostRecord: HostSessionRecord | null;
}

export type HostSessionRestoreFailureKind =
  | 'host-record-session-mismatch'
  | 'restore-plan-resolution-failed'
  | 'restore-plan-apply-failed';

export interface HostSessionRestoreFailureDetails {
  readonly kind: HostSessionRestoreFailureKind;
  readonly sessionId: string;
  readonly hostRecordSessionId?: string;
  readonly storedSnapshotState?: LexSessionStoredSnapshotState;
}

export interface HostSessionRestoreOptions {
  readonly isCurrent?: () => boolean;
  readonly sessionId?: string | null;
}

export class HostSessionRestoreError extends Error {
  readonly details: HostSessionRestoreFailureDetails;

  constructor(message: string, details: HostSessionRestoreFailureDetails, cause?: unknown) {
    super(message);
    this.name = 'HostSessionRestoreError';
    this.details = details;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function readHostSessionRestoreFailureDetails(error: unknown): HostSessionRestoreFailureDetails | null {
  return error instanceof HostSessionRestoreError ? error.details : null;
}

/**
 * Restores host-side persisted chat history back into the active UI/session state.
 *
 * Keeps host record application, Part reconstruction, lex restore handoff,
 * and post-restore host sync out of SessionLifecycleHelper.
 */
export class HostSessionRestoreBridge {
  private readonly viewWriteBridge: HostSessionRestoreViewWriteAccess;
  private readonly hostSessionContentProvider: HostSessionContentProvider;

  constructor(private readonly ctx: HostSessionRestoreContext) {
    const viewWriteContext: HostSessionRestoreViewWriteContext = {
      get list() {
        return ctx.list;
      },
      set list(list) {
        ctx.list = list;
      },
      get partStore() {
        return ctx.partStore;
      },
      get viewAdapter() {
        return ctx.viewAdapter;
      },
      get scrollManager() {
        return ctx.scrollManager;
      },
      get invalidateHostRequestGraph() {
        return ctx.invalidateHostRequestGraph;
      },
      get triggerSyncDetectChanges() {
        return ctx.triggerSyncDetectChanges;
      },
      get sessionId() {
        return ctx.sessionId;
      },
      get chatHistoryService() {
        return ctx.chatHistoryService;
      },
      get currentModelName() {
        return ctx.currentModelName;
      },
      get currentMessageSource() {
        return ctx.currentMessageSource;
      },
      get ngZone() {
        return ctx.ngZone;
      },
      markCurrentViewVisibleProjectionOwner: () => ctx.markCurrentViewVisibleProjectionOwner?.(),
    };
    this.viewWriteBridge = new ChatViewWriteBridge(viewWriteContext);
    this.hostSessionContentProvider = new HostSessionContentProvider({
      get sessionId() {
        return ctx.sessionId;
      },
      get chatService() {
        return ctx.chatService as any;
      },
      get chatHistoryService() {
        return ctx.chatHistoryService as any;
      },
    });
  }

  async restore(
    hostRecord: HostSessionRecord,
    options: HostSessionRestoreOptions = {},
  ): Promise<void> {
    const isCurrent = options.isCurrent ?? (() => true);
    const targetSessionId = this.resolveRestoreTargetSessionId(hostRecord, options.sessionId);
    const sanitizedHostRecord = sanitizeHostRecordForRestore(hostRecord);
    this.assertHostRecordMatchesTargetSession(sanitizedHostRecord, targetSessionId);

    let restorePlan: ResolvedLexSessionRestorePlan | null = null;
    try {
      restorePlan = await this.ctx.lexStream.session.resolveRestorePlan(
        targetSessionId,
        sanitizedHostRecord.turnResponses,
        sanitizedHostRecord,
      );
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      throw this.createRestoreFailure(
        'restore-plan-resolution-failed',
        targetSessionId,
        null,
        error,
      );
    }

    try {
      const resolvedLexSnapshot = restorePlan?.snapshot ?? null;
      const restoredLexSession = resolvedLexSnapshot
        ? this.ctx.lexStream.session.restoreResolvedSnapshot(resolvedLexSnapshot, targetSessionId)
        : false;

      const restoredSnapshot = restoredLexSession
        ? this.ctx.lexStream.session.snapshot?.(targetSessionId) ?? resolvedLexSnapshot
        : null;
      const turnResponses = [...(restorePlan?.turnResponses ?? sanitizedHostRecord.turnResponses ?? [])];
      const hostResponseState = this.resolveRuntimeHostProjectionState(targetSessionId, turnResponses)
        ?? buildHostProjectionStateFromPersistedRecord({
          turnResponses,
        });

      const shouldAttachVisibleProjection = isCurrent() && this.isVisibleRestoreTarget(targetSessionId);
      this.ctx.projectRestoredHostProjection?.(targetSessionId, turnResponses, hostResponseState, {
        attachedView: shouldAttachVisibleProjection,
      });
      this.ctx.projectRestoredRuntimeAuxiliary?.(targetSessionId, sanitizedHostRecord.auxiliary);

      if (!shouldAttachVisibleProjection) {
        return;
      }

      this.restoreSessionMetadata(sanitizedHostRecord, targetSessionId);
      this.ctx.lexStream.hydrateTurnResponses?.(targetSessionId, turnResponses, {
        visibility: 'visibleAttach',
      });
      this.applyHostView(hostResponseState);
      if (this.ctx.restoreSharedHostProjectionState) {
        this.ctx.restoreSharedHostProjectionState(hostResponseState, {
          sessionId: targetSessionId,
          attachedView: true,
        });
      } else {
        this.ctx.replaceSharedHostProjectionState?.(hostResponseState, {
          sessionId: targetSessionId,
          attachedView: true,
        });
      }
      await this.ctx.chatService.syncResolvedActiveModelAfterSuccessfulTurn?.(
        targetSessionId,
        hostResponseState.turnResponses,
      );
      this.restorePendingRuntimeInteraction(targetSessionId, hostResponseState.turnResponses);

      // Restore context budget: prefer persisted lex-derived values over local estimate
      const savedBudget = hostRecord.metadata?.contextBudget;
      if (savedBudget && savedBudget.maxContextTokens > 0 && savedBudget.currentTokens > 0) {
        this.ctx.contextBudgetService?.applyLexBudgetEvent(
          savedBudget.maxContextTokens,
          savedBudget.currentTokens,
          {
            usagePercent: savedBudget.usagePercent,
            systemTokens: savedBudget.systemTokens,
            baseSystemTokens: savedBudget.baseSystemTokens,
            instructionTokens: savedBudget.instructionTokens,
            skillTokens: savedBudget.skillTokens,
            toolsTokens: savedBudget.toolsTokens,
            toolSourceTokens: savedBudget.toolSourceTokens,
            messagesTokens: savedBudget.messagesTokens,
            toolResultsTokens: savedBudget.toolResultsTokens,
            messageCount: savedBudget.messageCount,
          },
        );
      } else {
        this.ctx.contextBudgetService?.refreshLocalEstimate(
          restoredSnapshot ? this.ctx.conversationMessages : [],
          this.ctx.lexStream.runtime.tools(),
        );
      }

      await this.restoreEditCheckpoints(hostResponseState.turnResponses);
      if (!isCurrent()) {
        return;
      }
      this.finalizeRestoreUi(Boolean(restoredSnapshot));
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      throw this.createRestoreFailure('restore-plan-apply-failed', targetSessionId, restorePlan, error);
    }
  }

  buildRuntimeRestoreHostRecord(request: RuntimeRestoreHostRecordRequest): HostSessionRecord | null {
    const runtimeState = this.ctx.readSessionRuntimeState?.(request.target.sessionId);
    if (!runtimeState) {
      return null;
    }

    const baseHostRecord = request.hostRecord;
    const baseMetadata = baseHostRecord?.metadata;
    const providerOptions = request.sessionContent.providerOptions;
    const projectPath = request.sessionContent.projectPathHint
      ?? providerOptions.folderPath
      ?? request.target.projectPath
      ?? baseMetadata?.projectPath
      ?? null;
    const mode = typeof request.sessionContent.metadata?.mode === 'string'
      ? normalizeChatSurfaceModeId(request.sessionContent.metadata.mode)
      : baseMetadata?.mode ?? this.ctx.currentMode;
    const requestRouting = request.sessionContent.metadata?.requestRouting
      ? normalizeHostSessionRequestRoutingSummary(
          request.sessionContent.metadata.requestRouting,
          request.sessionContent.metadata.mode ?? this.ctx.currentMode,
        )
      : baseMetadata?.requestRouting;
    const inputState = request.sessionContent.inputState
      ?? baseMetadata?.inputState
      ?? request.target.inputState;
    const now = Date.now();

    const runtimeTurnResponses = Array.isArray(runtimeState.turnResponses)
      ? runtimeState.turnResponses
      : [];
    const fallbackTurnResponses = runtimeTurnResponses.length > 0
      ? runtimeTurnResponses
      : stableDurableTurnResponsesForRuntimeRestore(baseHostRecord?.turnResponses ?? []);
    const runtimeAuxiliary = cloneHostSessionRuntimeAuxiliary({
      ...(baseHostRecord?.auxiliary ?? {}),
      pendingFollowupRequests: runtimeState.pendingFollowupRequests,
      yieldRequested: runtimeState.yieldRequested === true,
    });

    return {
      ...(baseHostRecord?.sidecar ? { sidecar: baseHostRecord.sidecar } : {}),
      ...(runtimeAuxiliary ? { auxiliary: runtimeAuxiliary } : {}),
      turnResponses: [...fallbackTurnResponses],
      metadata: {
        sessionId: request.target.sessionId,
        title: request.sessionContent.title ?? baseMetadata?.title ?? '',
        sessionType: normalizeChatSessionType(
          request.sessionContent.sessionType ?? baseMetadata?.sessionType ?? request.target.sessionType,
          DEFAULT_CHAT_SESSION_TYPE,
        ),
        projectPath,
        createdAt: baseMetadata?.createdAt ?? now,
        updatedAt: now,
        mode,
        agentRuntimeMode: request.target.agentRuntimeMode
          ?? baseMetadata?.agentRuntimeMode
          ?? baseMetadata?.runtimeMode,
        agentRuntimeModeSource: request.target.agentRuntimeModeSource
          ?? baseMetadata?.agentRuntimeModeSource
          ?? baseMetadata?.runtimeModeSource,
        ...(baseMetadata?.modeDescriptor ? { modeDescriptor: baseMetadata.modeDescriptor } : {}),
        ...(inputState ? { inputState } : {}),
        ...(requestRouting ? { requestRouting } : {}),
        ...(baseMetadata?.interactionActionSummary
          ? { interactionActionSummary: baseMetadata.interactionActionSummary }
          : {}),
        model: baseMetadata?.model ?? this.ctx.currentModelName,
        ...(baseMetadata?.contextBudget ? { contextBudget: baseMetadata.contextBudget } : {}),
        ...(baseMetadata?.requestContext ? { requestContext: baseMetadata.requestContext } : {}),
        ...(baseMetadata?.activeSkillNames ? { activeSkillNames: baseMetadata.activeSkillNames } : {}),
        toolCallingIteration: baseMetadata?.toolCallingIteration ?? this.ctx.toolCallingIteration ?? 0,
      },
    };
  }

  async restoreSessionProjection(sessionId: string | null | undefined, projectPathHint?: string | null): Promise<boolean> {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    const indexEntry = this.ctx.chatHistoryService.findEntry(targetSessionId) ?? null;
    const sessionContent = this.hostSessionContentProvider.provideChatSessionContent(targetSessionId, projectPathHint, {
      metadataFallback: indexEntry,
    });
    const hostRecord = this.buildRuntimeRestoreHostRecord({
      target: {
        sessionId: targetSessionId,
        sessionType: sessionContent.sessionType,
        projectPath: sessionContent.projectPathHint
          ?? sessionContent.providerOptions.folderPath
          ?? indexEntry?.projectPath
          ?? null,
        agentRuntimeMode: readChatAgentRuntimeModeFromMetadata(sessionContent.metadata)
          ?? indexEntry?.agentRuntimeMode,
        agentRuntimeModeSource: readChatAgentRuntimeModeSourceFromMetadata(sessionContent.metadata)
          ?? indexEntry?.agentRuntimeModeSource,
        inputState: sessionContent.inputState,
      },
      sessionContent,
      hostRecord: sessionContent.hostRecord,
    }) ?? sessionContent.hostRecord;
    if (!hostRecord) {
      return false;
    }

    await this.restore(hostRecord, { sessionId: targetSessionId });
    return true;
  }

  private resolveRestoreTargetSessionId(hostRecord: HostSessionRecord, requestedSessionId?: string | null): string {
    const explicitSessionId = typeof requestedSessionId === 'string' ? requestedSessionId.trim() : '';
    const hostRecordSessionId = typeof hostRecord.metadata?.sessionId === 'string'
      ? hostRecord.metadata.sessionId.trim()
      : '';
    return explicitSessionId || hostRecordSessionId;
  }

  private assertHostRecordMatchesTargetSession(hostRecord: HostSessionRecord, targetSessionId: string): void {
    const hostRecordSessionId = typeof hostRecord.metadata?.sessionId === 'string'
      ? hostRecord.metadata.sessionId.trim()
      : '';
    if (!targetSessionId || !hostRecordSessionId || targetSessionId === hostRecordSessionId) {
      return;
    }

    const details: HostSessionRestoreFailureDetails = {
      kind: 'host-record-session-mismatch',
      sessionId: targetSessionId,
      hostRecordSessionId,
    };
    throw new HostSessionRestoreError(
      `[HostSessionRestoreBridge] Restore target mismatch (${formatHostSessionRestoreFailureDetails(details)})`,
      details,
    );
  }

  private createRestoreFailure(
    kind: HostSessionRestoreFailureKind,
    sessionId: string,
    restorePlan: ResolvedLexSessionRestorePlan | null,
    cause: unknown,
  ): HostSessionRestoreError {
    const details: HostSessionRestoreFailureDetails = {
      kind,
      sessionId,
      ...(restorePlan?.diagnostics?.storedSnapshotState
        ? { storedSnapshotState: restorePlan.diagnostics.storedSnapshotState }
        : {}),
    };
    return new HostSessionRestoreError(
      `[HostSessionRestoreBridge] Restore failed (${formatHostSessionRestoreFailureDetails(details)}): ${toHostSessionRestoreErrorMessage(cause)}`,
      details,
      cause,
    );
  }

  private applyHostView(hostResponseState: Pick<HostResponseProjection, 'turnResponses' | 'chatList'>): void {
    if (hostResponseState.turnResponses.length === 0) {
      this.viewWriteBridge.restoreLegacyHistoryList(hostResponseState.chatList);
      return;
    }

    const turnIds = new Set(hostResponseState.turnResponses.map(turn => turn.turnId));
    this.viewWriteBridge.restoreTurnNativeHistoryList(
      buildTurnNativeRestoreChatList(hostResponseState.chatList, turnIds),
      turnIds,
    );

    projectTurnResponsesToHistory(this.ctx, hostResponseState.turnResponses);
  }

  private resolveRuntimeHostProjectionState(
    sessionId: string,
    turnResponses: readonly TurnResponseTurn[],
  ): HostTurnResponseState | null {
    const runtimeState = this.ctx.readSessionRuntimeState?.(sessionId);
    const hostProjectionState = runtimeState?.hostProjectionState;
    if (!hostProjectionState) {
      return null;
    }

    return areHostProjectionTurnResponsesEquivalent(hostProjectionState.turnResponses, turnResponses)
      ? hostProjectionState
      : null;
  }

  private restoreSessionMetadata(hostRecord: HostSessionRecord, sessionId: string): void {
    const indexEntry = this.ctx.chatHistoryService.findEntry(sessionId);
    const sessionContent = this.hostSessionContentProvider.provideChatSessionContent(sessionId, undefined, {
      hostRecordOverride: hostRecord,
      metadataFallback: indexEntry,
    });
    const sessionMetadata = {
      mode: hostRecord.metadata?.mode ?? indexEntry?.mode,
      agentRuntimeMode: hostRecord.metadata?.agentRuntimeMode ?? indexEntry?.agentRuntimeMode,
      runtimeMode: hostRecord.metadata?.runtimeMode ?? indexEntry?.runtimeMode,
      agentRuntimeModeSource: hostRecord.metadata?.agentRuntimeModeSource ?? indexEntry?.agentRuntimeModeSource,
      runtimeModeSource: hostRecord.metadata?.runtimeModeSource ?? indexEntry?.runtimeModeSource,
      modeDescriptor: hostRecord.metadata?.modeDescriptor ?? indexEntry?.modeDescriptor,
      inputState: hostRecord.metadata?.inputState ?? indexEntry?.inputState,
      requestRouting: hostRecord.metadata?.requestRouting ?? indexEntry?.requestRouting,
      interactionActionSummary: hostRecord.metadata?.interactionActionSummary,
      sessionType: hostRecord.metadata?.sessionType ?? indexEntry?.sessionType,
      projectPath: hostRecord.metadata?.projectPath ?? indexEntry?.projectPath,
    };

    applyCurrentSessionTitle(this.ctx.chatService, resolveRestoredSessionTitle(sessionContent));

    const sessionType = normalizeChatSessionType(
      sessionContent?.sessionType ?? sessionMetadata?.sessionType,
      DEFAULT_CHAT_SESSION_TYPE,
    );
    const providerOptions = sessionContent?.providerOptions ?? resolveHostSessionProviderOptions(hostRecord);
    this.ctx.chatService.applySessionIdentity({
      sessionType,
      providerOptions,
      inputState: sessionContent?.inputState ?? sessionMetadata?.inputState,
    });
    this.ctx.chatService.setCurrentAgentRuntimeMode?.(
      normalizeChatAgentRuntimeMode(
        sessionMetadata.agentRuntimeMode ?? sessionMetadata.runtimeMode,
        this.ctx.chatService.currentAgentRuntimeMode ?? 'unbound',
      ),
      sessionMetadata.agentRuntimeModeSource ?? sessionMetadata.runtimeModeSource ?? 'restored',
    ) ?? (this.ctx.chatService.currentAgentRuntimeMode = normalizeChatAgentRuntimeMode(
      sessionMetadata.agentRuntimeMode ?? sessionMetadata.runtimeMode,
      this.ctx.chatService.currentAgentRuntimeMode ?? 'unbound',
    ));

    const resolveModeById = (modeId: string) => typeof this.ctx.chatService.findResolvedModeById === 'function'
      ? this.ctx.chatService.findResolvedModeById(modeId)
      : undefined;
    const hasSessionPickerMetadata = !!sessionMetadata?.modeDescriptor
      || !!sessionMetadata?.inputState
      || !!sessionMetadata?.requestRouting;
    const mergedSelectedMode = hasSessionPickerMetadata
      ? resolveHostSessionSelectedModeFromMetadata({
          mode: sessionMetadata?.mode,
          modeDescriptor: sessionMetadata?.modeDescriptor,
          inputState: sessionMetadata?.inputState,
          requestRouting: sessionMetadata?.requestRouting,
        }, { resolveModeById })
      : normalizeChatSelectedMode({
          modeId: resolveHostSessionRequestRoutingSummary(hostRecord).selectedModeId,
          customAgentTarget: resolveHostSessionRequestRoutingSummary(hostRecord).customAgentTarget,
        });
    const storedModeDescriptor = hasSessionPickerMetadata
      ? resolveHostSessionModeDescriptorFromMetadata({
          mode: sessionMetadata?.mode,
          modeDescriptor: sessionMetadata?.modeDescriptor,
          inputState: sessionMetadata?.inputState,
          requestRouting: sessionMetadata?.requestRouting,
        }, { resolveModeById })
      : undefined;
    const storedModeId = typeof storedModeDescriptor?.id === 'string' && storedModeDescriptor.id.trim().length > 0
      ? storedModeDescriptor.id.trim()
      : typeof sessionMetadata?.inputState?.mode?.id === 'string'
        ? sessionMetadata.inputState.mode.id.trim()
      : '';
    if (storedModeId && typeof this.ctx.chatService.setChatMode === 'function') {
      this.ctx.chatService.setChatMode(storedModeId, false);
      if (mergedSelectedMode.modeId === 'agent'
        && mergedSelectedMode.customAgentTarget
        && this.ctx.chatService.currentCustomAgentTarget !== mergedSelectedMode.customAgentTarget
        && typeof this.ctx.chatService.setSelectedMode === 'function') {
        this.ctx.chatService.setSelectedMode(
          {
            modeId: mergedSelectedMode.modeId,
            customAgentTarget: mergedSelectedMode.customAgentTarget,
          },
          { persist: false },
        );
      }
    } else if (typeof this.ctx.chatService.setSelectedMode === 'function') {
      this.ctx.chatService.setSelectedMode(
        {
          modeId: mergedSelectedMode.modeId,
          customAgentTarget: mergedSelectedMode.customAgentTarget,
        },
        { persist: false },
      );
    } else {
      this.ctx.chatService.currentMode = mergedSelectedMode.modeId;
      this.ctx.chatService.currentCustomAgentTarget = mergedSelectedMode.modeId === 'agent'
        ? mergedSelectedMode.customAgentTarget
        : undefined;
    }

    this.ctx.toolCallingIteration = hostRecord.metadata?.toolCallingIteration || 0;
  }

  private async restoreEditCheckpoints(turnResponses: readonly TurnResponseTurn[]): Promise<void> {
    this.ctx.editCheckpointService?.clear();
    try {
      const fileHistory = this.ctx.lexStream.agent.getHandle?.()?.getFileHistory()
        ?? this.ctx.lexStream.agent.getAgent()?.getFileHistory?.();
      if (fileHistory) {
        this.ctx.editCheckpointService.setFileHistory(fileHistory);
      }
    } catch {
      // ignore file history restore failures
    }

    if (turnResponses.length > 0) {
      await this.ctx.editCheckpointService?.rebuildFromTurnResponses?.(turnResponses);
    }

    if (this.ctx.editCheckpointService?.hasUnsavedEdits()) {
      if (this.ctx.ailyChatConfigService.autoSaveEdits) {
        this.ctx.editCheckpointService.acceptAllAsBaseline();
        this.ctx.editCheckpointService.dismissSummary();
      } else {
        this.ctx.editCheckpointService.publishCurrentSummary();
      }
      return;
    }

    this.ctx.editCheckpointService?.dismissSummary();
  }

  private finalizeRestoreUi(_restoredLexSession: boolean): void {
    this.ctx.scrollManager.scrollToBottom('auto');
  }

  private restorePendingRuntimeInteraction(sessionId: string, turnResponses: readonly TurnResponseTurn[]): void {
    const interactionContinuation = this.ctx.lexStream.session.snapshot(sessionId)?.requestContext?.interactionContinuation;
    const pending = readInteractionPendingRecord(interactionContinuation);
    if (!pending || pending['kind'] === 'none') {
      return;
    }

    if (pending['kind'] === 'question') {
      this.restorePendingQuestion(sessionId, turnResponses);
      return;
    }

    if (pending['kind'] === 'confirmation') {
      this.restorePendingConfirmation(sessionId, turnResponses, interactionContinuation!);
      return;
    }

    if (pending['kind'] === 'plan_review') {
      this.restorePendingPlanReview(sessionId, interactionContinuation!);
    }
  }

  private isVisibleRestoreTarget(sessionId: string): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    const currentViewSessionResource = typeof this.ctx.readCurrentViewSessionResource === 'function'
      ? this.ctx.readCurrentViewSessionResource()
      : null;
    const currentViewSessionId = typeof currentViewSessionResource === 'string'
      ? currentViewSessionResource.trim()
      : '';
    if (currentViewSessionId) {
      return currentViewSessionId === targetSessionId;
    }

    return false;
  }

  private restorePendingQuestion(sessionId: string, turnResponses: readonly TurnResponseTurn[]): void {
    const questionPart = findPendingQuestionPart(turnResponses);
    if (!questionPart?.partId) {
      return;
    }

    const questions = questionPart.questions.map<AskUserQuestion>((question) => ({
      question: question.question,
      options: question.options?.map(option => ({
        label: option.label,
        description: option.description,
        recommended: option.recommended,
      })),
      allow_freeform: question.allow_freeform,
      multi_select: question.multi_select,
    }));

    void this.ctx.runtimeInteractionHost.presentQuestion(sessionId, questionPart.partId, questions)
      .then(async (result) => {
        if (!result?.answers) {
          return;
        }

        this.ctx.lexStream.ui.updateQuestionAnswers(result.answers, questionPart.partId!);
        await this.ctx.resumeRestoredInteraction?.(
          buildQuestionAnswerResumeContent(result.answers),
          {
            kind: 'question_answer',
            payload: { answers: result.answers },
          },
          {
            sessionId,
          },
        );
      })
      .catch(() => undefined);
  }

  private restorePendingConfirmation(
    sessionId: string,
    turnResponses: readonly TurnResponseTurn[],
    continuation: LexTurnContinuation,
  ): void {
    const confirmationPart = findPendingConfirmationPart(turnResponses, continuation);
    if (!confirmationPart?.partId) {
      return;
    }

    void this.ctx.runtimeInteractionHost.presentConfirmation(sessionId, {
      askId: confirmationPart.askId,
      partId: confirmationPart.partId,
      toolName: confirmationPart.toolName,
      title: confirmationPart.title,
      subtitle: confirmationPart.subtitle,
      message: confirmationPart.message,
      args: isRecord(confirmationPart.args) ? confirmationPart.args : undefined,
      actions: Array.isArray(confirmationPart.actions) ? confirmationPart.actions : [],
      primaryScope: confirmationPart.primaryScope ?? 'once',
    })
      .then(async (result) => {
        this.ctx.lexStream.ui.resolveConfirmation(
          confirmationPart.partId!,
          confirmationPart.askId,
          result.approved,
          result.scope,
        );
        await this.ctx.resumeRestoredInteraction?.(
          buildConfirmationResumeContent(confirmationPart, result.approved),
          buildConfirmationInteractionAction(continuation, confirmationPart, result),
          {
            sessionId,
          },
        );
      })
      .catch(() => undefined);
  }

  private restorePendingPlanReview(
    sessionId: string,
    continuation: LexTurnContinuation,
  ): void {
    const pendingReview = readPendingPlanReview(continuation);
    if (!pendingReview) {
      return;
    }

    void this.ctx.runtimeInteractionHost.presentPlanReview(sessionId, pendingReview)
      .then(async (result) => {
        await this.ctx.resumeRestoredInteraction?.(
          buildPlanReviewResumeContent(pendingReview, result),
          buildPlanReviewInteractionAction(continuation, result),
          {
            sessionId,
          },
        );
      })
      .catch(() => undefined);
  }
}

function areHostProjectionTurnResponsesEquivalent(
  left: readonly TurnResponseTurn[] | null | undefined,
  right: readonly TurnResponseTurn[] | null | undefined,
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftTurn = left[index];
    const rightTurn = right[index];
    if (leftTurn.turnId !== rightTurn.turnId || leftTurn.updatedAt !== rightTurn.updatedAt) {
      return false;
    }
  }

  return true;
}

function formatHostSessionRestoreFailureDetails(details: HostSessionRestoreFailureDetails): string {
  return [
    `kind=${details.kind}`,
    `sessionId=${details.sessionId || 'unknown'}`,
    ...(details.hostRecordSessionId ? [`hostRecordSessionId=${details.hostRecordSessionId}`] : []),
    ...(details.storedSnapshotState ? [`storedSnapshotState=${details.storedSnapshotState}`] : []),
  ].join(', ');
}

function toHostSessionRestoreErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'unknown error';
}

function sanitizeHostRecordForRestore(hostRecord: HostSessionRecord): HostSessionRecord {
  if (!hostRecord.turnResponses?.length) {
    return hostRecord;
  }

  const hasTransientRestoreState = hostRecord.turnResponses.some(turn =>
    isTransientTurnResponseStatus(turn.response.status)
    || turn.response.parts.some(part => isTransientRuntimeStatePart(part)),
  );
  if (!hasTransientRestoreState) {
    return hostRecord;
  }

  return {
    ...hostRecord,
    turnResponses: hostRecord.turnResponses.map(turn => {
      const hasTransientRuntimeState = turn.response.parts.some(part => isTransientRuntimeStatePart(part));
      if (!isTransientTurnResponseStatus(turn.response.status) && !hasTransientRuntimeState) {
        return turn;
      }

      return sanitizeTurnResponseForRestore(turn);
    }),
  };
}

function stableDurableTurnResponsesForRuntimeRestore(
  turnResponses: readonly TurnResponseTurn[],
): readonly TurnResponseTurn[] {
  return turnResponses.filter(turn => !isTransientTurnResponseStatus(turn.response.status));
}

function isTransientTurnResponseStatus(status: unknown): boolean {
  return status === 'streaming'
    || status === 'in_progress'
    || status === 'pending';
}

function sanitizeTurnResponseForRestore(turn: TurnResponseTurn): TurnResponseTurn {
  const clonedTurn = cloneJsonLikeValue(turn);
  const responseStatus = isTransientTurnResponseStatus(clonedTurn.response.status)
    ? 'cancelled'
    : clonedTurn.response.status;

  return {
    ...clonedTurn,
    response: {
      ...clonedTurn.response,
      status: responseStatus,
      parts: clonedTurn.response.parts.filter(part => !isTransientRuntimeStatePart(part)),
    },
  };
}

function cloneJsonLikeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneJsonLikeValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [key, cloneJsonLikeValue(entryValue)]),
    ) as T;
  }

  return value;
}

function isTransientRuntimeStatePart(
  part: TurnResponseTurn['response']['parts'][number],
): boolean {
  return part.type === 'state'
    && (part.kind === 'compaction' || part.kind === 'provider_context_management');
}

function cloneSessionSnapshotRounds(
  snapshotRounds: readonly NonNullable<SessionSnapshot['turns']>[number]['rounds'][number][],
  fallbackRounds: TurnResponseTurn['rounds'],
): TurnResponseTurn['rounds'] {
  if (snapshotRounds.length === 0) {
    return [...fallbackRounds];
  }

  return snapshotRounds.map((round) => {
    const summary = normalizeTurnResponseSummaryPreview(round.summary);

    return {
      ...round,
      toolCalls: (round.toolCalls ?? []).map(toolCall => ({ ...toolCall })),
      ...(summary ? { summary } : {}),
    };
  });
}

function findPendingQuestionPart(turnResponses: readonly TurnResponseTurn[]): QuestionPart | null {
  for (let turnIndex = turnResponses.length - 1; turnIndex >= 0; turnIndex--) {
    const parts = turnResponses[turnIndex]?.response?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex] as Partial<QuestionPart> | undefined;
      if (part?.type !== 'question' || !Array.isArray(part.questions) || part.answers) {
        continue;
      }
      return part as QuestionPart;
    }
  }

  return null;
}

function findPendingConfirmationPart(
  turnResponses: readonly TurnResponseTurn[],
  continuation: LexTurnContinuation,
): ConfirmationPart | null {
  const pendingRecord = readInteractionPendingRecord(continuation);
  const pendingRequestId = typeof pendingRecord?.['requestId'] === 'string'
    ? pendingRecord['requestId']
    : undefined;

  for (let turnIndex = turnResponses.length - 1; turnIndex >= 0; turnIndex--) {
    const parts = turnResponses[turnIndex]?.response?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex] as Partial<ConfirmationPart> | undefined;
      if (part?.type !== 'confirmation' || part.resolved === true || typeof part.askId !== 'string') {
        continue;
      }

      if (pendingRequestId && part.askId !== pendingRequestId) {
        continue;
      }

      return part as ConfirmationPart;
    }
  }

  return null;
}

function buildQuestionAnswerResumeContent(answers: Record<string, AskUserAnswer>): string {
  const summary = Object.entries(answers)
    .map(([question, answer]) => {
      const parts = [
        ...answer.selected,
        ...(typeof answer.freeText === 'string' && answer.freeText.trim().length > 0 ? [answer.freeText.trim()] : []),
      ];
      const answerText = answer.skipped ? '已跳过' : (parts.join('，') || '已回答');
      return `${question}: ${answerText}`;
    })
    .filter(text => text.length > 0)
    .join('；');

  return summary.length > 0 ? `已回答问题：${summary}` : '已回答问题。';
}

function buildConfirmationResumeContent(part: ConfirmationPart, approved: boolean): string {
  const action = approved ? '已确认' : '已拒绝';
  const target = typeof part.toolName === 'string' && part.toolName.length > 0
    ? `${action}执行 ${part.toolName}。`
    : `${action}继续当前确认。`;
  return target;
}

function buildConfirmationInteractionAction(
  continuation: LexTurnContinuation,
  part: ConfirmationPart,
  result: { approved: boolean; scope?: string; reason?: string; actionId?: string },
): LexInteractionAction {
  const pendingRecord = readInteractionPendingRecord(continuation);
  const payload: Record<string, unknown> = {
    result: result.approved ? 'approved' : 'rejected',
    source: pendingRecord?.['sourceEvent'] === 'approval_request' ? 'approval' : 'confirmation',
    ...(typeof part.toolName === 'string' && part.toolName.length > 0 ? { toolName: part.toolName } : {}),
    ...(typeof pendingRecord?.['toolCallId'] === 'string' ? { toolCallId: pendingRecord['toolCallId'] } : {}),
    ...(typeof result.scope === 'string' ? { scope: result.scope } : {}),
    ...(typeof result.reason === 'string' && result.reason.length > 0 ? { reason: result.reason } : {}),
    ...(typeof result.actionId === 'string' && result.actionId.length > 0 ? { actionId: result.actionId } : {}),
  };

  return {
    kind: 'confirmation',
    payload,
  };
}

export function readPendingPlanReview(
  continuation: LexSessionInteractionContinuation | LexTurnContinuation | undefined,
): {
  id: string;
  title: string;
  planUri?: string;
  content: string;
  actions: readonly RuntimePlanReviewAction[];
  canProvideFeedback: boolean;
} | null {
  const pendingRecord = readInteractionPendingRecord(continuation);
  if (pendingRecord?.['kind'] !== 'plan_review') {
    return null;
  }

  const id = readNonEmptyString(pendingRecord['requestId']) ?? readNonEmptyString(pendingRecord['id']);
  const content = readNonEmptyString(pendingRecord['content']);
  const actions = Array.isArray(pendingRecord['actions'])
    ? pendingRecord['actions'].map(toRuntimePlanReviewAction).filter((action): action is RuntimePlanReviewAction => !!action)
    : [];

  if (!id || !content || actions.length === 0) {
    return null;
  }

  return {
    id,
    title: readNonEmptyString(pendingRecord['title']) ?? 'Review Plan',
    ...(readNonEmptyString(pendingRecord['plan']) ?? readNonEmptyString(pendingRecord['planUri'])
      ? { planUri: readNonEmptyString(pendingRecord['plan']) ?? readNonEmptyString(pendingRecord['planUri']) }
      : {}),
    content,
    actions,
    canProvideFeedback: pendingRecord['canProvideFeedback'] !== false,
  };
}

function toRuntimePlanReviewAction(value: unknown): RuntimePlanReviewAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readNonEmptyString(value['id']);
  const knownAction = id ? KNOWN_PLAN_REVIEW_ACTIONS[id] : undefined;
  const label = knownAction?.label ?? readNonEmptyString(value['label']);
  if (!id || !label) {
    return null;
  }

  return {
    id,
    label,
    ...((knownAction?.description ?? readNonEmptyString(value['description']))
      ? { description: knownAction?.description ?? readNonEmptyString(value['description']) }
      : {}),
    ...(value['default'] === true ? { default: true } : {}),
    ...((knownAction?.permissionLevel === 'autopilot' || value['permissionLevel'] === 'autopilot')
      ? { permissionLevel: 'autopilot' as const }
      : {}),
  };
}

export function buildPlanReviewResumeContent(
  review: { actions: readonly RuntimePlanReviewAction[] },
  result: RuntimePlanReviewDecision,
): string {
  const actionLabel = typeof result.actionId === 'string' && result.actionId.length > 0
    ? review.actions.find(action => action.id === result.actionId)?.label ?? result.actionId
    : undefined;
  const feedback = typeof result.feedback === 'string' ? result.feedback.trim() : '';

  if (feedback.length > 0) {
    return actionLabel
      ? `已对计划提供反馈，并选择动作：${actionLabel}。`
      : '已对计划提供反馈。';
  }

  if (result.approved) {
    return actionLabel
      ? `已批准计划并选择动作：${actionLabel}。`
      : '已批准当前计划。';
  }

  return actionLabel
    ? `已拒绝当前计划，原选择动作为：${actionLabel}。`
    : '已拒绝当前计划。';
}

export function buildPlanReviewInteractionAction(
  continuation: LexSessionInteractionContinuation | LexTurnContinuation,
  result: RuntimePlanReviewDecision,
): LexInteractionAction {
  const pendingRecord = readInteractionPendingRecord(continuation);
  const feedback = typeof result.feedback === 'string' ? result.feedback.trim() : '';

  return {
    kind: 'plan_review',
    payload: {
      result: result.approved ? 'approved' : 'rejected',
      ...(typeof result.actionId === 'string' && result.actionId.length > 0 ? { actionId: result.actionId } : {}),
      ...(feedback.length > 0 ? { feedback } : {}),
      ...(readNonEmptyString(pendingRecord?.['sourceEvent']) ? { sourceEvent: readNonEmptyString(pendingRecord?.['sourceEvent']) } : {}),
    },
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
