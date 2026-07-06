const { ipcMain } = require('electron');

const MCP_REQUEST_CHANNEL = 'mcp:request';
const MCP_RESPONSE_CHANNEL = 'mcp:response';
const DEFAULT_TIMEOUT_MS = 15000;

function createRequestId() {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

class RendererMcpBridge {
  constructor() {
    this.mainWindow = null;
    this.pendingRequests = new Map();
    this.responseHandlerRegistered = false;
    this.boundHandleResponse = this.handleResponse.bind(this);
  }

  registerResponseHandler() {
    if (this.responseHandlerRegistered) {
      return;
    }
    ipcMain.on(MCP_RESPONSE_CHANNEL, this.boundHandleResponse);
    this.responseHandlerRegistered = true;
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow || null;
  }

  async request(payload = {}) {
    return new Promise((resolve, reject) => {
      const mainWindow = this.mainWindow;
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
        reject(new Error('Main window is unavailable.'));
        return;
      }

      const requestId = createRequestId();
      const timeoutMs = Number.isFinite(payload.timeoutMs) && payload.timeoutMs > 0
        ? payload.timeoutMs
        : DEFAULT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Renderer MCP bridge timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      mainWindow.webContents.send(MCP_REQUEST_CHANNEL, {
        requestId,
        namespace: payload.namespace,
        method: payload.method,
        args: payload.args,
        targetProjectPath: payload.targetProjectPath,
        timeoutMs,
      });
    });
  }

  handleResponse(_event, payload = {}) {
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    if (!requestId) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(payload);
  }
}

module.exports = {
  RendererMcpBridge,
  MCP_REQUEST_CHANNEL,
  MCP_RESPONSE_CHANNEL,
  DEFAULT_TIMEOUT_MS,
};
