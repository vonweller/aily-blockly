import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NoticeService {

  data: NoticeOptions;

  stateSubject = new Subject<NoticeOptions>();

  constructor() { }

  update(opts: NoticeOptions | null) {
    this.stateSubject.next(opts);
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
}