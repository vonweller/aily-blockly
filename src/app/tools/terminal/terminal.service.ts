// 这个函数用于通过electron端控制终端

import { Injectable } from '@angular/core';
import { UiService } from '../../services/ui.service';

@Injectable({
  providedIn: 'root'
})
export class TerminalService {

  isLocked = false;

  currentPid;

  constructor(
  ) { }

  async create(opts) {
    const { pid } = await window['terminal'].init({
      cols: 120,
      rows: 200,
      cwd: opts.cwd
    })
    this.currentPid = pid;
  }

  close() {
    window['terminal'].close({ pid: this.currentPid });
  }

  resize(opts) {
    window['terminal'].resize({ pid: this.currentPid, cols: opts.cols, rows: opts.rows });
  }

  send(input: string) {
    window['terminal'].sendInput({ pid: this.currentPid, input });
  }

  // sendCmd(cmd: string) {
  //   window['terminal'].sendInput({ pid: this.currentPid, input: cmd + '\r' });
  // }

  async sendCmd(input: string): Promise<any> {
    return new Promise(async (resolve, reject) => {
      window['terminal'].sendInputAsync({ pid: this.currentPid, input: input + '\r' })
        .then(output => {
          resolve(output);
        })
        .catch(err => {
          console.error('执行错误:', err);
        });
    });
  }

  // 使用流式输出执行命令
  async executeWithStream(
    input: string,
    lineCallback: (line: string) => void,
    completeCallback?: () => void
  ): Promise<any> {
    const { streamId } = await window['terminal'].startStream(this.currentPid);

    // 注册监听器
    const removeListener = window['terminal'].onStreamData(
      streamId, 
      (lines: string[], complete: boolean) => {
        // 处理每行数据
        lines.forEach(line => lineCallback(line));

        // 如果完成，调用完成回调
        if (complete && completeCallback) {
          completeCallback();
          // 清理监听器
          removeListener();
        }
      }
    );

    try {
      await window['terminal'].sendInput({ pid: this.currentPid, input: input + '\r' });

      // 在固定时间后停止流（如果未正常结束）
      setTimeout(() => {
        window['electronAPI'].terminal.stopStream(this.currentPid, streamId);
        removeListener();
        if (completeCallback) completeCallback();
      }, 300000); // 5分钟超时
    } catch (error) {
      // 出错时清理资源
      window['electronAPI'].terminal.stopStream(this.currentPid, streamId);
      removeListener();
      throw error;
    }
  }
}
