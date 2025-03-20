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
    private notice: NoticeService
  ) { }

  private buildInProgress = false;
  private currentBuildStreamId: string | null = null;
  private buildResolver: ((value: ActionState) => void) | null = null;

  lastCode = "";

  async build(): Promise<ActionState> {
    this.notice.update(null);

    const projectPath = this.projectService.currentProjectPath;
    const tempPath = projectPath + '/.temp';
    const sketchPath = tempPath + '/sketch';
    const sketchFilePath = sketchPath + '/sketch.ino';
    const librariesPath = tempPath + '/libraries';
    const buildPath = tempPath + '/build';

    this.buildInProgress = true;
    this.currentBuildStreamId = null;
    this.buildResolver = null;

    // this.uiService.updateState({ state: 'doing', text: '编译准备中...' });

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

    // 加载项目package.json
    const packageJson = JSON.parse(window['file'].readFileSync(`${projectPath}/package.json`));
    const dependencies = packageJson.dependencies || {};
    const boardDependencies = packageJson.boardDependencies || {};

    // 从dependencies中查找以@aily-project/board-开头的依赖
    
    let board = ""
    const libsPath = []
    Object.entries(dependencies).forEach(([key, version]) => {
      if (key.startsWith('@aily-project/board-')) {
        board = key
      } else if (key.startsWith('@aily-project/lib-')) {
        libsPath.push(key)
      }
    });

    if (!board) {
      console.error('缺少板子信息');
      this.buildInProgress = false;
      return { state: 'error', text: '缺少板子信息' };
    }

    // 获取板子信息(board.json)
    const boardJson = JSON.parse(window['file'].readFileSync(`${projectPath}/node_modules/${board}/board.json`));
    console.log("boardJson: ", boardJson);

    if (!boardJson) {
      console.error('缺少板子信息');
      this.buildInProgress = false;
      return { state: 'error', text: '缺少板子信息' };
    }

    // 解压libraries到临时文件夹
    console.log("libsPath: ", libsPath);
    for (let lib of libsPath) {
      let sourcePath = `${projectPath}/node_modules/${lib}/src.7z`;
      if (!window['path'].isExists(sourcePath)) continue;
      let targetName = lib.split('@aily-project/')[1];
      let targetPath = `${librariesPath}/${targetName}`;
      await this.terminalService.sendCmd(`7z x "${sourcePath}" -o"${targetPath}" -y`);
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
      this.buildInProgress = false;
      return { state: 'error', text: '缺少编译器或sdk' };
    }

    // 组合编译器、sdk、tools的路径
    const compilerPath = await window["env"].get('AILY_COMPILERS_PATH') + `/${compiler}`;
    const sdkPath = await window["env"].get('AILY_SDK_PATH') + `/${sdk}`;
    const toolsPath = await window["env"].get('AILY_TOOLS_PATH');

    this.uiService.updateState({ state: 'doing', text: '准备完成，开始编译中...' });

    // 创建返回的 Promise
    return new Promise<ActionState>((resolve, reject) => {
      this.buildResolver = resolve;

      const compileCommand = `arduino-cli.exe ${compilerParam} --libraries '${librariesPath}' --board-path '${sdkPath}' --compile-path '${compilerPath}' --tools-path '${toolsPath}' --output-dir '${buildPath}' --log-level debug '${sketchFilePath}'  --verbose`;

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
          async (line) => {
            // 判断是否已取消，如果已取消则不在处理输出
            if (!this.buildInProgress) {
              resolve({ state: 'canceled', text: '编译已取消' });
            }

            // 处理每一行输出
            const trimmedLine = line.trim();

            // 提取构建文本
            if (trimmedLine.startsWith('BuildText:')) {
              const buildText = trimmedLine.replace('BuildText:', '').trim();
              console.log("Build text:", buildText);
              lastBuildText = buildText;
              // this.uiService.updateState({ state: 'doing', text: buildText });
            }
            // 检查错误信息
            else if (trimmedLine.toLowerCase().includes('error:') ||
              trimmedLine.toLowerCase().includes('error during build:') ||
              trimmedLine.toLowerCase().includes('failed') || 
              trimmedLine.toLowerCase().includes('fatal')) {
              console.error("检测到编译错误:", trimmedLine);
              errorText = trimmedLine;
              isErrored = true;
            }
            else {
              // 提取进度信息
              console.log(trimmedLine);
              const progressInfo = trimmedLine.trim();

              // Match patterns like [========================================          ] 80%
              const barProgressMatch = progressInfo.match(/\[.*?\]\s*(\d+)%/);
              if (barProgressMatch) {
                const progressValue = parseInt(barProgressMatch[1], 10);
                lastProgress = progressValue;

                // 进度为100%时标记完成
                if (progressValue === 100 && !buildCompleted) {
                  buildCompleted = true;
                }
              }
            }

            if (isErrored) {
              this.notice.update({ title: title, text: errorText, state: 'error', setTimeout: 55000 });
              this.buildInProgress = false;
              await this.terminalService.stopStream(streamId);
              this.uiService.updateState({ state: 'error', text: errorText });
              reject({ state: 'error', text: errorText });
            } else {
              // 更新状态
              if (!buildCompleted) {
                this.notice.update({
                  title: title, text: lastBuildText, state: 'doing', progress: lastProgress, setTimeout: 0, stop: () => {
                    this.cancelBuild();
                  }
                });
              } else {
                this.notice.update({ title: completeTitle, text: "编译完成", state: 'done', setTimeout: 55000 });
                this.uiService.updateState({ state: 'done', text: '编译完成' });

                this.buildInProgress = false;
                this.buildResolver = null;
                await this.terminalService.stopStream(streamId);
                resolve({ state: 'done', text: '编译完成' });
              }
            }
          }
        ).catch(error => {
          console.error("编译命令执行失败:", error);
          this.uiService.updateState({ state: 'error', text: '编译失败' });
          this.message.error('编译失败: ' + error.message);
          this.buildInProgress = false;
          this.buildResolver = null;
          this.terminalService.stopStream(streamId);
          resolve({ state: 'error', text: error.message });
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
            this.notice.update(null);
            this.terminalService.stopStream(this.currentBuildStreamId);
            this.currentBuildStreamId = null;
            this.message.success('编译已中断');
            this.uiService.updateState({ state: 'done', text: '编译已取消' });
          });
        }
      })
      .catch(error => {
        console.error('取消编译失败:', error);
        this.notice.update(null)
        this.message.warning('取消编译失败: ' + error.message);
        return false;
      });
  }
}
