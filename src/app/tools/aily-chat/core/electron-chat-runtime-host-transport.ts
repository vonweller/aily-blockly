import type {
  ChatRuntimeHost,
  ChatRuntimeHostAttachViewOptions,
  ChatRuntimeHostEvent,
  ChatRuntimeHostEventSubscription,
  ChatRuntimeHostInteractionRequest,
  ChatRuntimeHostInteractionSnapshot,
  ChatRuntimeHostRerunReadiness,
  ChatRuntimeHostSessionId,
  ChatRuntimeHostSessionState,
  ChatRuntimeHostSubmitReadiness,
  ChatRuntimeHostSubmitRequest,
  ChatRuntimeHostTranscriptSnapshot,
  ChatRuntimeHostViewId,
} from './chat-runtime-host-contract';

type RuntimeHostMethod =
  | 'attachView'
  | 'detachView'
  | 'submitTurn'
  | 'readSubmitReadiness'
  | 'ensureSessionCanRerun'
  | 'stopTurn'
  | 'disposeSession'
  | 'readSessionState'
  | 'readTranscript'
  | 'awaitRequestCompletion'
  | 'runWorkspaceFinalizeBoundaryProbe'
  | 'readInteractionSnapshot'
  | 'resolveInteraction';

interface ElectronChatRuntimeHostApi {
  call(method: RuntimeHostMethod, args: readonly unknown[]): Promise<unknown>;
  registerOwner(ownerId: string): Promise<{ ok?: boolean; ownerId?: string }>;
  unregisterOwner(ownerId: string): Promise<{ ok?: boolean }>;
  onOwnerCommand(callback: (payload: ElectronOwnerCommandPayload) => void): () => void;
  sendOwnerResponse(payload: ElectronOwnerCommandResponse): void;
  emitOwnerEvent(payload: ChatRuntimeHostEvent): void;
  onEvent(callback: (event: ChatRuntimeHostEvent) => void): () => void;
}

interface ElectronOwnerCommandPayload {
  readonly requestId?: string;
  readonly method?: string;
  readonly args?: readonly unknown[];
}

interface ElectronOwnerCommandResponse {
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: {
    readonly message: string;
    readonly code?: string;
  };
}

export interface ElectronChatRuntimeOwnerRegistration {
  dispose(): Promise<void>;
}

function readElectronChatRuntimeHostApi(): ElectronChatRuntimeHostApi | null {
  const api = (globalThis as unknown as { electronAPI?: { chatRuntimeHost?: Partial<ElectronChatRuntimeHostApi> } })
    .electronAPI?.chatRuntimeHost;
  if (!api
    || typeof api.call !== 'function'
    || typeof api.registerOwner !== 'function'
    || typeof api.unregisterOwner !== 'function'
    || typeof api.onOwnerCommand !== 'function'
    || typeof api.sendOwnerResponse !== 'function'
    || typeof api.emitOwnerEvent !== 'function'
    || typeof api.onEvent !== 'function') {
    return null;
  }
  return api as ElectronChatRuntimeHostApi;
}

function createErrorPayload(error: unknown): { message: string; code?: string } {
  const maybeError = error as { message?: unknown; code?: unknown } | null | undefined;
  return {
    message: typeof maybeError?.message === 'string' ? maybeError.message : String(error || 'Unknown runtime host error'),
    code: typeof maybeError?.code === 'string' ? maybeError.code : undefined,
  };
}

function normalizeRequestId(requestId: unknown): string {
  const normalized = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalized) {
    throw new Error('[AilyChat][RuntimeHost] Missing owner command request id.');
  }
  return normalized;
}

function normalizeOwnerMethod(method: unknown): RuntimeHostMethod {
  switch (method) {
    case 'attachView':
    case 'detachView':
    case 'submitTurn':
    case 'readSubmitReadiness':
    case 'ensureSessionCanRerun':
    case 'stopTurn':
    case 'disposeSession':
    case 'readSessionState':
    case 'readTranscript':
    case 'awaitRequestCompletion':
    case 'runWorkspaceFinalizeBoundaryProbe':
    case 'readInteractionSnapshot':
    case 'resolveInteraction':
      return method;
    default:
      throw new Error(`[AilyChat][RuntimeHost] Unsupported owner command method: ${String(method || '<missing>')}`);
  }
}

export function createElectronChatRuntimeHostTransport(): ChatRuntimeHost | null {
  const api = readElectronChatRuntimeHostApi();
  if (!api) {
    return null;
  }

  return {
    attachView: (
      viewId: ChatRuntimeHostViewId,
      sessionId: ChatRuntimeHostSessionId,
      options?: ChatRuntimeHostAttachViewOptions,
    ) =>
      api.call('attachView', [viewId, sessionId, options]) as Promise<ChatRuntimeHostSessionState>,
    detachView: (viewId: ChatRuntimeHostViewId) =>
      api.call('detachView', [viewId]) as Promise<void>,
    submitTurn: (request: ChatRuntimeHostSubmitRequest) =>
      api.call('submitTurn', [request]) as Promise<ChatRuntimeHostSessionState>,
    readSubmitReadiness: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('readSubmitReadiness', [sessionId]) as Promise<ChatRuntimeHostSubmitReadiness>,
    ensureSessionCanRerun: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('ensureSessionCanRerun', [sessionId]) as Promise<ChatRuntimeHostRerunReadiness>,
    stopTurn: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('stopTurn', [sessionId]) as Promise<void>,
    disposeSession: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('disposeSession', [sessionId]) as Promise<void>,
    readSessionState: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('readSessionState', [sessionId]) as Promise<ChatRuntimeHostSessionState | null>,
    readTranscript: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('readTranscript', [sessionId]) as Promise<ChatRuntimeHostTranscriptSnapshot | null>,
    awaitRequestCompletion: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('awaitRequestCompletion', [sessionId]) as Promise<void>,
    runWorkspaceFinalizeBoundaryProbe: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('runWorkspaceFinalizeBoundaryProbe', [sessionId]) as Promise<void>,
    readInteractionSnapshot: (sessionId: ChatRuntimeHostSessionId) =>
      api.call('readInteractionSnapshot', [sessionId]) as Promise<ChatRuntimeHostInteractionSnapshot | null>,
    resolveInteraction: (request: ChatRuntimeHostInteractionRequest) =>
      api.call('resolveInteraction', [request]) as Promise<ChatRuntimeHostInteractionSnapshot | null>,
    onEvent: (listener: (event: ChatRuntimeHostEvent) => void): ChatRuntimeHostEventSubscription => {
      const unsubscribe = api.onEvent(listener);
      return { dispose: unsubscribe };
    },
  };
}

export async function registerElectronChatRuntimeOwner(
  owner: ChatRuntimeHost,
  ownerId = 'aily-chat-main-runtime-owner',
): Promise<ElectronChatRuntimeOwnerRegistration> {
  const api = readElectronChatRuntimeHostApi();
  if (!api) {
    throw new Error('[AilyChat][RuntimeHost] Electron runtime host API is unavailable.');
  }

  const registration = await api.registerOwner(ownerId);
  if (!registration?.ok) {
    throw new Error('[AilyChat][RuntimeHost] Failed to register Electron runtime owner.');
  }

  const ownerEvents = owner.onEvent(event => api.emitOwnerEvent(event));
  const unsubscribeCommands = api.onOwnerCommand(payload => {
    void dispatchOwnerCommand(owner, api, payload);
  });

  let disposed = false;
  return {
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeCommands();
      ownerEvents.dispose();
      await api.unregisterOwner(ownerId);
    },
  };
}

async function dispatchOwnerCommand(
  owner: ChatRuntimeHost,
  api: ElectronChatRuntimeHostApi,
  payload: ElectronOwnerCommandPayload,
): Promise<void> {
  let requestId = '';
  try {
    requestId = normalizeRequestId(payload.requestId);
    const method = normalizeOwnerMethod(payload.method);
    const args = Array.isArray(payload.args) ? payload.args : [];
    const result = await callOwnerMethod(owner, method, args);
    api.sendOwnerResponse({ requestId, ok: true, result });
  } catch (error) {
    if (!requestId && typeof payload.requestId === 'string') {
      requestId = payload.requestId;
    }
    if (!requestId) {
      return;
    }
    api.sendOwnerResponse({
      requestId,
      ok: false,
      error: createErrorPayload(error),
    });
  }
}

function callOwnerMethod(owner: ChatRuntimeHost, method: RuntimeHostMethod, args: readonly unknown[]): Promise<unknown> {
  switch (method) {
    case 'attachView':
      return owner.attachView(
        args[0] as ChatRuntimeHostViewId,
        args[1] as ChatRuntimeHostSessionId,
        args[2] as ChatRuntimeHostAttachViewOptions | undefined,
      );
    case 'detachView':
      return owner.detachView(args[0] as ChatRuntimeHostViewId);
    case 'submitTurn':
      return owner.submitTurn(args[0] as ChatRuntimeHostSubmitRequest);
    case 'readSubmitReadiness':
      return owner.readSubmitReadiness(args[0] as ChatRuntimeHostSessionId);
    case 'ensureSessionCanRerun':
      return owner.ensureSessionCanRerun(args[0] as ChatRuntimeHostSessionId);
    case 'stopTurn':
      return owner.stopTurn(args[0] as ChatRuntimeHostSessionId);
    case 'disposeSession':
      return owner.disposeSession(args[0] as ChatRuntimeHostSessionId);
    case 'readSessionState':
      return owner.readSessionState(args[0] as ChatRuntimeHostSessionId);
    case 'readTranscript':
      return owner.readTranscript(args[0] as ChatRuntimeHostSessionId);
    case 'awaitRequestCompletion':
      return owner.awaitRequestCompletion(args[0] as ChatRuntimeHostSessionId);
    case 'runWorkspaceFinalizeBoundaryProbe':
      return owner.runWorkspaceFinalizeBoundaryProbe(args[0] as ChatRuntimeHostSessionId);
    case 'readInteractionSnapshot':
      return owner.readInteractionSnapshot(args[0] as ChatRuntimeHostSessionId);
    case 'resolveInteraction':
      return owner.resolveInteraction(args[0] as ChatRuntimeHostInteractionRequest);
  }
}
