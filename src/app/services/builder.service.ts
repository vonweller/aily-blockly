import { Injectable } from '@angular/core';
import { arduinoGenerator } from '../blockly/generators/arduino/arduino';
import { BlocklyService } from '../blockly/blockly.service';
import { ProjectService } from './project.service';
import { ActionState, UiService } from './ui.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NoticeService } from '../services/notice.service';
import { CmdOutput, CmdService } from './cmd.service';

@Injectable({
  providedIn: 'root'
})
export class BuilderService {

  constructor(
    private blocklyService: BlocklyService,
    private projectService: ProjectService,
    private cmdService: CmdService,
    private message: NzMessageService,
    private noticeService: NoticeService,
  ) { }

  private buildInProgress = false;
  private streamId: string | null = null;
  private buildCompleted = false;
  private isErrored = false; // 标识是否为错误状态


  currentProjectPath = "";
  lastCode = "";
  passed = false;
  cancelled = false;
  boardType = "";
  sdkPath = "";
  toolsPath = "";
  compilerPath = "";
  boardJson: any = null;
  buildPath = "";

  // 添加这个错误处理方法
  private handleCompileError(errorMessage: string) {
    console.error("handle errror: ", errorMessage);
    this.noticeService.update({
      title: "编译失败",
      text: errorMessage,
      detail: errorMessage,
      state: 'error',
      setTimeout: 55000
    });

    this.cmdService.kill(this.streamId || '');
    this.passed = false;
    this.isErrored = true;
    this.buildInProgress = false;
  }

  async build(): Promise<ActionState> {
    return new Promise<ActionState>(async (resolve, reject) => {
      try {
        if (this.buildInProgress) {
          this.message.warning("编译正在进行中，请稍后再试");
          reject({ state: 'warn', text: '编译中，请稍后' });
          return;
        }

        // this.noticeService.clear();
        this.currentProjectPath = this.projectService.currentProjectPath;
        const tempPath = this.currentProjectPath + '/.temp';
        const sketchPath = tempPath + '/sketch';
        const sketchFilePath = sketchPath + '/sketch.ino';
        const librariesPath = tempPath + '/libraries';

        this.buildPath = tempPath + '/build';

        this.buildCompleted = false;
        this.buildInProgress = true;
        this.streamId = "";
        this.isErrored = false; // 重置错误状态
        this.cancelled = false; // 重置取消状态

        // 创建临时文件夹
        // await this.uiService.openTerminal();
        await this.cmdService.runAsync(`New-Item -Path "${tempPath}" -ItemType Directory -Force`);
        await this.cmdService.runAsync(`New-Item -Path "${sketchPath}" -ItemType Directory -Force`);
        await this.cmdService.runAsync(`New-Item -Path "${librariesPath}" -ItemType Directory -Force`);

        console.log("临时文件夹已创建:", tempPath);

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

        // 获取板子信息(board.json)
        const boardJson = JSON.parse(window['fs'].readFileSync(`${this.currentProjectPath}/node_modules/${board}/board.json`));

        if (!boardJson) {
          throw new Error('未找到板子信息(board.json)');
        }

        this.boardJson = boardJson;

        // 解压libraries到临时文件夹
        for (let lib of libsPath) {
          let sourcePath = `${this.currentProjectPath}/node_modules/${lib}/src`;
          if (!window['path'].isExists(sourcePath)) {
            // 如果没有src文件夹，则使用src.7z解压到临时文件夹
            let sourceZipPath = `${this.currentProjectPath}/node_modules/${lib}/src.7z`;
            if (!window['path'].isExists(sourceZipPath)) continue;
            await this.cmdService.runAsync(`7za x "${sourceZipPath}" -o"${sourcePath}" -y`);
          }

          // 判断src目录下是否有且仅有一个src目录，没有别的文件或文件夹
          if (window['fs'].existsSync(sourcePath)) {
            const srcContents = window['fs'].readDirSync(sourcePath);
            if (srcContents.length === 1 &&
              srcContents[0].name === 'src' &&
              window['fs'].isDirectory(`${sourcePath}/${srcContents[0].name}`)) {
              // 如果有且仅有一个src目录，则将复制源路径定位到src/src
              console.log(`库 ${lib} 检测到嵌套src目录，使用 ${sourcePath}/src 作为源路径`);
              sourcePath = `${sourcePath}/src`;
            }
          }

          console.log("Source path for library:", sourcePath);

          // 判断src目录下是否包含.h文件
          let hasHeaderFiles = false;
          if (window['fs'].existsSync(sourcePath)) {
            // 获取sourcePath下的所有文件，排除文件夹
            const files = window['fs'].readDirSync(sourcePath, { withFileTypes: true });
            // 检查文件是否是对象数组或字符串数组
            hasHeaderFiles = Array.isArray(files) && files.some(file => {
              // 如果是文件对象
              if (typeof file === 'object' && file !== null && file.name) {
                return file.name.toString().endsWith('.h');
              }
              // 如果是字符串
              return typeof file === 'string' && file.endsWith('.h');
            });
            if (hasHeaderFiles) {
              console.log(`库 ${lib} 包含头文件`);
              let targetName = lib.split('@aily-project/')[1];
              let targetPath = `${librariesPath}/${targetName}`;

              if (window['path'].isExists(targetPath)) {
                await this.cmdService.runAsync(`Remove-Item -Path "${targetPath}" -Recurse -Force`);
              }
              // 直接复制src到targetPath
              await this.cmdService.runAsync(`Copy-Item -Path "${sourcePath}" -Destination "${targetPath}" -Recurse -Force`);
            } else {
              // For libraries without header files, copy each directory individually
              console.log(`库 ${lib} 不包含头文件，逐个复制目录`);
              // Get all directories in the source path
              if (window['fs'].existsSync(sourcePath)) {
                const items = window['fs'].readDirSync(sourcePath);

                // Process each directory
                for (const item of items) {
                  console.log("item: ", item);
                  const fullSourcePath = `${sourcePath}/${item.name}`;

                  // Check if it's a directory
                  if (window['fs'].isDirectory(fullSourcePath)) {
                    const targetPath = `${librariesPath}/${item.name}`;

                    // Delete target directory if it exists
                    if (window['path'].isExists(targetPath)) {
                      await this.cmdService.runAsync(`Remove-Item -Path "${targetPath}" -Recurse -Force`);
                    }

                    // Copy directory
                    await this.cmdService.runAsync(`Copy-Item -Path "${fullSourcePath}" -Destination "${targetPath}" -Recurse -Force`);
                    // console.log(`目录 ${item.name} 已复制到 ${targetPath}`);
                  }
                }
              }
            }
          }
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

        if (!compiler || !sdk) {
          throw new Error('未找到编译器或SDK信息');
        }

        // 组合编译器、sdk、tools的路径
        this.compilerPath = await window["env"].get('AILY_COMPILERS_PATH') + `/${compiler}`;
        this.sdkPath = await window["env"].get('AILY_SDK_PATH') + `/${sdk}`;
        this.toolsPath = await window["env"].get('AILY_TOOLS_PATH');

        // 获取编译命令
        let compilerParam = boardJson.compilerParam;
        if (!compilerParam) {
          throw new Error('未找到编译命令(compilerParam)');
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

        const compileCommand = `arduino-cli.exe ${compilerParam} --jobs 0 --libraries '${librariesPath}' --board-path '${this.sdkPath}' --compile-path '${this.compilerPath}' --tools-path '${this.toolsPath}' --output-dir '${this.buildPath}' --log-level debug '${sketchFilePath}'  --verbose`;
        
        const title = `编译 ${boardJson.name}`;
        const completeTitle = `编译完成`;

        let lastProgress = 0;
        let lastBuildText = '';
        let bufferData = '';

        this.cmdService.run(compileCommand).subscribe({
          next: (output: CmdOutput) => {
            // console.log('编译命令输出:', output);
            this.streamId = output.streamId;

            if (output.data) {
              const data = output.data;
              if (data.includes('\r\n') || data.includes('\n') || data.includes('\r')) {
                // 分割成行，同时处理所有三种换行符情况
                const lines = (bufferData + data).split(/\r\n|\n|\r/);
                // 最后一个可能不完整的行保留为新的bufferData
                bufferData = lines.pop() || '';
                // 处理完整的行
                // const completeLines = lines.join('\n');

                lines.forEach((line: string) => {
                  // 处理每一行输出
                  const trimmedLine = line.trim();

                  if (!trimmedLine) return; // 如果行为空，则跳过处理

                  // 检查是否有错误信息
                  if (/error:|error during build:|failed|fatal/i.test(trimmedLine)) {
                    console.error("检测到编译错误:", trimmedLine);
                    // 提取更有用的错误信息，避免过长
                    const errorMatch = trimmedLine.match(/error:(.+?)($|(\s+at\s+))/i);
                    const errorText = errorMatch ? errorMatch[1].trim() : trimmedLine;
                    this.handleCompileError(errorText);
                    return;
                  }
                  // 提取构建文本
                  if (trimmedLine.startsWith('BuildText:')) {
                    const lineContent = trimmedLine.replace('BuildText:', '').trim();
                    const buildText = lineContent.split(/[\n\r]/)[0];
                    lastBuildText = buildText;
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
                      progress: lastProgress,
                      setTimeout: 0,
                      stop: () => {
                        this.cancelBuild();
                      }
                    });
                  }

                  // 进度为100%时标记完成
                  if (lastProgress === 100) {
                    this.buildCompleted = true;
                  }
                });
              } else {
                // 没有换行符，直接追加
                bufferData += data;
              }
            } else {
              bufferData += '';
            }
          },
          error: (error: any) => {
            console.error('编译过程中发生错误:', error);
            this.handleCompileError(error.message);
            reject({ state: 'error', text: error.message });
          },
          complete: () => {
            if (this.buildCompleted) {
              console.log('编译命令执行完成');
              this.noticeService.update({ title: completeTitle, text: "编译完成", state: 'done', setTimeout: 55000 });
              this.buildInProgress = false;
              this.passed = true;
              resolve({ state: 'done', text: '编译完成' });
            } else if (this.isErrored) {
              console.error('编译过程中发生错误，编译未完成');
              this.noticeService.update({
                title: "编译",
                text: '编译失败',
                detail: '编译过程中发生错误，请查看日志',
                state: 'error',
                setTimeout: 55000
              });
              reject({ state: 'error', text: '编译失败' });
            } else {
              console.warn("编译中断")
              this.noticeService.update({
                title: "编译已取消",
                text: '编译已取消',
                state: 'warn',
                setTimeout: 55000
              });
              this.buildInProgress = false;
              this.passed = false;
              this.cancelled = true;
              reject({ state: 'warn', text: '编译已取消' });
            }
          }
        })
      } catch (error) {
        console.error('编译过程中发生错误:', error);
        this.handleCompileError(error.message);
        reject({ state: 'error', text: error.message });
      }
    });
  }

  /**
 * 取消当前编译过程
 */
  cancelBuild() {
    this.cmdService.kill(this.streamId || '');
  }
}
