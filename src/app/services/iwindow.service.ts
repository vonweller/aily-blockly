import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class IwindowService {

  windows: IWindowOpt[] = [
    {
      position: {
        top: 0,
        right: 0,
      },
      size: {
        width: 400,
        height: 600,
      },
      type: 'code-viewer',
      title: '代码查看',
      zindex: 999,
    },
    {
      position: {
        top: 0,
        right: 0,
      },
      size: {
        width: 400,
        height: 600,
      },
      type: 'serial-monitor',
      title: '串口助手',
      zindex: 0,
    },
    {
      position: {
        top: 0,
        right: 0,
      },
      size: {
        width: 400,
        height: 600,
      },
      type: 'aily-chat',
      title: 'AI助手',
      zindex: 0,
    },
  ];

  constructor() { }

  openWindow(opt: IWindowOpt) {
    this.windows.push(opt);
  }

  closeWindow(opt: IWindowOpt) {
    console.log(opt);

    let index = this.windows.indexOf(opt);
    console.log(index);
    this.windows.splice(index, 1);
    console.log(this.windows);
    
  }
}


export interface IWindowOpt {
  position: {
    top: number,
    right: number,
  },
  size: {
    width: number,
    height: number,
  },
  type: string,
  title: string,
  zindex: number,
}