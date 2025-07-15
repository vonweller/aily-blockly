import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LogService {

  list: LogOptions[] = [
    {
      title: '连接成功',
      detail: '设备已成功连接到串口 COM3',
      state: 'success',
      timestamp: Date.now() - 60000
    },
    {
      title: '编译中',
      detail: '正在编译项目代码...',
      state: 'info',
      timestamp: Date.now() - 30000
    },
    {
      title: '上传失败',
      detail: '无法上传代码到设备，请检查连接',
      state: 'error',
      timestamp: Date.now() - 15000
    },
    {
      title: '调试信息',
      detail: '变量 x 的值为 42',
      state: 'debug',
      timestamp: Date.now() - 5000
    }
  ];

  stateSubject = new Subject<LogOptions>();

  constructor() { }

  /**
   * 使用提供的选项更新日志状态。
   * @param opts - 要更新和发送的日志选项。
   */
  update(opts: LogOptions) {
    opts['timestamp'] = Date.now();
    // opts['showDetail'] = false;
    this.list.push(opts);
    this.stateSubject.next(opts);
  }

  clear() {
    this.list = [];
  }
}

export interface LogOptions {
  title?: string,
  detail?: string,
  state?: string,
  timestamp?: number,
}