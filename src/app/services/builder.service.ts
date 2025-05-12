import { Injectable } from '@angular/core';
import { arduinoGenerator } from '../blockly/generators/arduino/arduino';
import { BlocklyService } from '../blockly/blockly.service';
import { ProjectService } from './project.service';
import { ActionState, UiService } from './ui.service';
import { TerminalService } from '../tools/terminal/terminal.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NoticeService } from '../services/notice.service';

@Injectable({
  providedIn: 'root'
})
export class BuilderService {

  constructor(
    private uiService: UiService,
    private blocklyService: BlocklyService,
    private projectService: ProjectService,
    private terminalService: TerminalService,
    private message: NzMessageService,
    private noticeService: NoticeService
  ) { }

  private buildInProgress = false;
  private currentBuildStreamId: string | null = null;
  private buildResolver: ((value: ActionState) => void) | null = null;

  currentProjectPath = "";
  lastCode = "";
  passed = false;
  boardType = "";
  sdkPath = "";
  toolsPath = "";
  compilerPath = "";
  boardJson: any = null;
  buildPath = "";

  /**
 * 等待指定目录创建完成
 * @param dirPath 需要检查的目录路径
 * @param timeout 超时时间，默认5000毫秒
 * @param interval 检查间隔，默认100毫秒
 * @returns 返回Promise，目录存在时resolve，超时时reject
 */
  private async waitForDirectoryExists(dirPath: string, timeout = 1000 * 60 * 1, interval = 100): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const startTime = Date.now();

      const checkDirectory = () => {
        // 检查是否超时
        if (Date.now() - startTime > timeout) {
          console.error(`等待目录创建超时: ${dirPath}`);
          reject(new Error(`等待目录创建超时: ${dirPath}`));
          return;
        }

        // 检查目录是否存在
        try {
          const exists = window['fs'].existsSync(dirPath);
          if (exists) {
            console.log(`目录已创建: ${dirPath}`);
            resolve(true);
            return;
          }
        } catch (error) {
          console.warn(`检查目录时出错: ${error.message}`);
          reject(error);
          return;
        }

        // 目录不存在，继续等待
        setTimeout(checkDirectory, interval);
      };

      // 开始检查
      checkDirectory();
    });
  }

  async build(): Promise<ActionState> {
    return new Promise<ActionState>(async (resolve, reject) => {
      this.noticeService.clear();

      this.currentProjectPath = this.projectService.currentProjectPath;
      const tempPath = this.currentProjectPath + '/.temp';
      const sketchPath = tempPath + '/sketch';
      const sketchFilePath = sketchPath + '/sketch.ino';
      const librariesPath = tempPath + '/libraries';

      this.buildPath = tempPath + '/build';

      this.buildInProgress = true;
      this.currentBuildStreamId = null;
      this.buildResolver = null;

      // this.uiService.updateState({ state: 'doing', text: '编译准备中...' });

      // 创建临时文件夹
      await this.uiService.openTerminal();
      await this.terminalService.sendCmd(`New-Item -Path "${tempPath}" -ItemType Directory -Force`);
      await this.waitForDirectoryExists(tempPath, 5000, 100);
      await this.terminalService.sendCmd(`New-Item -Path "${sketchPath}" -ItemType Directory -Force`);
      await this.waitForDirectoryExists(sketchPath, 5000, 100);
      await this.terminalService.sendCmd(`New-Item -Path "${librariesPath}" -ItemType Directory -Force`);
      await this.waitForDirectoryExists(librariesPath, 5000, 100);

      // 生成sketch文件
      const code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
      this.lastCode = code;
      await window['fs'].writeFileSync(sketchFilePath, code);

      // 加载项目package.json
      const packageJson = JSON.parse(window['fs'].readFileSync(`${this.currentProjectPath}/package.json`));
      const dependencies = packageJson.dependencies || {};
      const boardDependencies = packageJson.boardDependencies || {};

      // 从dependencies中查找以@aily-project/board-开头的依赖
      let board = ""
      const libsPath = []
      Object.entries(dependencies).forEach(([key, version]) => {
        if (key.startsWith('@aily-project/board-')) {
          board = key
        } else if (key.startsWith('@aily-project/lib-') && !key.startsWith('@aily-project/lib-core')) {
          libsPath.push(key)
        }
      });

      if (!board) {
        console.error('缺少板子信息');
        this.buildInProgress = false;
        reject({ state: 'error', text: '缺少板子信息' });
        return;
      }

      // 获取板子信息(board.json)
      const boardJson = JSON.parse(window['fs'].readFileSync(`${this.currentProjectPath}/node_modules/${board}/board.json`));
      console.log("boardJson: ", boardJson);

      if (!boardJson) {
        console.error('缺少板子信息');
        this.buildInProgress = false;
        reject({ state: 'error', text: '缺少板子信息' });
        return;
      }

      this.boardJson = boardJson;

      // 获取板子

      // 解压libraries到临时文件夹
      console.log("libsPath: ", libsPath);
      for (let lib of libsPath) {
        let targetName = lib.split('@aily-project/')[1];
        let targetPath = `${librariesPath}/${targetName}`;

        if (window['path'].isExists(targetPath)) {
          await this.terminalService.sendCmd(`Remove-Item -Path "${targetPath}" -Recurse -Force`);
        }

        let sourceZipPath = `${this.currentProjectPath}/node_modules/${lib}/src.7z`;
        if (!window['path'].isExists(sourceZipPath)) continue;

        let sourcePath = `${this.currentProjectPath}/node_modules/${lib}/src`;
        if (!window['path'].isExists(sourcePath)) {
          // 如果没有src文件夹，则使用src.7z解压到临时文件夹
          await this.terminalService.sendCmd(`7za x "${sourceZipPath}" -o"${sourcePath}" -y`);
        }
        // 直接复制src到targetPath
        await this.terminalService.sendCmd(`Copy-Item -Path "${sourcePath}" -Destination "${targetPath}" -Recurse -Force`);

        await this.waitForDirectoryExists(targetPath, 5000, 100);
      }

      // 获取编译器、sdk、tool的名称和版本
      let compiler = ""
      let sdk = ""

      Object.entries(boardDependencies).forEach(([key, version]) => {
        if (key.startsWith('@aily-project/compiler-')) {
          compiler = key.replace(/^@aily-project\/compiler-/, '') + '@' + version;
        } else if (key.startsWith('@aily-project/sdk-')) {
          sdk = key.replace(/^@aily-project\/sdk-/, '') + '_' + version;
        }
      });

      console.log("sdk: ", sdk)

      if (!compiler || !sdk) {
        console.error('缺少编译器或sdk');
        this.buildInProgress = false;
        reject({ state: 'warn', text: '缺少编译器或sdk' });
        return;
      }

      // 组合编译器、sdk、tools的路径
      this.compilerPath = await window["env"].get('AILY_COMPILERS_PATH') + `/${compiler}`;
      this.sdkPath = await window["env"].get('AILY_SDK_PATH') + `/${sdk}`;
      this.toolsPath = await window["env"].get('AILY_TOOLS_PATH');

      // 获取编译命令
      let compilerParam = boardJson.compilerParam;
      if (!compilerParam) {
        console.error('缺少编译参数');
        this.buildInProgress = false;
        reject({ state: 'error', text: '缺少编译参数' });
        return;
      }

      let compilerParamList = compilerParam.split(' ');
      compilerParamList = compilerParamList.map(param => {
        if (param.startsWith('aily:')) {
          let res;
          const parts = param.split(':');
          if (parts.length > 2) { // Ensure we have at least 3 parts (aily:avr:mega)
            parts[1] = sdk;
            res = parts.join(':');
          } else {
            res = param
          }
          this.boardType = res
          return res; // Return unchanged if format doesn't match
        } else {
          return param;
        }
      });

      compilerParam = compilerParamList.join(' ');

      // this.uiService.updateState({ state: 'doing', text: '准备完成，开始编译中...' });

      // 创建返回的 Promise
      this.buildResolver = resolve;

      const compileCommand = `arduino-cli.exe ${compilerParam} --jobs 0 --libraries '${librariesPath}' --board-path '${this.sdkPath}' --compile-path '${this.compilerPath}' --tools-path '${this.toolsPath}' --output-dir '${this.buildPath}' --log-level debug '${sketchFilePath}'  --verbose`;

      const title = `编译 ${boardJson.name}`;
      const completeTitle = `编译完成`;

      // 用于跟踪编译状态
      let buildCompleted = false;
      let lastProgress = 0;
      let lastBuildText = '';
      let isErrored = false;
      let isStopped = false;
      let errorText = '编译失败';

      this.terminalService.startStream().then(streamId => {
        this.currentBuildStreamId = streamId;

        // 使用流式输出执行命令
        this.terminalService.executeWithStream(
          compileCommand,
          streamId,
          async (line) => {
            // 判断是否已取消，如果已取消则不在处理输出
            if (!this.buildInProgress) {
              resolve({ state: 'canceled', text: '编译已取消' });
            }
            // 处理每一行输出
            const trimmedLine = line.trim();

            if (isErrored) {
              if (isStopped) {
                return; // 如果已经停止，则不处理后续行
              }
              if (/Error during build/i.test(trimmedLine) || /Used platform/i.test(trimmedLine) || /Used library Version/i.test(trimmedLine)) {
                isStopped = true;
                return; // Stop processing this line
              }
              this.noticeService.update({
                title: "编译错误",
                text: errorText,
                detail: ">> " + trimmedLine,
                state: 'error',
                setTimeout: 55000
              });
              reject({ state: 'error', text: errorText });
            };

            // 检查是否有错误信息
            if (/error:|error during build:|failed|fatal/i.test(trimmedLine)) {
              console.error("检测到编译错误:", trimmedLine);
              // 提取更有用的错误信息，避免过长
              const errorMatch = trimmedLine.match(/error:(.+?)($|(\s+at\s+))/i);
              errorText = errorMatch ? errorMatch[1].trim() : trimmedLine;

              // 错误时立即返回，避免继续处理
              isErrored = true;
              // this.uiService.updateState({ state: 'error', text: errorText });
              this.noticeService.update({
                title: "编译错误",
                text: errorText,
                detail: "> " + errorText,
                state: 'error',
                setTimeout: 55000
              });

              // 清理资源后再拒绝Promise
              this.buildInProgress = false;
              this.buildResolver = null;
              this.passed = false;

              setTimeout(async () => {
                await this.terminalService.stopStream(streamId);
                reject({ state: 'error', text: errorText });
              }, 1000);

              return;
            }
            // 提取构建文本
            if (trimmedLine.startsWith('BuildText:')) {
              const buildText = trimmedLine.replace('BuildText:', '').trim();
              lastBuildText = buildText;
              // this.uiService.updateState({ state: 'doing', text: buildText });
            }

            // 提取进度信息
            const progressInfo = trimmedLine.trim();
            let progressValue = 0;

            // Match patterns like [========================================          ] 80%
            const barProgressMatch = progressInfo.match(/\[.*?\]\s*(\d+)%/);
            if (barProgressMatch) {
              try {
                progressValue = parseInt(barProgressMatch[1], 10);
              } catch (error) {
                progressValue = 0;
                console.warn('进度解析错误:', error);
              }
            }

            if (progressValue > lastProgress) {
              console.log("progress: ", lastProgress);
              lastProgress = progressValue;
              this.noticeService.update({
                title: title,
                text: lastBuildText,
                state: 'doing',
                progress: lastProgress, setTimeout: 0, stop: () => {
                  this.cancelBuild();
                }
              });
            }

            // 进度为100%时标记完成
            if (lastProgress === 100 && !buildCompleted) {
              buildCompleted = true;
            }

            // 更新状态
            if (buildCompleted) {
              this.noticeService.update({ title: completeTitle, text: "编译完成", state: 'done', setTimeout: 55000 });
              // this.uiService.updateState({ state: 'done', text: '编译完成' });

              this.buildInProgress = false;
              this.buildResolver = null;
              await this.terminalService.stopStream(streamId);
              this.passed = true;
              resolve({ state: 'done', text: '编译完成' });
              return;
            }
          },
        ).catch(error => {
          // this.uiService.updateState({ state: 'error', text: '编译失败' });
          this.message.error('编译失败: ' + error.message);
          this.noticeService.update({ title: title, text: '编译失败', detail: error, state: 'error', setTimeout: 55000 });
          this.buildInProgress = false;
          this.buildResolver = null;
          this.terminalService.stopStream(streamId);
          this.passed = false;
          reject({ state: 'error', text: error.message });
        });
      })
    });
  }

  /**
 * 取消当前编译过程
 */
  cancelBuild() {
    this.buildInProgress = false;

    if (this.buildResolver) {
      this.buildResolver({ state: 'canceled', text: '编译已取消' });
      this.buildResolver = null;
    }

    // 中断终端
    this.terminalService.interrupt()
      .then(() => {
        // 如果当前有流ID，尝试停止流
        if (this.currentBuildStreamId) {
          window['terminal'].stopStream(
            this.terminalService.currentPid,
            this.currentBuildStreamId
          ).then(() => {
            console.log('编译流已停止');
            this.noticeService.clear();
            this.terminalService.stopStream(this.currentBuildStreamId);
            this.currentBuildStreamId = null;
            this.message.success('编译已中断');
            // this.uiService.updateState({ state: 'done', text: '编译已取消' });
          });
        }
      })
      .catch(error => {
        console.error('取消编译失败:', error);
        this.noticeService.update({ title: '取消编译失败', text: error.message, state: 'error', setTimeout: 55000 });
        this.message.warning('取消编译失败: ' + error.message);
        return false;
      });
  }
}
