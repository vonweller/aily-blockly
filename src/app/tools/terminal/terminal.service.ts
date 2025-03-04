// 这个函数用于通过electron端控制终端

import { Injectable } from '@angular/core';
import { UiService } from '../../services/ui.service';

@Injectable({
  providedIn: 'root'
})
export class TerminalService {

  isLocked = false;

  constructor(
  ) { }

  async open() {
    await window['iWindow'].send({ to: 'main', data: { action: 'open-terminal' } });
  }

  async close() {
    await window['iWindow'].send({ to: 'main', data: { action: 'close-terminal' } });
  }

  send(cmd: string) {
    window['terminal'].sendInput(cmd + '\r');
  }

  async sendAsync(cmd: string): Promise<any> {
    return new Promise(async (resolve, reject) => {
      window['terminal'].sendInputAsync(cmd + '\r')
        .then(commandOutput => {
          // console.log('命令输出:', commandOutput);
          // 检查是否超时
          resolve(commandOutput);
        })
        .catch(err => {
          console.error('执行错误:', err);
        });
    });
  }
}
