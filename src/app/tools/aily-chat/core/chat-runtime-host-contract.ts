import type { TurnResponseTurn } from 'aily-lex/browser';

import type { ChatModeId, ChatSelectedMode } from './chat-mode';

export type ChatRuntimeHostViewId = string;
export type ChatRuntimeHostSessionId = string;

export type ChatRuntimeHostEventKind =
  | 'session-state'
  | 'transcript'
  | 'runtime-status'
  | 'interaction'
  | 'view-request'
  | 'error';

export type ChatRuntimeHostSessionStatus =
  | 'idle'
  | 'running'
  | 'needs_input'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ChatRuntimeHostSubmitRequest {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly requestText: string;
  readonly displayText?: string;
  readonly selectedMode?: ChatSelectedMode | null;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
  readonly activeResponseHandle?: unknown | null;
}

export interface ChatRuntimeHostTranscriptSnapshot {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly revision: number;
}

export interface ChatRuntimeHostSessionState {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly status: ChatRuntimeHostSessionStatus;
  readonly requestInProgress: boolean;
  readonly attachedViewIds: readonly ChatRuntimeHostViewId[];
  readonly activeTurnId?: string | null;
  readonly transcriptRevision: number;
  readonly selectedMode?: ChatSelectedMode | null;
}

export interface ChatRuntimeHostSubmitReadiness {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly canSubmit: boolean;
  readonly requestInProgress: boolean;
}

export interface ChatRuntimeHostRerunReadiness {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly activeRequestInProgress: boolean;
  readonly staleGateCleared: boolean;
  readonly state: ChatRuntimeHostSessionState | null;
}

export interface ChatRuntimeHostInteractionSnapshot {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly revision: number;
  readonly question: Readonly<Record<string, unknown>> | null;
  readonly confirmationQueue: readonly Readonly<Record<string, unknown>>[];
  readonly activeConfirmationIndex: number;
  readonly activePlanReview: Readonly<Record<string, unknown>> | null;
  readonly backgroundCommandSessionKeys: readonly string[];
}

export type ChatRuntimeHostInteractionRequestKind =
  | 'question.complete'
  | 'question.skip'
  | 'confirmation.navigate'
  | 'confirmation.resolve'
  | 'confirmation.action'
  | 'planReview.resolve'
  | 'commandSession.action';

export interface ChatRuntimeHostInteractionRequest {
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly kind: ChatRuntimeHostInteractionRequestKind;
  readonly id?: string;
  readonly delta?: number;
  readonly payload?: unknown;
}

export type ChatRuntimeHostViewRequestKind =
  | 'notification'
  | 'todo-state'
  | 'handoff';

export type ChatRuntimeHostNotificationSeverity =
  | 'success'
  | 'error'
  | 'warning'
  | 'info';

export interface ChatRuntimeHostViewRequest {
  readonly id: string;
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly kind: ChatRuntimeHostViewRequestKind;
  readonly notification?: {
    readonly severity: ChatRuntimeHostNotificationSeverity;
    readonly message: string;
  };
  readonly todoState?: {
    readonly items: readonly ChatRuntimeHostTodoItem[];
  };
  readonly handoff?: {
    readonly targetAgent?: string;
    readonly targetModeId?: ChatModeId;
    readonly message: string;
    readonly suggestedInput?: string;
  };
}

export interface ChatRuntimeHostTodoItem {
  readonly id: number;
  readonly content: string;
  readonly status: 'not-started' | 'in-progress' | 'completed';
  readonly priority: 'low' | 'medium' | 'high';
  readonly updatedAt: number;
}

export interface ChatRuntimeHostEventBase {
  readonly kind: ChatRuntimeHostEventKind;
  readonly sessionId: ChatRuntimeHostSessionId;
  readonly revision: number;
}

export interface ChatRuntimeHostTranscriptEvent extends ChatRuntimeHostEventBase {
  readonly kind: 'transcript';
  readonly transcript: ChatRuntimeHostTranscriptSnapshot;
}

export interface ChatRuntimeHostSessionStateEvent extends ChatRuntimeHostEventBase {
  readonly kind: 'session-state' | 'runtime-status';
  readonly state: ChatRuntimeHostSessionState;
}

export interface ChatRuntimeHostInteractionEvent extends ChatRuntimeHostEventBase {
  readonly kind: 'interaction';
  readonly interaction: ChatRuntimeHostInteractionSnapshot;
}

export interface ChatRuntimeHostViewRequestEvent extends ChatRuntimeHostEventBase {
  readonly kind: 'view-request';
  readonly request: ChatRuntimeHostViewRequest;
}

export interface ChatRuntimeHostErrorEvent extends ChatRuntimeHostEventBase {
  readonly kind: 'error';
  readonly error: {
    readonly code?: string;
    readonly message: string;
    readonly retryable?: boolean;
  };
}

export type ChatRuntimeHostEvent =
  | ChatRuntimeHostTranscriptEvent
  | ChatRuntimeHostSessionStateEvent
  | ChatRuntimeHostInteractionEvent
  | ChatRuntimeHostViewRequestEvent
  | ChatRuntimeHostErrorEvent;

export interface ChatRuntimeHostEventSubscription {
  dispose(): void;
}

export interface ChatRuntimeHostAttachViewOptions {
  readonly visibleAttachmentGeneration?: number | null;
}

export interface ChatRuntimeHost {
  attachView(
    viewId: ChatRuntimeHostViewId,
    sessionId: ChatRuntimeHostSessionId,
    options?: ChatRuntimeHostAttachViewOptions,
  ): Promise<ChatRuntimeHostSessionState>;
  detachView(viewId: ChatRuntimeHostViewId): Promise<void>;
  submitTurn(request: ChatRuntimeHostSubmitRequest): Promise<ChatRuntimeHostSessionState>;
  readSubmitReadiness(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostSubmitReadiness>;
  ensureSessionCanRerun(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostRerunReadiness>;
  stopTurn(sessionId: ChatRuntimeHostSessionId): Promise<void>;
  disposeSession(sessionId: ChatRuntimeHostSessionId): Promise<void>;
  readSessionState(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostSessionState | null>;
  readTranscript(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostTranscriptSnapshot | null>;
  awaitRequestCompletion(sessionId: ChatRuntimeHostSessionId): Promise<void>;
  runWorkspaceFinalizeBoundaryProbe(sessionId: ChatRuntimeHostSessionId): Promise<void>;
  readInteractionSnapshot(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostInteractionSnapshot | null>;
  resolveInteraction(request: ChatRuntimeHostInteractionRequest): Promise<ChatRuntimeHostInteractionSnapshot | null>;
  onEvent(listener: (event: ChatRuntimeHostEvent) => void): ChatRuntimeHostEventSubscription;
}
