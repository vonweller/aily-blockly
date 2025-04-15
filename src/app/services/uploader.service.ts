import { Injectable } from '@angular/core';
import { ProjectService } from './project.service';
import { SerialService } from './serial.service';
import { arduinoGenerator } from '../blockly/generators/arduino/arduino';
import { ActionState, UiService } from './ui.service';
import { BuilderService } from './builder.service';
import { TerminalService } from '../tools/terminal/terminal.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { BlocklyService } from '../blockly/blockly.service';
import { NoticeService } from '../services/notice.service';

@Injectable({
  providedIn: 'root'
})
export class UploaderService {

  constructor(
    private projectService: ProjectService,
    private uiService: UiService,
    private serialService: SerialService,
    private terminalService: TerminalService,
    private message: NzMessageService,
    private blocklyService: BlocklyService,
    private builderService: BuilderService,
    private noticeService: NoticeService
  ) { }

  uploadInProgress = false;
  currentUploadStreamId: string | null = null;
  uploadResolver: ((value: ActionState) => void) | null = null

  // 定义正则表达式，匹配常见的进度格式
  progressRegexPatterns = [
    // Writing | ################################################## | 78% 0.12s
    /\|\s*#+\s*\|\s*\d+%.*$/,
    // [==============================] 84% (11/13 pages)
    /\[\s*={1,}>*\s*\]\s*\d+%.*$/,
    // Writing | ████████████████████████████████████████████████▉  | 98% 
    /\|\s*\d+%\s*$/,
    // 或者只是数字+百分号（例如：[====>    ] 70%）
    /\b(\d+)%\b/,
    // Writing at 0x0005446e... (18 %)
    // Writing at 0x0002d89e... (40 %)
    // Writing at 0x0003356b... (50 %)
    /Writing\s+at\s+0x[0-9a-f]+\.\.\.\s+\(\d+\s*%\)/i,
    // 70% 13/18
    /^(\d+)%\s+\d+\/\d+/,
    // 标准格式：数字%（例如：70%）
    /(?:进度|Progress)[^\d]*?(\d+)%/i,
    // 带空格的格式（例如：70 %）
    /(?:进度|Progress)[^\d]*?(\d+)\s*%/i,
  ];

  async upload(): Promise<ActionState> {
    if (this.uploadInProgress) {
      this.message.warning('上传中，请稍后');
      return ({ state: 'error', text: '上传中，请稍后' });
    }
    if (!this.serialService.currentPort) {
      this.message.warning('请先选择串口');
      this.uploadInProgress = false;
      return ({ state: 'error', text: '请先选择串口' });
    }

    this.uploadInProgress = true;
    let isErrored = false;
    let uploadCompleted = false;

    this.noticeService.clear()

    // 对比代码是否有变化
    const code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
    if (!this.builderService.passed || code !== this.builderService.lastCode) {
      // 编译
      await this.builderService.build();
    }

    const projectPath = this.projectService.currentProjectPath;
    const tempPath = projectPath + '/.temp';
    const buildPath = tempPath + '/build';

    // 判断buildPath是否存在
    if (!window['path'].isExists(buildPath)) {
      // 编译
      await this.builderService.build();
    }

    // 加载项目package.json
    const packageJson = JSON.parse(window['fs'].readFileSync(`${projectPath}/package.json`));
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
      this.message.error('缺少板子信息');
      this.uploadInProgress = false;
      return ({ state: 'error', text: '缺少板子信息' });
    }

    // 获取板子信息(board.json)
    const boardJson = JSON.parse(window['fs'].readFileSync(`${projectPath}/node_modules/${board}/board.json`));
    console.log("boardJson: ", boardJson);

    if (!boardJson) {
      this.message.error('缺少板子信息');
      this.uploadInProgress = false;
      return ({ state: 'error', text: '缺少板子信息' });
    }

    this.noticeService.clear()

    let lastUploadText = `正在上传${boardJson.name}`;

    // 获取上传参数
    let uploadParam = boardJson.uploadParam;
    // 替换uploadParam中的${serial}为当前串口
    uploadParam = uploadParam.replace('${serial}', this.serialService.currentPort);

    // 获取sdk、上传工具的名称和版本
    let sdk = ""

    Object.entries(boardDependencies).forEach(([key, version]) => {
      if (key.startsWith('@aily-project/sdk-')) {
        sdk = key.replace(/^@aily-project\/sdk-/, '') + '_' + version;
      }
    });

    if (!sdk) {
      this.message.error('缺少sdk信息');
      this.uploadInProgress = false;
      return ({ state: 'error', text: '缺少sdk信息' });
    }

    // 组合sdk、上传工具的路径
    const sdkPath = await window["env"].get('AILY_SDK_PATH') + `/${sdk}`; 
    const toolsPath = await window["env"].get('AILY_TOOLS_PATH');

    // 上传
    await this.uiService.openTerminal();

    this.uiService.updateState({ state: 'doing', text: '准备完成，开始上传...' });

    return new Promise<ActionState>((resolve, reject) => {
      // 将resolve函数保存，以便在取消时使用
      this.uploadResolver = resolve;

      const title = '上传中';
      const completeTitle = '上传完成';
      const errorTitle = '上传失败';
      const completeText = '上传完成';
      let lastProgress = 0;

      let errorText = '';
      const uploadCmd = `arduino-cli.exe ${uploadParam} --input-dir ${buildPath} --board-path ${sdkPath} --tools-path ${toolsPath} --verbose`;

      console.log("start progress: ", lastProgress);
      this.uploadInProgress = true;
      this.noticeService.update({ title: title, text: lastUploadText, state: 'doing', progress: 0, setTimeout: 0 });
    
      this.terminalService.startStream().then(streamId => {
        this.currentUploadStreamId = streamId;

        // 使用流式输出执行命令
        this.terminalService.executeWithStream(
          uploadCmd,
          streamId,
          async (line) => {
            // 判断是否已取消，如果已取消则不在处理输出
            if (!this.uploadInProgress) {
              resolve({ state: 'canceled', text: '上传已取消' });
            }

            // 处理每一行输出
            const trimmedLine = line.trim();
            // 尝试使用所有模式匹配进度
            let progressValue = null;

            // 使用通用提取方法获取进度
            // const progressValue = this.extractProgressFromLine(trimmedLine);
            // console.log("trimmedLine: ", trimmedLine);
            for (const regex of this.progressRegexPatterns) {
              const match = trimmedLine.match(regex);
              if (match) {
                // 提取数字部分
                console.log("match: ", match);
                let numericMatch = trimmedLine.match(/(\d+)%/);
                if (!numericMatch) {
                  numericMatch = trimmedLine.match(/(\d+)\s*%/);
                }
                console.log("numericMatch: ", numericMatch);
                if (numericMatch) {
                  progressValue = parseInt(numericMatch[1], 10);
                  if (lastProgress == 0 && progressValue > 100) {
                    progressValue = 0;
                  }
                  break; // 找到匹配后停止循环
                }
              }
            }

            // 如果找到有效的进度值
            if (progressValue !== null) {
              console.log(`检测到上传进度: ${progressValue}%`);
              lastProgress = progressValue;

              // 进度为100%时标记完成
              if (progressValue === 100 && !uploadCompleted) {
                uploadCompleted = true;
                console.log("上传完成: 100%");
              }
            }
            // 检查错误信息
            else if (trimmedLine.toLowerCase().includes('error:') ||
              trimmedLine.toLowerCase().includes('failed')) {
              console.error("检测到上传错误:", trimmedLine);
              errorText = trimmedLine;
              isErrored = true;
            }

            if (isErrored) {
              this.noticeService.update({ title: errorTitle, text: errorText, state: 'error', setTimeout: 55000 });
              this.uploadInProgress = false;
              await this.terminalService.stopStream(streamId);
              this.uiService.updateState({ state: 'error', text: errorText });
              reject({ state: 'error', text: errorText });
            } else {
              // 上传
              if (!uploadCompleted) {
                this.noticeService.update({ title: title, text: lastUploadText, state: 'doing', progress: lastProgress, setTimeout: 0, stop: () => {
                  this.cancelBuild()}});
              } else {
                this.noticeService.update({ title: completeTitle, text: completeText, state: 'done', setTimeout: 55000 });
                this.uiService.updateState({ state: 'done', text: completeText });

                this.uploadInProgress = false;
                this.uploadResolver = null;
                await this.terminalService.stopStream(streamId);
                resolve({ state: 'done', text: '上传完成' });
              }
            }
          },
        ).catch(error => {
          console.error("上传执行失败:", error);
          this.uiService.updateState({ state: 'error', text: '上传失败' });
          this.message.error('上传失败: ' + error.message);
          this.uploadInProgress = false;
          this.uploadResolver = null;
          reject({ state: 'error', text: error.message });
        });

      });
    });
  }

  /**
  * 取消当前上传过程
  */
  cancelBuild() {
    this.uploadInProgress = false;

    if (this.uploadResolver) {
      this.uploadResolver({ state: 'canceled', text: '上传已取消' });
      this.uploadResolver = null;
    }

    // 中断终端
    this.terminalService.interrupt()
      .then(() => {
        // 如果当前有流ID，尝试停止流
        if (this.currentUploadStreamId) {
          window['terminal'].stopStream(
            this.terminalService.currentPid,
            this.currentUploadStreamId
          ).then(() => {
            console.log('上传已停止');
            this.noticeService.clear();
            this.terminalService.stopStream(this.currentUploadStreamId);
            this.currentUploadStreamId = null;
            this.message.success('上传已中断');
            this.uiService.updateState({ state: 'done', text: '上传已中断' });
          });
        }
      })
      .catch(error => {
        console.error('取消上传失败:', error);
        this.noticeService.clear()
        this.message.warning('取消上传失败: ' + error.message);
        return false;
      });
  }
}

