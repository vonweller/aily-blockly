// 这个文件用于和cli交互，进行编译和烧录等操作
const { ipcMain } = require("electron");
const pty = require("@lydell/node-pty");

// 匹配 PowerShell 提示符: PS D:\path>   以后需要匹配mac os和linux的提示符（陈吕洲 2025.3.4）
const promptRegex = /PS [A-Z]:(\\[^\\]+)+>/g;
const terminals = new Map();

// 清除ANSI转义序列的函数
function stripAnsiEscapeCodes(text) {
  // 匹配所有ANSI转义序列
  return text.replace(/\x1B\[(?:[0-9]{1,3}(?:;[0-9]{1,3})*)?[m|K|h|l|H|A-Z]/g, '');
}

function registerTerminalHandlers(mainWindow) {
  ipcMain.handle("terminal-create", (event, args) => {
    return new Promise((resolve, reject) => {
      const shell = process.platform === "win32" ? "powershell.exe" : "bash";
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-color",
        cols: args.cols || 80,  // 确保有合适的默认值
        rows: args.rows || 24,
        cwd: args.cwd || process.env.HOME,
        env: process.env,
      });

      console.log("new terminal pid: ", ptyProcess.pid);
      terminals.set(ptyProcess.pid, ptyProcess);
      // 设置一个标志来避免重复解析
      let isResolved = false;
      // 设置超时保护
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          // console.log("创建终端超时，但仍继续");
          resolve({ pid: ptyProcess.pid });
        }
      }, 5000); // 5秒超时

      // 修改数据处理函数，检测提示符
      ptyProcess.on("data", (data) => {
        mainWindow.webContents.send("terminal-inc-data", data);
        // 检查是否包含命令提示符
        if (!isResolved && promptRegex.test(data)) {
          clearTimeout(timeout);
          isResolved = true;
          // console.log("检测到终端提示符，终端准备就绪");
          // console.log("终端准备就绪, pid ", ptyProcess.pid);
          resolve({ pid: ptyProcess.pid });
        }
      });
    });
  });

  ipcMain.on("terminal-to-pty", (event, { pid, input }) => {
    const ptyProcess = terminals.get(parseInt(pid, 10));
    if (ptyProcess) {
      ptyProcess.write(input);
    }
  });

  // 终端大小调整处理
  ipcMain.on("terminal-resize", (event, { pid, cols, rows }) => {
    const ptyProcess = terminals.get(parseInt(pid, 10));
    if (ptyProcess) {
      ptyProcess.resize(cols, rows);
    }
  });

  // 关闭终端
  // ipcMain.on("terminal-close", (event, { pid }) => {
  //   console.log("terminal-close pid ", pid);
  //   const ptyProcess = terminals.get(parseInt(pid, 10));
  //   if (ptyProcess) {
  //     ptyProcess.kill();
  //     terminals.delete(parseInt(pid, 10));
  //   }
  // });

  // 异步输入，可以获取到数据
  ipcMain.handle('terminal-to-pty-async', async (event, { pid, input }) => {
    const ptyProcess = terminals.get(parseInt(pid, 10));
    console.log('terminal-to-pty-async pid ', pid, ' input ', input);
    return new Promise((resolve, reject) => {
      try {
        let commandOutput = '';
        let commandTimeout = null;
        // 临时数据处理函数
        const dataHandler = (e) => {
          // 累积所有输出
          console.log("output: ", e);
          commandOutput += e;

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
            resolve(stripAnsiEscapeCodes(commandOutput.trim()));
          }
        };

        // 添加临时监听器
        ptyProcess.addListener('data', dataHandler);

        // 发送命令
        ptyProcess.write(input);

        // 设置超时保护
        commandTimeout = setTimeout(() => {
          ptyProcess.removeListener('data', dataHandler);
          resolve(stripAnsiEscapeCodes(commandOutput));
        }, 120000); // 默认120秒超时
      } catch (error) {
        reject(error.message || '执行命令失败');
      }
    });
  });

  // 存储流式输出回调
  const streamCallbacks = new Map();

  // 添加流式输出处理函数
  ipcMain.handle("terminal-stream-start", (event, { pid, streamId }) => {
    const ptyProcess = terminals.get(parseInt(pid, 10));
    if (!ptyProcess) {
      return { success: false, error: 'Terminal not found' };
    }

    // 为每个流管理其未完成的行数据
    const streamState = {
      buffer: '',  // 用于存储未完成的行
      streamId
    };

    // 创建处理函数
    const streamHandler = (data) => {
      // 累积接收的数据
      let buffer = streamState.buffer + data;
      let lines = [];
      let lastNewlineIndex = 0;

      // 查找所有完整的行
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === '\n') {
          lines.push(buffer.substring(lastNewlineIndex, i + 1));
          lastNewlineIndex = i + 1;
        }
      }

      // 保存剩余的未完成行
      streamState.buffer = lastNewlineIndex < buffer.length ? buffer.substring(lastNewlineIndex) : '';

      // 发送完整的行到渲染进程
      if (lines.length > 0) {
        mainWindow.webContents.send(`terminal-stream-data-${streamId}`, {
          lines,
          complete: false
        });
      }
    };

    // 将处理函数存储起来以便后续移除
    if (!streamCallbacks.has(pid)) {
      streamCallbacks.set(pid, new Map());
    }
    streamCallbacks.get(pid).set(streamId, {
      handler: streamHandler,
      state: streamState
    });

    // 添加数据监听器
    ptyProcess.on('data', streamHandler);

    return { success: true, streamId };
  })

  // 停止流式输出
  ipcMain.handle('terminal-stream-stop', (event, { pid, streamId }) => {
    const ptyProcess = terminals.get(parseInt(pid, 10));
    if (!ptyProcess) {
      return { success: false, error: 'Terminal not found' };
    }

    // 获取流处理函数
    if (streamCallbacks.has(pid) && streamCallbacks.get(pid).has(streamId)) {
      const { handler, state } = streamCallbacks.get(pid).get(streamId);

      // 移除监听器
      ptyProcess.removeListener('data', handler);
      streamCallbacks.get(pid).delete(streamId);

      // 发送任何剩余的不完整数据
      if (state.buffer.length > 0) {
        mainWindow.webContents.send(`terminal-stream-data-${streamId}`, {
          lines: [state.buffer],
          complete: true  // 标记为最后一批数据
        });
      } else {
        // 发送完成信号
        mainWindow.webContents.send(`terminal-stream-data-${streamId}`, {
          lines: [],
          complete: true
        });
      }

      return { success: true };
    }

    return { success: false, error: 'Stream not found' };
  });

  // 执行命令并流式输出结果
  ipcMain.handle('terminal-to-pty-stream', async (event, { pid, input, streamId }) => {
    const ptyProcess = terminals.get(parseInt(pid, 10));
    if (!ptyProcess) {
      return { success: false, error: 'Terminal not found' };
    }

    // 生成唯一流ID（如果未提供）
    const actualStreamId = streamId || `stream_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    // 先启动流监听
    await ipcMain.handle('terminal-stream-start', event, { pid, streamId: actualStreamId });

    // 发送命令
    ptyProcess.write(input);

    return {
      success: true,
      streamId: actualStreamId,
      message: '命令已发送，开始流式输出'
    };
  });

  // 修改关闭终端处理，确保清理流回调
  // const originalCloseHandler = ipcMain.listeners('terminal-close')[0];
  // ipcMain.removeListener('terminal-close', originalCloseHandler);

  ipcMain.on("terminal-close", (event, { pid }) => {
    console.log("terminal-close pid ", pid);
    const ptyProcess = terminals.get(parseInt(pid, 10));
    if (ptyProcess) {
      // 清理流回调
      if (streamCallbacks.has(pid)) {
        streamCallbacks.delete(pid);
      }

      ptyProcess.kill();
      terminals.delete(parseInt(pid, 10));
    }
  });

}

module.exports = {
  registerTerminalHandlers,
};