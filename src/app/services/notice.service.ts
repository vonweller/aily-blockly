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

  update(opts: NoticeOptions | null) {
    opts['timestamp'] = Date.now();
    opts['showDetail'] = false;
    this.stateSubject.next(opts);
    this.noticeList.push(opts);
    console.log(opts);
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