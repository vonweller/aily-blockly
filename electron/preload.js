const { contextBridge, ipcRenderer, shell } = require("electron");
const { SerialPort } = require("serialport");
const { exec } = require("child_process");
const { existsSync, statSync } = require("fs");

contextBridge.exposeInMainWorld("electronAPI", {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  },
  path: {
    getUserHome: () => require("os").homedir(),
    getAppData: () => process.env.AILY_APPDATA_PATH,
    getUserDocuments: () => require("os").homedir() + "\\Documents",
    isExists: (path) => existsSync(path),
    getElectronPath: () => __dirname,
    isDir: (path) => statSync(path).isDirectory(),
  },
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => {
      const port = new SerialPort(options);
      return {
        write: (data, callback) => port.write(data, callback),
        open: (callback) => port.open(callback),
        close: (callback) => port.close(callback),
        on: (event, callback) => {
          port.on(event, callback);
          return port; // 允许链式调用
        },
        off: (event, callback) => {
          port.off(event, callback);
          return port;
        },
        get path() { return port.path; },
        get isOpen() { return port.isOpen; }
      };
    }
  },
  platform: {
    type: () => process.platform,
    isWindows: () => process.platform === "win32",
    isMacOS: () => process.platform === "darwin",
    isLinux: () => process.platform === "linux",
  },
  terminal: {
    init: (data) => ipcRenderer.invoke("terminal-create", data),
    onData: (callback) => {
      ipcRenderer.on("terminal-inc-data", (event, data) => {
        callback(data);
      });
    },
    sendInput: (data) => ipcRenderer.send("terminal-to-pty", data),
    sendInputAsync: (data) => ipcRenderer.invoke("terminal-to-pty-async", data),
    close: (data) => ipcRenderer.send("terminal-close", data),
    resize: (data) => ipcRenderer.send("terminal-resize", data),
    // 开始流式监听
    startStream: (pid) => {
      const streamId = `stream_${Date.now()}`;
      return ipcRenderer.invoke('terminal-stream-start', { pid, streamId });
    },
    // 停止流式监听
    stopStream: (pid, streamId) => {
      return ipcRenderer.invoke('terminal-stream-stop', { pid, streamId });
    },
    // 监听流数据
    onStreamData: (streamId, callback) => {
      const listener = (event, data) => {
        callback(data.lines, data.complete);
      };
      ipcRenderer.on(`terminal-stream-data-${streamId}`, listener);
      // 返回解除监听函数
      return () => {
        ipcRenderer.removeListener(`terminal-stream-data-${streamId}`, listener);
      };
    },
    // 执行命令并流式获取输出
    executeWithStream: (pid, command) => {
      const streamId = `stream_${Date.now()}`;
      return ipcRenderer.invoke('terminal-to-pty-stream', {
        pid,
        input: command + '\r',
        streamId
      });
    },

    // 中断当前执行的命令（发送 Ctrl+C）
    interrupt: (pid) => ipcRenderer.invoke("terminal-interrupt", { pid }),

    // 强制终止进程（当普通中断无效时）
    killProcess: (pid, processName) => ipcRenderer.invoke("terminal-kill-process", { pid, processName }),
  },
  iWindow: {
    minimize: () => ipcRenderer.send("window-minimize"),
    maximize: () => ipcRenderer.send("window-maximize"),
    close: () => ipcRenderer.send("window-close"),
    // 子窗口收回到主窗口事件
    goMain: (data) => ipcRenderer.send("window-go-main", data),
    // 向其他窗口发送消息
    send: (data) => ipcRenderer.invoke("window-send", data),
    onReceive: (callback) => ipcRenderer.on("window-receive", callback),
  },
  subWindow: {
    open: (options) => ipcRenderer.send("window-open", options),
    close: () => ipcRenderer.send("window-close"),
  },
  builder: {
    init: (data) => {
      return new Promise((resolve, reject) => {
        ipcRenderer
          .invoke("builder-init", data)
          .then((result) => resolve(result))
          .catch((error) => reject(error));
      });
    },
    codeGen: (data) => ipcRenderer.invoke("builder-codeGen", data),
    build: (data) => ipcRenderer.invoke("builder-build", data),
  },
  uploader: {
    upload: (data) => ipcRenderer.invoke("uploader-upload", data),
  },
  fs: {
    readFileSync: (path) => require("fs").readFileSync(path, "utf8"),
    readDirSync: (path) => require("fs").readdirSync(path, { withFileTypes: true }),
    writeFileSync: (path, data) => require("fs").writeFileSync(path, data),
    mkdirSync: (path) => require("fs").mkdirSync(path, { recursive: true }),
    copySync: (src, dest) => require("fs-extra").copySync(src, dest),
    existsSync: (path) => require("fs").existsSync(path),
    statSync: (path) => require("fs").statSync(path),
    isDirectory: (path) => require("fs").statSync(path).isDirectory(),
  },
  ble: {

  },
  wifi: {

  },
  other: {
    // 通过资源管理器打开 
    openByExplorer: (path) => {
      if (process.platform === 'win32') {
        exec(`explorer.exe "${path}"`, (error) => { });
      } else {
        shell.openPath(path)
      }
    },
    // 通过浏览器打开
    openByBrowser: (url) => shell.openExternal(url),
    exitApp: () => ipcRenderer.send("window-close"),
  },
  env: {
    set: (data) => ipcRenderer.invoke("env-set", data),
    get: (key) => {
      return new Promise((resolve, reject) => {
        ipcRenderer
          .invoke("env-get", key)
          .then((result) => resolve(result))
          .catch((error) => reject(error));
      });
    },
  },
  npm: {
    run: (data) => ipcRenderer.invoke("npm-run", data),
  }
});
