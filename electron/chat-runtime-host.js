const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const {
  ChatRuntimeHostProcessService,
  channels,
} = require('./chat-runtime-host-service');

let registered = false;
let runtimeHostService = null;
let executionWorkerWindow = null;

function bindExecutionWorkerWindowDiagnostics(win) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return;
  }
  const webContents = win.webContents;
  if (webContents.__ailyChatExecutionWorkerDiagnosticsBound) {
    return;
  }
  webContents.__ailyChatExecutionWorkerDiagnosticsBound = true;

  webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[AilyChat][ExecutionWorkerConsole]', JSON.stringify({
      webContentsId: webContents.id,
      level,
      message,
      line,
      sourceId,
    }));
  });
  webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[AilyChat][ExecutionWorkerLoadFailed]', JSON.stringify({
      webContentsId: webContents.id,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    }));
  });
  webContents.on('render-process-gone', (event, details) => {
    console.error('[AilyChat][ExecutionWorkerRenderProcessGone]', JSON.stringify({
      webContentsId: webContents.id,
      details,
    }));
  });
  webContents.on('unresponsive', () => {
    console.warn('[AilyChat][ExecutionWorkerUnresponsive]', JSON.stringify({
      webContentsId: webContents.id,
    }));
  });
}

function readRuntimeHostService() {
  if (!runtimeHostService) {
    runtimeHostService = new ChatRuntimeHostProcessService({ BrowserWindow });
  }
  return runtimeHostService;
}

function registerChatRuntimeHostIpc(mainWindow) {
  const service = readRuntimeHostService();
  service.setMainWindow(mainWindow);
  if (registered) {
    return;
  }
  registered = true;

  ipcMain.handle(channels.EXECUTION_WORKER_REGISTER_CHANNEL, (event, payload = {}) => (
    service.handleExecutionWorkerRegister(event, payload)
  ));
  ipcMain.handle(channels.EXECUTION_WORKER_UNREGISTER_CHANNEL, (event, payload = {}) => (
    service.handleExecutionWorkerUnregister(event, payload)
  ));
  ipcMain.handle(channels.RESOURCE_HANDLER_REGISTER_CHANNEL, (event, payload = {}) => (
    service.handleResourceOperationHandlerRegister(event, payload)
  ));
  ipcMain.handle(channels.RESOURCE_HANDLER_UNREGISTER_CHANNEL, (event, payload = {}) => (
    service.handleResourceOperationHandlerUnregister(event, payload)
  ));
  ipcMain.handle(channels.HOST_COMMAND_CHANNEL, (event, payload = {}) => (
    service.handleHostCommand(event, payload)
  ));
  ipcMain.on(channels.EXECUTION_WORKER_RESPONSE_CHANNEL, (event, payload = {}) => {
    service.handleExecutionWorkerResponse(event, payload);
  });
  ipcMain.on(channels.EXECUTION_WORKER_EVENT_CHANNEL, (event, payload = {}) => {
    service.handleExecutionWorkerEvent(event, payload);
  });
  ipcMain.on(channels.RESOURCE_HANDLER_RESPONSE_CHANNEL, (event, payload = {}) => {
    service.handleResourceOperationHandlerResponse(event, payload);
  });
}

function isDevServeExecutionWorkerWindow() {
  return process.env.DEV === 'true' || process.env.DEV === true;
}

function createExecutionWorkerWindow() {
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    frame: false,
    autoHideMenuBar: true,
    width: 320,
    height: 240,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  bindExecutionWorkerWindowDiagnostics(win);
  win.on('closed', () => {
    if (executionWorkerWindow === win) {
      executionWorkerWindow = null;
      readRuntimeHostService().setExecutionWorkerWindow(null);
    }
  });
  return win;
}

function loadExecutionWorkerWindow(win) {
  const route = 'aily-chat-execution-worker';
  if (isDevServeExecutionWorkerWindow()) {
    return win.loadURL(`http://localhost:4200/#/${route}`);
  }
  return win.loadFile('renderer/index.html', { hash: `#/${route}` });
}

function startChatRuntimeExecutionWorkerWindow() {
  if (executionWorkerWindow && !executionWorkerWindow.isDestroyed()) {
    return executionWorkerWindow;
  }

  const service = readRuntimeHostService();
  executionWorkerWindow = createExecutionWorkerWindow();
  service.setExecutionWorkerWindow(executionWorkerWindow);
  loadExecutionWorkerWindow(executionWorkerWindow).catch((error) => {
    console.error('[AilyChat][RuntimeHost] Failed to load execution worker window:', error);
  });
  return executionWorkerWindow;
}

module.exports = {
  registerChatRuntimeHostIpc,
  startChatRuntimeExecutionWorkerWindow,
  channels,
};
