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
import { NzModalService } from 'ng-zorro-antd/modal';
import { NpmService } from './npm.service';
import { SerialDialogComponent } from '../main-window/components/serial-dialog/serial-dialog.component';

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
    private noticeService: NoticeService,
    private modal: NzModalService,
    private npmService: NpmService
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
    return new Promise<ActionState>(async (resolve, reject) => {
      if (this.uploadInProgress) {
        this.message.warning('上传中，请稍后');
        reject({ state: 'warn', text: '上传中，请稍后' });
        return;
      }
      if (this.npmService.isInstalling) {
        this.message.warning('正在安装依赖，请稍后再试');
        reject({ state: 'warn', text: '正在安装依赖，请稍后再试' });
        return;
      }
      if (!this.serialService.currentPort) {
        this.message.warning('请先选择串口');
        this.uploadInProgress = false;
        reject({ state: 'warn', text: '请先选择串口' });
        this.modal.create({
          nzTitle: null,
          nzFooter: null,
          nzClosable: false,
          nzBodyStyle: {
            padding: '0',
          },
          nzWidth: '320px',
          nzContent: SerialDialogComponent,
        });
        return;
      }

      // 重置ESP32上传状态，防止进度累加
      this['esp32UploadState'] = {
        currentRegion: 0,
        totalRegions: 0,
        detectedRegions: false,
        completedRegions: 0
      };

      this.uploadInProgress = true;
      let isErrored = false;
      let isStopped = false;
      let uploadCompleted = false;

      this.noticeService.clear()

      // 对比代码是否有变化
      const code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
      if (!this.builderService.passed || code !== this.builderService.lastCode || this.projectService.currentProjectPath !== this.builderService.currentProjectPath) {
        // 编译
        await this.builderService.build();
      }

      console.log("passed1")

      if (!this.builderService.passed) {
        // this.message.error('编译失败，请检查代码');
        this.uploadInProgress = false;
        reject({ state: 'error', text: '编译失败，请检查代码' });
      }

      const buildPath = this.builderService.buildPath;

      console.log("passed2")

      // 判断buildPath是否存在
      if (!window['path'].isExists(buildPath)) {
        // 编译
        await this.builderService.build();
      }

      const boardJson = this.builderService.boardJson;
      this.noticeService.clear()

      let lastUploadText = `正在上传${boardJson.name}`;

      console.log("passed3");

      // 获取上传参数
      let uploadParam = boardJson.uploadParam;
      if (!uploadParam) {
        this.message.error('缺少上传参数');
        this.uploadInProgress = false;
        reject({ state: 'error', text: '缺少上传参数' });
      }

      console.log("passed4")

      let uploadParamList = uploadParam.split(' ');
      uploadParamList = uploadParamList.map(param => {
        // 替换${serial}为当前串口号
        if (param.includes('${serial}')) {
          return param.replace('${serial}', this.serialService.currentPort);
        } else if (param.startsWith('aily:')) {
          return this.builderService.boardType;
        }
        return param;
      });

      uploadParam = uploadParamList.join(' ');
      const sdkPath = this.builderService.sdkPath;
      const toolsPath = this.builderService.toolsPath;

      console.log("passed5")

      // 上传
      await this.uiService.openTerminal();

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

            if (isErrored) {
              if (isStopped) {
                return;
              }

              this.noticeService.update({
                title: "上传失败",
                text: errorText,
                detail: ">> " + trimmedLine,
                state: 'error',
                setTimeout: 55000
              });
            };

            // 检查是否有错误信息
            if (trimmedLine.toLowerCase().includes('error:') ||
              trimmedLine.toLowerCase().includes('failed')) {
              console.error("检测到上传错误:", trimmedLine);
              errorText = trimmedLine;
              isErrored = true;

              this.noticeService.update({
                title: errorTitle,
                text: errorText,
                state: 'error',
                setTimeout: 55000
              });

              this.uploadInProgress = false;
              this.uploadResolver = null;

              setTimeout(async () => {
                await this.terminalService.stopStream(streamId);
                reject({ state: 'error', text: errorText });
              }, 1000);

              return;
            }


            // 使用通用提取方法获取进度
            // const progressValue = this.extractProgressFromLine(trimmedLine);
            // console.log("trimmedLine: ", trimmedLine);
            // ESP32特定进度跟踪
            let isESP32Format = /Writing\s+at\s+0x[0-9a-f]+\.\.\.\s+\(\d+\s*%\)/i.test(trimmedLine);
            // 使用静态变量跟踪ESP32上传状态
            if (!this['esp32UploadState']) {
              this['esp32UploadState'] = {
                currentRegion: 0,
                totalRegions: 0,
                detectedRegions: false,
                completedRegions: 0
              };
            }

            // 检测擦除区域的数量来确定总区域
            if (!this['esp32UploadState'].detectedRegions &&
              trimmedLine.includes('Flash will be erased from')) {
              this['esp32UploadState'].totalRegions++;
            }

            // 检测到"Compressed"字样表示开始新区域
            if (trimmedLine.includes('Compressed') &&
              trimmedLine.includes('bytes to')) {
              this['esp32UploadState'].detectedRegions = true;
              this['esp32UploadState'].currentRegion++;
            }

            // 检测到"Hash of data verified"表示一个区域完成
            if (trimmedLine.includes('Hash of data verified')) {
              this['esp32UploadState'].completedRegions++;
            }

            // 优先处理ESP32格式
            if (isESP32Format) {
              const numericMatch = trimmedLine.match(/\((\d+)\s*%\)/);
              if (numericMatch) {
                const regionProgress = parseInt(numericMatch[1], 10);

                // 计算整体进度
                if (this['esp32UploadState'].totalRegions > 0) {
                  // 已完成区域贡献100%，当前区域贡献按比例
                  const completedPortion = this['esp32UploadState'].completedRegions /
                    this['esp32UploadState'].totalRegions * 100;
                  const currentPortion = regionProgress /
                    this['esp32UploadState'].totalRegions;

                  progressValue = Math.floor(completedPortion + currentPortion);

                  // 进度强制显示，无论是否增加
                  lastProgress = progressValue - 1; // 确保更新
                } else {
                  progressValue = regionProgress;
                }
              }
            } else {
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
            }

            if (progressValue && progressValue > lastProgress) {
              console.log("progress: ", lastProgress);
              lastProgress = progressValue;
              this.noticeService.update({
                title: title,
                text: lastUploadText,
                state: 'doing',
                progress: lastProgress,
                setTimeout: 0,
                stop: () => {
                  this.cancelBuild()
                }
              });
            }

            // 进度为100%时标记完成
            // if (progressValue === 100 && !uploadCompleted) {
            //   uploadCompleted = true;
            //   console.log("上传完成: 100%");

            // 判断是否包含New upload port
            if (trimmedLine.includes('New upload port')) {
              uploadCompleted = true;
            }

            // 上传
            if (uploadCompleted) {
              this.noticeService.update({
                title: completeTitle,
                text: completeText,
                state: 'done',
                setTimeout: 55000
              });

              this.uploadInProgress = false;
              this.uploadResolver = null;
              await this.terminalService.stopStream(streamId);
              return resolve({ state: 'done', text: '上传完成' });
            }
          },
        ).catch(error => {
          // console.error("上传执行失败:", error);
          // this.uiService.updateState({ state: 'error', text: '上传失败' });
          // this.message.error('上传失败: ' + error.message);
          this.uploadInProgress = false;
          this.uploadResolver = null;
          return reject({ state: 'error', text: error.message });
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
            // console.log('上传已停止');
            this.noticeService.clear();
            this.terminalService.stopStream(this.currentUploadStreamId);
            this.currentUploadStreamId = null;
            this.message.success('上传已中断');
            // this.uiService.updateState({ state: 'done', text: '上传已中断' });
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

