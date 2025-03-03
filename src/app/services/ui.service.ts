/* 这个服务用来控制窗口、工具的显示和隐藏，通过 Subject 来实现组件之间的通信。
 */
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { ElectronService } from './electron.service';

@Injectable({
  providedIn: 'root',
})
export class UiService {
  // 用来控制窗口和工具的显示和隐藏
  actionSubject = new Subject();

  // 用来更新footer右下角的状态
  stateSubject = new Subject<ActionState>();

  // 用来记录当前已打开的工具
  openToolList: string[] = [];

  // 用来获取当前最上层的工具
  get topTool() {
    return this.openToolList[this.openToolList.length - 1] || null;
  }

  // 用来记录terminal是否打开
  terminalIsOpen = false;
  theme = 'dark';


  constructor(private electronService: ElectronService) { }


  // 初始化UI服务，这个服务仅供main-window使用  
  init(): void {
    if (this.electronService.isElectron) {
      window['ipcRenderer'].on('window-go-main', (event, toolName) => {
        this.openTool(toolName);
      });
      window['ipcRenderer'].on('window-receive', (event, message) => {
        if (message.data == 'open-terminal') {
          this.openTerminal();
        }
        if (message.data == 'close-terminal') {
          this.closeTerminal();
        }
      });
    }
  }

  openWindow(opt: WindowOpts) {
    window['subWindow'].open(opt);
  }

  // 这个方法是给header用的
  turnTool(opt: ToolOpts) {
    if (this.topTool == opt.data) {
      this.closeTool(opt.data);
    } else {
      this.openTool(opt.data);
    }
  }

  // 如果其它组件/程序要打开工具，调用这个方法
  openTool(name: string) {
    if (name == 'terminal') {
      this.openTerminal();
      return;
    }
    this.openToolList = this.openToolList.filter((e) => e !== name);
    this.openToolList.push(name);
    this.actionSubject.next({ action: 'open', type: 'tool', data: name });
  }

  // 如果其它组件/程序要关闭工具，调用这个方法
  closeTool(name: string) {
    if (name == 'terminal') {
      this.closeTerminal();
      return;
    }
    this.openToolList = this.openToolList.filter((e) => e !== name);
    this.actionSubject.next({ action: 'close', type: 'tool', data: name });
  }

  turnTerminal(data) {
    if (this.terminalIsOpen) {
      this.closeTerminal();
    } else {
      this.openTerminal(data);
    }
  }

  openTerminal(data = 'default') {
    this.actionSubject.next({ action: 'open', type: 'terminal', data });
    this.terminalIsOpen = true;
    console.log(this.terminalIsOpen);
  }

  closeTerminal() {
    this.actionSubject.next({ action: 'close', type: 'terminal' });
    this.terminalIsOpen = false;
  }

  // 清空终端
  clearTerminal() {
    // this.actionSubject.next({ action: 'clear-terminal' });
  }

  // 更新footer右下角的状态
  updateState(state: ActionState) {
    this.stateSubject.next(state);
  }

  // 关闭当前窗口
  closeWindow() {
    window['iWindow'].close();
  }
}

export interface WindowOpts {
  path: string;
  title?: string;
  alwaysOnTop?: boolean;
  width?: number;
  height?: number;
}

export interface ToolOpts {
  type: string;
  data: string;
  title?: string;
}

export interface ActionState {
  text: string;
  desc?: string;
  state?: 'done' | 'error' | 'warn' | 'loading' | string,
  color?: string;
  icon?: string;
  timeout?: number;
}
