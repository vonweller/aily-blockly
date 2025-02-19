import { Injectable } from '@angular/core';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root'
})
export class UploaderService {

  constructor(
    private projectService: ProjectService
  ) { }

  async upload() {
    console.log('start upload');
    // 上传
    // 获取当前项目路径
    const prjPath = this.projectService.currentProject

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
