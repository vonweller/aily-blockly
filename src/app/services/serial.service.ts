import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

@Injectable({
  providedIn: 'root'
})
export class SerialService {

  // 编译上传时，通过这里获取串口
  currentPort;

  constructor(
    private electronService: ElectronService
  ) { }

  async getSerialPorts() {
    if (this.electronService.isElectron) {
      let serialList = (await window['SerialPort'].list()).map(
        (item) => item.path,
      );
      return serialList;
    } else {
      const port = await navigator['serial'].requestPort();
      return [port];
    }
  }
}
