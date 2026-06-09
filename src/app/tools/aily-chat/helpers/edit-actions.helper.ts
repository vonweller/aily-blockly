/**
 * EditActionsHelper �?编辑操作辅助�?
 *
 * 封装所有与文件编辑检查点相关的操作：
 * - undo / redo / accept / reject 单文件操�?
 * - restoreToCheckpoint（还原到指定对话检查点�?
 * - editAndResendFromTurn（编辑并重发�?
 * - regenerateTurn（重新生成）
 * - ensureAbsExport / saveCheckpointToDisk / reloadAbsWorkspace（内部辅助）
 *
 * �?ChatEngineService 中提取（Phase 4），减轻后者的体积�?
 */

import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import { AilyHost } from '../core/host';
import { ChatViewWriteBridge, type ChatViewWriteBridgeContext } from './chat-view-write-bridge';
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
import type { CheckpointRestoreRedoArtifact, TurnSnapshot } from '../services/edit-checkpoint.service';
import type { IWorkspaceCheckpointProvider } from '../services/edit-checkpoint.service';
import {
  type HostResponseProjection,
  type HostTurnResponseState,
} from './host-turn-response-state';
import {
  CheckpointReplayCoordinator,
  type CheckpointRedoExecutionResult,
} from './checkpoint-replay-coordinator';
import { appendEditActionResult } from './edit-action-result-projection';
import {
  buildUndoActionResult,
  type EditActionName,
  type EditActionResultDescriptor,
  type EditActionResultState,
} from './edit-action-result-projection';

export interface EditActionTurnTarget extends Partial<LegacyTurnInteractionMetadata>, Partial<DialogTurnContext> {}

export interface RestoreCheckpointConfirmation {
  requestCount: number;
  fileCount: number;
  fileLabel?: string;
}

type WorkspaceCheckpointAccess = Partial<Pick<
  IWorkspaceCheckpointProvider,
  'buildRestorePlan' | 'buildRedoPlan' | 'applyRestorePlan' | 'getPresentationMode'
>>;

type EditActionsContext = ChatViewWriteBridgeContext
  & Pick<IAgentLifecycle, 'isWaiting' | 'isCompleted' | 'isCancelled' | 'pendingEditFeedback'>
  & Pick<ISessionAccess, 'sessionAllowedPaths' | 'conversationMessages'>
  & Pick<IProjectContext, 'getCurrentProjectPath'>
  & Pick<IChatServiceAccess, 'absAutoSyncService' | 'editCheckpointService' | 'workspaceCheckpointProvider' | 'resourceManager' | 'message'>
  & Pick<IChatCoordination, 'lexStream' | 'send' | 'session'>
  & {
    workspaceCheckpointAccess?: WorkspaceCheckpointAccess;
    confirmRestoreCheckpoint?(confirmation: RestoreCheckpointConfirmation): Promise<boolean> | boolean;
    syncWorkspaceState?(): Promise<void> | void;
    readonly hostResponseProjection?: HostResponseProjection | null;
    restoreSharedHostProjectionState?(state: HostTurnResponseState | null): void;
    replaceSharedHostProjectionState?(state: HostTurnResponseState | null): void;
  };

type EditActionsViewWriteContext = ConstructorParameters<typeof ChatViewWriteBridge>[0];

type EditActionsViewWriteAccess = Pick<
  ChatViewWriteBridge,
  'appendAilyPartsMessageHandle' | 'truncateFromTurnId' | 'truncateFrom' | 'restoreLegacyHistoryList' | 'restoreTurnNativeHistoryList'
>;

export class EditActionsHelper {
  private readonly viewWriteBridge: EditActionsViewWriteAccess;
  private readonly checkpointReplayCoordinator: CheckpointReplayCoordinator;

  constructor(private ctx: EditActionsContext) {
    this.ctx.syncWorkspaceState = this.reloadAbsWorkspace.bind(this);

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
    this.checkpointReplayCoordinator = new CheckpointReplayCoordinator(this.ctx, this.viewWriteBridge);
  }

  private getWorkspaceCheckpointAccess(): WorkspaceCheckpointAccess {
    if (this.ctx.workspaceCheckpointAccess) {
      return this.normalizeWorkspaceCheckpointAccess(this.ctx.workspaceCheckpointAccess);
    }

    return this.buildWorkspaceCheckpointAccessFromProvider(this.ctx.workspaceCheckpointProvider);
  }

  private buildWorkspaceCheckpointAccessFromProvider(
    provider: IWorkspaceCheckpointProvider | null | undefined,
  ): WorkspaceCheckpointAccess {
    if (!provider) {
      return {};
    }

    return this.normalizeWorkspaceCheckpointAccess(provider);
  }

  private normalizeWorkspaceCheckpointAccess(
    access: WorkspaceCheckpointAccess,
  ): WorkspaceCheckpointAccess {
    const getPresentationMode = access.getPresentationMode?.bind(access);
    const buildRestorePlan = access.buildRestorePlan?.bind(access);
    const buildRedoPlan = access.buildRedoPlan?.bind(access);
    const applyRestorePlan = access.applyRestorePlan?.bind(access);

    return {
      getPresentationMode,
      buildRestorePlan,
      buildRedoPlan,
      applyRestorePlan,
    };
  }

  private refreshWorkspaceCheckpointAccess(): void {
    this.ctx.workspaceCheckpointAccess = this.getWorkspaceCheckpointAccess();
  }

  // ==================== 内部辅助 ====================

  /**
   * 确保 absAutoSyncService 已初始化并执行导�?
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
   * Turn 开始前提交并持久化前一轮的 checkpoint 数据到磁盘�?
   * 确保前一轮的快照不因崩溃而丢失�?
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
   * 回滚/还原后重新同�?ABS �?Blockly 工作区�?
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

  private async restoreCheckpointSnapshot(
    snapshot: TurnSnapshot,
    options: {
      turnId?: string;
      listIndex?: number;
      emitResultMessage?: boolean;
      captureRedoTurns?: boolean;
      truncateLiveTurnResponses?: boolean;
      truncateChatTurn?: (turnId: string) => void;
    } = {},
  ): Promise<boolean> {
    this.refreshWorkspaceCheckpointAccess();

    const {
      turnId,
      listIndex,
      emitResultMessage = true,
      captureRedoTurns = true,
      truncateLiveTurnResponses = true,
      truncateChatTurn,
    } = options;
    const truncatedTurnId = turnId ?? snapshot.turnId;
    const restoreResult = await this.checkpointReplayCoordinator.restoreCheckpoint(snapshot.checkpointId, {
      turnId: truncatedTurnId,
      listIndex,
      captureRedoTurns,
      truncateLiveTurnResponses,
      truncateChatTurn,
    });

    if (restoreResult.ok === false) {
      console.warn('[restoreToCheckpoint] 回滚文件部分失败:', restoreResult.detailErrors);

      if (emitResultMessage) {
        this.checkpointReplayCoordinator.projectRestoreExecutionResult(restoreResult);
      }
      return false;
    }

    if (!emitResultMessage) {
      return true;
    }

    this.checkpointReplayCoordinator.projectRestoreExecutionResult(restoreResult);

    return true;
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
   * 用户保留文件变更 �?将当前状态设为新基线，保存反馈状�?
   */
  onKeepEdits(detail?: ChatTaskActionDetail): void {
    const { fileCount, totalAdded, totalRemoved } = detail || {};
    const displayContent = this.buildUserVisibleRequestPreview(getInteractionDisplayContent(detail?.target));
    const requestHint = displayContent ? `与“${displayContent}”关联的` : '上一轮的';
    this.ctx.pendingEditFeedback = `[用户已确认保留${requestHint}文件变更：${fileCount || 0} 个文件，+${totalAdded || 0} / -${totalRemoved || 0} 行]`;
    this.ctx.editCheckpointService.acceptAllAsBaseline();
  }

  /**
   * 撤销最近一轮的文件变更（Undo，不截断对话历史，支�?Redo�?
   */
  async undoLastEdits(): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }

    if (!this.ctx.editCheckpointService.canUndo) {
      this.ctx.message.info('没有可撤销的文件变更');
      return;
    }

    const { rolledBackFiles, errors } = await this.ctx.editCheckpointService.undo();

    this.ctx.pendingEditFeedback = `[用户撤销了上一轮的 ${rolledBackFiles} 个文件变更，文件已恢复到变更前的状态。后续操作请基于当前文件内容进行。]`;

    appendEditActionResult(this.viewWriteBridge, 'undo', buildUndoActionResult(rolledBackFiles, errors));

    await this.reloadAbsWorkspace();
  }

  /**
   * 重做文件变更（Redo，恢复被撤销的文件状态）
   */
  async redoEdits(): Promise<void> {
    if (this.ctx.isWaiting) { this.ctx.message.warning('正在处理中，请稍候...'); return; }

    this.refreshWorkspaceCheckpointAccess();

    const checkpointRedoArtifact = this.ctx.editCheckpointService.getCheckpointRestoreRedoArtifact?.() ?? null;
    const checkpointRedoTurnResponses = checkpointRedoArtifact?.hostRecord?.turnResponses
      ?? checkpointRedoArtifact?.turnResponses
      ?? this.ctx.editCheckpointService.getCheckpointRestoreRedoTurnResponses?.()
      ?? [];
    const hasCheckpointRedoChat = this.ctx.editCheckpointService.hasRecoverableCheckpointRestoreRedoTurnResponses?.()
      ?? checkpointRedoTurnResponses.length > 0;

    if (!hasCheckpointRedoChat && !this.ctx.editCheckpointService.canRedo) {
      this.ctx.message.info('没有可重做的文件变更');
      return;
    }

    const previousTurnResponses = Array.isArray(this.ctx.lexStream.turnResponses)
      ? [...this.ctx.lexStream.turnResponses]
      : [];

    if (hasCheckpointRedoChat) {
      const checkpointRedoResult = await this.checkpointReplayCoordinator.redoCheckpoint(
        checkpointRedoArtifact,
          checkpointRedoTurnResponses,
          previousTurnResponses,
        );
      if (checkpointRedoResult.ok === false) {
        this.checkpointReplayCoordinator.projectRedoExecutionResult(checkpointRedoResult);
        return;
      }

      this.checkpointReplayCoordinator.projectRedoExecutionResult(checkpointRedoResult);
      return;
    }

    const fileRedoResult = await this.ctx.editCheckpointService.redo();
    const errors = [...fileRedoResult.errors];
    const rolledBackFiles = fileRedoResult.rolledBackFiles;

    this.checkpointReplayCoordinator.projectRedoFileApplyResult({
      rolledBackFiles,
      errors,
    });

    this.ctx.editCheckpointService.publishCurrentSummary();
    await this.reloadAbsWorkspace();
  }

  /**
   * 接受单个文件�?AI 编辑
   */
  onAcceptFile(filePath: string): void {
    if (!filePath) return;
    this.ctx.editCheckpointService.acceptFile(filePath);
    this.ctx.editCheckpointService.publishCurrentSummary();
  }

  /**
   * 拒绝单个文件�?AI 编辑（恢复到初始内容�?
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

    const confirmed = await this.confirmRestoreCheckpoint(resolved.snapshot, resolved.turnId);
    if (!confirmed) {
      return false;
    }

    return this.restoreCheckpointSnapshot(resolved.snapshot, {
      turnId: resolved.turnId,
      listIndex: resolved.listIndex,
      emitResultMessage,
      truncateChatTurn: turnId => {
        this.ctx.lexStream.turns.removeFrom(turnId);
      },
    });
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

  private async confirmRestoreCheckpoint(snapshot: TurnSnapshot, turnId: string | undefined): Promise<boolean> {
    const confirmRestoreCheckpoint = this.ctx.confirmRestoreCheckpoint;
    if (!confirmRestoreCheckpoint) {
      return true;
    }

    const fileSummary = await this.getRestoreCheckpointFileSummary(snapshot.checkpointId);

    return await confirmRestoreCheckpoint({
      requestCount: this.getRestoreCheckpointRequestCount(turnId ?? snapshot.turnId),
      fileCount: fileSummary.fileCount,
      fileLabel: fileSummary.fileLabel,
    });
  }

  private getRestoreCheckpointRequestCount(turnId: string | undefined): number {
    const liveTurnResponses = Array.isArray(this.ctx.lexStream.turnResponses)
      ? this.ctx.lexStream.turnResponses
      : [];

    if (!turnId) {
      return 1;
    }

    const turnIndex = liveTurnResponses.findIndex(turn => turn.turnId === turnId);
    if (turnIndex < 0) {
      return 1;
    }

    return Math.max(1, liveTurnResponses.length - turnIndex);
  }

  private async getRestoreCheckpointFileSummary(checkpointId: string): Promise<{ fileCount: number; fileLabel?: string; }> {
    this.refreshWorkspaceCheckpointAccess();

    try {
      const restorePlan = await this.ctx.workspaceCheckpointAccess?.buildRestorePlan?.(checkpointId);
      if (Array.isArray(restorePlan?.files)) {
        return {
          fileCount: restorePlan.files.length,
          fileLabel: restorePlan.files.length === 1
            ? AilyHost.get().path.basename(restorePlan.files[0].uri)
            : undefined,
        };
      }
    } catch (error) {
      console.warn('[restoreToCheckpoint] failed to inspect restore plan for confirmation:', error);
    }

    try {
      const editsSummary = await this.ctx.editCheckpointService.getEditsSummary?.(checkpointId);
      if (typeof editsSummary?.fileCount === 'number') {
        return { fileCount: editsSummary.fileCount };
      }
    } catch (error) {
      console.warn('[restoreToCheckpoint] failed to inspect edits summary for confirmation:', error);
    }

    return { fileCount: 0 };
  }

  /**
   * 编辑并重新发�?�?回滚到指定消息的检查点 + 用新内容重新发�?
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
   * 重新生成 �?回滚文件变更 + 截断对话历史 + 重新发送�?
   * 不传 target 时，默认重试最新一轮�?
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
    const requestMetadata = canonicalTarget?.request?.metadata
      ?? snapshotContext?.request?.metadata
      ?? normalizedTarget?.request?.metadata
      ?? normalizedTarget?.turnResponse?.request?.metadata;
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

    // 2. 复用 restore checkpoint 语义处理 workspace owner；restartFrom 只负责聊天侧 turn truncate
    const restored = await this.restoreCheckpointSnapshot(snapshot, {
      turnId: snapshotTurnId,
      listIndex: this.ctx.editCheckpointService.getResponseStartListIndexForSnapshot(snapshot) ?? undefined,
      emitResultMessage: false,
      captureRedoTurns: false,
      truncateLiveTurnResponses: false,
      truncateChatTurn: turnId => {
        this.ctx.lexStream.turns.restartFrom(turnId);
      },
    });
    if (!restored) {
      return;
    }

    // 3. 重新发起 turn
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
    this.ctx.lexStream.turn.begin(nextRequest, displayContent, requestMetadata);
    this.ctx.lexStream.turn.run(nextRequest, displayContent);
  }
}
