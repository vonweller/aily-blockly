const { isUsableWebContents } = require('./chat-runtime-host-session-store');

const DEFAULT_COMMAND_TIMEOUT_MS = 30000;

function normalizeExecutionWorkerId(executionWorkerId) {
  return typeof executionWorkerId === 'string' && executionWorkerId.trim().length > 0
    ? executionWorkerId.trim()
    : 'aily-chat-host-execution-worker';
}

class ChatRuntimeHostExecutionWorkerController {
  constructor(options = {}) {
    if (!options.BrowserWindow) {
      throw new Error('[AilyChat][RuntimeHost] BrowserWindow is required.');
    }
    if (!options.executionWorkerCommandChannel) {
      throw new Error('[AilyChat][RuntimeHost] Execution worker command channel is required.');
    }

    this.BrowserWindow = options.BrowserWindow;
    this.executionWorkerCommandChannel = options.executionWorkerCommandChannel;
    this.commandTimeoutMs = Number.isFinite(options.commandTimeoutMs)
      ? options.commandTimeoutMs
      : DEFAULT_COMMAND_TIMEOUT_MS;
    this.onCommandResult = typeof options.onCommandResult === 'function'
      ? options.onCommandResult
      : () => {};
    this.onExecutionWorkerLost = typeof options.onExecutionWorkerLost === 'function'
      ? options.onExecutionWorkerLost
      : () => {};

    this.executionWorkerWindowRef = null;
    this.executionWorker = null;
    this.commandSeed = 0;
    this.pendingCommands = new Map();
  }

  setExecutionWorkerWindow(executionWorkerWindow) {
    this.executionWorkerWindowRef = executionWorkerWindow || null;
  }

  handleExecutionWorkerRegister(event, payload = {}) {
    this.assertHostCreatedExecutionWorker(event);
    const executionWorkerId = normalizeExecutionWorkerId(payload.executionWorkerId);
    if (this.executionWorker && this.executionWorker.webContentsId !== event.sender.id) {
      throw new Error('[AilyChat][RuntimeHost] A different runtime execution worker is already registered.');
    }

    this.executionWorker = {
      executionWorkerId,
      webContentsId: event.sender.id,
      webContents: event.sender,
    };
    console.log('[AilyChat][ExecutionWorkerRegistered]', JSON.stringify({
      executionWorkerId,
      webContentsId: event.sender.id,
    }));
    event.sender.once('destroyed', () => this.clearExecutionWorkerIfMatches(event.sender.id));
    return { ok: true, executionWorkerId };
  }

  handleExecutionWorkerUnregister(event, payload = {}) {
    const executionWorkerId = normalizeExecutionWorkerId(payload.executionWorkerId);
    if (!this.executionWorker) {
      return { ok: true };
    }
    this.assertRegisteredExecutionWorkerSender(event);
    if (this.executionWorker.executionWorkerId !== executionWorkerId) {
      throw new Error('[AilyChat][RuntimeHost] Runtime execution worker id mismatch during unregister.');
    }
    this.clearExecutionWorkerIfMatches(event.sender.id);
    return { ok: true };
  }

  hasUsableExecutionWorker() {
    return !!this.readExecutionWorkerWebContents();
  }

  dispatchCommand(method, args) {
    const executionWorkerWebContents = this.readExecutionWorkerWebContents();
    if (!executionWorkerWebContents) {
      throw new Error('[AilyChat][RuntimeHost] No registered host runtime execution worker.');
    }

    const requestId = this.nextCommandId(method);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`[AilyChat][RuntimeHost] Runtime host command timed out: ${method}`));
      }, this.commandTimeoutMs);

      this.pendingCommands.set(requestId, { resolve, reject, timer, method, args });
      executionWorkerWebContents.send(this.executionWorkerCommandChannel, { requestId, method, args });
    });
  }

  handleExecutionWorkerResponse(event, payload = {}) {
    this.assertRegisteredExecutionWorkerSender(event);
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCommands.delete(requestId);
    if (payload.ok === false) {
      const error = new Error(payload.error?.message || '[AilyChat][RuntimeHost] Runtime execution worker command failed.');
      if (payload.error?.code) {
        error.code = payload.error.code;
      }
      pending.reject(error);
      return;
    }

    this.onCommandResult(pending.method, pending.args, payload.result);
    pending.resolve(payload.result);
  }

  assertRegisteredExecutionWorkerSender(event) {
    if (!this.executionWorker || !event || !event.sender || this.executionWorker.webContentsId !== event.sender.id) {
      throw new Error('[AilyChat][RuntimeHost] Runtime execution worker message came from a non-execution-worker renderer.');
    }
  }

  clearPendingCommands(error) {
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingCommands.delete(requestId);
    }
  }

  clearExecutionWorkerIfMatches(webContentsId) {
    if (!this.executionWorker || this.executionWorker.webContentsId !== webContentsId) {
      return;
    }
    this.executionWorker = null;
    const error = new Error('[AilyChat][RuntimeHost] Registered runtime execution worker was destroyed.');
    error.code = 'execution_worker_lost';
    error.retryable = true;
    console.warn('[AilyChat][ExecutionWorkerLost]', JSON.stringify({ webContentsId }));
    this.clearPendingCommands(error);
    this.onExecutionWorkerLost(error);
  }

  getSenderWindow(event) {
    return event && event.sender ? this.BrowserWindow.fromWebContents(event.sender) : null;
  }

  assertHostCreatedExecutionWorker(event) {
    const senderWindow = this.getSenderWindow(event);
    if (!this.executionWorkerWindowRef || !senderWindow || senderWindow !== this.executionWorkerWindowRef) {
      throw new Error('[AilyChat][RuntimeHost] Runtime execution worker must be registered by the host-created execution worker window.');
    }
  }

  readExecutionWorkerWebContents() {
    if (!this.executionWorker || !isUsableWebContents(this.executionWorker.webContents)) {
      if (this.executionWorker) {
        this.clearExecutionWorkerIfMatches(this.executionWorker.webContentsId);
      }
      return null;
    }
    return this.executionWorker.webContents;
  }

  nextCommandId(method) {
    this.commandSeed += 1;
    return `chat_runtime_${method}_${Date.now().toString(36)}_${this.commandSeed.toString(36)}`;
  }
}

module.exports = {
  ChatRuntimeHostExecutionWorkerController,
  DEFAULT_COMMAND_TIMEOUT_MS,
  normalizeExecutionWorkerId,
};


