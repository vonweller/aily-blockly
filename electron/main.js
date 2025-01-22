import { app, BrowserWindow, Tray, Menu } from "electron";
import path from "path";
import { initTerminal } from "./xterm.js";

const args = process.argv.slice(1);
const serve = args.some((val) => val === "--serve");

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 740,
    show: true, // 不显示主窗口，实现“后台运行”的效果
    webPreferences: {
      nodeIntegration: true,
      // contextIsolation: false,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (serve) {
    mainWindow.loadURL("http://localhost:4200");
  } else {
    mainWindow.loadFile(`renderer/index.html`);
  }

  // 当主窗口被关闭时，进行相应的处理
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  // 指定托盘图标，路径可替换为实际图标路径
  const iconPath = path.join(__dirname, "tray_icon.png");
  tray = new Tray(iconPath);

  // 系统托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      },
    },
    {
      label: "退出",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip("这是一个后台运行的示例应用");
  tray.setContextMenu(contextMenu);

  // 点击托盘图标自动显示/隐藏主窗口
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

// 当 Electron 完成初始化并准备好创建浏览器窗口时调用
app.on("ready", () => {
  createWindow();
  //   createTray();

  initTerminal(".");
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
