import { contextBridge, ipcRenderer } from "electron";
import { SerialPort } from "serialport";
import { spawn, exec } from "child_process";


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
  },
  ChildProcess: {
    spawn: (command, args, onStdout, onStderr, onClose) => {
      const child = spawn(command, args);
      child.stdout.on("data", (data) => onStdout(data.toString()));
      child.stderr.on("data", (data) => onStderr(data.toString()));
      child.on("close", onClose);
      return child;
    },
    exec: (command) => {
      return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    }
  },
  fs: {
    existsSync: (path) => existsSync(path),
    mkdirSync: (path) => mkdirSync(path),
    writeFileSync: (path, data) => writeFileSync(path, data),
  }
});

