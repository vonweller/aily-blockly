import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ElectronService {
  isElectron = false;

  electron = window['ielectron'];

  SerialPort;

  constructor() {}

  async init() {
    if (this.electron && typeof this.electron.versions() == 'object') {
      console.log('Running in electron', this.electron.versions());
      this.isElectron = true;

      this.SerialPort = window['ielectron'].SerialPort;
      console.log(await this.SerialPort.list());
    } else {
      console.log('Running in browser');
    }
  }
}
