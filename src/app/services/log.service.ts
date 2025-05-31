import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LogService {

  list: LogOptions[] = [];

  stateSubject = new Subject<LogOptions>();

  constructor() { }

  /**
   * 使用提供的选项更新日志状态。
   * @param opts - 要更新和发送的日志选项。
   */
  update(opts: LogOptions) {
    opts['timestamp'] = Date.now();
    opts['showDetail'] = false;
    this.stateSubject.next(opts);
    this.list.push(opts)
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