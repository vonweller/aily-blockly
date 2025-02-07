const { contextBridge } = require("electron");
const { existsSync, mkdirSync, writeFileSync, writeFile } = require("fs");
const { platform } = require("os");
const { SerialPort } = require("serialport");
const { spawn } = require("node:child_process");

contextBridge.exposeInMainWorld("ielectron", {
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => new SerialPort(options)
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
        require("child_process").exec(command, (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    }
  },
  os: {
    platform: require("os").platform,
  },
  fs: {
    existsSync: (path) => existsSync(path),
    mkdirSync: (path) => mkdirSync(path),
    writeFileSync: (path, data) => writeFileSync(path, data),
  }
});

