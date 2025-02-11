import { contextBridge, ipcRenderer } from "electron";
import { SerialPort } from "serialport";

contextBridge.exposeInMainWorld("electronAPI", {
  ipcRenderer,
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => new SerialPort(options),
  },
  platform: {
    // 获取操作系统类型
    type: () => process.platform,
    // 判断是否是Windows
    isWindows: () => process.platform === "win32",
    // 判断是否是macOS
    isMacOS: () => process.platform === "darwin",
    // 判断是否是Linux
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
      ipcRenderer.send('run-node-script', scriptPath);
    }
  },
  window: {
    create: (options) => {
      ipcRenderer.send('window-create', options);
    },
    close: () => {
      ipcRenderer.send('window-close');
    }
  }
});

