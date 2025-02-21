import { Injectable } from '@angular/core';
import { arduinoGenerator, DEFAULT_DATA } from '../blockly/generators/arduino/arduino';
import { BlocklyService } from '../blockly/blockly.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root'
})
export class BuilderService {

  constructor(
    private blocklyService: BlocklyService,
    private projectService: ProjectService
  ) { }

  async build() {
    console.log('start build');
    // 获取APPData路径（主要用于存放包缓存）
    const appDataPath = process.env['AILY_APPDATA_PATH'];
    
    // 获取当前项目路径
    const prjPath = this.projectService.currentProject

    const initResult = await window["builder"].init({prjPath, appDataPath})
    if (!initResult.success) {
      console.error("init failed: ", initResult)
      return
    }

    // 转换代码
    const code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
    // 生成文件，并写入临时文件夹的.ino文件
    const genResult = await window["builder"].codeGen({code, prjPath});
    if (!genResult.success) {
      console.error("codeGen failed: ", genResult)
      return
    }

    // 编译
    const buildResult = await window["builder"].build({prjPath})
    if (!buildResult.success) {
      console.error("build failed: ", buildResult)
      return
    }
    console.log('build success');
  }
}
