import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ElectronService {
  isElectron = false;
  electron: any = window['electronAPI'];

  constructor() { }

  async init() {
    if (this.electron && typeof this.electron.versions() == 'object') {
      console.log('Running in electron', this.electron.versions());
      this.isElectron = true;
      // 在这里把 相关nodejs内容 挂载到 window 上
      // 调用前先判断isElectron
      for (let key in this.electron) {
        console.log('load ' + key);
        window[key] = this.electron[key];
      }
    } else {
      console.log('Running in browser');
    }
  }

  /**
  * 读取文件内容
  */
  readFile(filePath: string) {
    return window['fs'].readFileSync(filePath, 'utf8');
  }

  /**
   * 读取目录内容
   */
  readDir(dirPath: string) {
    return window['fs'].readDirSync(dirPath);
  }

  /**
   * 写文件
   */
  writeFile(filePath: string, content: string) {
    window['fs'].writeFileSync(filePath, content);
  }

  /**
 * 判断路径是否存在
 */
  exists(path: string): boolean {
    return window['fs'].existsSync(path)
  }

  /**
   * 判断是否为目录
   */
  isDirectory(path: string) {
    return window['fs'].isDirectory(path);
  }

  isFile(path: string) {
    return window['fs'].isFile(path);
  }

}
