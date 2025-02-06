import { Injectable } from '@angular/core';
import { ElectronService } from './electron.service';

import * as childProcess from 'child_process';
import * as os from 'os';
import * as fs from 'fs'

enum RunState {
  BUILDING = '编译中...',
  BUILD_DONE = '编译成功',
  BUILD_FAILED = '编译失败',
  UPLOADING = '上传中...',
  UPLOAD_DONE = '上传成功',
  UPLOAD_FAILED = '上传失败'
}

@Injectable({
  providedIn: 'root'
})
export class ArduinoCliService {

  childProcess: typeof childProcess;
  os: typeof os;
  fs: typeof fs;

  cliPath = '.\\child\\arduino-cli.exe';

  child_build: childProcess.ChildProcess;
  child_upload: childProcess.ChildProcess;

  RunStage = {
    BUILD_START: (device: string) => `创建编译任务  目标设备：${device}\n`,
    BUILD_DONE: '编译完成\n',
    UPLOAD_START: (device: string) => `创建上传任务  目标设备：${device}\n`,
  };

  constructor(
    private electronService: ElectronService
  ) { 
    if (this.electronService.isElectron) {
      console.log('isElectron')
      this.childProcess = window["myChildProcess"];
      this.os = window["myOs"];
      this.fs = window["myFs"];
      this.cliPath = this.fs.existsSync('./resources/app') ? '.\\resources\\child\\arduino-cli.exe' : '.\\child\\arduino-cli.exe';
    } else {
      console.log('isBrowser')
    }
  }

  createTempProject(content, name='temp.ino') {
    if (!this.fs === undefined) {
      console.error('fs is undefined');
      return;
    }
    if (!this.fs.existsSync('.\\temp')) {
      this.fs.mkdirSync('.\\temp');
    }
    this.fs.writeFileSync(`.\\temp\\${name}`, content);
    // 返回文件路径
    return `.\\temp\\${name}`;
  }

  async build(code, compileCmd='compile --fqbn arduino:avr:uno', name='temp.ino') {
    const filePath = this.createTempProject(code, name);
    return await this.runBuild(`${this.cliPath} ${compileCmd} ${filePath}`);
  }

  killChild() {
    if (typeof this.child_build != 'undefined') {
      this.child_build.stdout!.destroy();
      if (this.os.platform() === 'win32') {
        this.childProcess.exec('taskkill /pid ' + this.child_build.pid + ' /f /t')
      } else {
        this.child_build.kill();
      }
    }

    if (typeof this.child_upload != 'undefined') {
      this.child_upload.stdout!.destroy()
      this.child_upload.stderr!.destroy()
      if (this.os.platform() === 'win32')
        this.childProcess.exec('taskkill /pid ' + this.child_upload.pid + ' /f /t')
      else
        this.child_upload.kill()
    }
  }

  runBuild(params: string) {
    this.killChild()

    return new Promise<boolean>((resolve, reject) => {
      let state = RunState.BUILDING;
      // TODO 往terminal里面写入信息
      // 发送state
      // 发送runStage.BUILD_START

      console.log('runBuild: ', params)
      console.log('state: ', state)
      console.log(this.RunStage.BUILD_START('arduino:avr:uno'))

      const cmdList = params.split(' ')

      const child_build = this.childProcess.spawn('cmd.exe', ['/c', 'dir'])
      console.log("childBuild: ", child_build.stdout)
    
      child_build.stdout.on('data', (dataBuffer: Buffer) => {
        let data = dataBuffer.toString();
        // TODO 往terminal里面写入信息
        console.log(data)
      });
      
      child_build.stderr!.on('data', (dataBuffer: Buffer) => {
        let data = dataBuffer.toString();
        if (state === RunState.BUILDING && data.includes('error:')) {
          state = RunState.BUILD_FAILED;
        }
        // TODO 往terminal里面写入信息
        console.log(data)
      })
      child_build.on('close', (code) => {
        if (state == RunState.BUILDING && code == 0) {
          state = RunState.BUILD_DONE;
          // TODO 往terminal里面写入信息
          // TODO 往terminal写入RunStage.BUILD_DONE
          console.log('state: ', RunState.BUILD_DONE)
          console.log(this.RunStage.BUILD_DONE)
          resolve(true);
          return;
        }
        if (state == RunState.BUILD_FAILED || code == null) {
          // TODO 往terminal里面写入信息
          console.log('state: ', RunState.BUILD_FAILED)
          reject(false);
        }
      })
    });
  }

  runUpload(params: string) {
    this.killChild();
    return new Promise<boolean>((resolve, reject) => {
      let state = RunState.UPLOADING;
      // TODO 往terminal里面写入信息
      // 发送state
      // 发送runStage.BUILD_START

      this.child_upload = this.childProcess.spawn(this.cliPath, params.split(' '))
      this.child_upload.stdout!.on('data', (dataBuffer: Buffer) => {
        let data = dataBuffer.toString();
        // TODO 往terminal里面写入信息
      })
      this.child_upload.stderr!.on('data', (dataBuffer: Buffer) => {
        let data = dataBuffer.toString();
        if (state === RunState.UPLOADING && data.includes('error:')) {
          state = RunState.UPLOAD_FAILED;
        // TODO 往terminal里面写入信息
        }
      })
      this.child_upload.on('close', (code) => {
        if (state == RunState.UPLOADING && code == 0) {
          state = RunState.UPLOAD_DONE;
          // TODO 往terminal里面写入信息
          // TODO 往terminal写入runStage.BUILD_DONE
          resolve(true);
          return;
        }
        if (state == RunState.UPLOAD_FAILED || code == null) {
          // TODO 往terminal里面写入信息
          reject(false);
        }
      })
    });
  }
}
