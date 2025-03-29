const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");
// 添加autoUpdater引入
const { autoUpdater } = require('electron-updater');

// 添加自动更新处理函数
function registerUpdaterHandlers(mainWindow) {

  // 添加IPC处理程序，允许从渲染进程手动检查更新
  ipcMain.handle('check-for-updates', () => {
    return autoUpdater.checkForUpdates();
  });

  // 添加IPC处理程序，允许从渲染进程安装更新
  ipcMain.on('quit-and-install', () => {
    autoUpdater.quitAndInstall();
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

    // 可选：询问用户是否立即重启应用
    dialog.showMessageBox({
      type: 'info',
      title: '应用更新',
      message: '已下载新版本，是否现在重启应用?',
      buttons: ['是', '否']
    }).then((buttonIndex) => {
      if (buttonIndex.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // 启动时检查更新
  autoUpdater.checkForUpdates();
}


module.exports = {
  registerUpdaterHandlers,
};