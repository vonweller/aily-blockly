import { Injectable } from '@angular/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Subscription } from 'rxjs';
import { CmdOutput, CmdService } from './cmd.service';
import { CrossPlatformCmdService } from './cross-platform-cmd.service';
import { ProjectService } from './project.service';
import { ElectronService } from './electron.service';
import { WorkflowService, ProcessState } from './workflow.service';
import { NoticeService } from './notice.service';
import { PlatformService } from './platform.service';
import { ConfigService } from './config.service';
import { ActionState } from './ui.service';
import { CompileValidationService } from './compile-validation.service';

/**
 * Code Editor Pro 路由下无 Blockly 宿主，根 BuilderService 发出的 compile-begin 无人处理。
 * 本服务在含 project.aci 的 Aily Code 工程中，从磁盘入口文件读取源码并复用 child/scripts 的预处理与编译链。
 */
@Injectable({ providedIn: 'root' })
export class AilyCodeProCompileService {
  private cancelled = false;
  /** 当前 cmd 订阅，便于取消时清理 */
  private activeSub: Subscription | null = null;
  private activeStreamId: string | null = null;

  constructor(
    private projectService: ProjectService,
    private cmdService: CmdService,
    private crossPlatformCmdService: CrossPlatformCmdService,
    private electronService: ElectronService,
    private workflowService: WorkflowService,
    private noticeService: NoticeService,
    private platformService: PlatformService,
    private configService: ConfigService,
    private message: NzMessageService,
    private compileValidationService: CompileValidationService,
  ) { }

  /**
   * 用户点击「取消编译」时由 ActionService 转发调用。
   */
  cancel(): void {
    this.cancelled = true;
    if (this.activeStreamId) {
      void this.cmdService.kill(this.activeStreamId);
      this.activeStreamId = null;
    }
    if (this.activeSub) {
      this.activeSub.unsubscribe();
      this.activeSub = null;
    }
  }

  /**
   * 执行 Aily Code 磁盘编译；返回形态与 Blockly 侧 compile-begin 监听器一致。
   */
  async runCompileFromDisk(): Promise<{ success: boolean; result: ActionState & { fullStdErr?: string } }> {
    const root = this.projectService.currentProjectPath;
    const aciPath = this.electronService.pathJoin(root, 'project.aci');

    // 非 Aily Code 工程在 Pro 中无法走 Blockly 生成器，明确提示
    if (!root || !window['path'].isExists(aciPath)) {
      this.message.warning('当前为 Pro 编辑器：仅支持含 project.aci 的 Aily Code 工程在此编译。');
      return {
        success: false,
        result: { state: 'warn', text: '请使用 Blockly 工程或先创建 Aily Code 项目' },
      };
    }

    let code = '';
    let entryRel = 'src/main.cpp';
    try {
      const aci = JSON.parse(window['fs'].readFileSync(aciPath, 'utf8'));
      if (aci.entry && typeof aci.entry === 'string') {
        entryRel = aci.entry.replace(/\\/g, '/');
      }
      const segments = entryRel.split('/').filter(Boolean);
      const srcPath = this.electronService.pathJoin(root, ...segments);
      if (!window['path'].isExists(srcPath)) {
        return { success: false, result: { state: 'error', text: `入口文件不存在: ${entryRel}` } };
      }
      code = window['fs'].readFileSync(srcPath, 'utf8');
    } catch (e: any) {
      return { success: false, result: { state: 'error', text: e?.message || '读取工程配置失败' } };
    }

    if (!this.workflowService.startBuild()) {
      const state = this.workflowService.currentState;
      let msg = '系统繁忙';
      if (state === ProcessState.BUILDING) {
        msg = '编译正在进行中';
      } else if (state === ProcessState.UPLOADING) {
        msg = '上传正在进行中';
      } else if (state === ProcessState.INSTALLING) {
        msg = '依赖安装中';
      }
      this.message.warning(msg + '，请稍后再试');
      return { success: false, result: { state: 'warn', text: msg } };
    }

    this.cancelled = false;
    const started = Date.now();

    try {
      const boardModule = await this.projectService.getBoardModule();
      const boardName = boardModule.replace('@aily-project/board-', '');
      const ailyBuilderPath = window['path'].getAilyBuilderPath();
      const appDataPath = window['path'].getAppDataPath();
      const ailyChildPath = window['path'].getAilyChildPath();
      const tempPath = this.electronService.pathJoin(root, '.temp');
      const preprocessCachePath = this.electronService.pathJoin(tempPath, 'preprocess.json');

      if (!ailyBuilderPath || !ailyChildPath) {
        this.workflowService.finishBuild(false, 'Missing builder paths');
        return { success: false, result: { state: 'error', text: 'aily-builder 路径未就绪' } };
      }

      this.noticeService.update({
        title: `正在编译 ${boardName}`,
        text: 'Aily Code 构建',
        state: 'doing',
        progress: 0,
        setTimeout: 0,
        stop: () => this.cancel(),
      });

      // 写入 preprocess / compile 共用的配置文件（与 Blockly 侧结构一致）
      const buildConfig = {
        currentProjectPath: root,
        boardModule,
        code,
        appDataPath,
        za7Path: this.platformService.za7,
        ailyBuilderPath,
        devmode: this.configService.data.devmode || false,
        partitionFilePath: this.electronService.pathJoin(root, 'partitions.csv'),
      };
      const configFilePath = this.electronService.pathJoin(tempPath, 'build-config.json');
      if (!window['path'].isExists(tempPath)) {
        await this.crossPlatformCmdService.createDirectory(tempPath, true);
      }
      window['fs'].writeFileSync(configFilePath, JSON.stringify(buildConfig, null, 2));

      // 按需同步预处理（无缓存时才跑）
      if (!window['path'].isExists(preprocessCachePath)) {
        const preprocessScriptPath = this.electronService.pathJoin(ailyChildPath, 'scripts', 'preprocess.js');
        const preprocessCmd = `node "${preprocessScriptPath}" "${configFilePath}"`;
        const pre = await this.runOneShotCommand(preprocessCmd);
        if (this.cancelled) {
          this.workflowService.finishBuild(false, 'Cancelled');
          const sec = ((Date.now() - started) / 1000).toFixed(2);
          return { success: false, result: { state: 'warn', text: `编译已取消 (耗时: ${sec}s)` } };
        }
        if (pre.exitCode !== 0) {
          this.workflowService.finishBuild(false, 'Preprocess failed');
          this.handleFailNotice(pre.stderr + pre.stdout);
          return {
            success: false,
            result: { state: 'error', text: `预编译失败 (耗时: ${((Date.now() - started) / 1000).toFixed(2)}s)`, fullStdErr: pre.stderr + pre.stdout },
          };
        }
      }

      const compileScriptPath = this.electronService.pathJoin(ailyChildPath, 'scripts', 'compile.js');
      const compileCmd = `node "${compileScriptPath}" "${configFilePath}"`;
      const cmp = await this.runOneShotCommand(compileCmd);
      const buildDuration = ((Date.now() - started) / 1000).toFixed(2);

      if (this.cancelled) {
        this.workflowService.finishBuild(false, 'Cancelled');
        return { success: false, result: { state: 'warn', text: `编译已取消 (耗时: ${buildDuration}s)` } };
      }

      if (cmp.exitCode !== 0) {
        this.workflowService.finishBuild(false, 'Compile failed');
        this.handleFailNotice(cmp.stderr + cmp.stdout);
        return {
          success: false,
          result: { state: 'error', text: `编译失败 (耗时: ${buildDuration}s)`, fullStdErr: cmp.stderr + cmp.stdout },
        };
      }

      this.compileValidationService.triggerAfterSuccessfulCompile();
      this.workflowService.finishBuild(true);
      this.noticeService.update({
        title: '编译完成',
        text: `编译完成 (耗时: ${buildDuration}s)`,
        state: 'done',
        setTimeout: 600000,
      });

      return { success: true, result: { state: 'done', text: `编译完成 (耗时: ${buildDuration}s)` } };
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.workflowService.finishBuild(false, msg);
      this.message.error(msg);
      return { success: false, result: { state: 'error', text: msg, fullStdErr: msg } };
    }
  }

  private handleFailNotice(detail: string): void {
    const clean = (detail || '').replace(/\[\d+(;\d+)*m/g, '').trim().slice(0, 8000);
    this.noticeService.update({
      title: '编译失败',
      text: '请查看日志',
      state: 'error',
      detail: clean || '(无日志)',
      setTimeout: 600000,
      sendToLog: true,
    });
  }

  /** 跑一次子进程直至 Observable complete，汇总退出码与输出 */
  private runOneShotCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string; signal: string | null }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      let signal: string | null = null;

      const sub = this.cmdService.run(command, null, false).subscribe({
        next: (o: CmdOutput) => {
          if (!this.activeStreamId && o.streamId) {
            this.activeStreamId = o.streamId;
          }
          if (o.type === 'close') {
            exitCode = o.code ?? (o.signal ? 1 : 0);
            signal = o.signal || null;
          }
          if (o.type === 'error') {
            stderr += String(o.error || '');
          }
          if (o.data) {
            if (o.type === 'stderr') {
              stderr += o.data;
            } else {
              stdout += o.data;
            }
          }
        },
        error: (err) => reject(err),
        complete: () => {
          this.activeStreamId = null;
          sub.unsubscribe();
          this.activeSub = null;
          resolve({ exitCode, stdout, stderr, signal });
        },
      });
      this.activeSub = sub;
    });
  }
}
