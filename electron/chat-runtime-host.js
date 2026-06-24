const { ipcMain, BrowserWindow } = require('electron');
const {
  ChatRuntimeHostProcessService,
  channels,
} = require('./chat-runtime-host-service');

let registered = false;
let runtimeHostService = null;

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

  ipcMain.handle(channels.OWNER_REGISTER_CHANNEL, (event, payload = {}) => (
    service.handleOwnerRegister(event, payload)
  ));
  ipcMain.handle(channels.OWNER_UNREGISTER_CHANNEL, (event, payload = {}) => (
    service.handleOwnerUnregister(event, payload)
  ));
  ipcMain.handle(channels.HOST_COMMAND_CHANNEL, (event, payload = {}) => (
    service.handleHostCommand(event, payload)
  ));
  ipcMain.on(channels.OWNER_RESPONSE_CHANNEL, (event, payload = {}) => {
    service.handleOwnerResponse(event, payload);
  });
  ipcMain.on(channels.OWNER_EVENT_CHANNEL, (event, payload = {}) => {
    service.handleOwnerEvent(event, payload);
  });
}

module.exports = {
  registerChatRuntimeHostIpc,
  channels,
};
