const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");
// 添加autoUpdater引入
const { autoUpdater } = require('electron-updater');

// 添加自动更新处理函数
function registerUpdaterHandlers(mainWindow) {

  // 强制使用开发环境配置
  // if (process.env.DEV === 'true' || process.env.DEV === true) {
  //   autoUpdater.forceDevUpdateConfig = true;
  //   autoUpdater.allowDowngrade = true;
  //   autoUpdater.logger = require("electron-log");
  //   autoUpdater.logger.transports.file.level = "debug";
  // }

  autoUpdater.autoDownload = false;  // 禁用自动下载
  // autoUpdater.allowDowngrade = true; // 允许版本降级
  autoUpdater.useMultipleRangeRequest = false; // 禁用多范围请求
  autoUpdater.disableDifferentialDownload = true; // 禁用差量下载，使用完整下载

  // 添加IPC处理程序，允许从渲染进程手动检查更新
  ipcMain.handle('check-for-updates', async () => {
    const result = await autoUpdater.checkForUpdates();
    // console.log('检查更新结果:', result);
    return JSON.parse(JSON.stringify(result))
  });

  // 添加IPC处理程序，允许从渲染进程安装更新
  ipcMain.on('quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  // 添加IPC处理程序，手动下载更新
  ipcMain.handle('download-update', () => {
    return autoUpdater.downloadUpdate();
  });

  // 日志设置
  autoUpdater.logger = require("electron-log");
  autoUpdater.logger.transports.file.level = "info";

  // 设置检查更新时发送状态到渲染进程
  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update-status', {
      status: 'available',
      info: info
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    mainWindow.webContents.send('update-status', {
      status: 'not-available',
      info: info
    });
  });

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update-status', {
      status: 'error',
      error: err.toString()
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update-status', {
      status: 'progress',
      progress: progressObj
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update-status', {
      status: 'downloaded',
      info: info
    });
  });

  // 启动时检查更新
  autoUpdater.checkForUpdates();
}


module.exports = {
  registerUpdaterHandlers,
};