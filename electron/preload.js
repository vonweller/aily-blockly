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
    close: () => ipcRenderer.send("window-close"),
  },
  project: {
    new: (data) => {
      return new Promise((resolve, reject) => {
        ipcRenderer.invoke("project-new", data)
          .then((result) => resolve(result))
          .catch((error) => reject(error));
      });
    },
    open: (path) => ipcRenderer.invoke("project-open", path),
    save: () => ipcRenderer.invoke("project-save"),
    saveAs: (path) => ipcRenderer.invoke("project-saveAs", path),
    getProjectData: () => {
      return window["projectData"] || {
        name: 'new project',
        path: '',
        author: '',
        description: '',
        board: '',
        type: 'web',
        framework: 'angular',
        version: '1.0.0',
      };
    },
    setProjectData: (data) => {
      window["projectData"] = data;
    },
  },
  package: {
    init: (data) => ipcRenderer.invoke("package-init", data),
    install: (data) => ipcRenderer.invoke("package-install", data),
  },
  builder: {
    init: (data) => {
      return new Promise((resolve, reject) => {
        ipcRenderer.invoke("builder-init", data)
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
  tester: {
    send: (data) => {
      console.log("tester-send: ", data);
      ipcRenderer.send("tester-send", data)},
  }
});

