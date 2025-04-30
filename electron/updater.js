const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");
// 添加autoUpdater引入
const { autoUpdater, CancellationToken } = require('electron-updater');

let cancellationToken = null;
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
  ipcMain.handle('start-download', () => {
    if (!cancellationToken) { // 防止重复下载
      cancellationToken = new CancellationToken();
      autoUpdater.downloadUpdate(cancellationToken)
        .then(result => {
          console.log('Download finished:', result);
          // 下载完成后也需要重置 token
          cancellationToken = null;
        })
        .catch(error => {
          // 检查错误是否是取消操作引起的
          // CancellationToken.cancel() 会抛出一个带有 "cancelled" 消息的错误
          if (error && error.message === "cancelled") {
            console.log('Download cancelled by user.');
            mainWindow?.webContents.send('download-cancelled'); // 发送取消事件
          } else {
            // 其他下载错误
            console.error('Download error:', error);
            mainWindow?.webContents.send('update-status', { // 使用 update-status 通道报告错误
              status: 'error',
              error: error.toString()
            });
          }
          cancellationToken = null; // 出错或取消后重置
        });
    }
  });

  // 添加IPC处理程序，取消下载更新
  ipcMain.handle('cancel-download', () => {
    if (cancellationToken) {
      cancellationToken.cancel();
    }
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
    // 这个监听器主要处理检查更新阶段或非下载过程中的错误
    // 下载过程中的错误（包括取消）在 downloadUpdate 的 catch 中处理
    console.error('Updater error:', err);
    // 如果下载正在进行中被取消，这里的错误可能也会触发，但我们已经在 catch 中处理了
    // 避免重复发送错误状态，除非 token 已经是 null (表示非下载错误)
    if (!cancellationToken) {
        mainWindow.webContents.send('update-status', {
          status: 'error',
          error: err.toString()
        });
    }
    // 确保 token 在任何错误后都被重置
    cancellationToken = null;
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update-status', {
      status: 'progress',
      progress: progressObj
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    cancellationToken = null; // 确保下载成功后也重置 token
    mainWindow.webContents.send('update-status', {
      status: 'downloaded',
      info: info
    });
  });

  // 启动时检查更新
  // autoUpdater.checkForUpdates();
}


module.exports = {
  registerUpdaterHandlers,
};