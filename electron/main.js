const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const pty = require("@lydell/node-pty");

const { getDependencies, initArduinoCliConf, arduinoCodeGen, genBuilderJson, arduinoCliBuilder, arduinoCliUploader } = require("./terminal");
const {installPackageByArduinoCli} = require("./board");
const { createProject, createTemporaryProject } = require("./project");
const { installPackage, initNpmRegistry } = require("./package");

const args = process.argv.slice(1);
const serve = args.some((val) => val === "--serve");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
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

ipcMain.handle("project-new", async (event, data) => {
  try {
    const projectPath = createProject(data);
    return { success: true, data: projectPath };
  } catch (error) {
    console.error("project-new error: ", error);
    return { success: false };
  }
});

ipcMain.handle("project-newTmp", async (event, data) => {
  try {
    const projectPath = createTemporaryProject();
    return { success: true, data: projectPath };
  } catch (error) {
    console.error("project-tmp error: ", error);
    return { success: false };
  }
});

ipcMain.on('project-update', (event, data) => {
  if (mainWindow) {
    mainWindow.webContents.send('project-update', data.data);
  }
});

ipcMain.handle("builder-init", async (event, data) => {
  try {
    const deps = getDependencies(data.prjPath);
    // arduino-cli配置文件路径（每个项目下都有一个）
    let cliYamlPath = initArduinoCliConf(data.prjPath, data.appDataPath)
    console.log("arduino-prj-new: ", cliYamlPath);

    const core = deps.boardConfList[0].core;
    await installPackageByArduinoCli(core, cliYamlPath);

    await Promise.all(
      deps.libraryConfList.map(async (libraryConf) => {
        // TODO: 处理 library 安装逻辑
      })
    );

    // 临时文件夹路径
    const tmpPath = createTemporaryProject();

    genBuilderJson({
       core, 
       cliYamlPath, 
       type: deps.boardConfList[0].type,
       sketchPath: path.join(tmpPath, 'mySketch'),
       compilerOutput: path.join(tmpPath, 'output'),
       compilerParam: deps.boardConfList[0].compilerParam ,
       uploadParam: deps.boardConfList[0].uploadParam,
      }, data.prjPath);

    return { success: true };
  } catch (error) {
    console.error("builder-init error: ", error);
    return { success: false };
  }
});

ipcMain.handle("builder-codeGen", async (event, data) => {
  try {
    arduinoCodeGen(data.code, data.prjPath);
    return { success: true };
  } catch (error) {
    console.error("builder-codeGen error: ", error);
    return { success: false };
  }
});

ipcMain.handle("builder-build", async (event, data) => {
  try {
    await arduinoCliBuilder(data.prjPath);
    return { success: true };
  } catch (error) {
    console.error("builder-build error: ", error);
    return { success: false };
  }
});

ipcMain.handle("uploader-upload", async (event, data) => {
  try {
    await arduinoCliUploader(data.port, data.prjPath);
    return { success: true };
  } catch (error) {
    console.error("uploader-upload error: ", error);
    return { success: false };
  }
});

ipcMain.handle("package-init", async (event, data) => {
  try {
    initNpmRegistry();
    return { success: true };
  } catch (error) {
    console.error("package-init error: ", error);
    return { success: false };
  }
});

ipcMain.handle("package-install", async (event, data) => {
  try {
    await installPackage(data.prjPath, data?.package);
    return { success: true };
  } catch (error) {
    console.error("package-install error: ", error);
    return { success: false };
  }
});

ipcMain.on("terminal-data", async (event, data) => {
  console.log("terminal-data: ", data);
});

// 终端相关(dev)
const terminals = new Map();
ipcMain.on("terminal-create", (event, args) => {
  const shell = process.env[process.platform === "win32" ? "powershell.exe" : "bash"];
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: args.cols,
    rows: args.rows,
    cwd: args.cwd || process.env.HOME,
    env: process.env,
  });

  ptyProcess.on("data", (data) => {
    console.log("ptyProcessData: ", data);
    mainWindow.webContents.send("terminal-inc-data", data);
  });

  terminals[ptyProcess.pid] = ptyProcess;

  ipcMain.on("terminal-to-pty", (event, input) => {
    console.log("terminal-to-pty: ", input);
    ptyProcess.write(input + '\r\n');
  });

  // 关闭终端
  ipcMain.on("terminal-close", (event, pid) => {
    console.log("pid: ", pid);
    ptyProcess.kill();
  });
});