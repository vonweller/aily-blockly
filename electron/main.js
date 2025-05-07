const path = require("path");
const os = require("os");
const fs = require("fs");

const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");

const { isWin32, isDarwin, isLinux } = require("./platform");

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('enable-features', 'V8LazyCodeGeneration,V8CacheOptions');

const args = process.argv.slice(1);
const serve = args.some((val) => val === "--serve");
process.env.DEV = serve;

// ipc handlers模块
const { registerTerminalHandlers } = require("./terminal");
const { registerWindowHandlers } = require("./window");
const { registerNpmHandlers } = require("./npm");
const { registerUpdaterHandlers } = require("./updater");
// debug模块
const { initLogger } = require("./logger");

let mainWindow;

// 环境变量加载
function loadEnv() {
  // 将child目录添加到环境变量PATH中
  const childPath = path.join(__dirname, "..", "child")
  process.env.PATH = childPath + path.delimiter + process.env.PATH;

  // node环境加载
  // checkNodePath(childPath)

  const nodePath = path.join(childPath, "node")
  // 将node环境的路径配置在系统PATH环境的最前面，以实现优先调用内置的node环境
  process.env.PATH = nodePath + path.delimiter + process.env.PATH;

  // 读取同级目录下的config.json文件
  const confContent = require("fs").readFileSync(
    path.join(__dirname, "config.json"),
  );
  const conf = JSON.parse(confContent);

  // 设置系统默认的应用数据目录
  if (isWin32) {
    // 设置Windows的环境变量
    process.env.AILY_APPDATA_PATH = conf["appdata_path"]["win32"].replace('%HOMEPATH%', os.homedir());
  } else if (isDarwin) {
    // 设置macOS的环境变量
    process.env.AILY_APPDATA_PATH = conf["appdata_path"]["darwin"];
  } else {
    // 设置Linux的环境变量
    process.env.AILY_APPDATA_PATH = conf["appdata_path"]["linux"];
  }

  // npm registry
  process.env.AILY_NPM_REGISTRY = conf["npm_registry"][0];
  // 7za path
  process.env.AILY_7ZA_PATH = path.join(childPath, "7za.exe")
  // 全局npm包路径
  process.env.AILY_NPM_PREFIX = process.env.AILY_APPDATA_PATH;
  // 默认全局编译器路径
  process.env.AILY_COMPILERS_PATH = path.join(
    process.env.AILY_APPDATA_PATH,
    "compiler",
  );
  // 默认全局烧录器路径
  process.env.AILY_TOOLS_PATH = path.join(process.env.AILY_APPDATA_PATH, "tools");
  // 默认全局SDK路径
  process.env.AILY_SDK_PATH = path.join(process.env.AILY_APPDATA_PATH, "sdk");
  // zip包下载地址
  process.env.AILY_ZIP_URL = conf["resource"][0];

  process.env.AILY_PROJECT_PATH = conf["project_path"];
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    frame: false,
    minWidth: 1200,
    minHeight: 780,
    autoHideMenuBar: true,
    transparent: true,
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (serve) {
    mainWindow.loadURL("http://localhost:4200");
    // mainWindow.loadURL("http://127.0.0.1:4200");
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(`renderer/index.html`);
    // mainWindow.webContents.openDevTools();
  }

  // registerShortcuts(mainWindow);

  // 当主窗口被关闭时，进行相应的处理
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });

  try {
    loadEnv();
    initLogger(process.env.AILY_APPDATA_PATH);
  } catch (error) {
    console.error("loadEnv error: ", error);
  }

  // 注册ipc handlers
  setTimeout(() => {
    registerTerminalHandlers(mainWindow);
    registerWindowHandlers(mainWindow);
    registerNpmHandlers(mainWindow);
    registerUpdaterHandlers(mainWindow);
  }, 500);
}

app.on("ready", () => {
  createWindow();

  // 这个用于双击实现窗口最大化，之后调
  // setInterval(() => {
  //   const cursorPos = screen.getCursorScreenPoint(); // 全局鼠标坐标
  //   const winPos = mainWindow.getBounds();             // 窗口在屏幕中的位置和大小

  //   // 计算鼠标在窗口中的位置
  //   const relativeX = cursorPos.x - winPos.x;
  //   const relativeY = cursorPos.y - winPos.y;
  //   // console.log('鼠标在窗口中的位置：', relativeX, relativeY);
  // }, 1000);
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

// 项目管理相关
// 打开项目用
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

// 另存为用
ipcMain.handle("select-folder-saveAs", async (event, data) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  // 构建默认路径，确保包含建议的文件名
  let defaultPath;
  if (data.path) {
    defaultPath = data.path;
    // 如果同时提供了建议名称，则附加到路径上
    if (data.suggestedName) {
      defaultPath = path.join(defaultPath, data.suggestedName);
    }
  } else if (data.suggestedName) {
    defaultPath = path.join(app.getPath('documents'), data.suggestedName);
  } else {
    defaultPath = app.getPath('documents');
  }
  const result = await dialog.showSaveDialog(senderWindow, {
    defaultPath: defaultPath,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    buttonLabel: '保存',
    title: '项目另存为'
  });

  if (result.canceled) {
    return data.path || '';
  }
  // 直接返回用户选择的完整路径，保留文件名部分
  return result.filePath;
});

// 环境变量
ipcMain.handle("env-set", (event, data) => {
  process.env[data.key] = data.value;
})

ipcMain.handle("env-get", (event, key) => {
  return process.env[key];
})

// 用于嵌入的iframe打开外部链接
app.on('web-contents-created', (event, contents) => {
  // 处理iframe中的链接点击
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' }; // 阻止在Electron中打开
  });
});

// settingChanged
ipcMain.on("setting-changed", (event, data) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  mainWindow.webContents.send("setting-changed", data);
});
