const { globalShortcut } = require("electron");

// 注册快捷键打开调试工具
function registerShortcuts(window) {
    // 额外注册 Ctrl+Shift+I (Windows/Linux) 或 Command+Option+I (macOS)
    const devToolsShortcut = process.platform === 'darwin' ? 'Command+Option+I' : 'Control+Shift+I';
    globalShortcut.register(devToolsShortcut, () => {
        if (window) {
            if (window.webContents.isDevToolsOpened()) {
                window.webContents.closeDevTools();
            } else {
                window.webContents.openDevTools();
            }
        }
    });
}

module.exports = {
    registerShortcuts,
};
