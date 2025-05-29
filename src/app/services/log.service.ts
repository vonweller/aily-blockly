import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LogService {

  list: LogOptions[] = [];

  stateSubject = new Subject<LogOptions>();

  constructor() { }

  update(opts: LogOptions) {
    opts['timestamp'] = Date.now();
    opts['showDetail'] = false;
    this.stateSubject.next(opts);
    if (opts.state === 'error') {
      this.list.push(opts)
    }
  }

  clear() {
    this.stateSubject.next(null);
  }
}


export interface LogOptions {
  title?: string,
  text?: string,
  state?: string,
  progress?: number,
  setTimeout?: number,
  stop?: Function,
  detail?: string,
  showDetail?: boolean,
  timestamp?: number,
}