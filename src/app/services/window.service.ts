import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class WindowService {
  constructor() {}

  open(opt: WindowOpts) {
    console.log('open window', opt);
    window['subWindow'].open(opt);
  }
}

export interface WindowOpts {
  path: string,
  title?: string,
  alwaysOnTop?: boolean,
}
