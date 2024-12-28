import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class IwindowService {

  windows: IWindow[] = [];

  constructor() { }

  openWindow(window: IWindow) {
    this.windows.push(window);
  }

  closeWindow(index: number) {
    this.windows.splice(index, 1);
  }
}


interface IWindow {
  position: {
    top: number,
    right: number,
  },
  size: {
    width: number,
    height: number,
  },
  title: string,
  index: number,
}