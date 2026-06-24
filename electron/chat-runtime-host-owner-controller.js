const { isUsableWebContents } = require('./chat-runtime-host-mirror-controller');

const DEFAULT_COMMAND_TIMEOUT_MS = 30000;

function normalizeOwnerId(ownerId) {
  return typeof ownerId === 'string' && ownerId.trim().length > 0
    ? ownerId.trim()
    : 'aily-chat-main-runtime-owner';
}

class ChatRuntimeHostOwnerController {
  constructor(options = {}) {
    if (!options.BrowserWindow) {
      throw new Error('[AilyChat][RuntimeHost] BrowserWindow is required.');
    }
    if (!options.ownerCommandChannel) {
      throw new Error('[AilyChat][RuntimeHost] Owner command channel is required.');
    }

    this.BrowserWindow = options.BrowserWindow;
    this.ownerCommandChannel = options.ownerCommandChannel;
    this.commandTimeoutMs = Number.isFinite(options.commandTimeoutMs)
      ? options.commandTimeoutMs
      : DEFAULT_COMMAND_TIMEOUT_MS;
    this.onCommandResult = typeof options.onCommandResult === 'function'
      ? options.onCommandResult
      : () => {};

    this.mainWindowRef = null;
    this.owner = null;
    this.commandSeed = 0;
    this.pendingCommands = new Map();
  }

  setMainWindow(mainWindow) {
    this.mainWindowRef = mainWindow;
  }

  handleOwnerRegister(event, payload = {}) {
    this.assertMainWindowOwner(event);
    const ownerId = normalizeOwnerId(payload.ownerId);
    if (this.owner && this.owner.webContentsId !== event.sender.id) {
      throw new Error('[AilyChat][RuntimeHost] A different runtime owner is already registered.');
    }

    this.owner = {
      ownerId,
      webContentsId: event.sender.id,
      webContents: event.sender,
    };
    event.sender.once('destroyed', () => this.clearOwnerIfMatches(event.sender.id));
    return { ok: true, ownerId };
  }

  handleOwnerUnregister(event, payload = {}) {
    const ownerId = normalizeOwnerId(payload.ownerId);
    if (!this.owner) {
      return { ok: true };
    }
    this.assertRegisteredOwnerSender(event);
    if (this.owner.ownerId !== ownerId) {
      throw new Error('[AilyChat][RuntimeHost] Runtime owner id mismatch during unregister.');
    }
    this.clearOwnerIfMatches(event.sender.id);
    return { ok: true };
  }

  hasUsableOwner() {
    return !!this.readOwnerWebContents();
  }

  dispatchCommand(method, args) {
    const ownerWebContents = this.readOwnerWebContents();
    if (!ownerWebContents) {
      throw new Error('[AilyChat][RuntimeHost] No registered host runtime owner.');
    }

    const requestId = this.nextCommandId(method);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`[AilyChat][RuntimeHost] Runtime host command timed out: ${method}`));
      }, this.commandTimeoutMs);

      this.pendingCommands.set(requestId, { resolve, reject, timer, method, args });
      ownerWebContents.send(this.ownerCommandChannel, { requestId, method, args });
    });
  }

  handleOwnerResponse(event, payload = {}) {
    this.assertRegisteredOwnerSender(event);
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCommands.delete(requestId);
    if (payload.ok === false) {
      const error = new Error(payload.error?.message || '[AilyChat][RuntimeHost] Runtime owner command failed.');
      if (payload.error?.code) {
        error.code = payload.error.code;
      }
      pending.reject(error);
      return;
    }

    this.onCommandResult(pending.method, pending.args, payload.result);
    pending.resolve(payload.result);
  }

  assertRegisteredOwnerSender(event) {
    if (!this.owner || !event || !event.sender || this.owner.webContentsId !== event.sender.id) {
      throw new Error('[AilyChat][RuntimeHost] Runtime owner message came from a non-owner renderer.');
    }
  }

  clearPendingCommands(error) {
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingCommands.delete(requestId);
    }
  }

  clearOwnerIfMatches(webContentsId) {
    if (!this.owner || this.owner.webContentsId !== webContentsId) {
      return;
    }
    this.owner = null;
    this.clearPendingCommands(new Error('[AilyChat][RuntimeHost] Registered runtime owner was destroyed.'));
  }

  getSenderWindow(event) {
    return event && event.sender ? this.BrowserWindow.fromWebContents(event.sender) : null;
  }

  assertMainWindowOwner(event) {
    const senderWindow = this.getSenderWindow(event);
    if (!this.mainWindowRef || !senderWindow || senderWindow !== this.mainWindowRef) {
      throw new Error('[AilyChat][RuntimeHost] Runtime owner must be registered by the main BrowserWindow.');
    }
  }

  readOwnerWebContents() {
    if (!this.owner || !isUsableWebContents(this.owner.webContents)) {
      if (this.owner) {
        this.clearOwnerIfMatches(this.owner.webContentsId);
      }
      return null;
    }
    return this.owner.webContents;
  }

  nextCommandId(method) {
    this.commandSeed += 1;
    return `chat_runtime_${method}_${Date.now().toString(36)}_${this.commandSeed.toString(36)}`;
  }
}

module.exports = {
  ChatRuntimeHostOwnerController,
  DEFAULT_COMMAND_TIMEOUT_MS,
  normalizeOwnerId,
};
