// 这个文件用于和cli交互，进行编译和烧录等操作
const pty = require("@lydell/node-pty");

mainWindow;

// 终端相关(dev)
const terminals = new Map();
ipcMain.on("terminal-create", (event, args) => {
  const shell = process.env[process.platform === "win32" ? "COMSPEC" : "SHELL"];
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd: process.env.HOME,
    env: process.env,
  });

  ptyProcess.on("data", (data) => {
    mainWindow.webContents.send("terminal-data", data);
  });

  ipcMain.on("terminal-input", (event, input) => {
    ptyProcess.write(input);
  });

  // 关闭终端
  ipcMain.on("terminal-close", (event) => {
    ptyProcess.kill();
  });
});

export function initTerminal(window) {
  mainWindow = window;
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("termina", {});
  });
}

export function openTerminal() {
  mainWindow.webContents.send("terminal", { action: "open" });
}

export function closeTerminal() {
  mainWindow.webContents.send("terminal", { action: "close" });
}

export function updateTerminal(data) {
  mainWindow.webContents.send("terminal", { action: "update", data });
}
