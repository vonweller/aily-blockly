import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ElectronService {
  isElectron = false;

  electron = window['ielectron'];

  constructor() {}

  async init() {
    if (this.electron && typeof this.electron.versions() == 'object') {
      console.log('Running in electron', this.electron.versions());
      this.isElectron = true;
      // 在这里把 相关nodejs内容 挂载到 window 上
      // 调用前先判断isElectron
      window['SerialPort'] = window['ielectron'].SerialPort;
      window['ChildProcess'] = window['ielectron'].ChildProcess;
      window["os"] = window['ielectron'].os;
      window["fs"] = window['ielectron'].fs;
    } else {
      console.log('Running in browser');
    }
  }
}
