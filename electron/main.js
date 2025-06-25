const path = require("path");
const os = require("os");
const fs = require("fs");
const _ = require("lodash");
const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require("electron");

const { isWin32, isDarwin, isLinux } = require("./platform");

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('enable-features', 'V8LazyCodeGeneration,V8CacheOptions');

const args = process.argv.slice(1);
const serve = args.some((val) => val === "--serve");
process.env.DEV = serve;

// 文件关联处理
let pendingFileToOpen = null;

// 处理命令行参数中的 .abi 文件
function handleCommandLineArgs(argv) {
  const abiFile = argv.find(arg => arg.endsWith('.abi') && fs.existsSync(arg));
  if (abiFile) {
    const resolvedPath = path.resolve(abiFile);
    pendingFileToOpen = path.dirname(resolvedPath);
    console.log('Found .abi file to open:', resolvedPath);
    console.log('Project directory:', pendingFileToOpen);
    return true;
  }
  return false;
}

// 在应用启动时处理命令行参数
handleCommandLineArgs(process.argv);

// 确保应用只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // 处理第二个实例的启动参数
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Windows下处理文件关联
    handleCommandLineArgs(commandLine);
    
    // 如果主窗口存在，聚焦并处理文件
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // 如果有待打开的文件，直接导航到对应路由
      if (pendingFileToOpen) {
        const routePath = `main/blockly-editor?path=${encodeURIComponent(pendingFileToOpen)}`;
        console.log('Navigating to route:', routePath);
        
        if (serve) {
          mainWindow.loadURL(`http://localhost:4200/#/${routePath}`);
        } else {
          mainWindow.loadFile(`renderer/index.html`, { hash: `#/${routePath}` });
        }
        pendingFileToOpen = null;
      }
    }
  });
}

// macOS下处理文件打开
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (filePath.endsWith('.abi') && fs.existsSync(filePath)) {
    const projectDir = path.dirname(path.resolve(filePath));
    console.log('macOS open-file:', filePath);
    console.log('Project directory:', projectDir);
    
    if (mainWindow && mainWindow.webContents) {
      // 直接导航到对应路由
      const routePath = `main/blockly-editor?path=${encodeURIComponent(projectDir)}`;
      console.log('Navigating to route:', routePath);
      
      if (serve) {
        mainWindow.loadURL(`http://localhost:4200/#/${routePath}`);
      } else {
        mainWindow.loadFile(`renderer/index.html`, { hash: `#/${routePath}` });
      }
    } else {
      pendingFileToOpen = projectDir;
    }
  }
});

// ipc handlers模块
const { registerTerminalHandlers } = require("./terminal");
const { registerWindowHandlers } = require("./window");
const { registerNpmHandlers } = require("./npm");
const { registerUpdaterHandlers } = require("./updater");
const { registerCmdHandlers } = require("./cmd");
// debug模块
const { initLogger } = require("./logger");

let mainWindow;
let userConf;

// 环境变量加载
function loadEnv() {
  // 将child目录添加到环境变量PATH中
  const childPath = path.join(__dirname, "..", "child")
  const nodePath = path.join(childPath, "node")
  
  // 只保留PowerShell路径，移除其他系统PATH
  let customPath = nodePath + path.delimiter + childPath;
  
  if (isWin32) {
    // 添加必要的系统路径
    const systemPaths = [
      'C:\\Windows\\System32',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      'C:\\Program Files\\PowerShell\\7', // PowerShell 7 (如果存在)
      'C:\\Windows'
    ];
    
    // 检查路径是否存在，只添加存在的路径
    systemPaths.forEach(sysPath => {
      if (fs.existsSync(sysPath)) {
        customPath += path.delimiter + sysPath;
      }
    });
  }
  
  // 完全替换PATH
  process.env.PATH = customPath;
  
  // 读取同级目录下的config.json文件
  const configPath = path.join(__dirname, "config.json");
  const conf = JSON.parse(fs.readFileSync(configPath));

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

  // 确保应用数据目录存在
  if (!fs.existsSync(process.env.AILY_APPDATA_PATH)) {
    try {
      fs.mkdirSync(process.env.AILY_APPDATA_PATH, { recursive: true });
    } catch (error) {
      console.error("创建应用数据目录失败:", error);
    }
  }

  // 检测并读取appdata_path目录下是否有config.json文件
  const userConfigPath = path.join(process.env.AILY_APPDATA_PATH, "config.json");

  // 如果用户配置文件不存在，则复制默认配置文件
  if (!fs.existsSync(userConfigPath)) {
    try {
      fs.copyFileSync(configPath, userConfigPath);
      console.log("已将默认配置文件复制到用户目录:", userConfigPath);
    } catch (error) {
      console.error("复制配置文件失败:", error);
    }
  }

  // 读取用户配置文件
  try {
    userConf = JSON.parse(fs.readFileSync(userConfigPath));
    // 合并配置文件
    Object.assign(conf, userConf);
  } catch (error) {
    console.error("读取用户配置文件失败:", error);
    userConf = {}; // 确保userConf是一个对象
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
  let windowBounds = getConfWindowBounds();

  mainWindow = new BrowserWindow({
    ...windowBounds,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'default',
    alwaysOnTop: false,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // 根据是否有待打开的项目路径来决定加载的页面
  if (pendingFileToOpen) {
    const routePath = `main/blockly-editor?path=${encodeURIComponent(pendingFileToOpen)}`;
    console.log('Loading with project path:', routePath);
    
    if (serve) {
      mainWindow.loadURL(`http://localhost:4200/#/${routePath}`);
    } else {
      mainWindow.loadFile(`renderer/index.html`, { hash: `#/${routePath}` });
    }
    pendingFileToOpen = null;
  } else {
    if (serve) {
      mainWindow.loadURL("http://localhost:4200");
    } else {
      mainWindow.loadFile(`renderer/index.html`);
    }
  }

  // 当主窗口被关闭时，进行相应的处理
  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });

  try {
    initLogger(process.env.AILY_APPDATA_PATH);
  } catch (error) {
    console.error("initLogger error: ", error);
  }

  // 注册ipc handlers
  setTimeout(() => {
    registerTerminalHandlers(mainWindow);
    registerWindowHandlers(mainWindow);
    registerNpmHandlers(mainWindow);
    registerUpdaterHandlers(mainWindow);
    registerCmdHandlers(mainWindow);
  }, 500);

}

app.on("ready", () => {
  // 先加载环境变量
  try {
    loadEnv();
  } catch (error) {
    console.error("loadEnv error: ", error);
  }
  // 创建主窗口
  createWindow();
  listenMoveResize();
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
    // 先加载环境变量
    try {
      loadEnv();
    } catch (error) {
      console.error("loadEnv error: ", error);
    }
    // 创建主窗口
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


// 记录窗口大小和位置，用于下次打开时恢复
function windowMoveResizeListener() {
  const bounds = mainWindow.getBounds();
  // console.log("窗口位置和大小：", bounds);
  // 读取配置文件, 将窗口位置和大小保存到配置文件中
  const userConfigPath = path.join(process.env.AILY_APPDATA_PATH, "config.json");
  let userConf = JSON.parse(fs.readFileSync(userConfigPath));
  userConf["window"] = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  fs.writeFileSync(userConfigPath, JSON.stringify(userConf));
}

function listenMoveResize() {
  const listener = _.debounce(windowMoveResizeListener.bind(this), 1000)
  mainWindow.on('resize', listener)
  mainWindow.on('move', listener)
}

function getConfWindowBounds() {
  let bounds = userConf.window || {
    width: 1200,
    height: 780,
  };
  // 确保窗口位置在屏幕范围内
  const screenBounds = screen.getPrimaryDisplay().bounds;
  if (bounds.x < screenBounds.x) {
    bounds.x = screenBounds.x;
  }
  if (bounds.y < screenBounds.y) {
    bounds.y = screenBounds.y;
  }
  if (bounds.width > screenBounds.width) {
    bounds.width = screenBounds.width;
  }
  if (bounds.height > screenBounds.height) {
    bounds.height = screenBounds.height;
  }
  return bounds;
}
