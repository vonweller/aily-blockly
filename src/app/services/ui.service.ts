/* 这个服务用来控制窗口、工具的显示和隐藏，通过 Subject 来实现组件之间的通信。
*/
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UiService {
  actionSubject = new Subject();
  openToolList = [];

  constructor() { }

  openWindow(opt: WindowOpts) {
    window['subWindow'].open(opt);
  }

  // 这个方法是给header用的
  turnTool(opt: ToolOpts) {
    if (this.openToolList.indexOf(opt.data) === -1) {
      this.openTool(opt.data)
    } else {
      this.closeTool(opt.data);
    }
  }

  // 如果其它组件/程序要打开工具，调用这个方法
  openTool(name: string) {
    this.actionSubject.next({ action: 'open', type: 'tool', data: name });
    this.openToolList.push(name)
  }

  // 如果其它组件/程序要关闭工具，调用这个方法
  closeTool(name: string) {
    this.actionSubject.next({ action: 'close', type: 'tool', data: name });
    this.openToolList = this.openToolList.filter(e => e !== name);
  }

  clearTerminal() {
    // this.actionSubject.next({ action: 'clear-terminal' });
  }

  runCmd(cmd: string) {

  }
}

export interface WindowOpts {
  path: string,
  title?: string,
  alwaysOnTop?: boolean,
  width?: number,
  height?: number,
}

export interface ToolOpts {
  type: string,
  data: string,
  title?: string
}


