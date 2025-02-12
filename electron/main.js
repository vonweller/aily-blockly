const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const pty = require("@lydell/node-pty");

const args = process.argv.slice(1);
const serve = args.some((val) => val === "--serve");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 740,
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (serve) {
    mainWindow.loadURL("http://localhost:4200");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(`renderer/index.html`);
    mainWindow.webContents.openDevTools();
  }

  // 当主窗口被关闭时，进行相应的处理
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", () => {
  createWindow();
});

// 当所有窗口都被关闭时退出应用（macOS 除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 在 macOS 上，当应用被激活时（如点击 Dock 图标），重新创建窗口
app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

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

// 多窗口相关(dev)
ipcMain.on("window-open", (event, data) => {
  console.log("window-open", data);
  const subWindow = new BrowserWindow({
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    alwaysOnTop: data.alwaysOnTop ? data.alwaysOnTop : false,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js")
    },
  });

  if (serve) {
    subWindow.loadURL(`http://localhost:4200/#/${data.path}`);
    subWindow.webContents.openDevTools();
  } else {
    subWindow.loadFile(`renderer/index.html`, { hash: `#/${data.path}` });
    subWindow.webContents.openDevTools();
  }
});

ipcMain.on("window-minimize", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    senderWindow.minimize();
  }
});

ipcMain.on("window-maximize", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow.isMaximized()) {
    senderWindow.unmaximize();
  } else {
    senderWindow.maximize();
  }
});

ipcMain.on("window-close", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  senderWindow.close();
});

ipcMain.on("window-alwaysOnTop", (event, alwaysOnTop) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  senderWindow.setAlwaysOnTop(alwaysOnTop);
});

// 项目管理相关
ipcMain.handle("select-folder", async (event, data) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(senderWindow, {
    defaultPath: data.path,
    properties: ["openDirectory"],
  });
  if (result.canceled) {
    return data.path;
  }
  return result.filePaths[0];
});

ipcMain.handle("project-new", (event) => {
  const projectPath = createTemporaryProject();
  event.returnValue = projectPath;
  console.log("project-new path", projectPath);
});
