// 这个文件用于和cli交互，进行编译和烧录等操作
const { ipcMain } = require("electron");
const pty = require("@lydell/node-pty");

function registerTerminalHandlers(mainWindow) {

  ipcMain.on("terminal-data", async (event, data) => {
    console.log("terminal-data: ", data);
  });

  const terminals = new Map();
  ipcMain.on("terminal-create", (event, args) => {
    const shell = process.platform === "win32" ? "powershell.exe" : "bash";
    const ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: args.cols || 80,  // 确保有合适的默认值
      rows: args.rows || 24,
      cwd: args.cwd || process.env.HOME,
      env: process.env,
    });

    ptyProcess.on("data", (data) => {
      mainWindow.webContents.send("terminal-inc-data", data);
    });

    console.log("terminal-created pid ", ptyProcess.pid);
    terminals.set(ptyProcess.pid, ptyProcess);
    event.reply("terminal-created", { pid: ptyProcess.pid });

    ipcMain.on("terminal-to-pty", (event, input) => {
      ptyProcess.write(input);
    });

    // 终端大小调整处理
    ipcMain.on("terminal-resize", (event, { pid, cols, rows }) => {
      const ptyProcess = terminals.get(parseInt(pid, 10));
      if (ptyProcess) {
        ptyProcess.resize(cols, rows);
      }
    });

    // 关闭终端
    ipcMain.on("terminal-close", (event, data) => {
      console.log("terminal-close pid ", data.pid);
      const ptyProcess = terminals.get(parseInt(data.pid, 10));
      if (ptyProcess) {
        ptyProcess.kill();
        terminals.delete(parseInt(data.pid, 10));
      }
    });

    // 异步输入，可以获取到数据
    ipcMain.handle('terminal-to-pty-async', async (event, input) => {
      return new Promise((resolve, reject) => {
        try {
          // 确保输入是字符串
          if (typeof input !== 'string') {
            reject(new Error('命令必须是字符串'));
            return;
          }

          let commandOutput = '';
          let commandTimeout = null;
          // 匹配 PowerShell 提示符: PS D:\path>   以后需要匹配mac os和linux的提示符（陈吕洲 2025.3.4）
          const promptRegex = /PS [A-Z]:(\\[^\\]+)+>/g;

          // 临时数据处理函数
          const dataHandler = (data) => {
            // 累积所有输出
            commandOutput += data;

            // 检查是否检测到命令提示符，表示命令已完成
            if (promptRegex.test(commandOutput)) {
              clearTimeout(commandTimeout);
              ptyProcess.removeListener('data', dataHandler);

              // 移除命令提示符部分，只保留命令输出
              // 从最后一次出现提示符的位置开始截取
              const lastPromptIndex = commandOutput.search(promptRegex);
              if (lastPromptIndex > 0) {
                commandOutput = commandOutput.substring(0, lastPromptIndex);
              }
              resolve(commandOutput.trim());
            }
          };

          // 添加临时监听器
          ptyProcess.addListener('data', dataHandler);

          // 发送命令
          ptyProcess.write(input);

          // 设置超时保护
          commandTimeout = setTimeout(() => {
            ptyProcess.removeListener('data', dataHandler);
            resolve(commandOutput);
          }, 120000); // 默认120秒超时
        } catch (error) {
          reject(error.message || '执行命令失败');
        }
      });
    });
  });
}


module.exports = {
  registerTerminalHandlers,
};