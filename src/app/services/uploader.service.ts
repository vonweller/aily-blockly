import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UploaderService {

  constructor() { }

  async upload() {
    console.log('start upload');
    // 上传
    // TODO 获取当前项目路径
    const prjPath = "D:\\temp\\ailyPrj"

    // TODO 获取port
    const port = "COM3"

    const uploadResult = await window["uploader"].upload({port, prjPath})
    if (!uploadResult.success) {
      console.error("init failed: ", uploadResult)
      return
    }

    console.log('upload success');
  }
}
