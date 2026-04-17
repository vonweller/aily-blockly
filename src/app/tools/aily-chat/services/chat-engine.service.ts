/**
 * ChatEngineService — aily-chat 核心业务逻辑引擎
 *
 * 从 AilyChatComponent 中提取的全部业务逻辑、副作用和共享状态。
 * Component 仅保留 Angular 生命周期、模板绑定和 UI 事件处理器。
 *
 * 职责：
 * - 会话生命周期管理（start / stop / close / new / history）
 * - 消息发送与工具调用循环（stateless turn loop）
 * - SSE 流处理与事件分发
 * - 订阅管理（项目路径、登录状态、配置变更等）
 */

import { Injectable, ElementRef, NgZone } from '@angular/core';
import { Subscription, skip, distinctUntilChanged, combineLatest } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { NzMessageService } from 'ng-zorro-antd/message';

import { ChatService, ChatTextOptions, ModelConfig } from './chat.service';
import { McpService } from './mcp.service';
import { AilyChatConfigService } from './aily-chat-config.service';
import { ChatHistoryService } from './chat-history.service';
import { RepetitionDetectionService } from './repetition-detection.service';
import { ContextBudgetService } from './context-budget.service';
import { ContextBudgetViewService } from './context-budget-view.service';
import type { ContextBudgetSnapshot } from './context-budget-snapshot';

import { AbsAutoSyncService } from './abs-auto-sync.service';
import { EditCheckpointService } from './edit-checkpoint.service';
import { ScrollManagerService } from './scroll-manager.service';
import { ResourceManagerService } from './resource-manager.service';
import { MenuManagerService } from './menu-manager.service';

import { ChatMessage, ToolCallState, ResourceItem } from '../core/chat-types';
import { AilyHost } from '../core/host';
import { registerAskUserCallback, unregisterAskUserCallback } from '../core/ask-user';
import { lexGenerateTitle } from '../core/lex-endpoint';

import { ChatTitleCoordinator } from '../helpers/chat-title-coordinator';
import { MessageDisplayHelper } from '../helpers/message-display.helper';
import { SessionLifecycleHelper } from '../helpers/session-lifecycle.helper';
import { LexOwnerFacade } from '../helpers/lex-stream.helper';
import { ChatSendCoordinator } from '../helpers/chat-send-coordinator';
import { ChatStopCoordinator } from '../helpers/chat-stop-coordinator';
import { ChatConversationActionCoordinator } from '../helpers/chat-conversation-action-coordinator';
import { ChatAiNoticeCoordinator } from '../helpers/chat-ai-notice-coordinator';
import { ChatExternalInputCoordinator } from '../helpers/chat-external-input-coordinator';
import { ChatSwitchCoordinator } from '../helpers/chat-switch-coordinator';
import { ChatSubscriptionCoordinator } from '../helpers/chat-subscription-coordinator';
import { ChatTaskActionCoordinator } from '../helpers/chat-task-action-coordinator';
import { ChatViewAdapter } from './chat-view-adapter';
import { initBundledAgents } from '../agents/bundled-agents';
import { ChatPartStore } from '../core/chat-part-store';
import type { IChatContext } from '../core/chat-context';
import { EditActionsHelper } from '../helpers/edit-actions.helper';
import { UserInteractionHelper } from '../helpers/user-interaction.helper';

@Injectable()
export class ChatEngineService implements IChatContext {

  // ==================== Part-based 消息模型（Phase 1） ====================
  /** Part 存储：与 string-based list[] 并行工作，供 lex-stream 路径使用 */
  readonly partStore = new ChatPartStore();

  // ==================== 辅助类 ====================
  readonly msg = new MessageDisplayHelper(this);
  readonly session = new SessionLifecycleHelper(this);
  readonly lexStream = new LexOwnerFacade(this);
  readonly editActions = new EditActionsHelper(this);
  readonly interaction = new UserInteractionHelper(this);
  private readonly titleCoordinator = new ChatTitleCoordinator(this, lexGenerateTitle);
  private readonly sendCoordinator = new ChatSendCoordinator(
    this,
    (content) => this.titleCoordinator.generate(content),
    () => this.resourceManager.getResourcesText(),
  );
  private readonly stopCoordinator = new ChatStopCoordinator(this);
  private readonly conversationActionCoordinator = new ChatConversationActionCoordinator(this);
  private readonly aiNoticeCoordinator = new ChatAiNoticeCoordinator({
    stop: () => this.stop(),
    updateNotice: (config) => {
      AilyHost.get().notice?.update(config);
    },
    clearNotice: () => {
      AilyHost.get().notice?.clear();
    },
  });
  private readonly switchCoordinator = new ChatSwitchCoordinator(this);
  private readonly subscriptionCoordinator = new ChatSubscriptionCoordinator(this, {
    receiveTextFromExternal: (text, options) => this.receiveTextFromExternal(text, options),
    showAiWritingNotice: (isWaiting) => this.showAiWritingNotice(isWaiting),
    handleTaskAction: (event) => this.handleTaskAction(event),
    flushPendingAutoSend: () => this.flushPendingAutoSend(),
  });
  private readonly externalInputCoordinator = new ChatExternalInputCoordinator(this, {
    retryLastAction: () => this.retryLastAction(),
    regenerateTurn: () => this.editActions.regenerateTurn(),
    undoLastEdits: () => this.editActions.undoLastEdits(),
    newChat: () => this.newChat(),
    queuePendingAutoSend: (text) => {
      this._pendingAutoSendText = text;
    },
    focusInput: () => {
      if (this.chatTextareaRef?.nativeElement) {
        const textarea = this.chatTextareaRef.nativeElement;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    },
    schedulePostInputWork: (work) => {
      setTimeout(work, 100);
    },
  });
  private readonly taskActionCoordinator = new ChatTaskActionCoordinator(this.editActions, {
    continueConversation: () => this.continueConversation(),
    retryLastAction: () => this.retryLastAction(),
    newChat: () => this.newChat(),
    warnUnknownAction: (action) => {
      console.warn('未知的任务操作:', action);
    },
  });

  // ==================== rAF 批处理 UI 适配器 ====================
  /** 流式文本走 rAF 合并，每帧只触发一次 Angular CD（参考 Copilot FetchStreamSource pause/unpause） */
  readonly viewAdapter: ChatViewAdapter = null!; // 由 constructor 初始化

  // ==================== 公共状态（模板绑定） ====================
  list: ChatMessage[] = [];
  inputValue = '';
  prjRootPath = '';
  prjPath = '';
  currentUserGroup: string[] = [];
  isCompleted = false;
  isLoggedIn = false;
  debug = false;

  // ==================== 半公共状态 ====================
  sessionAllowedPaths: string[] = [];
  currentMessageSource: string = 'mainAgent';
  toolCallStates: { [key: string]: string } = {};

  // ==================== 内部状态（helper 可访问） ====================
  isSessionStarting = false;
  hasInitializedForThisLogin = false;
  isCancelled = false;
  /** 只读视图：从 lex TurnManager 派生的消息数组（lex 为唯一 source of truth） */
  get conversationMessages(): any[] {
      return this.lexStream.conversation.messages();
  }
  toolCallingIteration = 0;
  activeToolExecutions = 0;
  currentStatelessMode = false;

  /** 缓存的编辑反馈（用户保留/撤销变更后，在下次发送时注入上下文） */
  pendingEditFeedback: string | null = null;

  pendingUserInput = false;
  private _isWaiting = false;
  mcpInitialized = false;
  lastStopReason = '';
  /** 会话级：已激活的 deferred 工具名称集合（通过 search_available_tools 加载） */
  activatedDeferredTools = new Set<string>();

  /** 延迟切换：活跃请求期间暂存待切换的模型/模式，完成后自动应用 */
  _pendingModelSwitch: ModelConfig | null = null;
  _pendingModeSwitch: string | null = null;

  /** autoSend 消息在 sessionId 未就绪时的暂存区，startSession 完成后自动冲刷 */
  private _pendingAutoSendText: string | null = null;

  // ==================== 订阅 ====================
  messageSubscription: any;

  // ==================== 外部引用 ====================
  private chatTextareaRef: ElementRef | null = null;

  // ==================== Getters / Setters ====================

  get sessionId() { return this.chatService.currentSessionId; }
  set sessionId(value: string) { this.chatService.currentSessionId = value; }

  get sessionTitle() { return this.chatService.currentSessionTitle; }

  get currentMode() { return this.chatService.currentMode; }

  get currentModel() { return this.chatService.currentModel; }

  get currentModelName() { return this.chatService.currentModel?.name; }

  get isWaiting() { return this._isWaiting; }
  set isWaiting(value: boolean) {
    this._isWaiting = value;
    this.chatService.isWaiting = value;
    AilyHost.get().blockly.aiWaiting = value;
    if (!value) {
      this.aiWriting = false;
      AilyHost.get().blockly.aiWaitWriting = false;
    }
  }

  set aiWriting(value: boolean) {
    AilyHost.get().blockly.aiWriting = value;
  }

  get contextBudget$() { return this.contextBudgetViewService?.budget$; }

  get contextBudgetSnapshot(): ContextBudgetSnapshot | null {
    return this.contextBudgetViewService?.getSnapshot() ?? null;
  }

  // ==================== 构造函数 ====================

  constructor(
    public chatService: ChatService,
    public mcpService: McpService,
    public ailyChatConfigService: AilyChatConfigService,
    public chatHistoryService: ChatHistoryService,
    public repetitionDetectionService: RepetitionDetectionService,
    public contextBudgetService: ContextBudgetService,
    private contextBudgetViewService: ContextBudgetViewService,
    public ngZone: NgZone,
    public absAutoSyncService: AbsAutoSyncService,
    public editCheckpointService: EditCheckpointService,
    public translate: TranslateService,
    public message: NzMessageService,
    public scrollManager: ScrollManagerService,
    public resourceManager: ResourceManagerService,
    public menuManager: MenuManagerService,
  ) {
    // 初始化 viewAdapter（需要 ngZone 已注入）
    (this as any).viewAdapter = new ChatViewAdapter(
      () => this.list,
      (msg) => this.list.push(msg),
      () => this.currentMessageSource,
      () => this.currentModelName || undefined,
      () => this._isWaiting,
      () => { if (this.sessionId) { this.chatHistoryService.markDirty(this.sessionId); } },
      this.ngZone,
      undefined, // cdCallback — 由 component 通过 setCdCallback 注入
      () => this.scrollManager.scrollToBottom(), // scrollToBottom — 流式 rAF flush 后自动滚动
    );

    this.chatHistoryService.setLiveSessionProvider(() => this.session.buildHostSessionRecord());
  }

  /** 注册 OnPush CD 回调（由 component 调用 cdr.markForCheck） */
  setCdCallback(cb: () => void): void {
    (this.viewAdapter as any).cdCallback = cb;
  }

  /**
   * 同步 detectChanges 回调 — 在 runOutsideAngular 场景中使用。
   * markForCheck 在 zone 外不会触发实际 CD，此回调直接同步执行 detectChanges。
   */
  private _syncDetectChanges: (() => void) | null = null;

  setSyncDetectChanges(cb: () => void): void {
    this._syncDetectChanges = cb;
  }

  /** 同步触发变更检测（zone 安全） */
  triggerSyncDetectChanges(): void {
    if (this._syncDetectChanges) {
      this.ngZone.run(() => this._syncDetectChanges!());
    }
  }

  // ==================== 初始化 / 销毁 ====================

  /**
   * 引擎初始化 — 由 Component 的 ngOnInit 调用
   * @param chatTextareaRef 输入框 ElementRef（用于自动聚焦）
   */
  init(chatTextareaRef: ElementRef | null): void {
    this.chatTextareaRef = chatTextareaRef;
    this.chatService.isWaiting = this._isWaiting;

    this.prjPath = AilyHost.get().project.currentProjectPath === AilyHost.get().project.projectRootPath
      ? '' : AilyHost.get().project.currentProjectPath;
    this.prjRootPath = AilyHost.get().project.projectRootPath;

    // 初始化时：如果项目已打开，立即执行孤儿领养（订阅的 skip(1) 会跳过初始值）
    if (this.prjPath) {
      const adopted = this.chatHistoryService.adoptOrphanSessions(this.prjPath, this.prjRootPath);
      if (adopted > 0) {
        console.log(`[ChatEngine] 初始化时领养 ${adopted} 个孤儿会话到: ${this.prjPath}`);
      }
    }

    // 注册 ask_user 回调：在聊天界面显示全部问题并等待用户回答
    registerAskUserCallback((questions) => this.interaction.handleAskUser(questions));

    // 从打包的 .agent.md 加载子代理定义（幂等）
    initBundledAgents();

    // 预加载 aily-lex 模块
    this.lexStream.agent.loadModule().then(ok => {
      if (ok) { console.log('[ChatEngine] aily-lex 模块预加载成功'); }
      else { console.error('[ChatEngine] aily-lex 模块加载失败，聊天功能不可用'); }
    });

    this.setupSubscriptions();
  }

  /**
   * 引擎销毁 — 由 Component 的 ngOnDestroy 调用
   */
  destroy(): void {
    this.viewAdapter.destroy();
    this.lexStream.agent.dispose();
    this.partStore.destroy();
    this.chatService.isWaiting = false;
    this.session.saveCurrentSession();
    this.chatHistoryService.flushAll();
    this.chatHistoryService.setLiveSessionProvider(null);
    this.editCheckpointService.clear();

    unregisterAskUserCallback();
    this.interaction.destroy();

    this.cleanupSubscriptions();
    this.session.dispose();

    this.viewAdapter.markLastMessageDone();
  }

  // ==================== 订阅管理 ====================

  private setupSubscriptions(): void {
    this.subscriptionCoordinator.setup();
  }

  private cleanupSubscriptions(): void {
    this.subscriptionCoordinator.cleanup();
  }

  private flushPendingAutoSend(): void {
    if (!this._pendingAutoSendText) {
      return;
    }

    const text = this._pendingAutoSendText;
    this._pendingAutoSendText = null;
    this.inputValue = text;
    setTimeout(() => this.send('user', text, true), 50);
  }

  // ==================== 辅助方法 ====================

  getCurrentProjectPath(): string {
    return AilyHost.get().project.currentProjectPath !== AilyHost.get().project.projectRootPath
      ? AilyHost.get().project.currentProjectPath : '';
  }

  getKeyInfo = async () => {
    const shell = await AilyHost.get().terminal.getShell();
    return `
<keyinfo>
项目存放根路径(**rootFolder**): ${AilyHost.get().project.projectRootPath || '无'}
当前项目路径(**path**): ${this.getCurrentProjectPath() || '无'}
当前项目库存放路径(**librariesPath**): ${this.getCurrentProjectPath() ? this.getCurrentProjectPath() + '/node_modules/@aily-project' : '无'}
appDataPath(**appDataPath**): ${AilyHost.get().path.getAppDataPath() || '无'}
 - 包含SDK文件、编译器工具等，boards.json-开发板列表 libraries.json-库列表 等缓存到此路径
转换库存放路径(**libraryConversionPath**): ${this.getCurrentProjectPath() ? this.getCurrentProjectPath() : (AilyHost.get().path.join(AilyHost.get().path.getAppDataPath(), 'libraries') || '无')}
当前使用的语言(**lang**)： ${AilyHost.get().config.data?.lang || 'zh-cn'}
操作系统(**os**): ${AilyHost.get().platform.type || 'unknown'}
当前命令行终端(**terminal**): ${shell || 'unknown'}
</keyinfo>
<keyinfo>
uses get_hardware_categories tool to get hardware categories before searching boards and libraries.
uses search_boards_libraries tool to search for boards and libraries based on user needs.
Do not create non-existent boards and libraries.
</keyinfo>
`;
  }

  generateTitle(content: string): void {
    this.titleCoordinator.generate(content);
  }

  showAiWritingNotice(isWaiting: boolean): void {
    this.aiNoticeCoordinator.update(isWaiting);
  }

  receiveTextFromExternal(text: string, options?: ChatTextOptions): void {
    this.externalInputCoordinator.receiveText(text, options);
  }

  // ==================== 外观方法（转发到 helper） ====================

  saveCurrentSession(): void { this.session.saveCurrentSession(); }
  refreshHistoryList(): void { this.session.refreshHistoryList(); }
  newChat(): Promise<void> { return this.session.newChat(); }
  getHistory(): Promise<void> { return this.session.getHistory(); }
  getCurrentTools(): any[] { return this.lexStream.runtime.tools(); }
  getCurrentLLMConfig(): any { return this.lexStream.runtime.llmConfig(); }

  // ==================== 消息发送 ====================

  async send(sender: string, content: string, clear: boolean = true): Promise<void> {
    const prepared = this.sendCoordinator.prepareSend(sender, content);
    if (!prepared) return;

    this.lexStream.turn.begin(prepared.llmText);
    if (clear) { this.inputValue = ''; }

    await this.lexStream.turn.run(prepared.llmText);
  }

  resetChat(): Promise<void> { return this.session.startSession(); }

  // ==================== 停止 ====================

  stop(): void {
    this.stopCoordinator.stop();
  }

  // ==================== 模式 / 模型切换 ====================

  async switchToModel(model: ModelConfig): Promise<void> {
    await this.switchCoordinator.switchToModel(model);
  }

  async switchToMode(mode: string): Promise<void> {
    await this.switchCoordinator.switchToMode(mode);
  }

  /**
   * 应用延迟的模型/模式切换。
   * 在 turn 完成（finalizeStatelessTurn / stream complete / stop）后调用。
   */
  async applyPendingSwitch(): Promise<void> {
    await this.switchCoordinator.applyPendingSwitch();
  }

  // ==================== 任务操作 ====================

  private handleTaskAction(event: Event): void {
    this.taskActionCoordinator.handle((event as CustomEvent).detail || {});
  }

  async continueConversation(): Promise<void> {
    await this.conversationActionCoordinator.continueConversation();
  }

  async retryLastAction(): Promise<void> {
    await this.conversationActionCoordinator.retryLastAction();
  }

  // ==================== 委托到 EditActionsHelper ====================

  editAndResendFromTurn(listIndex: number, newText: string, resources: ResourceItem[]): Promise<void> {
    return this.editActions.editAndResendFromTurn(listIndex, newText, resources);
  }

  // ==================== 委托到 UserInteractionHelper ====================

  handleToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    return this.interaction.handleToolApproval(toolName, input, reason);
  }

  resolveAskUserResponse(answer: string, wasFreeform: boolean): void {
    this.interaction.resolveAskUserResponse(answer, wasFreeform);
  }

  skipAskUserResponse(): void {
    this.interaction.skipAskUserResponse();
  }

  approveToolExecution(toolCallId: string, scope: 'once' | 'session' | 'session-safe' = 'once'): void {
    this.interaction.approveToolExecution(toolCallId, scope);
  }

  rejectToolExecution(toolCallId: string, reason?: string): void {
    this.interaction.rejectToolExecution(toolCallId, reason);
  }
}
