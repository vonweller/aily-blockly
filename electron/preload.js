const { contextBridge } = require("electron");
const { existsSync, mkdirSync, writeFileSync, writeFile } = require("fs");
const { platform } = require("os");
const { SerialPort } = require("serialport");

contextBridge.exposeInMainWorld("ielectron", {
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => new SerialPort(options)
  },
});

contextBridge.exposeInMainWorld("myFs", {
  existsSync: (path) => existsSync(path),
  mkdirSync: (path) => mkdirSync(path),
  writeFileSync: (path, data) => writeFileSync(path, data),
});

contextBridge.exposeInMainWorld("myChildProcess", {
  exec: require("node:child_process").exec,
  execFile: require("node:child_process").execFile,
  spawn: require("node:child_process").spawn,
  fork: require("node:child_process").fork,
});

contextBridge.exposeInMainWorld("myOs", {
  platform: require("os").platform,
});

contextBridge.exposeInMainWorld("myPath", {
  join: require("path").join,
  resolve: require("path").resolve,
});
