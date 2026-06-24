import { InjectionToken } from '@angular/core';
import type { TurnResponseTurn } from 'aily-lex/browser';

import type {
  ChatAgentRuntimeMode,
  ChatAgentRuntimeModeSource,
} from '../core/chat-agent-runtime-mode';
import type {
  ChatSelectedMode,
  ChatModeId,
} from '../core/chat-mode';
import type { ChatRuntimeOwnerScheduler } from '../core/chat-runtime-owner-scheduler';
import type { AskUserFullResponse, AskUserPresentationContext, AskUserQuestion } from '../core/ask-user';
import type {
  ChatRuntimeHostAttachViewOptions,
  ChatRuntimeHostInteractionRequest,
  ChatRuntimeHostInteractionSnapshot,
  ChatRuntimeHostNotificationSeverity,
  ChatRuntimeHost,
  ChatRuntimeHostSessionId,
  ChatRuntimeHostSessionState,
  ChatRuntimeHostSubmitReadiness,
  ChatRuntimeHostSubmitRequest,
  ChatRuntimeHostTranscriptSnapshot,
  ChatRuntimeHostTodoItem,
  ChatRuntimeHostViewRequest,
  ChatRuntimeHostViewId,
} from '../core/chat-runtime-host-contract';
import type { ChatRuntimeTurnResponseSyncOptions } from '../core/chat-runtime-projection-policy';
import type { ChatMessage } from '../core/chat-types';
import type { ChatPartStore } from '../core/chat-part-store';
import type { HostSessionSaveTarget } from '../helpers/host-session-save-bridge';
import type { HostSessionProviderOptions } from '../helpers/host-session-input-state';
import type { ToolApprovalAction, ToolApprovalRequest, ToolApprovalScope } from '../helpers/tool-approval-ui';
import type {
  RuntimeCommandSessionActionRequest,
  RuntimeCommandSessionActionResult,
  RuntimeConfirmationDecision,
  RuntimePlanReviewAction,
  RuntimePlanReviewDecision,
  RuntimePlanReviewWidgetState,
} from './chat-runtime-interaction-host.service';
import type {
  HostTurnResponseState,
  HostRequestModel,
  HostResponseProjection,
} from '../helpers/host-turn-response-state';
import type { LexOwnerContext, LexOwnerFacade } from '../helpers/lex-stream.helper';
import type { ChatSessionLexPostTurnResources } from './chat-session-lex-post-turn-resource-factory.service';
import type { ChatSessionLexRequestCompletedInput } from './chat-session-runtime-completion-queue-core';
import type { ChatListItem } from './chat-history.service';
import type { ChatSessionRuntimeHandlePatch } from './chat-session-runtime-registry-core';
import type { ChatSessionRuntimeProjectionPatch } from './chat-session-runtime-projection-core';
import type {
  ChatSessionRuntimeCapabilities,
  ChatSessionRuntimeChangeOptions,
  ChatSessionRuntimeState,
} from './chat-session-runtime-store.service';
import type { ChatRuntimeOwnerContextAdapter } from './chat-runtime-owner-context.service';
import type { ChatSessionTurnOwnerPolicyOptions } from './chat-session-model-store.service';

export interface ChatRuntimeOwnerBindingPort {
  bindAdapter(adapter: ChatRuntimeOwnerContextAdapter): LexOwnerFacade;
}

export interface ChatRuntimeOwnerContextMaterializerPort {
  bindAdapter(adapter: ChatRuntimeOwnerContextAdapter): LexOwnerContext;
}

export interface ChatRuntimeOwnerContextBinderPort {
  bindContext(context: LexOwnerContext): LexOwnerFacade;
}

export interface ChatRuntimeOwnerHostAdapterPort {
  ensureBound(): LexOwnerFacade;
}

export type ChatRuntimeOwnerHostPort = ChatRuntimeHost;

export interface ChatRuntimeOwnerEndpointPort {
  startElectronHostOwner(ownerId?: string): Promise<void>;
}

export interface ChatRuntimeOwnerWorkspaceEnvironmentPort {
  readonly currentProjectPath: string;
  readonly projectRootPath: string;
  readonly projectPath: string;
}

export interface ChatRuntimeOwnerInteractionHostPort {
  onSnapshot(listener: (snapshot: ChatRuntimeHostInteractionSnapshot) => void): { dispose(): void };
  readSnapshot(sessionId: string): ChatRuntimeHostInteractionSnapshot;
  applyHostSnapshot(
    snapshot: ChatRuntimeHostInteractionSnapshot,
    remoteResolver: (request: ChatRuntimeHostInteractionRequest) => Promise<ChatRuntimeHostInteractionSnapshot | null>,
  ): void;
  presentQuestion(
    sessionId: string,
    partId: string,
    questions: AskUserQuestion[],
    context?: AskUserPresentationContext,
  ): Promise<AskUserFullResponse | undefined>;
  completeQuestion(sessionId: string, result: AskUserFullResponse | undefined): void;
  resolveQuestionCompat(sessionId: string, answer: string, wasFreeform: boolean): void;
  skipQuestion(sessionId: string): void;
  clearQuestion(sessionId: string): void;
  presentToolApproval(sessionId: string, request: ToolApprovalRequest): Promise<RuntimeConfirmationDecision>;
  presentConfirmation(
    sessionId: string,
    confirmation: {
      askId: string;
      partId: string;
      toolName?: string;
      title: string;
      subtitle?: string;
      message: string;
      args?: Record<string, unknown>;
      actions: readonly ToolApprovalAction[];
      primaryScope: ToolApprovalScope;
      primaryLabel?: string;
      primaryTooltip?: string;
      rejectLabel?: string;
      rejectTooltip?: string;
      onAction?: (actionId: string) => void;
    },
  ): Promise<RuntimeConfirmationDecision>;
  navigateConfirmation(sessionId: string, delta: number): void;
  resolveConfirmation(sessionId: string, id: string, result: RuntimeConfirmationDecision): void;
  triggerConfirmationAction(sessionId: string, id: string, actionId: string): void;
  resolveToolApproval(sessionId: string, toolCallId: string, result: RuntimeConfirmationDecision): void;
  clearConfirmations(sessionId: string): void;
  presentPlanReview(
    sessionId: string,
    review: {
      id: string;
      title: string;
      planUri?: string;
      content: string;
      actions: readonly RuntimePlanReviewAction[];
      canProvideFeedback: boolean;
    },
  ): Promise<RuntimePlanReviewDecision>;
  getActivePlanReview(sessionId: string): RuntimePlanReviewWidgetState | null;
  resolvePlanReview(sessionId: string, id: string, result: RuntimePlanReviewDecision): void;
  requestCommandSessionAction(
    sessionId: string,
    request: RuntimeCommandSessionActionRequest,
  ): Promise<RuntimeCommandSessionActionResult>;
}

export interface ChatRuntimeOwnerSubmittedTurnLifecyclePort {
  bindOwner(owner: LexOwnerFacade): void;
  prepareSubmittedTurn(request: ChatRuntimeHostSubmitRequest, owner: LexOwnerFacade): Promise<void>;
  completeSubmittedTurn(sessionId?: string | null): Promise<void>;
}

export interface ChatRuntimeOwnerSaveCurrentSessionInput {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly lexStream: LexOwnerFacade;
  readonly hostProjection?: HostResponseProjection | null;
  readonly visibleChatList?: readonly ChatListItem[];
  readonly hostRequestModel?: HostRequestModel | null;
  readonly target?: HostSessionSaveTarget | null;
}

export interface ChatRuntimeOwnerSessionSaveBridgeOptions {
  readonly hostProjection?: HostResponseProjection | null;
  readonly visibleChatList?: readonly ChatListItem[];
  readonly hostRequestModel?: HostRequestModel | null;
  readonly target: HostSessionSaveTarget | null;
}

export interface ChatRuntimeOwnerSessionSaveBridgePort {
  saveCurrentSession(options: ChatRuntimeOwnerSessionSaveBridgeOptions): boolean;
}

export interface ChatRuntimeOwnerSessionSaveBridgeFactoryInput {
  readonly sessionId: string;
  readonly sessionTitle: string;
  readonly lexStream: LexOwnerFacade;
}

export interface ChatRuntimeOwnerSessionSaveBridgeFactoryPort {
  create(input: ChatRuntimeOwnerSessionSaveBridgeFactoryInput): ChatRuntimeOwnerSessionSaveBridgePort;
}

export interface ChatRuntimeOwnerSaveBridgePort {
  saveCurrentSession(input: ChatRuntimeOwnerSaveCurrentSessionInput): void;
}

export interface ChatRuntimeOwnerSaveTargetPort {
  buildExecutionSaveTarget(sessionId?: string | null): HostSessionSaveTarget | null;
}

export interface ChatRuntimeOwnerSessionContextPort {
  readonly prjPath: string;
  readonly prjRootPath: string;
  readonly currentModel: unknown;
  readonly currentAgentRuntimeMode: ChatAgentRuntimeMode;
  readonly currentAgentRuntimeModeSource: ChatAgentRuntimeModeSource;
  readonly sessionTitle: string;
  readonly currentSessionId: string;
  currentSessionPath(sessionId?: string | null): string | null;
  currentSessionPermissionMode(sessionId?: string | null): HostSessionProviderOptions['permissionMode'];
  currentSessionApprovalsReviewer(sessionId?: string | null): HostSessionProviderOptions['approvalsReviewer'];
  currentSessionApprovalPolicy(sessionId?: string | null): HostSessionProviderOptions['approvalPolicy'];
  selectAgentRuntimeMode(
    mode: ChatAgentRuntimeMode | string | null | undefined,
    source?: ChatAgentRuntimeModeSource | string | null | undefined,
    reason?: string | null,
    sessionId?: string | null,
  ): void;
  resolveRuntimeSessionProviderOptions(sessionId?: string | null): HostSessionProviderOptions;
  resolveRuntimeSelectedMode(sessionId?: string | null): ChatSelectedMode;
  resolveRuntimeCapabilities(sessionId?: string | null): ChatSessionRuntimeCapabilities;
  resolveRuntimeConcurrencyScope(sessionId?: string | null): string | undefined;
}

export interface ChatRuntimeOwnerStatePort {
  currentMessageSource: string;
  toolCallingIteration: number;
  isWaiting: boolean;
  isCompleted: boolean;
  isCancelled: boolean;
  activeToolExecutions: number;
  currentStatelessMode: boolean;
  resetForCancellation(): void;
  resolveActiveRuntimeSessionId(defaultSessionId?: string | null): string;
  runWithRuntimeSessionOwner<T>(sessionId: string, action: () => Promise<T>): Promise<T>;
  beginRuntimeSessionOwnerScope(sessionId: string): () => void;
}

export interface ChatRuntimeOwnerHeadlessProjectionPort {
  readonly partStore: ChatPartStore;
  readonly viewAdapter: unknown;
  readonly scrollManager: unknown;
  readonly list: ChatMessage[];
  setList(value: ChatMessage[]): void;
  invalidateHostRequestGraph(): void;
  triggerSyncDetectChanges(): void;
}

export interface ChatRuntimeOwnerViewAttachmentPort {
  attachView(
    viewId: ChatRuntimeHostViewId,
    sessionId: ChatRuntimeHostSessionId,
    options: ChatRuntimeHostAttachViewOptions | null | undefined,
  ): void;
  detachView(viewId: ChatRuntimeHostViewId): ChatRuntimeHostSessionId | null;
  detachSession(sessionId: ChatRuntimeHostSessionId): void;
  readSessionForView(viewId: ChatRuntimeHostViewId): ChatRuntimeHostSessionId | null;
  readAttachedViewIds(sessionId: ChatRuntimeHostSessionId): readonly ChatRuntimeHostViewId[];
  hasAttachedView(sessionId: ChatRuntimeHostSessionId | null | undefined): boolean;
  readVisibleAttachmentGeneration(sessionId: ChatRuntimeHostSessionId | null | undefined): number | null;
  isVisibleAttachmentCurrent(
    sessionId: ChatRuntimeHostSessionId | null | undefined,
    generation: number | null | undefined,
  ): boolean;
}

export interface ChatRuntimeOwnerViewRequestSubscription {
  dispose(): void;
}

export interface ChatRuntimeOwnerViewRequestPort {
  onRequest(listener: (request: ChatRuntimeHostViewRequest) => void): ChatRuntimeOwnerViewRequestSubscription;
  notify(
    sessionId: ChatRuntimeHostSessionId | null | undefined,
    severity: ChatRuntimeHostNotificationSeverity,
    message: unknown,
  ): void;
  syncTodoState(
    sessionId: ChatRuntimeHostSessionId | null | undefined,
    items: readonly ChatRuntimeHostTodoItem[],
  ): void;
  requestHandoff(input: {
    readonly sessionId: ChatRuntimeHostSessionId | null | undefined;
    readonly targetAgent?: string;
    readonly targetModeId?: ChatModeId;
    readonly message: string;
    readonly suggestedInput?: string;
  }): void;
}

export interface ChatRuntimeOwnerSessionModelPort {
  readTurnResponses(sessionId: string | null | undefined): readonly TurnResponseTurn[];
  replaceTurnResponses(
    sessionId: string | null | undefined,
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
    ownerPolicy?: ChatSessionTurnOwnerPolicyOptions,
  ): readonly TurnResponseTurn[] | null;
  appendOrReplaceTurnResponse(
    sessionId: string | null | undefined,
    turnResponse: TurnResponseTurn,
    ownerPolicy?: ChatSessionTurnOwnerPolicyOptions,
  ): readonly TurnResponseTurn[] | null;
}

export interface ChatRuntimeOwnerExecutionProjectionInput {
  readonly saveTarget: HostSessionSaveTarget | null | undefined;
}

export interface ChatRuntimeOwnerProjectionPatchInput {
  readonly sessionId: string | null | undefined;
  readonly patch: ChatSessionRuntimeProjectionPatch;
  readonly options?: ChatSessionRuntimeChangeOptions;
}

export interface ChatRuntimeOwnerHandleProjectionInput {
  readonly sessionId: string | null | undefined;
  readonly patch: ChatSessionRuntimeHandlePatch;
}

export interface ChatRuntimeOwnerTurnResponsesProjectionInput {
  readonly sessionId: string | null | undefined;
  readonly turnResponses: readonly TurnResponseTurn[] | null | undefined;
  readonly hostProjectionState: HostTurnResponseState | null;
  readonly capabilities?: ChatSessionRuntimeCapabilities | null;
  readonly concurrencyScope?: string | null;
  readonly projection: ChatRuntimeTurnResponseSyncOptions;
}

export interface ChatRuntimeOwnerProjectionPort {
  buildHostProjectionState(turnResponses: readonly TurnResponseTurn[] | null | undefined): HostTurnResponseState | null;
  projectExecutionRuntimeState(input: ChatRuntimeOwnerExecutionProjectionInput): boolean;
  projectRuntimeState(input: ChatRuntimeOwnerProjectionPatchInput): boolean;
  syncHandleState(input: ChatRuntimeOwnerHandleProjectionInput): boolean;
  syncTurnResponses(input: ChatRuntimeOwnerTurnResponsesProjectionInput): boolean;
}

export type ChatRuntimeOwnerSchedulerPort = ChatRuntimeOwnerScheduler;

export interface ChatRuntimeOwnerTurnStartupEditLifecyclePort {
  ensureAbsExport(): void;
  saveCheckpointToDisk(): void;
}

export interface ChatRuntimeOwnerRerunGateState {
  readonly activeRequestInProgress: boolean;
  readonly staleGateCleared: boolean;
}

export interface ChatRuntimeOwnerBeginRequestInput {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly activeResponseHandle: unknown;
  readonly attachedView: boolean;
  readonly stopSession: () => void;
  readonly disposeSession: () => void;
}

export interface ChatRuntimeOwnerAgentEntryReadyInput {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly disposeSession: () => void;
}

export interface ChatRuntimeOwnerSessionSnapshotInput {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly attachedViewIds: readonly ChatRuntimeHostViewId[];
  readonly transcriptRevision: number;
}

export interface ChatRuntimeOwnerHandleProjectionMetadata {
  readonly capabilities?: ChatSessionRuntimeCapabilities;
  readonly concurrencyScope: string | null;
}

export interface ChatRuntimeOwnerRuntimeStateReaderPort {
  readSessionRuntimeState(sessionId: string | null | undefined): Readonly<ChatSessionRuntimeState> | undefined;
  readHandleMetadata(sessionId: string | null | undefined): ChatRuntimeOwnerHandleProjectionMetadata;
}

export interface ChatRuntimeOwnerRuntimeControllerPort {
  attachSessionView(sessionId: ChatRuntimeHostSessionId): void;
  detachSessionView(sessionId: ChatRuntimeHostSessionId): void;
  readSubmitReadiness(sessionId: ChatRuntimeHostSessionId): ChatRuntimeHostSubmitReadiness;
  ensureSessionCanRerun(sessionId: ChatRuntimeHostSessionId): ChatRuntimeOwnerRerunGateState;
  syncAgentEntryReady(input: ChatRuntimeOwnerAgentEntryReadyInput): void;
  releaseRuntimeHandle(sessionId: ChatRuntimeHostSessionId): boolean;
  setRuntimeAbortController(
    sessionId: ChatRuntimeHostSessionId,
    controller: AbortController | null,
  ): boolean;
  getOrCreateLexPostTurnResources(
    sessionId: ChatRuntimeHostSessionId,
    cwd: string | null | undefined,
  ): ChatSessionLexPostTurnResources | undefined;
  scheduleLexRequestCompleted(input: ChatSessionLexRequestCompletedInput): void;
  beginSubmittedRequestState(input: ChatRuntimeOwnerBeginRequestInput): void;
  completeSubmittedRequestState(sessionId: ChatRuntimeHostSessionId, activeResponseHandle: unknown): void;
  stopSession(sessionId: ChatRuntimeHostSessionId): void;
  disposeSession(sessionId: ChatRuntimeHostSessionId): void;
  getSessionIds(): readonly ChatRuntimeHostSessionId[];
  readRuntimeState(sessionId: ChatRuntimeHostSessionId): ChatSessionRuntimeState | null;
  readHandleProjectionMetadata(sessionId: ChatRuntimeHostSessionId): ChatRuntimeOwnerHandleProjectionMetadata;
  projectRuntimeState(
    sessionId: ChatRuntimeHostSessionId,
    patch: ChatSessionRuntimeProjectionPatch,
    options?: ChatSessionRuntimeChangeOptions,
  ): void;
  syncRuntimeHandleState(
    sessionId: ChatRuntimeHostSessionId,
    patch: ChatSessionRuntimeHandlePatch,
  ): void;
  syncRuntimeTurnResponses(
    sessionId: ChatRuntimeHostSessionId,
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
    hostProjectionState: HostTurnResponseState | null,
    options?: ChatSessionRuntimeChangeOptions,
  ): void;
  readSessionState(input: ChatRuntimeOwnerSessionSnapshotInput): ChatRuntimeHostSessionState | null;
  buildSessionState(
    input: ChatRuntimeOwnerSessionSnapshotInput,
    runtimeState?: ChatSessionRuntimeState | null,
  ): ChatRuntimeHostSessionState;
  readTranscript(input: ChatRuntimeOwnerSessionSnapshotInput): ChatRuntimeHostTranscriptSnapshot | null;
  buildTranscriptSnapshot(
    input: ChatRuntimeOwnerSessionSnapshotInput,
    runtimeState?: ChatSessionRuntimeState | null,
  ): ChatRuntimeHostTranscriptSnapshot;
  awaitRequestCompletion(sessionId: ChatRuntimeHostSessionId): Promise<void>;
  runWorkspaceFinalizeBoundaryProbe(sessionId: ChatRuntimeHostSessionId): Promise<void>;
}

export const CHAT_RUNTIME_OWNER_BINDING = new InjectionToken<ChatRuntimeOwnerBindingPort>(
  'AILY_CHAT_RUNTIME_OWNER_BINDING',
);

export const CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER = new InjectionToken<ChatRuntimeOwnerContextMaterializerPort>(
  'AILY_CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER',
);

export const CHAT_RUNTIME_OWNER_CONTEXT_BINDER = new InjectionToken<ChatRuntimeOwnerContextBinderPort>(
  'AILY_CHAT_RUNTIME_OWNER_CONTEXT_BINDER',
);

export const CHAT_RUNTIME_OWNER_HOST_ADAPTER = new InjectionToken<ChatRuntimeOwnerHostAdapterPort>(
  'AILY_CHAT_RUNTIME_OWNER_HOST_ADAPTER',
);

export const CHAT_RUNTIME_OWNER_HOST = new InjectionToken<ChatRuntimeOwnerHostPort>(
  'AILY_CHAT_RUNTIME_OWNER_HOST',
);

export const CHAT_RUNTIME_OWNER_ENDPOINT = new InjectionToken<ChatRuntimeOwnerEndpointPort>(
  'AILY_CHAT_RUNTIME_OWNER_ENDPOINT',
);

export const CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT = new InjectionToken<ChatRuntimeOwnerWorkspaceEnvironmentPort>(
  'AILY_CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT',
);

export const CHAT_RUNTIME_OWNER_INTERACTION_HOST = new InjectionToken<ChatRuntimeOwnerInteractionHostPort>(
  'AILY_CHAT_RUNTIME_OWNER_INTERACTION_HOST',
);

export const CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE = new InjectionToken<ChatRuntimeOwnerSubmittedTurnLifecyclePort>(
  'AILY_CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE',
);

export const CHAT_RUNTIME_OWNER_SAVE_BRIDGE = new InjectionToken<ChatRuntimeOwnerSaveBridgePort>(
  'AILY_CHAT_RUNTIME_OWNER_SAVE_BRIDGE',
);

export const CHAT_RUNTIME_OWNER_SESSION_SAVE_BRIDGE_FACTORY = new InjectionToken<ChatRuntimeOwnerSessionSaveBridgeFactoryPort>(
  'AILY_CHAT_RUNTIME_OWNER_SESSION_SAVE_BRIDGE_FACTORY',
);

export const CHAT_RUNTIME_OWNER_SAVE_TARGET = new InjectionToken<ChatRuntimeOwnerSaveTargetPort>(
  'AILY_CHAT_RUNTIME_OWNER_SAVE_TARGET',
);

export const CHAT_RUNTIME_OWNER_SESSION_CONTEXT = new InjectionToken<ChatRuntimeOwnerSessionContextPort>(
  'AILY_CHAT_RUNTIME_OWNER_SESSION_CONTEXT',
);

export const CHAT_RUNTIME_OWNER_STATE = new InjectionToken<ChatRuntimeOwnerStatePort>(
  'AILY_CHAT_RUNTIME_OWNER_STATE',
);

export const CHAT_RUNTIME_OWNER_HEADLESS_PROJECTION = new InjectionToken<ChatRuntimeOwnerHeadlessProjectionPort>(
  'AILY_CHAT_RUNTIME_OWNER_HEADLESS_PROJECTION',
);

export const CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT = new InjectionToken<ChatRuntimeOwnerViewAttachmentPort>(
  'AILY_CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT',
);

export const CHAT_RUNTIME_OWNER_VIEW_REQUEST = new InjectionToken<ChatRuntimeOwnerViewRequestPort>(
  'AILY_CHAT_RUNTIME_OWNER_VIEW_REQUEST',
);

export const CHAT_RUNTIME_OWNER_SESSION_MODEL = new InjectionToken<ChatRuntimeOwnerSessionModelPort>(
  'AILY_CHAT_RUNTIME_OWNER_SESSION_MODEL',
);

export const CHAT_RUNTIME_OWNER_PROJECTION = new InjectionToken<ChatRuntimeOwnerProjectionPort>(
  'AILY_CHAT_RUNTIME_OWNER_PROJECTION',
);

export const CHAT_RUNTIME_OWNER_SCHEDULER = new InjectionToken<ChatRuntimeOwnerSchedulerPort>(
  'AILY_CHAT_RUNTIME_OWNER_SCHEDULER',
);

export const CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE = new InjectionToken<ChatRuntimeOwnerTurnStartupEditLifecyclePort>(
  'AILY_CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE',
);

export const CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER = new InjectionToken<ChatRuntimeOwnerRuntimeControllerPort>(
  'AILY_CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER',
);

export const CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER = new InjectionToken<ChatRuntimeOwnerRuntimeStateReaderPort>(
  'AILY_CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER',
);
