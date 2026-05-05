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

import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import { AilyHost } from '../core/host';
import { mkError, mkState } from '../core/chat-parts';
import { ChatViewWriteBridge, type ChatViewWriteBridgeContext } from './chat-view-write-bridge';
import type { ChatPart } from '../core/chat-parts';
import { syncAbsFileHandler } from '../tools/syncAbsFileTool';
import type { TurnResponseTurn } from 'aily-lex/browser';
import type { ResourceItem } from '../core/chat-types';
import {
  buildDialogTurnContext,
  getInteractionDisplayContent,
  getInteractionLastRoundId,
  getInteractionRequestContent,
  getInteractionRoundCount,
  getInteractionRounds,
  getInteractionToolCallCount,
  toDialogTurnContext,
  type DialogTurnContext,
  type LegacyTurnInteractionMetadata,
} from '../core/user-turn-action-target';
import { extractUserTurnResources, mergeUserTurnResources } from './chat-user-turn-context';
import type { ChatTaskActionDetail } from './chat-task-action-coordinator';
import type { TurnSnapshot } from '../services/edit-checkpoint.service';
import {
  buildHostProjectionStateFromPersistedRecord,
  buildTurnNativeRestoreChatList,
  type HostTurnResponseState,
} from './host-turn-response-state';
import { projectTurnResponsesToHistory } from './turn-response-history-projector';

export interface EditActionTurnTarget extends Partial<LegacyTurnInteractionMetadata>, Partial<DialogTurnContext> {}

type EditActionsContext = ChatViewWriteBridgeContext
  & Pick<IAgentLifecycle, 'isWaiting' | 'isCompleted' | 'isCancelled' | 'pendingEditFeedback'>
  & Pick<ISessionAccess, 'sessionAllowedPaths' | 'conversationMessages'>
  & Pick<IProjectContext, 'getCurrentProjectPath'>
  & Pick<IChatServiceAccess, 'absAutoSyncService' | 'editCheckpointService' | 'resourceManager' | 'message'>
  & Pick<IChatCoordination, 'lexStream' | 'send' | 'session'>
  & {
    replaceSharedHostProjectionState?(state: HostTurnResponseState | null): void;
  };

type EditActionsViewWriteContext = ConstructorParameters<typeof ChatViewWriteBridge>[0];

type EditActionsViewWriteAccess = Pick<
  ChatViewWriteBridge,
  'appendAilyPartsMessageHandle' | 'truncateFromTurnId' | 'truncateFrom' | 'restoreLegacyHistoryList' | 'restoreTurnNativeHistoryList'
>;

export class EditActionsHelper {
  private readonly viewWriteBridge: EditActionsViewWriteAccess;

  constructor(private ctx: EditActionsContext) {
    const viewWriteContext: EditActionsViewWriteContext = {
      get list() {
        return ctx.list;
      },
      set list(list) {
        ctx.list = list;
      },
      get partStore() {
        return ctx.partStore;
      },
      get viewAdapter() {
        return ctx.viewAdapter;
      },
      get scrollManager() {
        return ctx.scrollManager;
      },
      get invalidateHostRequestGraph() {
        return ctx.invalidateHostRequestGraph;
      },
      get triggerSyncDetectChanges() {
        return ctx.triggerSyncDetectChanges;
      },
      get sessionId() {
        return ctx.sessionId;
      },
      get chatHistoryService() {
        return ctx.chatHistoryService;
      },
      get currentModelName() {
        return ctx.currentModelName;
      },
      get currentMessageSource() {
        return ctx.currentMessageSource;
      },
      get ngZone() {
        return ctx.ngZone;
      },
    };
    this.viewWriteBridge = new ChatViewWriteBridge(viewWriteContext);
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

    this.viewWriteBridge.appendAilyPartsMessageHandle(parts, { scroll: true });
  }

  private formatEditErrorDetail(errors: string[]): string | undefined {
    if (errors.length === 0) return undefined;
    const lines = errors.slice(0, 3).map((error, index) => `${index + 1}. ${error}`);
    return `以下操作失败（最多显示 3 条）：\n${lines.join('\n')}`;
  }

  private truncateUiList(fromIndex: number | undefined, turnId?: string): void {
    if (turnId && this.viewWriteBridge.truncateFromTurnId(turnId)) {
      return;
    }

    if (typeof fromIndex === 'number') {
      this.viewWriteBridge.truncateFrom(fromIndex);
    }
  }

  private truncateLiveTurnResponsesFromTurnId(turnId: string | undefined): void {
    if (!turnId || !this.ctx.lexStream.hydrateTurnResponses) {
      return;
    }

    const liveTurnResponses = this.ctx.lexStream.turnResponses;
    if (!Array.isArray(liveTurnResponses) || liveTurnResponses.length === 0) {
      return;
    }

    const truncateIndex = liveTurnResponses.findIndex(turn => turn.turnId === turnId);
    if (truncateIndex < 0) {
      return;
    }

    this.ctx.lexStream.hydrateTurnResponses(liveTurnResponses.slice(0, truncateIndex));
    this.ctx.invalidateHostRequestGraph?.();
    this.ctx.triggerSyncDetectChanges();
  }

  private captureCheckpointRestoreRedoTurns(turnId: string | undefined): void {
    const setRedoTurns = this.ctx.editCheckpointService.setCheckpointRestoreRedoTurnResponses?.bind(this.ctx.editCheckpointService);
    if (!setRedoTurns) {
      return;
    }

    const liveTurnResponses = Array.isArray(this.ctx.lexStream.turnResponses)
      ? this.ctx.lexStream.turnResponses
      : [];

    if (!turnId || liveTurnResponses.length === 0) {
      setRedoTurns(null);
      return;
    }

    const truncateIndex = liveTurnResponses.findIndex(turn => turn.turnId === turnId);
    if (truncateIndex < 0) {
      setRedoTurns(null);
      return;
    }

    setRedoTurns(liveTurnResponses.slice());
  }

  private buildRedoActionSummary(fileCount: number, chatTurnCount: number): string {
    const segments: string[] = [];

    if (fileCount > 0) {
      segments.push(`${fileCount} 个文件变更`);
    }

    if (chatTurnCount > 0) {
      segments.push(`${chatTurnCount} 轮聊天`);
    }

    if (segments.length === 0) {
      return '已重做还原前的状态';
    }

    return `已重做 ${segments.join('和')}`;
  }

  private async restoreCheckpointRedoChat(turnResponses: readonly TurnResponseTurn[]): Promise<void> {
    const restoredLexSession = await this.ctx.lexStream.session.restore?.(
      this.ctx.sessionId,
      turnResponses,
    );

    this.ctx.lexStream.hydrateTurnResponses?.(turnResponses);

    const hostResponseState = buildHostProjectionStateFromPersistedRecord({
      turnResponses,
    });
    this.ctx.replaceSharedHostProjectionState?.(hostResponseState);

    if (hostResponseState.turnResponses.length === 0) {
      this.viewWriteBridge.restoreLegacyHistoryList(hostResponseState.chatList);
    } else {
      const turnIds = new Set(hostResponseState.turnResponses.map(turn => turn.turnId));
      this.viewWriteBridge.restoreTurnNativeHistoryList(
        buildTurnNativeRestoreChatList(hostResponseState.chatList, turnIds),
        turnIds,
      );
      projectTurnResponsesToHistory(this.ctx, hostResponseState.turnResponses);
    }

    await this.ctx.editCheckpointService.rebuildFromTurnResponses?.(hostResponseState.turnResponses);
    this.ctx.editCheckpointService.clearCheckpointRestoreRedoTurnResponses?.();
    this.ctx.editCheckpointService.publishCurrentSummary();
    this.ctx.session.saveCurrentSession();

    if (!restoredLexSession) {
      console.warn('[redoEdits] lex session restore returned false while replaying checkpoint chat');
    }
  }

  private getCheckpointIdFromTurnResponses(turnResponses: readonly TurnResponseTurn[]): string | null {
    const checkpointId = turnResponses.at(-1)?.request?.metadata?.checkpointId;
    return typeof checkpointId === 'string' && checkpointId.length > 0 ? checkpointId : null;
  }

  private async applyCheckpointRedoFiles(turnResponses: readonly TurnResponseTurn[]) {
    const checkpointId = this.getCheckpointIdFromTurnResponses(turnResponses);
    const buildRedoPlan = this.ctx.editCheckpointService.buildRedoPlanForCheckpoint?.bind(this.ctx.editCheckpointService);
    const applyRestorePlan = this.ctx.editCheckpointService.applyRestorePlan?.bind(this.ctx.editCheckpointService);

    if (!checkpointId || !buildRedoPlan || !applyRestorePlan) {
      return { rolledBackFiles: 0, errors: ['checkpoint redo timeline plan 不可用'] };
    }

    const restorePlan = await buildRedoPlan(checkpointId);
    if (!restorePlan) {
      return { rolledBackFiles: 0, errors: [`未找到检查点 redo plan: ${checkpointId}`] };
    }

    return applyRestorePlan(restorePlan);
  }

  private async applyCheckpointRestoreFiles(checkpointId: string) {
    const buildRestorePlan = this.ctx.editCheckpointService.buildRestorePlanForCheckpoint?.bind(this.ctx.editCheckpointService);
    const applyRestorePlan = this.ctx.editCheckpointService.applyRestorePlan?.bind(this.ctx.editCheckpointService);

    if (!buildRestorePlan || !applyRestorePlan) {
      return { rolledBackFiles: 0, errors: ['checkpoint restore timeline plan 不可用'] };
    }

    const restorePlan = await buildRestorePlan(checkpointId);
    if (!restorePlan) {
      return { rolledBackFiles: 0, errors: [`未找到检查点 restore plan: ${checkpointId}`] };
    }

    return applyRestorePlan(restorePlan);
  }

  private toCanonicalTurnContext(target: EditActionTurnTarget | null | undefined): DialogTurnContext | null {
    if (!target) {
      return null;
    }

    const turnResponse = target.turnResponse ?? null;
    const request = target.request ?? turnResponse?.request ?? undefined;
    const canonical = buildDialogTurnContext({
      turnId: turnResponse?.turnId ?? target.turnId,
      turnResponse,
      request,
      response: target.response ?? turnResponse?.response ?? undefined,
      rounds: target.rounds ?? turnResponse?.rounds,
      requestContent: request?.content ?? target.requestContent,
      displayContent: request?.displayContent ?? target.displayContent ?? request?.content ?? target.requestContent,
    });

    if (!canonical) {
      return null;
    }

    return {
      ...canonical,
      lastRoundId: canonical.rounds.at(-1)?.id ?? target.lastRoundId ?? canonical.lastRoundId,
    };
  }

  private withResolvedTurnTarget(
    target: EditActionTurnTarget | null | undefined,
    overrides: {
      turnId?: string;
      requestContent?: string;
      displayContent?: string;
      lastRoundId?: string;
    },
  ): EditActionTurnTarget {
    const canonical = this.toCanonicalTurnContext(target);
    const rebuilt = buildDialogTurnContext({
      turnId: overrides.turnId ?? canonical?.turnId ?? target?.turnId,
      turnResponse: canonical?.turnResponse ?? target?.turnResponse ?? null,
      request: canonical?.request,
      response: canonical?.response,
      rounds: canonical?.rounds,
      requestContent: overrides.requestContent ?? canonical?.requestContent ?? target?.requestContent,
      displayContent: overrides.displayContent ?? canonical?.displayContent ?? target?.displayContent,
    });

    if (rebuilt) {
      return {
        ...rebuilt,
        lastRoundId: overrides.lastRoundId ?? canonical?.lastRoundId ?? rebuilt.lastRoundId,
      };
    }

    return {
      ...(target ?? {}),
      turnId: overrides.turnId ?? target?.turnId,
      requestContent: overrides.requestContent ?? target?.requestContent,
      displayContent: overrides.displayContent ?? target?.displayContent,
      lastRoundId: overrides.lastRoundId ?? target?.lastRoundId,
    };
  }

  private resolveTurnTarget(target: EditActionTurnTarget | null | undefined): {
    snapshot: TurnSnapshot | undefined;
    listIndex: number | undefined;
    turnId: string | undefined;
    requestContent: string | undefined;
    displayContent: string | undefined;
    lastRoundId: string | undefined;
  } {
    const normalized = target ?? {};
    const liveTurnResponses = Array.isArray(this.ctx.lexStream.turnResponses)
      ? this.ctx.lexStream.turnResponses
      : [];
    const isLiveTurnId = (turnId: string | undefined): turnId is string => !!turnId && (
      liveTurnResponses.some(turn => turn.turnId === turnId)
      || this.findTurnMessageIndex(turnId) !== undefined
    );
    const interactionContext = this.toCanonicalTurnContext(normalized);
    const targetRoundId = interactionContext?.lastRoundId
      ?? normalized.lastRoundId
      ?? getInteractionLastRoundId(normalized);
    const directTurnId = interactionContext?.turnId ?? normalized.turnId;
    const roundSnapshot = targetRoundId
      ? this.ctx.editCheckpointService.getSnapshotByRoundId?.(targetRoundId)
      : undefined;
    const roundTurnId = targetRoundId
      ? (roundSnapshot?.turnId ?? this.ctx.lexStream.turns.turnIdByRound(targetRoundId))
      : undefined;

    const directSnapshot = directTurnId
      ? this.ctx.editCheckpointService.getSnapshotByTurnId(directTurnId)
      : undefined;
    const resolvedRoundSnapshot = directSnapshot ? undefined : (roundSnapshot ?? (roundTurnId
      ? this.ctx.editCheckpointService.getSnapshotByTurnId(roundTurnId)
      : undefined));
    const resolvedSnapshotCandidate = directSnapshot ?? resolvedRoundSnapshot;
    const resolvedSnapshot = this.ctx.editCheckpointService.isSnapshotActive?.(resolvedSnapshotCandidate) === false
      ? undefined
      : resolvedSnapshotCandidate;
    const resolvedSnapshotTurnId = isLiveTurnId(directTurnId)
      ? directTurnId
      : (isLiveTurnId(roundTurnId) ? roundTurnId : resolvedSnapshot?.turnId);
    const snapshotContext = this.ctx.editCheckpointService.getTurnContextForSnapshot(
      resolvedSnapshot,
      resolvedSnapshotTurnId,
    );
    const resolvedTurnId = resolvedSnapshotTurnId ?? snapshotContext?.turnId;
    const listIndex = this.findTurnMessageIndex(resolvedTurnId)
      ?? (this.ctx.editCheckpointService.getTurnStartListIndexForSnapshot(resolvedSnapshot) ?? undefined);
    const requestContent = interactionContext?.requestContent
      ?? getInteractionRequestContent(normalized)
      ?? snapshotContext?.requestContent
      ?? (resolvedTurnId ? this.ctx.lexStream.turns.requestContent(resolvedTurnId) : undefined);
    const displayContent = interactionContext?.displayContent
      ?? getInteractionDisplayContent(normalized)
      ?? snapshotContext?.displayContent
      ?? (resolvedTurnId ? this.ctx.lexStream.turns.requestContent(resolvedTurnId) : undefined);
    const lastRoundId = targetRoundId
      ?? snapshotContext?.lastRoundId
      ?? (resolvedTurnId ? this.ctx.lexStream.turns.lastRoundId(resolvedTurnId) : undefined);

    return {
      snapshot: resolvedSnapshot,
      listIndex,
      turnId: resolvedTurnId,
      requestContent,
      displayContent,
      lastRoundId,
    };
  }

  private async resolveTurnTargetWithCheckpointSync(
    target: EditActionTurnTarget | null | undefined,
  ): Promise<{
    snapshot: TurnSnapshot | undefined;
    listIndex: number | undefined;
    turnId: string | undefined;
    requestContent: string | undefined;
    displayContent: string | undefined;
    lastRoundId: string | undefined;
  }> {
    let resolved = this.resolveTurnTarget(target);
    if (resolved.snapshot || !this.ctx.editCheckpointService.rebuildFromTurnResponses) {
      return resolved;
    }

    const liveTurnResponses = this.ctx.lexStream.turnResponses;
    if (!Array.isArray(liveTurnResponses) || liveTurnResponses.length === 0) {
      return resolved;
    }

    await this.ctx.editCheckpointService.rebuildFromTurnResponses(liveTurnResponses);
    resolved = this.resolveTurnTarget(target);
    return resolved;
  }

  private findTurnMessageIndex(turnId: string | undefined): number | undefined {
    if (!turnId) {
      return undefined;
    }

    const userIndex = this.ctx.list.findIndex(message => message.role === 'user' && message.turnId === turnId);
    if (userIndex >= 0) {
      return userIndex;
    }

    const assistantIndex = this.ctx.list.findIndex(message => message.turnId === turnId);
    return assistantIndex >= 0 ? assistantIndex : undefined;
  }

  private getTurnRoundExecutionContext(rounds: EditActionTurnTarget['rounds'] | undefined): {
    toolBearingRoundCount: number;
    lastRoundId: string | null;
    lastAssistantPreview: string | null;
  } {
    const resolvedRounds = rounds ?? [];
    const toolBearingRoundCount = resolvedRounds.reduce(
      (count, round) => count + (round.toolCalls.length > 0 ? 1 : 0),
      0,
    );

    let lastAssistantPreview: string | null = null;
    for (let index = resolvedRounds.length - 1; index >= 0; index--) {
      const normalized = resolvedRounds[index].assistantText.replace(/\s+/g, ' ').trim();
      if (normalized) {
        lastAssistantPreview = normalized.length > 96
          ? `${normalized.slice(0, 96).trimEnd()}...`
          : normalized;
        break;
      }
    }

    return {
      toolBearingRoundCount,
      lastRoundId: resolvedRounds.at(-1)?.id ?? null,
      lastAssistantPreview,
    };
  }

  private describeTurnExecution(target: EditActionTurnTarget): {
    segments: string[];
    detailText: string;
  } | null {
    const rounds = getInteractionRounds(target);
    const roundCount = getInteractionRoundCount(target);
    const toolCallCount = getInteractionToolCallCount(target);
    const roundContext = this.getTurnRoundExecutionContext(rounds);
    const lastRoundId = getInteractionLastRoundId(target) ?? roundContext.lastRoundId;

    if (roundCount <= 0 && toolCallCount <= 0 && !lastRoundId && !roundContext.lastAssistantPreview) {
      return null;
    }

    const segments: string[] = [];
    if (roundCount > 0) {
      segments.push(`${roundCount} 轮执行`);
    }
    if (roundContext.toolBearingRoundCount > 0) {
      segments.push(`${roundContext.toolBearingRoundCount} 个工具轮次`);
    }
    if (toolCallCount > 0) {
      segments.push(`${toolCallCount} 次工具调用`);
    }
    if (segments.length === 0) {
      segments.push('历史执行');
    }

    const details: string[] = [];
    if (lastRoundId) {
      details.push(`最后执行锚点为 ${lastRoundId}`);
    }
    if (roundContext.lastAssistantPreview) {
      details.push(`上一轮 assistant 已执行到“${roundContext.lastAssistantPreview}”`);
    }

    return {
      segments,
      detailText: details.length > 0 ? `${details.join('；')}。` : '',
    };
  }

  private buildEditResendFeedback(target: EditActionTurnTarget): string | null {
    const execution = this.describeTurnExecution(target);
    if (!execution) {
      return null;
    }

    return `[用户正在重写一个已执行 ${execution.segments.join(' / ')} 的历史请求，之前该轮的执行结果已回滚。${execution.detailText}后续回复请仅基于当前工作区状态、本轮附加资源和新的用户输入继续。]`;
  }

  private buildRegenerateRequest(requestContent: string, target: EditActionTurnTarget): string {
    const execution = this.describeTurnExecution(target);
    if (!execution) {
      return requestContent;
    }

    return `[用户要求重新生成一个已执行 ${execution.segments.join(' / ')} 的历史请求，相关执行结果和文件变更已回滚。${execution.detailText}请沿用该轮原始请求上下文重新继续，不要引用已回滚的旧结果。]\n${requestContent}`;
  }

  private buildUserVisibleRequestPreview(content: string | undefined): string | null {
    const normalized = (content ?? '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    return normalized.length > 48
      ? `${normalized.slice(0, 48).trimEnd()}...`
      : normalized;
  }

  // ==================== 编辑检查点操作 ====================

  /**
   * 用户保留文件变更 — 将当前状态设为新基线，保存反馈状态
   */
  onKeepEdits(detail?: ChatTaskActionDetail): void {
    const { fileCount, totalAdded, totalRemoved } = detail || {};
    const displayContent = this.buildUserVisibleRequestPreview(getInteractionDisplayContent(detail?.target));
    const requestHint = displayContent ? `与“${displayContent}”关联的` : '上一轮的';
    this.ctx.pendingEditFeedback = `[用户已确认保留${requestHint}文件变更：${fileCount || 0} 个文件，+${totalAdded || 0} / -${totalRemoved || 0} 行]`;
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

    const checkpointRedoTurnResponses = this.ctx.editCheckpointService.getCheckpointRestoreRedoTurnResponses?.() ?? [];
    const hasCheckpointRedoChat = checkpointRedoTurnResponses.length > 0;

    if (!hasCheckpointRedoChat && !this.ctx.editCheckpointService.canRedo) {
      this.ctx.message.info('没有可重做的文件变更');
      return;
    }

    const fileRedoResult = hasCheckpointRedoChat
      ? await this.applyCheckpointRedoFiles(checkpointRedoTurnResponses)
      : await this.ctx.editCheckpointService.redo();
    const errors = [...fileRedoResult.errors];

    if (hasCheckpointRedoChat) {
      try {
        await this.restoreCheckpointRedoChat(checkpointRedoTurnResponses);
      } catch (err: any) {
        errors.push(err?.message || '恢复聊天历史失败');
      }
    }

    const rolledBackFiles = fileRedoResult.rolledBackFiles;
    const chatTurnCount = hasCheckpointRedoChat ? checkpointRedoTurnResponses.length : 0;

    this.ctx.pendingEditFeedback = hasCheckpointRedoChat
      ? `[用户重新应用了 ${rolledBackFiles} 个文件变更，并恢复了 ${chatTurnCount} 轮聊天。]`
      : `[用户重新应用了 ${rolledBackFiles} 个文件变更。]`;

    const summaryText = hasCheckpointRedoChat
      ? this.buildRedoActionSummary(rolledBackFiles, chatTurnCount)
      : `已重做 ${rolledBackFiles} 个文件变更`;

    if (errors.length > 0) {
      this.appendEditActionResult(
        'redo',
        `${summaryText}，另有 ${errors.length} 个错误`,
        'warn',
        {
          fileCount: rolledBackFiles,
          errorCount: errors.length,
          detailMessage: this.formatEditErrorDetail(errors),
        },
      );
    } else {
      this.appendEditActionResult('redo', summaryText, 'done', {
        fileCount: rolledBackFiles,
      });
    }

    if (!hasCheckpointRedoChat) {
      this.ctx.editCheckpointService.publishCurrentSummary();
    }
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

  async restoreToCheckpoint(target: EditActionTurnTarget | null | undefined, options: { emitResultMessage?: boolean } = {}): Promise<boolean> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return false; }
    const { emitResultMessage = true } = options;

    const resolved = await this.resolveTurnTargetWithCheckpointSync(target);
    if (!resolved.snapshot || (resolved.listIndex === undefined && !resolved.turnId)) {
      this.ctx.message.info('未找到该消息对应的检查点');
      return false;
    }

    const { rolledBackFiles, errors } = await this.applyCheckpointRestoreFiles(resolved.snapshot.checkpointId);
    if (errors.length > 0) {
      console.warn('[restoreToCheckpoint] 回滚文件部分失败:', errors);
    }

    await this.reloadAbsWorkspace();

    this.ctx.editCheckpointService.truncateStateFromCheckpoint?.(resolved.snapshot.checkpointId);

    const truncatedTurnId = resolved.turnId ?? resolved.snapshot.turnId;
    this.captureCheckpointRestoreRedoTurns(truncatedTurnId);
    if (truncatedTurnId) {
      this.ctx.lexStream.turns.removeFrom(truncatedTurnId);
      this.truncateLiveTurnResponsesFromTurnId(truncatedTurnId);
    }

    this.truncateUiList(resolved.listIndex, truncatedTurnId);

    this.ctx.isCompleted = false;
    this.ctx.isCancelled = false;
    this.ctx.editCheckpointService.dismissSummary();
    this.ctx.session.saveCurrentSession();

    if (!emitResultMessage) {
      return true;
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
      return true;
    }

    if (rolledBackFiles > 0) {
      this.appendEditActionResult('restore', `已还原检查点，回滚了 ${rolledBackFiles} 个文件变更`, 'done', {
        fileCount: rolledBackFiles,
      });
    }

    return true;
  }

  async forkSessionFromTurn(target: EditActionTurnTarget | null | undefined): Promise<boolean> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return false; }

    const normalized = target ?? {};
    const resolved = this.resolveTurnTarget(target);
    if (!resolved.turnId) {
      this.ctx.message.info('未找到该消息对应的会话边界');
      return false;
    }

    const requestContent = resolved.requestContent ?? getInteractionRequestContent(normalized);
    const displayContent = resolved.displayContent
      ?? getInteractionDisplayContent(normalized)
      ?? requestContent;
    if (!displayContent) {
      this.ctx.message.info('未找到该请求的可见内容');
      return false;
    }

    const requestResources = extractUserTurnResources(requestContent);
    return this.ctx.session.forkFromTurn({
      turnId: resolved.turnId,
      requestContent: requestContent ?? displayContent,
      displayContent,
      resources: mergeUserTurnResources([], requestResources),
    });
  }

  /**
   * 编辑并重新发送 — 回滚到指定消息的检查点 + 用新内容重新发送
   */
  async editAndResendFromTurn(target: EditActionTurnTarget | null | undefined, newText: string, resources: ResourceItem[]): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }
    const resolved = this.resolveTurnTarget(target);
    const restored = await this.restoreToCheckpoint(target, { emitResultMessage: false });
    if (!restored) {
      return;
    }

    const normalized = target ?? {};
    const requestResources = extractUserTurnResources(resolved.requestContent ?? getInteractionRequestContent(normalized));
    this.ctx.resourceManager.items = mergeUserTurnResources(resources, requestResources);
    const editFeedback = this.buildEditResendFeedback(this.withResolvedTurnTarget(normalized, {
      turnId: resolved.turnId,
      requestContent: resolved.requestContent,
      displayContent: resolved.displayContent,
      lastRoundId: resolved.lastRoundId,
    }));
    if (editFeedback) {
      this.ctx.pendingEditFeedback = editFeedback;
    }
    this.ctx.scrollManager.startNewExchange?.();
    await this.ctx.send('user', newText, false);
    this.ctx.resourceManager.mergePathsTo(this.ctx.sessionAllowedPaths);
    this.ctx.resourceManager.items = [];
  }

  /**
   * 重新生成 — 回滚文件变更 + 截断对话历史 + 重新发送。
   * 不传 target 时，默认重试最新一轮。
   */
  async regenerateTurn(target?: EditActionTurnTarget | null): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }
    if (!this.ctx.sessionId) { this.ctx.message.warning('会话不存在，请开始新对话'); return; }

    // 1. 找到目标快照
    const normalizedTarget = target ?? undefined;
    const resolvedTarget = normalizedTarget
      ? await this.resolveTurnTargetWithCheckpointSync(normalizedTarget)
      : undefined;
    const canonicalTarget = this.toCanonicalTurnContext(normalizedTarget);
    const snapshot = resolvedTarget?.snapshot ?? this.ctx.editCheckpointService.getLatestSnapshot();

    if (!snapshot) {
      await this.ctx.send('user', '请重试上次的操作。', false);
      return;
    }

    const snapshotTurnId = resolvedTarget?.turnId ?? canonicalTarget?.turnId ?? snapshot.turnId;
    const snapshotContext = this.ctx.editCheckpointService.getTurnContextForSnapshot(snapshot, snapshotTurnId);
    const requestContent = resolvedTarget?.requestContent
      ?? canonicalTarget?.requestContent
      ?? snapshotContext?.requestContent
      ?? (snapshotTurnId ? this.ctx.lexStream.turns.requestContent(snapshotTurnId) : undefined);
    const displayContent = resolvedTarget?.displayContent
      ?? canonicalTarget?.displayContent
      ?? snapshotContext?.displayContent
      ?? (normalizedTarget ? getInteractionDisplayContent(normalizedTarget) : undefined)
      ?? requestContent;
    const lastRoundId = resolvedTarget?.lastRoundId
      ?? canonicalTarget?.lastRoundId
      ?? snapshotContext?.lastRoundId
      ?? (normalizedTarget ? getInteractionLastRoundId(normalizedTarget) : undefined)
      ?? (snapshotTurnId ? this.ctx.lexStream.turns.lastRoundId(snapshotTurnId) : undefined);
    const regenerateTarget = this.withResolvedTurnTarget(normalizedTarget, {
      turnId: snapshotTurnId,
      requestContent,
      displayContent,
      lastRoundId,
    });

    // 2. 回滚文件变更并截断时间线
    const { rolledBackFiles, errors } = await this.applyCheckpointRestoreFiles(snapshot.checkpointId);
    if (errors.length > 0) {
      console.warn('[Regenerate] 回滚文件部分失败:', errors);
    }
    if (rolledBackFiles > 0) {
      console.log(`[Regenerate] 回滚了 ${rolledBackFiles} 个文件变更`);
    }

    this.ctx.editCheckpointService.truncateStateFromCheckpoint?.(snapshot.checkpointId);

    // 3. Turn-native 截断
    if (snapshotTurnId) {
      this.ctx.lexStream.turns.restartFrom(snapshotTurnId);
    }

    // 4. 截断 UI list
    const listCutIndex = this.ctx.editCheckpointService.getResponseStartListIndexForSnapshot(snapshot) ?? undefined;
    this.truncateUiList(listCutIndex, snapshotTurnId);

    // 5. 重新发起 turn
    const msgs = this.ctx.conversationMessages;
    const fallbackUserMsg = displayContent ?? (
      msgs.length > 0 && msgs[msgs.length - 1].role === 'user'
        ? msgs[msgs.length - 1].content
        : '请重试上次的操作。'
    );
    
    const nextRequest = this.buildRegenerateRequest(
      requestContent ?? fallbackUserMsg,
      regenerateTarget,
    );
    this.ctx.lexStream.turn.begin(nextRequest);
    this.ctx.lexStream.turn.run(nextRequest);
  }
}
