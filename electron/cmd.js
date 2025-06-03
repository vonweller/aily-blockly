const { spawn } = require('child_process');
const { ipcMain } = require('electron');

class CommandManager {
  constructor() {
    this.processes = new Map(); // 存储进程
    this.streams = new Map(); // 存储流监听器
  }

  // 执行命令并返回流式数据
  executeCommand(options) {
    const { command, args = [], cwd, env, streamId } = options;
    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...env },
      shell: 'powershell',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.processes.set(streamId, child);

    return {
      pid: child.pid,
      process: child
    };
  }

  // 终止进程
  killProcess(streamId) {
    const process = this.processes.get(streamId);
    if (process) {
      process.kill('SIGTERM');
      this.processes.delete(streamId);
      this.streams.delete(streamId);
      return true;
    }
    return false;
  }

  // 获取进程
  getProcess(streamId) {
    return this.processes.get(streamId);
  }
}

const commandManager = new CommandManager();

function registerCmdHandlers(mainWindow) {
  // 执行命令
  ipcMain.handle('cmd-run', async (event, options) => {
    const streamId = options.streamId || `cmd_${Date.now()}_${Math.random()}`;
    const senderWindow = event.sender; // 获取发送请求的窗口

    try {
      const result = commandManager.executeCommand({ ...options, streamId });
      const process = result.process;
      // console.log(options);
      // 监听标准输出
      process.stdout.on('data', (data) => {
        senderWindow.send(`cmd-data-${streamId}`, {
          type: 'stdout',
          data: data.toString(),
          streamId
        });
      });

      // 监听错误输出
      process.stderr.on('data', (data) => {
        senderWindow.send(`cmd-data-${streamId}`, {
          type: 'stderr',
          data: data.toString(),
          streamId
        });
      });

      // 监听进程关闭
      process.on('close', (code, signal) => {
        senderWindow.send(`cmd-data-${streamId}`, {
          type: 'close',
          code,
          signal,
          streamId
        });
        commandManager.processes.delete(streamId);
      });

      // 监听进程错误
      process.on('error', (error) => {
        senderWindow.send(`cmd-data-${streamId}`, {
          type: 'error',
          error: error.message,
          streamId
        });
        commandManager.processes.delete(streamId);
      });

      return {
        success: true,
        streamId,
        pid: result.pid
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        streamId
      };
    }
  });

  // 终止命令
  ipcMain.handle('cmd-kill', async (event, { streamId }) => {
    const success = commandManager.killProcess(streamId);
    return { success, streamId };
  });

  // 向进程发送输入
  ipcMain.handle('cmd-input', async (event, { streamId, input }) => {
    const process = commandManager.getProcess(streamId);
    if (process && process.stdin) {
      process.stdin.write(input);
      return { success: true };
    }
    return { success: false, error: 'Process not found or stdin not available' };
  });
}

module.exports = { registerCmdHandlers };