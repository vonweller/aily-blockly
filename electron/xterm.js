// 这个文件用于初始化xterm.js终端，以及处理终端的输入输出

import * as pty from '@lydell/node-pty';
import { ipcMain  } from 'electron';


export function initTerminal(path) {
  console.log("xterm.js loaded");

//   const shell = process.platform === "win32" ? "powershell.exe" : "bash";
//   const terminal = pty.spawn(shell, [], {
//     name: "xterm-color",
//     cwd: path,
//   });

//   terminal.on("data", (data) => {
//     ipcRenderer.send("terminal-output", data);
//   });

//   ipcRenderer.on("terminal-input", (event, input) => {
//     terminal.write(input);
//   });
}
