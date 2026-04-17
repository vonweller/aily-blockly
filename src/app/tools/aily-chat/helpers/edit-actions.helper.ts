/**
 * EditActionsHelper — 编辑操作辅助类
 *
 * 封装所有与文件编辑检查点相关的操作：
 * - undo / redo / accept / reject 单文件操作
 * - restoreToCheckpoint（还原到指定对话检查点）
 * - editAndResendFromTurn（编辑并重发）
 * - regenerateTurn（重新生成）
 * - ensureAbsExport / saveCheckpointToDisk / reloadAbsWorkspace（内部辅助）
 *
 * 从 ChatEngineService 中提取（Phase 4），减轻后者的体积。
 */

import type { IChatContext } from '../core/chat-context';
import { AilyHost } from '../core/host';
import { mkError, mkState } from '../core/chat-parts';
import { ChatViewWriteBridge } from './chat-view-write-bridge';
import type { ChatPart } from '../core/chat-parts';
import { syncAbsFileHandler } from '../tools/syncAbsFileTool';
import type { ResourceItem } from '../core/chat-types';

export class EditActionsHelper {
  private readonly viewWriteBridge: ChatViewWriteBridge;

  constructor(private ctx: IChatContext) {
    this.viewWriteBridge = new ChatViewWriteBridge(ctx);
  }

  // ==================== 内部辅助 ====================

  /**
   * 确保 absAutoSyncService 已初始化并执行导出
   */
  ensureAbsExport(): void {
    const projectPath = this.ctx.getCurrentProjectPath()
      || AilyHost.get().project.currentProjectPath
      || AilyHost.get().project.projectRootPath;
    if (projectPath) {
      this.ctx.absAutoSyncService.initialize(projectPath);
    }
    this.ctx.absAutoSyncService.exportToAbs().catch((err: any) => {
      console.warn('[ChatEngine] ABS 自动导出失败:', err);
    });
  }

  /**
   * Turn 开始前提交并持久化前一轮的 checkpoint 数据到磁盘。
   * 确保前一轮的快照不因崩溃而丢失。
   */
  saveCheckpointToDisk(): void {
    if (this.ctx.editCheckpointService.getTotalEditCount() === 0) return;
    try {
      this.ctx.editCheckpointService.commitCurrentTurn();
    } catch (err) {
      console.warn('[ChatEngine] checkpoint commit before turn failed:', err);
    }
  }

  /**
   * 回滚/还原后重新同步 ABS 到 Blockly 工作区。
   */
  private async reloadAbsWorkspace(): Promise<void> {
    const projectPath = this.ctx.getCurrentProjectPath()
      || AilyHost.get().project.currentProjectPath
      || AilyHost.get().project.projectRootPath;
    if (projectPath) {
      this.ctx.absAutoSyncService.initialize(projectPath);
    }
    try {
      const fsCompat = {
        exists: (p: string) => AilyHost.get().fs.existsSync(p),
        readFile: (p: string) => AilyHost.get().fs.readFileSync(p, 'utf-8'),
        writeFile: (p: string, data: string) => AilyHost.get().fs.writeFileSync(p, data),
      };
      const result = await syncAbsFileHandler(
        { operation: 'import' },
        AilyHost.get().project,
        fsCompat,
        this.ctx.absAutoSyncService
      );
      if (result.is_error) {
        console.warn('[reloadAbsWorkspace] ABS 导入失败:', result.content);
      }
    } catch (err) {
      console.warn('[reloadAbsWorkspace] ABS 导入异常:', err);
    }
  }

  private appendEditActionResult(
    action: 'undo' | 'redo' | 'restore',
    summaryText: string,
    state: 'done' | 'warn' | 'error' | 'info',
    options: {
      fileCount?: number;
      errorCount?: number;
      detailMessage?: string;
    } = {},
  ): void {
      const parts: ChatPart[] = [
      mkState(
        `edit-action-${action}-${Date.now()}`,
        summaryText,
        state,
        undefined,
        undefined,
        {
          action,
          fileCount: options.fileCount,
          errorCount: options.errorCount,
        },
      ),
    ];

    if (options.detailMessage) {
      parts.push(mkError(options.detailMessage));
    }

    this.viewWriteBridge.appendAilyPartsMessage(parts, { scroll: true });
  }

  private formatEditErrorDetail(errors: string[]): string | undefined {
    if (errors.length === 0) return undefined;
    const lines = errors.slice(0, 3).map((error, index) => `${index + 1}. ${error}`);
    return `以下操作失败（最多显示 3 条）：\n${lines.join('\n')}`;
  }

  private truncateUiList(fromIndex: number): void {
    this.viewWriteBridge.truncateFrom(fromIndex);
  }

  // ==================== 编辑检查点操作 ====================

  /**
   * 用户保留文件变更 — 将当前状态设为新基线，保存反馈状态
   */
  onKeepEdits(detail: any): void {
    const { fileCount, totalAdded, totalRemoved } = detail || {};
    this.ctx.pendingEditFeedback = `[用户已确认保留上一轮的文件变更：${fileCount || 0} 个文件，+${totalAdded || 0} / -${totalRemoved || 0} 行]`;
    this.ctx.editCheckpointService.acceptAllAsBaseline();
  }

  /**
   * 撤销最近一轮的文件变更（Undo，不截断对话历史，支持 Redo）
   */
  async undoLastEdits(): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }

    if (!this.ctx.editCheckpointService.canUndo) {
      this.ctx.message.info('没有可撤销的文件变更');
      return;
    }

    const { rolledBackFiles, errors } = await this.ctx.editCheckpointService.undo();

    this.ctx.pendingEditFeedback = `[用户撤销了上一轮的 ${rolledBackFiles} 个文件变更，文件已恢复到变更前的状态。后续操作请基于当前文件内容进行。]`;

    if (errors.length > 0) {
      this.appendEditActionResult(
        'undo',
        `已撤销 ${rolledBackFiles} 个文件变更，另有 ${errors.length} 个错误`,
        'warn',
        {
          fileCount: rolledBackFiles,
          errorCount: errors.length,
          detailMessage: this.formatEditErrorDetail(errors),
        },
      );
    } else {
      this.appendEditActionResult('undo', `已撤销 ${rolledBackFiles} 个文件变更`, 'done', {
        fileCount: rolledBackFiles,
      });
    }

    await this.reloadAbsWorkspace();
  }

  /**
   * 重做文件变更（Redo，恢复被撤销的文件状态）
   */
  async redoEdits(): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }

    if (!this.ctx.editCheckpointService.canRedo) {
      this.ctx.message.info('没有可重做的文件变更');
      return;
    }

    const { rolledBackFiles, errors } = await this.ctx.editCheckpointService.redo();

    this.ctx.pendingEditFeedback = `[用户重新应用了 ${rolledBackFiles} 个文件变更。]`;

    if (errors.length > 0) {
      this.appendEditActionResult(
        'redo',
        `已重做 ${rolledBackFiles} 个文件变更，另有 ${errors.length} 个错误`,
        'warn',
        {
          fileCount: rolledBackFiles,
          errorCount: errors.length,
          detailMessage: this.formatEditErrorDetail(errors),
        },
      );
    } else {
      this.appendEditActionResult('redo', `已重做 ${rolledBackFiles} 个文件变更`, 'done', {
        fileCount: rolledBackFiles,
      });
    }

    this.ctx.editCheckpointService.publishCurrentSummary();
    await this.reloadAbsWorkspace();
  }

  /**
   * 接受单个文件的 AI 编辑
   */
  onAcceptFile(filePath: string): void {
    if (!filePath) return;
    this.ctx.editCheckpointService.acceptFile(filePath);
    this.ctx.editCheckpointService.publishCurrentSummary();
  }

  /**
   * 拒绝单个文件的 AI 编辑（恢复到初始内容）
   */
  async onRejectFile(filePath: string): Promise<void> {
    if (!filePath) return;
    await this.ctx.editCheckpointService.rejectFile(filePath);
    this.ctx.editCheckpointService.publishCurrentSummary();
    await this.reloadAbsWorkspace();
  }

  async restoreToCheckpoint(listIndex: number, options: { emitResultMessage?: boolean } = {}): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }
    const { emitResultMessage = true } = options;

    const target = this.ctx.editCheckpointService.getSnapshotByListIndex(listIndex);
    if (!target) {
      this.ctx.message.info('未找到该消息对应的检查点');
      return;
    }

    const { rolledBackFiles, errors } = await this.ctx.editCheckpointService.truncateFromSnapshot(target.requestId);
    if (errors.length > 0) {
      console.warn('[restoreToCheckpoint] 回滚文件部分失败:', errors);
    }

    await this.reloadAbsWorkspace();

    if (target.turnId) {
      this.ctx.lexStream.turns.removeFrom(target.turnId);
    }

    this.truncateUiList(listIndex);

    this.ctx.isCompleted = false;
    this.ctx.isCancelled = false;
    this.ctx.editCheckpointService.dismissSummary();

    if (!emitResultMessage) {
      return;
    }

    if (errors.length > 0) {
      this.appendEditActionResult(
        'restore',
        rolledBackFiles > 0
          ? `已还原检查点，回滚了 ${rolledBackFiles} 个文件变更，另有 ${errors.length} 个错误`
          : `已还原检查点，但有 ${errors.length} 个错误`,
        'warn',
        {
          fileCount: rolledBackFiles,
          errorCount: errors.length,
          detailMessage: this.formatEditErrorDetail(errors),
        },
      );
      return;
    }

    if (rolledBackFiles > 0) {
      this.appendEditActionResult('restore', `已还原检查点，回滚了 ${rolledBackFiles} 个文件变更`, 'done', {
        fileCount: rolledBackFiles,
      });
    }
  }

  /**
   * 编辑并重新发送 — 回滚到指定消息的检查点 + 用新内容重新发送
   */
  async editAndResendFromTurn(listIndex: number, newText: string, resources: ResourceItem[]): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }
    await this.restoreToCheckpoint(listIndex, { emitResultMessage: false });

    this.ctx.resourceManager.items = resources;
    await this.ctx.send('user', newText, false);
    this.ctx.resourceManager.mergePathsTo(this.ctx.sessionAllowedPaths);
    this.ctx.resourceManager.items = [];

    this.ctx.scrollManager.autoScrollEnabled = true;
    this.ctx.scrollManager.scrollToBottom();
  }

  /**
   * 重新生成 — 回滚文件变更 + 截断对话历史 + 重新发送
   * @param checkpointId 可选，指定从哪个 checkpoint 开始回滚（默认最新）
   */
  async regenerateTurn(checkpointId?: string): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }
    if (!this.ctx.sessionId) { this.ctx.message.warning('会话不存在，请开始新对话'); return; }

    // 1. 找到目标快照
    const target = checkpointId
      ? this.ctx.editCheckpointService.getSnapshotByRequestId(checkpointId)
      : this.ctx.editCheckpointService.getLatestSnapshot();

    if (!target) {
      await this.ctx.send('user', '请重试上次的操作。', false);
      return;
    }

    // 2. 回滚文件变更并截断时间线
    if (target.hasFileEdits) {
      const { rolledBackFiles, errors } = await this.ctx.editCheckpointService.truncateFromSnapshot(target.requestId);
      if (errors.length > 0) {
        console.warn('[Regenerate] 回滚文件部分失败:', errors);
      }
      console.log(`[Regenerate] 回滚了 ${rolledBackFiles} 个文件变更`);
    }

    // 3. Turn-native 截断
    if (target.turnId) {
      this.ctx.lexStream.turns.restartFrom(target.turnId);
    }

    // 4. 截断 UI list
    const listCutIndex = target.listStartIndex;
    this.truncateUiList(listCutIndex);

    // 5. 重新发起 turn
    const msgs = this.ctx.conversationMessages;
    const lastUserMsg = msgs.length > 0 && msgs[msgs.length - 1].role === 'user'
      ? msgs[msgs.length - 1].content : '请重试上次的操作。';
    this.ctx.lexStream.turn.begin(lastUserMsg);
    this.ctx.lexStream.turn.run(lastUserMsg);
  }
}
