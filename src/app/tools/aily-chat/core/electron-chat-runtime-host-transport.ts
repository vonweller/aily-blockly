import type {
  ChatRuntimeHost,
  ChatRuntimeHostAttachViewOptions,
  ChatRuntimeExecutionWorkerCommandMethod,
  ChatRuntimeExecutionWorkerDisposeSessionResourcesCommand,
  ChatRuntimeExecutionWorkerEvent,
  ChatRuntimeExecutionWorker,
  ChatRuntimeExecutionWorkerRenderEventProgress,
  ChatRuntimeHostEvent,
  ChatRuntimeHostEventSubscription,
  ChatRuntimeExecutionWorkerResolveInteractionCommand,
  ChatRuntimeExecutionWorkerStartTurnCommand,
  ChatRuntimeExecutionWorkerStopTurnCommand,
  ChatRuntimeHostInteractionRequest,
  ChatRuntimeHostInteractionSnapshot,
  ChatRuntimeHostResourceOperationRequest,
  ChatRuntimeHostResourceOperationResult,
  ChatRuntimeHostRerunReadiness,
  ChatRuntimeHostResourceRequest,
  ChatRuntimeHostResourceRequestEvent,
  ChatRuntimeHostSessionId,
  ChatRuntimeHostSessionInventorySnapshot,
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
  | 'readSessionInventory'
  | 'readTranscript'
  | 'awaitRequestCompletion'
  | 'runWorkspaceFinalizeBoundaryProbe'
  | 'readInteractionSnapshot'
  | 'resolveInteraction'
  | 'recordResourceRequest'
  | 'requestResourceOperation';

interface ElectronChatRuntimeHostApi {
  call(method: RuntimeHostMethod, args: readonly unknown[]): Promise<unknown>;
  registerExecutionWorker(executionWorkerId: string): Promise<{ ok?: boolean; executionWorkerId?: string }>;
  unregisterExecutionWorker(executionWorkerId: string): Promise<{ ok?: boolean }>;
  registerResourceOperationHandler(handlerId: string): Promise<{ ok?: boolean; handlerId?: string }>;
  unregisterResourceOperationHandler(handlerId: string): Promise<{ ok?: boolean }>;
  onExecutionWorkerCommand(callback: (payload: ElectronExecutionWorkerCommandPayload) => void): () => void;
  onResourceOperationCommand(callback: (payload: ElectronResourceOperationCommandPayload) => void): () => void;
  sendExecutionWorkerResponse(payload: ElectronExecutionWorkerCommandResponse): void;
  sendResourceOperationResponse(payload: ElectronResourceOperationCommandResponse): void;
  emitExecutionWorkerEvent(payload: ChatRuntimeExecutionWorkerEvent): void;
  onEvent(callback: (event: ChatRuntimeHostEvent) => void): () => void;
}

interface ElectronExecutionWorkerCommandPayload {
  readonly requestId?: string;
  readonly method?: string;
  readonly args?: readonly unknown[];
}

interface ElectronExecutionWorkerCommandResponse {
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: {
    readonly message: string;
    readonly code?: string;
  };
}

interface ElectronResourceOperationCommandPayload {
  readonly requestId?: string;
  readonly request?: ChatRuntimeHostResourceOperationRequest;
}

interface ElectronResourceOperationCommandResponse {
  readonly requestId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: {
    readonly message: string;
    readonly code?: string;
    readonly retryable?: boolean;
  };
}

interface ExecutionWorkerRegistrationState {
  readonly activeTurnIds: Map<ChatRuntimeHostSessionId, string>;
  readonly activeRequestIds: Map<ChatRuntimeHostSessionId, string>;
}

export interface ElectronChatRuntimeExecutionWorkerRegistration {
  dispose(): Promise<void>;
}

export interface ElectronChatRuntimeResourceOperationHandlerRegistration {
  dispose(): Promise<void>;
}

export type ElectronChatRuntimeResourceOperationHandler = (
  request: ChatRuntimeHostResourceOperationRequest,
) => Promise<unknown> | unknown;

function readElectronChatRuntimeHostApi(): ElectronChatRuntimeHostApi | null {
  const api = (globalThis as unknown as { electronAPI?: { chatRuntimeHost?: Partial<ElectronChatRuntimeHostApi> } })
    .electronAPI?.chatRuntimeHost;
  if (!api
    || typeof api.call !== 'function'
    || typeof api.registerExecutionWorker !== 'function'
    || typeof api.unregisterExecutionWorker !== 'function'
    || typeof api.registerResourceOperationHandler !== 'function'
    || typeof api.unregisterResourceOperationHandler !== 'function'
    || typeof api.onExecutionWorkerCommand !== 'function'
    || typeof api.onResourceOperationCommand !== 'function'
    || typeof api.sendExecutionWorkerResponse !== 'function'
    || typeof api.sendResourceOperationResponse !== 'function'
    || typeof api.emitExecutionWorkerEvent !== 'function'
    || typeof api.onEvent !== 'function') {
    return null;
  }
  return api as ElectronChatRuntimeHostApi;
}

export async function registerElectronChatRuntimeResourceOperationHandler(
  handler: ElectronChatRuntimeResourceOperationHandler,
  handlerId = 'aily-chat-host-resource-handler',
): Promise<ElectronChatRuntimeResourceOperationHandlerRegistration> {
  const api = readElectronChatRuntimeHostApi();
  if (!api) {
    throw new Error('[AilyChat][RuntimeHost] Electron runtime host API is unavailable.');
  }
  if (typeof handler !== 'function') {
    throw new Error('[AilyChat][RuntimeHost] Runtime resource operation handler is required.');
  }

  const registration = await api.registerResourceOperationHandler(handlerId);
  if (!registration?.ok) {
    throw new Error('[AilyChat][RuntimeHost] Failed to register Electron runtime resource operation handler.');
  }

  const unsubscribeCommands = api.onResourceOperationCommand(payload => {
    void dispatchResourceOperationCommand(handler, api, payload);
  });

  let disposed = false;
  return {
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeCommands();
      await api.unregisterResourceOperationHandler(handlerId);
    },
  };
}

async function dispatchResourceOperationCommand(
  handler: ElectronChatRuntimeResourceOperationHandler,
  api: ElectronChatRuntimeHostApi,
  payload: ElectronResourceOperationCommandPayload,
): Promise<void> {
  let requestId = '';
  try {
    requestId = normalizeRequestId(payload.requestId);
    const request = payload.request;
    if (!request || typeof request !== 'object') {
      throw new Error('[AilyChat][RuntimeHost] Runtime resource operation command requires a request.');
    }
    const result = await handler(request);
    api.sendResourceOperationResponse(createIpcSafePayload({ requestId, ok: true, result }));
  } catch (error) {
    if (!requestId && typeof payload.requestId === 'string') {
      requestId = payload.requestId;
    }
    if (!requestId) {
      return;
    }
    const errorPayload = createErrorPayload(error) as { message: string; code?: string; retryable?: boolean };
    const maybeError = error as { retryable?: unknown } | null | undefined;
    if (typeof maybeError?.retryable === 'boolean') {
      errorPayload.retryable = maybeError.retryable;
    }
    api.sendResourceOperationResponse(createIpcSafePayload({
      requestId,
      ok: false,
      error: errorPayload,
    }));
  }
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
    throw new Error('[AilyChat][RuntimeHost] Missing execution worker command request id.');
  }
  return normalized;
}

function normalizeExecutionWorkerMethod(method: unknown): ChatRuntimeExecutionWorkerCommandMethod {
  switch (method) {
    case 'startTurn':
    case 'stopTurn':
    case 'disposeSessionResources':
    case 'resolveInteraction':
      return method;
    default:
      throw new Error(`[AilyChat][RuntimeHost] Unsupported execution worker command method: ${String(method || '<missing>')}`);
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
    readSessionInventory: () =>
      api.call('readSessionInventory', []) as Promise<ChatRuntimeHostSessionInventorySnapshot>,
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
    recordResourceRequest: (request: ChatRuntimeHostResourceRequest) =>
      api.call('recordResourceRequest', [request]) as Promise<ChatRuntimeHostResourceRequestEvent | null>,
    requestResourceOperation: (request: ChatRuntimeHostResourceOperationRequest) =>
      api.call('requestResourceOperation', [request]) as Promise<ChatRuntimeHostResourceOperationResult>,
    onEvent: (listener: (event: ChatRuntimeHostEvent) => void): ChatRuntimeHostEventSubscription => {
      const unsubscribe = api.onEvent(listener);
      return { dispose: unsubscribe };
    },
  };
}

export async function registerElectronChatRuntimeExecutionWorker(
  executionWorker: ChatRuntimeExecutionWorker,
  executionWorkerId = 'aily-chat-host-execution-worker',
): Promise<ElectronChatRuntimeExecutionWorkerRegistration> {
  const api = readElectronChatRuntimeHostApi();
  if (!api) {
    throw new Error('[AilyChat][RuntimeHost] Electron runtime host API is unavailable.');
  }

  const registration = await api.registerExecutionWorker(executionWorkerId);
  if (!registration?.ok) {
    throw new Error('[AilyChat][RuntimeHost] Failed to register Electron runtime execution worker.');
  }

  const registrationState: ExecutionWorkerRegistrationState = {
    activeTurnIds: new Map(),
    activeRequestIds: new Map(),
  };
  const executionWorkerEvents = executionWorker.onEvent(event => {
    const workerEvent = createExecutionWorkerEvent(event, registrationState);
    if (workerEvent) {
      api.emitExecutionWorkerEvent(createIpcSafePayload(workerEvent));
    }
  });
  const unsubscribeCommands = api.onExecutionWorkerCommand(payload => {
    void dispatchExecutionWorkerCommand(executionWorker, api, payload, registrationState);
  });

  let disposed = false;
  return {
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeCommands();
      executionWorkerEvents.dispose();
      await api.unregisterExecutionWorker(executionWorkerId);
    },
  };
}

async function dispatchExecutionWorkerCommand(
  executionWorker: ChatRuntimeExecutionWorker,
  api: ElectronChatRuntimeHostApi,
  payload: ElectronExecutionWorkerCommandPayload,
  registrationState: ExecutionWorkerRegistrationState,
): Promise<void> {
  let requestId = '';
  let method: ChatRuntimeExecutionWorkerCommandMethod | '' = '';
  try {
    requestId = normalizeRequestId(payload.requestId);
    method = normalizeExecutionWorkerMethod(payload.method);
    const args = Array.isArray(payload.args) ? payload.args : [];
    trackExecutionWorkerCommand(method, args, registrationState);
    const result = await callExecutionWorkerMethod(executionWorker, method, args);
    api.sendExecutionWorkerResponse(createIpcSafePayload({ requestId, ok: true, result }));
  } catch (error) {
    console.error('[AilyChat][RuntimeHost] Execution worker command failed:', {
      requestId,
      method: method || payload.method,
      error: createErrorPayload(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (!requestId && typeof payload.requestId === 'string') {
      requestId = payload.requestId;
    }
    if (!requestId) {
      return;
    }
    api.sendExecutionWorkerResponse(createIpcSafePayload({
      requestId,
      ok: false,
      error: createErrorPayload(error),
    }));
  }
}

function trackExecutionWorkerCommand(
  method: ChatRuntimeExecutionWorkerCommandMethod,
  args: readonly unknown[],
  registrationState: ExecutionWorkerRegistrationState,
): void {
  switch (method) {
    case 'startTurn': {
      const command = args[0] as Partial<ChatRuntimeExecutionWorkerStartTurnCommand> | null | undefined;
      const sessionId = normalizeNonEmptyString(command?.sessionId ?? command?.request?.sessionId);
      const turnId = normalizeNonEmptyString(command?.turnId ?? command?.request?.activeResponseHandle);
      const requestId = readRequestMetadataRequestId(command?.request);
      if (sessionId && turnId) {
        registrationState.activeTurnIds.set(sessionId, turnId);
        if (requestId) {
          registrationState.activeRequestIds.set(sessionId, requestId);
        } else {
          registrationState.activeRequestIds.delete(sessionId);
        }
      }
      return;
    }
    case 'disposeSessionResources': {
      const command = args[0] as Partial<ChatRuntimeExecutionWorkerDisposeSessionResourcesCommand> | null | undefined;
      const sessionId = normalizeNonEmptyString(command?.sessionId);
      if (sessionId) {
        registrationState.activeTurnIds.delete(sessionId);
        registrationState.activeRequestIds.delete(sessionId);
      }
      return;
    }
    default:
      return;
  }
}

function createExecutionWorkerEvent(
  event: ChatRuntimeHostEvent | ChatRuntimeExecutionWorkerRenderEventProgress | ChatRuntimeExecutionWorkerEvent,
  registrationState: ExecutionWorkerRegistrationState,
): ChatRuntimeExecutionWorkerEvent | null {
  const sessionId = normalizeNonEmptyString(event.sessionId);
  if (!sessionId) {
    return null;
  }
  if (isExecutionWorkerEvent(event)) {
    return normalizeExplicitExecutionWorkerEvent(event, sessionId, registrationState);
  }
  const trackedTurnId = registrationState.activeTurnIds.get(sessionId) || '';
  if (event.kind === 'render-event') {
    const renderEventTurnId = readRenderEventTurnId(event.renderEvent);
    const turnId = renderEventTurnId || normalizeNonEmptyString(event.turnId) || trackedTurnId;
    if (!turnId) {
      return null;
    }
    if (renderEventTurnId) {
      registrationState.activeTurnIds.set(sessionId, renderEventTurnId);
    }
    return {
      kind: 'turnProgress',
      sessionId,
      turnId,
      revision: Number(event.revision) || 0,
      ...(event.request ? { request: event.request } : {}),
      renderEvent: event.renderEvent,
    };
  }
  const turnId = trackedTurnId || readEventTurnId(event);
  if (!turnId) {
    return null;
  }
  const revision = Number(event.revision) || 0;
  switch (event.kind) {
    case 'transcript':
      return null;
    case 'view-request':
      return {
        kind: 'turnProgress',
        sessionId,
        turnId,
        revision,
        event,
      };
    case 'resource-request':
      return {
        kind: 'turnProgress',
        sessionId,
        turnId,
        revision,
        event,
      };
    case 'session-state':
    case 'runtime-status': {
      if (event.state.requestInProgress === false) {
        registrationState.activeTurnIds.delete(sessionId);
        registrationState.activeRequestIds.delete(sessionId);
        return {
          kind: 'turnCompleted',
          sessionId,
          turnId,
          revision,
          state: event.state,
        };
      }
      if (turnId) {
        registrationState.activeTurnIds.set(sessionId, turnId);
      }
      return {
        kind: 'turnProgress',
        sessionId,
        turnId,
        revision,
        event,
      };
    }
    case 'interaction':
      return {
        kind: 'turnInteractionRequested',
        sessionId,
        turnId,
        revision,
        interaction: event.interaction,
      };
    case 'error':
      registrationState.activeTurnIds.delete(sessionId);
      registrationState.activeRequestIds.delete(sessionId);
      return {
        kind: 'turnError',
        sessionId,
        turnId,
        revision,
        error: event.error,
      };
  }
}

function isExecutionWorkerEvent(event: unknown): event is ChatRuntimeExecutionWorkerEvent {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const kind = (event as { readonly kind?: unknown }).kind;
  return kind === 'turnProgress'
    || kind === 'turnInteractionRequested'
    || kind === 'turnError'
    || kind === 'turnCompleted';
}

function normalizeExplicitExecutionWorkerEvent(
  event: ChatRuntimeExecutionWorkerEvent,
  sessionId: string,
  registrationState: ExecutionWorkerRegistrationState,
): ChatRuntimeExecutionWorkerEvent | null {
  const trackedTurnId = registrationState.activeTurnIds.get(sessionId) || '';
  const turnId = normalizeNonEmptyString((event as { readonly turn?: { readonly turnId?: unknown } }).turn?.turnId)
    || normalizeNonEmptyString(event.turnId)
    || trackedTurnId;
  if (!turnId) {
    return null;
  }
  if (event.kind === 'turnCompleted' || event.kind === 'turnError') {
    registrationState.activeTurnIds.delete(sessionId);
    registrationState.activeRequestIds.delete(sessionId);
  } else {
    registrationState.activeTurnIds.set(sessionId, turnId);
  }
  return {
    ...event,
    sessionId,
    turnId,
  } as ChatRuntimeExecutionWorkerEvent;
}

function readEventTurnId(event: ChatRuntimeHostEvent): string {
  if ((event.kind === 'session-state' || event.kind === 'runtime-status') && event.state.activeTurnId) {
    return normalizeNonEmptyString(event.state.activeTurnId);
  }
  return '';
}

function readRenderEventTurnId(event: unknown): string {
  if (!event || typeof event !== 'object') {
    return '';
  }
  return normalizeNonEmptyString((event as { readonly turnId?: unknown }).turnId);
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : '';
}

function readRequestMetadataRequestId(request: Partial<ChatRuntimeExecutionWorkerStartTurnCommand['request']> | null | undefined): string {
  const metadata = request?.metadata;
  return metadata && typeof metadata === 'object'
    ? normalizeNonEmptyString((metadata as { requestId?: unknown }).requestId)
    : '';
}

function callExecutionWorkerMethod(
  executionWorker: ChatRuntimeExecutionWorker,
  method: ChatRuntimeExecutionWorkerCommandMethod,
  args: readonly unknown[],
): Promise<unknown> {
  switch (method) {
    case 'startTurn': {
      const command = args[0] as Partial<ChatRuntimeExecutionWorkerStartTurnCommand> | null | undefined;
      const request = command?.request;
      if (!request || typeof request !== 'object') {
        throw new Error('[AilyChat][RuntimeHost] startTurn requires a submit request.');
      }
      return executionWorker.startTurn({
        sessionId: command?.sessionId || request.sessionId,
        turnId: command?.turnId || request.activeResponseHandle,
        request: {
          ...request,
          sessionId: command?.sessionId || request.sessionId,
          activeResponseHandle: command?.turnId || request.activeResponseHandle,
        },
        executionContext: command?.executionContext,
      } as ChatRuntimeExecutionWorkerStartTurnCommand);
    }
    case 'stopTurn': {
      const command = args[0] as Partial<ChatRuntimeExecutionWorkerStopTurnCommand> | null | undefined;
      return executionWorker.stopTurn({
        sessionId: command?.sessionId as ChatRuntimeHostSessionId,
        turnId: command?.turnId,
      });
    }
    case 'disposeSessionResources': {
      const command = args[0] as Partial<ChatRuntimeExecutionWorkerDisposeSessionResourcesCommand> | null | undefined;
      return executionWorker.disposeSessionResources({
        sessionId: command?.sessionId as ChatRuntimeHostSessionId,
      });
    }
    case 'resolveInteraction':
      return executionWorker.resolveInteraction(
        args[0] as ChatRuntimeExecutionWorkerResolveInteractionCommand,
      );
  }
}

function createIpcSafePayload<T>(payload: T): T {
  return JSON.parse(JSON.stringify(payload, createIpcSafeJsonReplacer())) as T;
}

function createIpcSafeJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      return undefined;
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    if (value instanceof Map) {
      return Array.from(value.entries());
    }
    if (value instanceof Set) {
      return Array.from(value.values());
    }
    return value;
  };
}
