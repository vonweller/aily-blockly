import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NoticeService {

  data: NoticeOptions;

  stateSubject = new Subject<NoticeOptions>();

  noticeList: NoticeOptions[] = [];

  constructor() { }

  update(opts: NoticeOptions) {
    opts['timestamp'] = Date.now();
    opts['showDetail'] = false;
    this.stateSubject.next(opts);
    if (opts.state === 'error') {
      this.noticeList.push(opts)
    }
  }

  clear() {
    this.stateSubject.next(null);
  }
}

export interface NoticeOptions {
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