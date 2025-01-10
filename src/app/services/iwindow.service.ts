import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class IwindowService {
  windows: IWindowOpt[] = [];

  // bounds: HTMLElement;

  constructor() {}

  openWindow(opt: IWindowOpt) {
    opt.zindex = opt.zindex == 0 ? opt.zindex : this.getMaxZindex() + 1;
    opt.size = opt.size || { width: 400, height: 600 };
    opt.position = opt.position || {
      x: window.innerWidth - opt.size.width,
      y: 65,
    };
    this.windows.push(opt);
  }

  closeWindow(opt: IWindowOpt) {
    let index = this.windows.indexOf(opt);
    this.windows.splice(index, 1);
  }

  getMaxZindex() {
    if (this.windows.length === 0) return 0;
    return this.windows.reduce((prev, curr) => {
      return prev.zindex > curr.zindex ? prev : curr;
    }).zindex;
  }
}

export interface IWindowOpt {
  position?: {
    x: number;
    y: number;
  };
  size?: {
    width: number;
    height: number;
    minWidth?: number;
    minHeight?: number;
  };
  type: string;
  title: string;
  zindex?: number;
}
