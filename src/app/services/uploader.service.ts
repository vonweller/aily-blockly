import { Injectable } from '@angular/core';
import { ProjectService } from './project.service';
import { SerialService } from './serial.service';
import { arduinoGenerator, DEFAULT_DATA } from '../blockly/generators/arduino/arduino';
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
    private notice: NoticeService
  ) { }

  private uploadInProgress = false;
  private currentUploadStreamId: string | null = null;

  async upload(): Promise<ActionState> {
    // 获取code
    const code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
    if (code !== this.builderService.lastCode) {
      // 编译
      await this.builderService.build();
    }

    const projectPath = this.projectService.currentProjectPath;
    const tempPath = projectPath + '/.temp';
    const buildPath = tempPath + '/build';

    // 加载项目package.json
    const packageJson = JSON.parse(window['file'].readFileSync(`${projectPath}/package.json`));
    const dependencies = packageJson.dependencies || {};
    const boardDependencies = packageJson.boardDependencies || {};

    // 定义更精确的正则表达式，匹配常见的进度格式
    const progressRegexPatterns = [
      // 标准格式：数字%（例如：70%）
      /(?:进度|Progress)[^\d]*?(\d+)%/i,
      // 带空格的格式（例如：70 %）
      /(?:进度|Progress)[^\d]*?(\d+)\s*%/i,
      // 或者只是数字+百分号（例如：[====>    ] 70%）
      /\b(\d+)%\b/,
      // Writing | ████████████████████████████████████████████████▉  | 98% 
      /\|\s*\d+%\s*$/,
      // 70% 13/18
      /^(\d+)%\s+\d+\/\d+/,
      // Writing | ################################################## | 78% 0.12s
      /\|\s*#+\s*\|\s*\d+%.*$/
    ];

    // 从dependencies中查找以@aily-project/board-开头的依赖
    let board = ""
    Object.entries(dependencies).forEach(([key, version]) => {
      if (key.startsWith('@aily-project/board-')) {
        board = key
      }
    });

    if (!board) {
      this.message.error('缺少板子信息');
      return;
    }

    // 获取板子信息(board.json)
    const boardJson = JSON.parse(window['file'].readFileSync(`${projectPath}/node_modules/${board}/board.json`));
    console.log("boardJson: ", boardJson);

    if (!boardJson) {
      this.message.error('缺少板子信息');
      return;
    }

    // 获取上传参数
    let uploadParam = boardJson.uploadParam;
    // 替换uploadParam中的${serial}为当前串口
    if (!this.serialService.currentPort) {
      this.message.error('请先选择串口');
      return;
    }
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
      return;
    }

    // 组合sdk、上传工具的路径
    const sdkPath = await window["env"].get('AILY_SDK_PATH') + `/${sdk}`; 
    const toolsPath = await window["env"].get('AILY_TOOLS_PATH');

    // 上传
    await this.uiService.openTerminal();

    this.uiService.updateState({ state: 'doing', text: '准备完成，开始上传...' });

    const title = '上传中';
    const completeTitle = '上传完成';
    const errorTitle = '上传失败';
    const completeText = '上传完成';

    let uploadCompleted = false;
    let isErrored = false;
    let lastProgress = 0;
    let lastUploadText = `正在上传${boardJson.name}`;
    let errorText = '';

    return new Promise<ActionState>((resolve, reject) => {
      const uploadCmd = `arduino-cli.exe ${uploadParam} --input-dir ${buildPath} --board-path ${sdkPath} --tools-path ${toolsPath} --verbose`;
      // console.log("uploadCmd: ", uploadCmd);
      // await this.terminalService.sendCmd(uploadCmd);

      // this.uiService.updateState({ state: 'done', text: '上传完成' });
      // this.message.success('上传完成');

      this.terminalService.startStream().then(streamId => {
        this.currentUploadStreamId = streamId;

        // 使用流式输出执行命令
        this.terminalService.executeWithStream(
          uploadCmd,
          streamId,
          (line) => {
            // 处理每一行输出
            const trimmedLine = line.trim();
            console.log("trimmedLine: ", trimmedLine);
            // 尝试使用所有模式匹配进度
            let progressValue = null;

            for (const regex of progressRegexPatterns) {
              const match = trimmedLine.match(regex);
              if (match) {
                // 提取数字部分
                const numericMatch = trimmedLine.match(/(\d+)%/);
                if (numericMatch) {
                  progressValue = parseInt(numericMatch[1], 10);
                  break; // 找到匹配后停止循环
                }
              }
            }

            console.log("progressValue: ", progressValue);

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
              this.notice.update({ title: errorTitle, text: errorText, state: 'error', setTimeout: 55000 });
              this.uploadInProgress = false;
              reject({ state: 'error', text: errorText });
            } else {
              // 上传
              if (!uploadCompleted) {
                this.notice.update({ title: title, text: lastUploadText, state: 'doing', progress: lastProgress, setTimeout: 0 });
              } else {
                this.notice.update({ title: completeTitle, text: completeText, state: 'done', setTimeout: 55000 });
                this.uiService.updateState({ state: 'done', text: completeText });

                this.uploadInProgress = false;
                resolve({ state: 'done', text: '上传完成' });
              }
            }
          },
        ).catch(error => {
          console.error("上传执行失败:", error);
          this.uiService.updateState({ state: 'error', text: '上传失败' });
          this.message.error('上传失败: ' + error.message);
          this.uploadInProgress = false;
          resolve({ state: 'error', text: error.message });
        });

      });
    });
  }
}
