const { contextBridge, ipcRenderer, shell } = require("electron");
const { SerialPort } = require("serialport");
const { spawn, exec } = require("child_process");
const { get } = require("http");
// const { Bonjour } = require('bonjour-service');

contextBridge.exposeInMainWorld("electronAPI", {
  ipcRenderer: {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  },
  path: {
    getUserHome: () => require("os").homedir(),
    getUserDocuments: () => {
      let path = require("os").homedir() + "\\Documents\\aily-project";
      if (!require("fs").existsSync(path)) {
        require("fs").mkdirSync(path, { recursive: true });
      }
      return path;
    },
    isExists: (path) => {
      return require("fs").existsSync(path);
    },
  },
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => new SerialPort(options),
  },
  Bonjour: {
    // list: async () => await Bonjour.list(),
  },
  platform: {
    type: () => process.platform,
    isWindows: () => process.platform === "win32",
    isMacOS: () => process.platform === "darwin",
    isLinux: () => process.platform === "linux",
  },
  terminal: {
    init: (data) => {
      ipcRenderer.send("terminal-create", data);
    },
    onData: (callback) => {
      ipcRenderer.on("terminal-inc-data", (event, data) => {
        callback(data);
      });
    },
    sendInput: (input) => ipcRenderer.send("terminal-to-pty", input),
    close: (pid) => ipcRenderer.send("terminal-close", pid),
  },
  iWindow: {
    minimize: () => ipcRenderer.send("window-minimize"),
    maximize: () => ipcRenderer.send("window-maximize"),
    close: () => ipcRenderer.send("window-close"),
    goMain: (data) => ipcRenderer.send("window-go-main", data),
  },
  subWindow: {
    open: (options) => ipcRenderer.send("window-open", options),
    close: () => ipcRenderer.send("window-close"),
  },
  project: {
    new: (data) => {
      return new Promise((resolve, reject) => {
        ipcRenderer
          .invoke("project-new", data)
          .then((result) => resolve(result))
          .catch((error) => reject(error));
      });
    },
    open: (path) => ipcRenderer.invoke("project-open", path),
    save: () => ipcRenderer.invoke("project-save"),
    saveAs: (path) => ipcRenderer.invoke("project-saveAs", path),
    update: (data) => ipcRenderer.send("project-update", data),
    newTmp: () => ipcRenderer.invoke("project-newTmp"),
  },
  dependencies: {
    init: (data) => ipcRenderer.invoke("dependencies-init", data),
    install: (data) => ipcRenderer.invoke("dependencies-install", data),
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
  file: {
    readSync: (path) => require("fs").readFileSync(path, "utf8"),
  },
  ble: {
    startScan: () => ipcRenderer.send("ble-start-scan"),
    stopScan: () => ipcRenderer.send("ble-stop-scan"),
    connect: (deviceId) => ipcRenderer.send("ble-connect", deviceId),
    disconnect: (deviceId) => ipcRenderer.send("ble-disconnect", deviceId),
    onDeviceFound: (callback) => ipcRenderer.on("ble-device-found", callback),
    onConnected: (callback) => ipcRenderer.on("ble-connected", callback),
    onDisconnected: (callback) => ipcRenderer.on("ble-disconnected", callback),
    sendData: (deviceId, data) =>
      ipcRenderer.send("ble-send-data", deviceId, data),
    onDataReceived: (callback) => ipcRenderer.on("ble-data-received", callback),
  },
  other: {
    openByExplorer: (path) => shell.openPath(path),
    openByBrowser: (url) => shell.openExternal(url),
  },
});
