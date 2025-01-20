const { contextBridge } = require("electron");
const { SerialPort } = require("serialport");

contextBridge.exposeInMainWorld("ielectron", {
  versions: () => process.versions,
  SerialPort: {
    list: async () => await SerialPort.list(),
    create: (options) => new SerialPort(options)
  }
});
