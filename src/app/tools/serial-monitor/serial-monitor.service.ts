import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SerialMonitorService {
  dataViewMode = {
    hex: true, // hex显示
    ctrlChar: true, // 控制字符显示
    warp: true, // 换行显示
    scroll: true, // 自动滚动显示
    time: true, // 时间显示
  }

  inputViewMode = {
    hex: false,
    enter: false,
  }

  dataList: dataItem[] = [];

  constructor() { }
}

interface dataItem {
  time: string,
  data: any,
  dir: 'r' | 's'
}
