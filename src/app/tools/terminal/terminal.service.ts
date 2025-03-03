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
    await window['iWindow'].send({ to: 'main', data: 'open-terminal' });
  }

  async close() {
    await window['iWindow'].send({ to: 'main', data: 'close-terminal' });
  }

  send(cmd: string) {
    window['terminal'].sendInput(cmd + '\r');
  }
}
