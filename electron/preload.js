const { contextBridge, ipcRenderer } = require("electron");
const { SerialPort } = require("serialport");
const { spawn, exec } = require("child_process");

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
    }
  },
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => new SerialPort(options),
  },
  platform: {
    type: () => process.platform,
    isWindows: () => process.platform === "win32",
    isMacOS: () => process.platform === "darwin",
    isLinux: () => process.platform === "linux",
  },
  terminal: {
    init: (path) => {
      const shell = process.platform === "win32" ? "powershell.exe" : "bash";
      const terminal = pty.spawn(shell, [], {
        name: "xterm-color",
        cwd: path,
      });
      terminal.on("data", (data) => {
        ipcRenderer.send("terminal-output", data);
      });
      ipcRenderer.on("terminal-input", (event, input) => {
        terminal.write(input);
      });
    },
    runScript: (scriptPath) => {
      ipcRenderer.send("run-node-script", scriptPath);
    },
  },
  iWindow: {
    minimize: () => ipcRenderer.send("window-minimize"),
    maximize: () => ipcRenderer.send("window-maximize"),
    close: () => ipcRenderer.send("window-close"),
  },
  subWindow: {
    open: (options) => ipcRenderer.send("window-open", options),
  },
  project: {
    new: () => ipcRenderer.invoke("project-new"),
    open: (path) => ipcRenderer.invoke("project-open", path),
    save: () => ipcRenderer.invoke("project-save"),
    saveAs: (path) => ipcRenderer.invoke("project-saveAs", path),
  },
});

