const path = require("path");
const os = require("os");

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { registerProjectHandlers } = require("./project");

const args = process.argv.slice(1);
const serve = args.some((val) => val === "--serve");

// ipc handlers模块
const { registerTerminalHandlers } = require("./terminal");
const { registerBoardHandlers } = require("./board");

let mainWindow;

// 获取系统默认的应用数据目录
function getAppDataPath() {
  let home = os.homedir();
  let path;
  if (process.platform === "win32") {
    path = home + "\\AppData\\Local\\aily-project";
  } else if (process.platform === "darwin") {
    path = home + "/Library/Application Support/aily-project";
  } else {
    path = home + "/.config/aily-project";
  }
  if (!require("fs").existsSync(path)) {
    require("fs").mkdirSync(path, { recursive: true });
  }
  return path;
}

// 环境变量加载
function loadEnv() {
  // 将child目录添加到环境变量PATH中
  process.env.PATH += path.delimiter + path.join(__dirname, "..", "child");
  // TODO 需要配合解压node环境时命名的指定，当前默认为node
  process.env.PATH += path.delimiter + path.join(__dirname, "..", "child", "node");

  // 读取同级目录下的config.json文件
  const confContent = require("fs").readFileSync(path.join(__dirname, "config.json"));
  const conf = JSON.parse(confContent);

  console.log("conf: ", conf);

  // app data path
  process.env.AILY_APPDATA_PATH = getAppDataPath();
  // npm registry
  process.env.AILY_NPM_REGISTRY = conf['npm_registry'][0];
  // 全局npm包路径
  process.env.AILY_NPM_PREFIX = process.env.AILY_APPDATA_PATH;
  // 默认全局编译器路径
  process.env.AILY_COMPILER_PATH = path.join(process.env.AILY_APPDATA_PATH, "compiler");
  // 默认全局烧录器路径
  process.env.AILY_TOOL_PATH = path.join(process.env.AILY_APPDATA_PATH, "tool");
  // 默认全局SDK路径
  process.env.AILY_SDK_PATH = path.join(process.env.AILY_APPDATA_PATH, "sdk");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    frame: false,
    minWidth: 1200,
    minHeight:780,
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

  try {
    loadEnv();
  } catch (error) {
    console.error("loadEnv error: ", error);
  }

  // 注册ipc handlers
  registerProjectHandlers(mainWindow);
  registerTerminalHandlers(mainWindow);
  registerBoardHandlers(mainWindow);
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

// 多窗口相关(dev)
ipcMain.on("window-open", (event, data) => {
  console.log("window-open", data);
  const subWindow = new BrowserWindow({
    frame: false,
    autoHideMenuBar: true,
    transparent: true,
    alwaysOnTop: data.alwaysOnTop ? data.alwaysOnTop : false,
    width: data.width ? data.width : 800,
    height: data.height ? data.height : 600,
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