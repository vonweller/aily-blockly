const OWNER_REGISTER_CHANNEL = 'aily-chat-runtime-owner-register';
const OWNER_UNREGISTER_CHANNEL = 'aily-chat-runtime-owner-unregister';
const HOST_COMMAND_CHANNEL = 'aily-chat-runtime-host-command';
const OWNER_COMMAND_CHANNEL = 'aily-chat-runtime-owner-command';
const OWNER_RESPONSE_CHANNEL = 'aily-chat-runtime-owner-response';
const OWNER_EVENT_CHANNEL = 'aily-chat-runtime-owner-event';
const HOST_EVENT_CHANNEL = 'aily-chat-runtime-host-event';
const {
  ChatRuntimeHostMirrorController,
  MIRROR_MISS,
  isUsableWebContents,
  normalizeSessionId,
} = require('./chat-runtime-host-mirror-controller');
const {
  ChatRuntimeHostOwnerController,
  DEFAULT_COMMAND_TIMEOUT_MS,
} = require('./chat-runtime-host-owner-controller');

const channels = {
  OWNER_REGISTER_CHANNEL,
  OWNER_UNREGISTER_CHANNEL,
  HOST_COMMAND_CHANNEL,
  OWNER_COMMAND_CHANNEL,
  OWNER_RESPONSE_CHANNEL,
  OWNER_EVENT_CHANNEL,
  HOST_EVENT_CHANNEL,
};

const ALLOWED_METHODS = new Set([
  'attachView',
  'detachView',
  'submitTurn',
  'readSubmitReadiness',
  'ensureSessionCanRerun',
  'stopTurn',
  'disposeSession',
  'readSessionState',
  'readTranscript',
  'awaitRequestCompletion',
  'runWorkspaceFinalizeBoundaryProbe',
  'readInteractionSnapshot',
  'resolveInteraction',
]);

class ChatRuntimeHostProcessService {
  constructor(options = {}) {
    if (!options.BrowserWindow) {
      throw new Error('[AilyChat][RuntimeHost] BrowserWindow is required.');
    }
    this.BrowserWindow = options.BrowserWindow;
    this.hostMirror = new ChatRuntimeHostMirrorController();
    this.ownerController = new ChatRuntimeHostOwnerController({
      BrowserWindow: options.BrowserWindow,
      commandTimeoutMs: Number.isFinite(options.commandTimeoutMs)
        ? options.commandTimeoutMs
        : DEFAULT_COMMAND_TIMEOUT_MS,
      ownerCommandChannel: OWNER_COMMAND_CHANNEL,
      onCommandResult: (method, args, result) => this.hostMirror.cacheCommandResult(method, args, result),
    });
  }

  setMainWindow(mainWindow) {
    this.ownerController.setMainWindow(mainWindow);
  }

  async handleOwnerRegister(event, payload = {}) {
    return this.ownerController.handleOwnerRegister(event, payload);
  }

  async handleOwnerUnregister(event, payload = {}) {
    return this.ownerController.handleOwnerUnregister(event, payload);
  }

  async handleHostCommand(event, payload = {}) {
    const method = typeof payload.method === 'string' ? payload.method : '';
    if (!ALLOWED_METHODS.has(method)) {
      throw new Error(`[AilyChat][RuntimeHost] Unsupported runtime host method: ${method || '<missing>'}`);
    }

    const args = Array.isArray(payload.args) ? payload.args : [];
    if (method === 'attachView') {
      this.hostMirror.attachView(args[0], args[1], event && event.sender);
    }
    if (method === 'submitTurn') {
      return this.handleSubmitTurn(args);
    }
    const mirroredResult = this.hostMirror.readMirrorCommandResult(method, args);
    if (mirroredResult !== MIRROR_MISS) {
      return mirroredResult;
    }

    if (!this.ownerController.hasUsableOwner()) {
      const ownerUnavailableMirrorResult = this.hostMirror.readOwnerUnavailableMirrorCommandResult(method, args);
      if (ownerUnavailableMirrorResult !== MIRROR_MISS) {
        return ownerUnavailableMirrorResult;
      }
      throw new Error('[AilyChat][RuntimeHost] No registered host runtime owner.');
    }

    return this.ownerController.dispatchCommand(method, args);
  }

  async handleSubmitTurn(args) {
    if (!this.ownerController.hasUsableOwner()) {
      throw new Error('[AilyChat][RuntimeHost] No registered host runtime owner.');
    }

    const runningState = this.hostMirror.beginSubmittedTurn(args && args[0]);
    this.broadcastSessionState('runtime-status', runningState);
    this.ownerController.dispatchCommand('submitTurn', args)
      .catch(error => {
        const failedState = this.hostMirror.failSubmittedTurn(runningState.sessionId);
        if (failedState) {
          this.broadcastRuntimeError(runningState.sessionId, error, failedState.transcriptRevision);
          this.broadcastSessionState('runtime-status', failedState);
        }
      });
    return this.hostMirror.buildSessionState(runningState.sessionId);
  }

  handleOwnerResponse(event, payload = {}) {
    try {
      this.ownerController.handleOwnerResponse(event, payload);
    } catch (error) {
      console.warn('[AilyChat][RuntimeHost] Ignored owner response:', error.message);
    }
  }

  handleOwnerEvent(event, payload = {}) {
    try {
      this.ownerController.assertRegisteredOwnerSender(event);
      this.hostMirror.cacheHostEvent(payload);
      this.broadcastHostEvent(payload);
    } catch (error) {
      console.warn('[AilyChat][RuntimeHost] Ignored owner event:', error.message);
    }
  }

  broadcastHostEvent(payload) {
    if (!this.isSessionViewScopedEvent(payload)) {
      this.broadcastHostEventToAllWindows(payload);
      return;
    }
    this.broadcastHostEventToAttachedViews(payload);
  }

  broadcastHostEventToAllWindows(payload) {
    for (const win of this.BrowserWindow.getAllWindows()) {
      try {
        if (win && !win.isDestroyed() && isUsableWebContents(win.webContents)) {
          win.webContents.send(HOST_EVENT_CHANNEL, payload);
        }
      } catch (error) {
        console.warn('[AilyChat][RuntimeHost] Failed to broadcast host event:', error.message);
      }
    }
  }

  broadcastSessionState(kind, state) {
    if (!state || !state.sessionId) {
      return;
    }
    this.broadcastHostEvent({
      kind,
      sessionId: state.sessionId,
      revision: Number(state.transcriptRevision) || 0,
      state,
    });
  }

  broadcastRuntimeError(sessionId, error, revision = 0) {
    const maybeError = error || {};
    this.broadcastHostEvent({
      kind: 'error',
      sessionId,
      revision: Number(revision) || 0,
      error: {
        code: typeof maybeError.code === 'string' ? maybeError.code : undefined,
        message: typeof maybeError.message === 'string'
          ? maybeError.message
          : String(error || 'Unknown runtime host error'),
        retryable: typeof maybeError.retryable === 'boolean' ? maybeError.retryable : undefined,
      },
    });
  }

  broadcastHostEventToAttachedViews(payload) {
    const sessionId = normalizeSessionId(payload && payload.sessionId);
    if (!sessionId) {
      return;
    }
    for (const webContents of this.hostMirror.readAttachedViewWebContents(sessionId)) {
      try {
        webContents.send(HOST_EVENT_CHANNEL, payload);
      } catch (error) {
        console.warn('[AilyChat][RuntimeHost] Failed to send host event to attached view:', error.message);
      }
    }
  }

  isSessionViewScopedEvent(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    switch (payload.kind) {
      case 'transcript':
      case 'interaction':
      case 'view-request':
      case 'error':
        return true;
      default:
        return false;
    }
  }
}

module.exports = {
  ChatRuntimeHostProcessService,
  channels,
};
