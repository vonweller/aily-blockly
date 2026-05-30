import {
  DEFAULT_CHAT_SESSION_PERMISSION_MODE,
  DEFAULT_CHAT_SESSION_TYPE,
  normalizeChatSessionType,
  type ChatSessionInputState,
  type ChatSessionType,
} from '../core/chat-mode';
import type { ISessionAccess } from '../core/chat-context';
import type { HostSessionRecord } from '../services/chat-history.service';
import type { HostSessionInteractionActionSummary } from './host-session-interaction-action';
import {
  normalizeHostSessionInputStateFromMetadata,
  resolveHostSessionModeDescriptor,
  resolveHostSessionModeDescriptorFromMetadata,
  resolveHostSessionProviderOptionGroups,
  normalizeHostSessionProviderOptions,
  resolveHostSessionProviderOptionsFromInputState,
  resolveHostSessionInputState,
  type HostSessionProviderOptions,
  type HostSessionSelectedModeResolveOptions,
} from './host-session-input-state';

export interface HostSessionContentMetadataSource {
  readonly title?: unknown;
  readonly sessionType?: unknown;
  readonly projectPath?: unknown;
  readonly mode?: unknown;
  readonly modeDescriptor?: {
    readonly id?: unknown;
    readonly kind?: unknown;
    readonly isBuiltin?: unknown;
    readonly name?: unknown;
    readonly modeInstructions?: {
      readonly uri?: unknown;
      readonly name?: unknown;
      readonly content?: unknown;
      readonly metadata?: unknown;
      readonly isBuiltin?: unknown;
    } | null;
  } | null;
  readonly requestRouting?: {
    readonly selectedModeId?: unknown;
    readonly requestModeId?: unknown;
    readonly customAgentTarget?: unknown;
    readonly permissionLevel?: unknown;
  } | null;
  readonly interactionActionSummary?: HostSessionInteractionActionSummary | null;
  readonly inputState?: {
    readonly mode?: {
      readonly id?: unknown;
      readonly kind?: unknown;
      readonly modeInstructions?: {
        readonly uri?: unknown;
        readonly name?: unknown;
        readonly content?: unknown;
        readonly metadata?: unknown;
        readonly isBuiltin?: unknown;
      } | null;
    } | null;
    readonly groups?: unknown;
  } | null;
}

export interface HostSessionContentRequest {
  readonly hostRecordOverride?: HostSessionRecord | null;
  readonly metadataFallback?: HostSessionContentMetadataSource | null;
  readonly fallbackProviderOptions?: Partial<HostSessionProviderOptions> | null;
}

export interface HostSessionContent {
  readonly sessionId: string;
  readonly sessionType: ChatSessionType;
  readonly projectPathHint: string | null;
  readonly hostRecord: HostSessionRecord | null;
  readonly metadata?: HostSessionContentMetadataSource;
  readonly title?: string;
  readonly providerOptions: HostSessionProviderOptions;
  readonly inputState?: ChatSessionInputState;
}

export type HostSessionContentProviderContext = Pick<ISessionAccess, 'sessionId' | 'chatService' | 'chatHistoryService'>;

export class HostSessionContentProvider {
  constructor(private readonly ctx: HostSessionContentProviderContext) {}

  provideCurrentChatSessionContent(
    projectPathHint?: string | null,
    request?: HostSessionContentRequest,
  ): HostSessionContent | null {
    const sessionId = this.ctx.sessionId;
    if (!sessionId) {
      return null;
    }

    return this.provideChatSessionContent(sessionId, projectPathHint, request);
  }

  provideChatSessionContent(
    sessionId: string,
    projectPathHint?: string | null,
    request: HostSessionContentRequest = {},
  ): HostSessionContent {
    const isCurrentSession = sessionId === this.ctx.sessionId;
    const normalizedProjectPathHint = normalizeProjectPathHint(projectPathHint);
    const hostRecord = request.hostRecordOverride !== undefined
      ? request.hostRecordOverride
      : this.ctx.chatHistoryService.loadHostRecord(sessionId, normalizedProjectPathHint);
    const effectiveMetadata = mergeHostSessionContentMetadata(hostRecord?.metadata, request.metadataFallback);
    const providerOptionFallback = normalizeHostSessionProviderOptions(request.fallbackProviderOptions, {
      folderPath: request.hostRecordOverride === undefined
        ? normalizedProjectPathHint
        : null,
      permissionMode: isCurrentSession
        ? this.ctx.chatService.currentSessionPermissionMode
        : DEFAULT_CHAT_SESSION_PERMISSION_MODE,
      ...(isCurrentSession && this.ctx.chatService.currentSessionPermissionLevel
        ? { permissionLevel: this.ctx.chatService.currentSessionPermissionLevel }
        : {}),
    });
    const providerOptions = effectiveMetadata
      ? resolveHostSessionProviderOptionsFromInputState(effectiveMetadata.inputState, {
          ...providerOptionFallback,
          folderPath: normalizeProjectPathHint(effectiveMetadata.projectPath as string | null | undefined) ?? providerOptionFallback.folderPath,
          permissionLevel: typeof effectiveMetadata.requestRouting?.permissionLevel === 'string' && effectiveMetadata.requestRouting.permissionLevel.trim().length > 0
            ? effectiveMetadata.requestRouting.permissionLevel.trim()
            : providerOptionFallback.permissionLevel,
        })
      : providerOptionFallback;
    const normalizedProjectPath = effectiveMetadata
      ? normalizeProjectPathHint(effectiveMetadata.projectPath as string | null | undefined) ?? providerOptions.folderPath
      : providerOptions.folderPath;
    const mergedSessionType = resolveMergedSessionType(effectiveMetadata?.sessionType);
    const normalizedMetadata = effectiveMetadata
      ? (() => {
          const metadataForResolution = {
            ...effectiveMetadata,
            projectPath: normalizedProjectPath,
          };
          const modeDescriptor = hostRecord
            ? resolveHostSessionModeDescriptor({
                metadata: metadataForResolution as HostSessionRecord['metadata'],
                turnResponses: hostRecord.turnResponses,
              } as HostSessionRecord, this.getModeResolveOptions())
            : resolveHostSessionModeDescriptorFromMetadata(metadataForResolution, this.getModeResolveOptions());
          const inputState = (
            effectiveMetadata.mode !== undefined
            || effectiveMetadata.modeDescriptor
            || effectiveMetadata.inputState
            || effectiveMetadata.requestRouting
          )
            ? hostRecord
              ? resolveHostSessionInputState({
                  metadata: {
                    ...hostRecord.metadata,
                    ...metadataForResolution,
                    sessionType: mergedSessionType,
                    modeDescriptor,
                  },
                  turnResponses: hostRecord.turnResponses,
                } as HostSessionRecord, this.getModeResolveOptions())
              : normalizeHostSessionInputStateFromMetadata({
                  ...metadataForResolution,
                  ...(modeDescriptor ? { modeDescriptor } : {}),
                }, this.getModeResolveOptions())
            : undefined;

          return {
            ...effectiveMetadata,
            sessionType: mergedSessionType,
            ...(normalizedProjectPath ? { projectPath: normalizedProjectPath } : {}),
            ...(modeDescriptor ? { modeDescriptor } : {}),
            ...(inputState ? { inputState } : {}),
          };
        })()
      : undefined;
    const sessionType = normalizeChatSessionType(
      normalizedMetadata?.sessionType,
      this.ctx.chatService.currentSessionType ?? DEFAULT_CHAT_SESSION_TYPE,
    );
    const inputState: ChatSessionInputState | undefined = normalizedMetadata?.inputState as ChatSessionInputState | undefined;
    const sourceInputState = effectiveMetadata?.inputState ?? hostRecord?.metadata?.inputState;
    const projectedInputState = inputState
      ? {
          ...inputState,
          groups: resolveHostSessionProviderOptionGroups(sourceInputState, providerOptions),
        }
      : undefined;

    return {
      sessionId,
      sessionType,
      projectPathHint: normalizedProjectPathHint,
      hostRecord: hostRecord ?? null,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
      ...(normalizeSessionTitle(normalizedMetadata?.title) ? { title: normalizeSessionTitle(normalizedMetadata?.title) } : {}),
      providerOptions,
      ...(projectedInputState ? { inputState: projectedInputState } : {}),
    };
  }

  private getModeResolveOptions(): HostSessionSelectedModeResolveOptions {
    return {
      resolveModeById: (modeId) => this.ctx.chatService.findResolvedModeById?.(modeId),
    };
  }
}

export function resolveHostSessionProjectPathHint(
  chatService: Pick<HostSessionContentProviderContext['chatService'], 'currentSessionPath'> | null | undefined,
  fallbackProjectPath?: string | null,
): string | null {
  const sessionPath = normalizeProjectPathHint(chatService?.currentSessionPath);
  if (sessionPath) {
    return sessionPath;
  }

  return normalizeProjectPathHint(fallbackProjectPath);
}

function normalizeProjectPathHint(projectPathHint?: string | null): string | null {
  if (typeof projectPathHint !== 'string') {
    return null;
  }

  const trimmed = projectPathHint.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSessionTitle(title: unknown): string | undefined {
  return typeof title === 'string' && title.trim()
    ? title.trim()
    : undefined;
}

function resolveMergedSessionType(primary?: unknown, fallback?: unknown): ChatSessionType {
  const normalizedPrimary = typeof primary === 'string'
    ? primary.trim()
    : '';
  if (normalizedPrimary) {
    return normalizedPrimary;
  }

  return normalizeChatSessionType(fallback, DEFAULT_CHAT_SESSION_TYPE);
}

function mergeHostSessionContentMetadata(
  primary: HostSessionContentMetadataSource | null | undefined,
  fallback: HostSessionContentMetadataSource | null | undefined,
): HostSessionContentMetadataSource | null {
  if (!primary && !fallback) {
    return null;
  }

  const inputState = mergeHostSessionInputState(primary?.inputState, fallback?.inputState);
  const requestRouting = mergeHostSessionRequestRouting(primary?.requestRouting, fallback?.requestRouting);
  const interactionActionSummary = primary?.interactionActionSummary ?? fallback?.interactionActionSummary;
  const projectPath = normalizeProjectPathHint(primary?.projectPath as string | null | undefined)
    ?? normalizeProjectPathHint(fallback?.projectPath as string | null | undefined);

  return {
    ...(normalizeSessionTitle(primary?.title)
      ? { title: normalizeSessionTitle(primary?.title) }
      : {}),
    sessionType: resolveMergedSessionType(primary?.sessionType, fallback?.sessionType),
    ...(projectPath ? { projectPath } : {}),
    ...((primary?.mode ?? fallback?.mode) !== undefined ? { mode: primary?.mode ?? fallback?.mode } : {}),
    ...((primary?.modeDescriptor ?? fallback?.modeDescriptor) !== undefined
      ? { modeDescriptor: primary?.modeDescriptor ?? fallback?.modeDescriptor }
      : {}),
    ...(requestRouting ? { requestRouting } : {}),
    ...(interactionActionSummary ? { interactionActionSummary } : {}),
    ...(inputState ? { inputState } : {}),
  };
}

function mergeHostSessionInputState(
  primary: HostSessionContentMetadataSource['inputState'] | undefined | null,
  fallback: HostSessionContentMetadataSource['inputState'] | undefined | null,
): HostSessionContentMetadataSource['inputState'] | undefined {
  const mode = primary?.mode ?? fallback?.mode;
  const groups = Array.isArray(primary?.groups)
    ? primary?.groups
    : fallback?.groups;

  if (!mode && !Array.isArray(groups)) {
    return undefined;
  }

  return {
    ...(mode ? { mode } : {}),
    ...(Array.isArray(groups) ? { groups } : {}),
  };
}

function mergeHostSessionRequestRouting(
  primary: HostSessionContentMetadataSource['requestRouting'] | undefined | null,
  fallback: HostSessionContentMetadataSource['requestRouting'] | undefined | null,
): HostSessionContentMetadataSource['requestRouting'] | undefined {
  if (!primary && !fallback) {
    return undefined;
  }

  return {
    ...((primary?.selectedModeId ?? fallback?.selectedModeId) !== undefined
      ? { selectedModeId: primary?.selectedModeId ?? fallback?.selectedModeId }
      : {}),
    ...((primary?.requestModeId ?? fallback?.requestModeId) !== undefined
      ? { requestModeId: primary?.requestModeId ?? fallback?.requestModeId }
      : {}),
    ...((primary?.customAgentTarget ?? fallback?.customAgentTarget) !== undefined
      ? { customAgentTarget: primary?.customAgentTarget ?? fallback?.customAgentTarget }
      : {}),
    ...((primary?.permissionLevel ?? fallback?.permissionLevel) !== undefined
      ? { permissionLevel: primary?.permissionLevel ?? fallback?.permissionLevel }
      : {}),
  };
}