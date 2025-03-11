import { Injectable } from '@angular/core';
import { arduinoGenerator, DEFAULT_DATA } from '../blockly/generators/arduino/arduino';
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
    private notice: NoticeService
  ) { }

  private buildInProgress = false;
  private currentBuildStreamId: string | null = null;

  lastCode = "";

  async build(): Promise<ActionState> {
    const projectPath = this.projectService.currentProjectPath;
    const tempPath = projectPath + '/.temp';
    const sketchPath = tempPath + '/sketch';
    const sketchFilePath = sketchPath + '/sketch.ino';
    const librariesPath = tempPath + '/libraries';
    const buildPath = tempPath + '/build';

    this.uiService.updateState({ state: 'doing', text: '编译准备中...' });

    // 创建临时文件夹
    await this.uiService.openTerminal();
    await this.terminalService.sendCmd(`New-Item -Path "${tempPath}" -ItemType Directory -Force`);
    await this.terminalService.sendCmd(`New-Item -Path "${sketchPath}" -ItemType Directory -Force`);
    await this.terminalService.sendCmd(`New-Item -Path "${librariesPath}" -ItemType Directory -Force`);

    await this.terminalService.sendCmd(`cd "${tempPath}"`);

    // 生成sketch文件
    const code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
    this.lastCode = code;
    await window['file'].writeFileSync(sketchFilePath, code);

    // TODO 生成libraries中的文件

    // 加载项目package.json
    const packageJson = JSON.parse(window['file'].readFileSync(`${projectPath}/package.json`));
    const dependencies = packageJson.dependencies || {};
    const boardDependencies = packageJson.boardDependencies || {};

    // 从dependencies中查找以@aily-project/board-开头的依赖
    let board = ""
    Object.entries(dependencies).forEach(([key, version]) => {
      if (key.startsWith('@aily-project/board-')) {
        board = key
      }
    });

    if (!board) {
      console.error('缺少板子信息');
      return { state: 'error', text: '缺少板子信息' };
    }

    // 获取板子信息(board.json)
    const boardJson = JSON.parse(window['file'].readFileSync(`${projectPath}/node_modules/${board}/board.json`));
    console.log("boardJson: ", boardJson);

    if (!boardJson) {
      console.error('缺少板子信息');
      return { state: 'error', text: '缺少板子信息' };
    }

    // 获取编译命令
    let compilerParam = boardJson.compilerParam;


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

    if (!compiler || !sdk) {
      console.error('缺少编译器或sdk');
      return { state: 'error', text: '缺少编译器或sdk' };
    }

    // 组合编译器、sdk、tools的路径
    const compilerPath = await window["env"].get('AILY_COMPILERS_PATH') + `/${compiler}`;
    const sdkPath = await window["env"].get('AILY_SDK_PATH') + `/${sdk}`;
    const toolsPath = await window["env"].get('AILY_TOOLS_PATH');

    this.uiService.updateState({ state: 'doing', text: '准备完成，开始编译中...' });

    // 创建返回的 Promise
    return new Promise<ActionState>((resolve, reject) => {
      const compileCommand = `arduino-cli.exe ${compilerParam} --board-path '${sdkPath}' --compile-path '${compilerPath}' --tools-path '${toolsPath}' --output-dir '${buildPath}' --log-level debug '${sketchFilePath}' --verbose`;

      const title = `正在编译 ${boardJson.name}`;
      const completeTitle = `编译完成`;

      // 用于跟踪编译状态
      let buildCompleted = false;
      let lastProgress = 0;
      let lastBuildText = '';
      let isErrored = false;
      let errorText = '编译失败';

      this.terminalService.startStream().then(streamId => {
        this.currentBuildStreamId = streamId;

        // 使用流式输出执行命令
        this.terminalService.executeWithStream(
          compileCommand,
          streamId,
          (line) => {
            // 处理每一行输出
            const trimmedLine = line.trim();

            // 提取构建文本
            if (trimmedLine.startsWith('BuildText:')) {
              const buildText = trimmedLine.replace('BuildText:', '').trim();
              console.log("Build text:", buildText);
              lastBuildText = buildText;
              // this.uiService.updateState({ state: 'doing', text: buildText });
            }
            // 提取进度信息
            else if (trimmedLine.startsWith('progress')) {
              console.log(trimmedLine);
              const progressInfo = trimmedLine.replace('progress', '').trim();
              const progressMatch = progressInfo.match(/(\d+)%?/);

              if (progressMatch) {
                const progressValue = parseInt(progressMatch[1], 10);
                lastProgress = progressValue;

                // 进度为100%时标记完成
                if (progressValue === 100 && !buildCompleted) {
                  buildCompleted = true;
                  // this.uiService.updateState({ state: 'done', text: '编译完成' });
                  // this.message.success('编译成功');
                  // resolve({ state: 'done', text: '编译完成' });
                }
              }
            }
            // 检查错误信息
            else if (trimmedLine.toLowerCase().includes('error:') ||
              trimmedLine.toLowerCase().includes('failed')) {
              console.error("检测到编译错误:", trimmedLine);
              isErrored = true;
            }

            if (isErrored) {
              this.notice.update({ title: title, text: errorText, state: 'error', setTimeout: 55000 });
            } else {
              // 更新状态
              if (!buildCompleted) {
                this.notice.update({
                  title: title, text: lastBuildText, state: 'doing', progress: lastProgress, setTimeout: 0, stop: async () => {
                    await this.cancelBuild();
                  }
                });
              } else {
                this.notice.update({ title: completeTitle, text: "编译完成", state: 'done', setTimeout: 55000 });
                this.uiService.updateState({ state: 'done', text: '编译完成' });

                this.buildInProgress = false;
                resolve({ state: 'done', text: '编译完成' });
              }
            }
          }
        ).catch(error => {
          console.error("编译命令执行失败:", error);
          this.uiService.updateState({ state: 'error', text: '编译失败' });
          this.message.error('编译失败: ' + error.message);
          this.buildInProgress = false;
          resolve({ state: 'error', text: error.message });
        });
      });
    });
  }

  /**
 * 取消当前编译过程
 */
  cancelBuild(): Promise<boolean> {
    if (!this.buildInProgress) {
      return Promise.resolve(false);
    }

    this.buildInProgress = false;

    // 先尝试普通中断
    return this.terminalService.interrupt()
      .then(() => {
        // 如果当前有流ID，尝试停止流
        if (this.currentBuildStreamId) {
          return window['terminal'].stopStream(
            this.terminalService.currentPid,
            this.currentBuildStreamId
          );
        }
        return Promise.resolve();
      })
      .then(() => {
        // 等待短暂时间后，如果进程还在，使用强制终止
        return new Promise(resolve => {
          setTimeout(() => {
            this.terminalService.killProcess('arduino-cli.exe')
              .finally(() => resolve(true));
          }, 1000);
        });
      })
      .then(() => {
        this.uiService.updateState({ state: 'canceled', text: '编译已取消' });
        return true;
      })
      .catch(error => {
        console.error('取消编译失败:', error);
        return false;
      });
  }
}
