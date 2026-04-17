/**
 * SessionLifecycleHelper — 会话生命周期辅助类
 *
 * 负责会话的创建、关闭、保存、历史加载等逻辑。
 * 完全基于 aily-lex 本地 agent，不涉及服务端会话管理。
 */

import type { IChatContext } from '../core/chat-context';
import type { LiveHostSessionRecord } from '../services/chat-history.service';
import { AilyHost } from '../core/host';
import { SkillRegistry } from '../core/skill-registry';
import { HostSessionRestoreBridge } from './host-session-restore-bridge';
import { HostSessionSaveBridge } from './host-session-save-bridge';
import { ChatViewWriteBridge } from './chat-view-write-bridge';

export class SessionLifecycleHelper {
  private readonly _hostSessionRestoreBridge: HostSessionRestoreBridge;
  private readonly _hostSessionSaveBridge: HostSessionSaveBridge;
  private readonly _viewWriteBridge: ChatViewWriteBridge;

  constructor(private ctx: IChatContext) {
    this._hostSessionRestoreBridge = new HostSessionRestoreBridge(this.ctx);
    this._hostSessionSaveBridge = new HostSessionSaveBridge(this.ctx);
    this._viewWriteBridge = new ChatViewWriteBridge(this.ctx);
  }

  buildHostSessionRecord(): LiveHostSessionRecord | null {
    return this._hostSessionSaveBridge.buildHostSessionRecord();
  }

  // ==================== 会话持久化 ====================

  saveCurrentSession(): void {
    if (this._hostSessionSaveBridge.saveCurrentSession()) {
      this.refreshHistoryList();
    }
  }

  refreshHistoryList(): void {
    const historyActions = [
      { icon: 'fa-light fa-pen', action: 'rename-history', title: '重命名' },
      { icon: 'fa-light fa-trash', action: 'delete-history', title: '删除' },
    ];
    const entries = this.ctx.chatHistoryService.getHistoryList('current-project',
      AilyHost.get().project.currentProjectPath || AilyHost.get().project.projectRootPath,
      AilyHost.get().project.projectRootPath
    );
    this.ctx.menuManager.historyList = entries.map(e => ({
      sessionId: e.sessionId,
      name: e.title || 'q' + e.createdAt,
      actions: historyActions,
      current: e.sessionId === this.ctx.sessionId,
    }));
  }

  // ==================== 会话启动 ====================

  async startSession(): Promise<void> {
    if (this.ctx.isSessionStarting) return Promise.resolve();
    this.ctx.isSessionStarting = true;
    this.ctx.isCancelled = false;

    this.ctx.lexStream.turns.clear();
    this.ctx.toolCallingIteration = 0;
    this.ctx.contextBudgetService.reset();
    this.ctx.sessionAllowedPaths = [];
    this.ctx.repetitionDetectionService.resetAll();
    this.ctx.activatedDeferredTools.clear();
    SkillRegistry.clearSessionState();

    // 初始化 Skills 系统（扫描全局 + 项目级 skills）
    const projectRoot = AilyHost.get().project?.currentProjectPath || AilyHost.get().project?.projectRootPath;
    SkillRegistry.initialize(projectRoot).catch(err => {
      console.warn('[AilyChat] Skills 初始化失败:', err);
    });

    if (!this.ctx.mcpInitialized) {
      this.ctx.mcpInitialized = true;
      await this.ctx.mcpService.init();
      try {
        await AilyHost.get().config.loadHardwareIndexForAI?.();
      } catch (err) {
        console.warn('[AilyChat] 加载硬件索引失败:', err);
      }
    }

    this.ctx.isCompleted = false;

    // 先生成 sessionId，传给 agent（避免 agent 内部 sessionId 与 UI 不匹配）
    // send() 仍然以 chatService.currentSessionId 非空作为就绪标志
    const pendingSessionId = `lex-${Date.now()}`;

    // 初始化 aily-lex agent
    try {
      const agentReady = await this.ctx.lexStream.agent.ensureAgent(pendingSessionId);
      if (!agentReady) {
        const msg = 'aily-lex 模块加载失败，无法初始化 Agent';
        console.error('[SessionLifecycle]', msg);
        this.ctx.lexStream.turn.appendError(msg);
        this.ctx.isSessionStarting = false;
        return;
      }
    } catch (err) {
      console.error('[SessionLifecycle] aily-lex agent 初始化失败:', err);
      this.ctx.lexStream.turn.appendError('aily-lex 初始化失败: ' + (err as any)?.message);
      this.ctx.isSessionStarting = false;
      throw err;
    }

    // Agent 就绪后设置 sessionId（send() 用 sessionId 作为就绪标志）
    this.ctx.chatService.currentSessionId = pendingSessionId;
    this.ctx.chatService.currentSessionTitle = '';
    const _curPath = AilyHost.get().project.currentProjectPath;
    const _rootPath = AilyHost.get().project.projectRootPath;
    this.ctx.chatService.currentSessionPath = (_curPath && _curPath !== _rootPath) ? _curPath : '';

    this.ctx.isSessionStarting = false;
  }

  /** 清理当前会话的本地 agent 资源 */
  dispose(): void {
    this.ctx.lexStream.agent.dispose();
  }

  /** 简化的停止+清理（替代旧 stopAndCloseSession） */
  async stopAndCloseSession(skipSave: boolean = false): Promise<void> {
    if (!skipSave) { this.saveCurrentSession(); }
    this.ctx.lexStream.agent.stop();
    this.ctx.isWaiting = false;
  }

  // ==================== 新建 / 历史 ====================

  async newChat(): Promise<void> {
    if (this.ctx.isWaiting) {
      this.ctx.message.warning(this.ctx.translate.instant('AILY_CHAT.STOP_CURRENT_SESSION_FIRST') || '请先停止当前会话，再新建');
      return;
    }
    if (this.ctx.isSessionStarting) return;
    this.saveCurrentSession();
    this._viewWriteBridge.clearChatView();
    this.ctx.scrollManager.autoScrollEnabled = true;
    this.ctx.isCompleted = false;
    this.ctx.isCancelled = true;
    this.ctx.editCheckpointService.clear();
    this.ctx.editCheckpointService.dismissSummary();
    if (this.ctx.messageSubscription) { this.ctx.messageSubscription.unsubscribe(); this.ctx.messageSubscription = null; }
    this.ctx.activeToolExecutions = 0;
    try {
      // 清理旧的 lex agent
      this.ctx.lexStream.agent.dispose();
      this.ctx.chatService.currentSessionId = '';
      this.ctx.chatService.currentSessionTitle = '';
      this.ctx.chatService.currentSessionPath = '';
      this.ctx.isSessionStarting = false;
      this.ctx.hasInitializedForThisLogin = false;
      await this.startSession();
    } catch (error) {
      console.warn('新会话启动失败:', error);
      this.ctx.isSessionStarting = false;
    }
  }

  async getHistory(): Promise<void> {
    if (!this.ctx.sessionId) return;
    this._viewWriteBridge.clearChatView();
    this.ctx.lexStream.turns.clear();
    this.ctx.toolCallingIteration = 0;
    this.ctx.contextBudgetService?.reset();
    const currentPrjPath = AilyHost.get().project.currentProjectPath || AilyHost.get().project.projectRootPath;
    const hostRecord = this.ctx.chatHistoryService.loadHostRecord(this.ctx.sessionId, currentPrjPath);
    if (hostRecord) {
      await this._hostSessionRestoreBridge.restore(hostRecord);
    } else {
      this.ctx.editCheckpointService?.clear();
      this.ctx.editCheckpointService?.dismissSummary();
    }
  }

  resetChat(): Promise<void> { return this.startSession(); }
}
