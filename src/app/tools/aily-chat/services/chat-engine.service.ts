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

import { Injectable, ElementRef, NgZone, inject } from '@angular/core';
import { Subscription, skip, distinctUntilChanged, combineLatest } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { ChatService, ChatTextOptions, ModelConfig } from './chat.service';
import { McpService } from './mcp.service';
import { AilyChatConfigService } from './aily-chat-config.service';
import { AilyChatLanguageModelsService } from './aily-chat-language-models.service';
import { ChatHistoryService } from './chat-history.service';
import { MAIN_AGENT_TYPE } from '../core/agent-identifiers';
import { RepetitionDetectionService } from './repetition-detection.service';
import { ContextBudgetService } from './context-budget.service';
import { ContextBudgetViewService } from './context-budget-view.service';
import { ChatViewService } from './chat-view.service';
import { ChatRuntimeInteractionHostService } from './chat-runtime-interaction-host.service';
import { AuthQuotaStateService, readAuthQuotaStateSnapshot, type AuthQuotaInfo } from './auth-quota-state.service';
import { ChatInputNoticeStateService } from './chat-input-notice-state.service';
import type { ContextBudgetSnapshot } from './context-budget-snapshot';
import { createInteractionBudgetSnapshot, type InteractionBudgetSnapshot } from './interaction-budget-snapshot';
import type { RequestQuotaSnapshot } from './request-quota-snapshot';
import { RequestQuotaStateService } from './request-quota-state.service';
import { ConfigService } from '../../../services/config.service';
import { isDefaultAutoPresetSelected } from '../helpers/model-billing-label';

import { AbsAutoSyncService } from './abs-auto-sync.service';
import { EditCheckpointService } from './edit-checkpoint.service';
import { GitWorkspaceCheckpointProviderService } from './git-workspace-checkpoint-provider.service';
import { ScrollManagerService } from './scroll-manager.service';
import { ResourceManagerService } from './resource-manager.service';
import { MenuManagerService } from './menu-manager.service';

import { ChatMessage, ToolCallState, ResourceItem } from '../core/chat-types';
import { AilyHost } from '../core/host';
import { registerAskUserCallback, unregisterAskUserCallback } from '../core/ask-user';
import type { MetricsSnapshot, TurnRequest, TurnResponseTurn } from 'aily-lex/browser';
import { lexGenerateTitle } from '../core/lex-endpoint';

import { ChatTitleCoordinator } from '../helpers/chat-title-coordinator';
import { MessageDisplayHelper } from '../helpers/message-display.helper';
import { SessionLifecycleHelper } from '../helpers/session-lifecycle.helper';
import { getUserSelectedToolsForRequest } from '../helpers/lex-agent-bootstrap';
import { LexOwnerFacade } from '../helpers/lex-stream.helper';
import { ChatSendCoordinator } from '../helpers/chat-send-coordinator';
import { ChatStopCoordinator } from '../helpers/chat-stop-coordinator';
import { ChatConversationActionCoordinator } from '../helpers/chat-conversation-action-coordinator';
import { ChatAiNoticeCoordinator } from '../helpers/chat-ai-notice-coordinator';
import { ChatExternalInputCoordinator } from '../helpers/chat-external-input-coordinator';
import { ChatSwitchCoordinator } from '../helpers/chat-switch-coordinator';
import { ChatSubscriptionCoordinator } from '../helpers/chat-subscription-coordinator';
import { ChatTaskActionCoordinator, type ChatTaskActionEvent } from '../helpers/chat-task-action-coordinator';
import { ChatViewAdapter } from './chat-view-adapter';
import { ChatPartStore } from '../core/chat-part-store';
import type { IChatContext } from '../core/chat-context';
import type { DialogTurnContext } from '../core/user-turn-action-target';
import { EditActionsHelper, type RestoreCheckpointConfirmation } from '../helpers/edit-actions.helper';
import { applyCheckpointRestoreVisibility } from '../helpers/checkpoint-restore-visibility';
import { UserInteractionHelper } from '../helpers/user-interaction.helper';
import { type ChatDialogViewItem } from '../helpers/chat-dialog-view-items';
import { UnsaveDialogComponent, type UnsaveDialogData } from '../../../main-window/components/unsave-dialog/unsave-dialog.component';
import {
  applyHostResponseVoteToState,
  createLiveHostRequestGraphSource,
  LiveHostRequestGraphCache,
  type HostRequestModel,
  type HostResponseProjection,
  type HostResponseVoteDirection,
  type HostTurnResponseState,
} from '../helpers/host-turn-response-state';

@Injectable()
export class ChatEngineService implements IChatContext {
  private readonly chatViewState = inject(ChatViewService);
  private readonly modal = inject(NzModalService);

  // ==================== Part-based 消息模型（Phase 1） ====================
  /** Part 存储：与 string-based list[] 并行工作，供 lex-stream 路径使用 */
  readonly partStore = new ChatPartStore();
  private readonly liveHostRequestGraphCache = new LiveHostRequestGraphCache();
  private restoreCheckpointDialogOpen = false;
  private readonly messageDisplayContext = this.createMessageDisplayContext();
  private readonly userInteractionContext = this.createUserInteractionContext();
  private readonly editActionsContext = this.createEditActionsContext();
  private readonly sessionLifecycleContext = this.createSessionLifecycleContext();
  private readonly lexOwnerContext = this.createLexOwnerContext();
  private readonly titleCoordinatorContext = this.createTitleCoordinatorContext();
  private readonly stopCoordinatorContext = this.createStopCoordinatorContext();
  private readonly switchCoordinatorContext = this.createSwitchCoordinatorContext();
  private readonly conversationActionCoordinatorContext = this.createConversationActionCoordinatorContext();

  // ==================== 辅助类 ====================
  readonly msg = new MessageDisplayHelper(this.messageDisplayContext);
  readonly session = new SessionLifecycleHelper(this.sessionLifecycleContext);
  readonly lexStream = new LexOwnerFacade(this.lexOwnerContext);
  readonly editActions = new EditActionsHelper(this.editActionsContext);
  readonly interaction = new UserInteractionHelper(this.userInteractionContext);
  private readonly titleCoordinator = new ChatTitleCoordinator(this.titleCoordinatorContext, lexGenerateTitle);
  private readonly sendCoordinator = new ChatSendCoordinator(
    this,
    (content) => this.titleCoordinator.generate(content),
    () => this.resourceManager.getResourcesText(),
    (requestAgentId) => getUserSelectedToolsForRequest(
      {
        ailyChatConfigService: this.ailyChatConfigService,
        mcpService: this.mcpService,
      },
      requestAgentId,
      this.prjPath || this.prjRootPath || '',
    ),
  );
  private readonly stopCoordinator = new ChatStopCoordinator(this.stopCoordinatorContext);
  private readonly conversationActionCoordinator = new ChatConversationActionCoordinator(this.conversationActionCoordinatorContext);
  private readonly aiNoticeCoordinator = new ChatAiNoticeCoordinator({
    stop: () => this.stop(),
    updateNotice: (config) => {
      AilyHost.get().notice?.update(config);
    },
    clearNotice: () => {
      AilyHost.get().notice?.clear();
    },
  });
  private readonly switchCoordinator = new ChatSwitchCoordinator(this.switchCoordinatorContext);
  private readonly subscriptionCoordinator = new ChatSubscriptionCoordinator(this, {
    receiveTextFromExternal: (text, options) => this.receiveTextFromExternal(text, options),
    showAiWritingNotice: (isWaiting) => this.showAiWritingNotice(isWaiting),
    handleTaskAction: (event) => this.handleTaskAction(event),
    flushPendingAutoSend: () => this.flushPendingAutoSend(),
    syncAuthQuotaState: () => this.authQuotaStateService.syncAuthSnapshotFromHost(),
    refreshRequestQuotaState: () => this.refreshRequestQuotaState(),
    clearAuthQuotaState: () => this.authQuotaStateService.clear(),
    clearRequestQuotaState: () => this.requestQuotaStateService.clear(),
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
    voteResponse: (target, vote) => this.voteResponse(target, vote),
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
  currentMessageSource: string = MAIN_AGENT_TYPE;
  toolCallStates: { [key: string]: string } = {};

  // ==================== 内部状态（helper 可访问） ====================
  isSessionStarting = false;
  hasInitializedForThisLogin = false;
  isCancelled = false;
  /** 只读视图：从 lex TurnManager 派生的消息数组（lex 为唯一 source of truth） */
  get conversationMessages(): any[] {
      return this.lexStream.conversation.messages();
  }

  get dialogItems(): ChatDialogViewItem[] {
    const dialogItems = this.hostResponseProjection
      ? [...this.hostResponseProjection.dialogItems]
      : [];
    const canShowCheckpointRestore = this.editCheckpointService.hasRecoverableCheckpointRestoreRedoTurnResponses?.()
      ?? (this.editCheckpointService.getCheckpointRestoreRedoTurnResponses?.() ?? []).length > 0;
    return applyCheckpointRestoreVisibility(dialogItems, canShowCheckpointRestore);
  }

  get workspaceCheckpointPresentationMode() {
    return this.workspaceCheckpointProvider.getPresentationMode?.() ?? 'compatibility';
  }

  get hostResponseProjection(): HostResponseProjection | null {
    return this.getHostResponseState();
  }

  private getHostResponseState(): HostTurnResponseState | null {
    const snapshot = this.lexStream.session.snapshot();
    const liveSource = createLiveHostRequestGraphSource(
      () => snapshot,
      this.lexStream.turnResponses,
      this.lexStream.turns.currentId() ?? null,
      this.editCheckpointService.getDisabledRequestBoundaries().map(snapshot => snapshot.turnId),
    );

    return this.liveHostRequestGraphCache.getState(liveSource);
  }

  get hostRequestModel(): HostRequestModel | null {
    const snapshot = this.lexStream.session.snapshot();
    const liveSource = createLiveHostRequestGraphSource(
      () => snapshot,
      this.lexStream.turnResponses,
      this.lexStream.turns.currentId() ?? null,
      this.editCheckpointService.getDisabledRequestBoundaries().map(snapshot => snapshot.turnId),
    );

    return this.liveHostRequestGraphCache.getRequestModel(liveSource);
  }

  clearSharedHostRequestGraph(): void {
    this.liveHostRequestGraphCache.clear();
  }

  replaceSharedHostProjectionState(state: HostTurnResponseState | null): void {
    this.liveHostRequestGraphCache.replaceState(state);
    this.acceptLiveRequestQuotaState();
  }

  restoreSharedHostProjectionState(state: HostTurnResponseState | null): void {
    this.liveHostRequestGraphCache.replaceState(state);
  }

  private voteResponse(target: DialogTurnContext | null | undefined, vote: HostResponseVoteDirection): void {
    const turnId = target?.turnId;
    if (!turnId) {
      return;
    }

    const currentState = this.getHostResponseState();
    const nextState = applyHostResponseVoteToState(currentState, turnId, vote);
    if (nextState === currentState) {
      return;
    }

    this.replaceSharedHostProjectionState(nextState);
    if (this.sessionId) {
      this.chatHistoryService.markDirty(this.sessionId);
    }
    this.triggerSyncDetectChanges();
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
  /** 旧聊天链路会话级：已激活的 deferred 工具名称集合（通过 search_available_tools 加载） */
  legacyActivatedDeferredTools = new Set<string>();

  /** 延迟切换：活跃请求期间暂存待切换的模型/模式，完成后自动应用 */
  _pendingModelSwitch: ModelConfig | null = null;
  _pendingModeSwitch: string | null = null;

  /** autoSend 消息在 sessionId 未就绪时的暂存区，startSession 完成后自动冲刷 */
  private _pendingAutoSendText: string | null = null;

  // ==================== 订阅 ====================
  messageSubscription: any;
  private requestQuotaStateSubscription: Subscription | null = null;

  // ==================== 外部引用 ====================
  private chatTextareaRef: ElementRef | null = null;

  // ==================== Getters / Setters ====================

  get sessionId() { return this.chatService.currentSessionId; }
  set sessionId(value: string) { this.chatService.currentSessionId = value; }

  get sessionTitle() { return this.chatService.currentSessionTitle; }

  get currentMode() { return this.chatService.currentMode; }

  get currentModel() { return this.chatService.currentModel; }

  get currentModelName() { return this.getSelectedDisplayModel()?.name; }

  get currentReasoningEffort() { return this.chatService.currentModel?.reasoningEffort; }

  get currentReasoningEffortLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortLabel(this.currentReasoningEffort);
  }

  get currentReasoningEffortDisplayLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortDisplayLabel(
      this.ailyChatConfigService.resolveModelReasoningEffort(this.chatService.currentModel, this.currentReasoningEffort),
    );
  }

  get currentModelReasoningEfforts() {
    return this.ailyChatConfigService.getSupportedReasoningEfforts(this.chatService.currentModel);
  }

  get currentModelChipLabel(): string {
    const modelName = this.currentModelName;
    if (!modelName) {
      return '';
    }

    return modelName;
  }

  get currentModelTooltip(): string {
    return this.ailyChatConfigService.buildModelTooltip(this.getSelectedDisplayModel(), {
      maxContextTokens: this.contextBudgetSnapshot?.maxContextTokens,
    });
  }

  get currentModelBillingLabel(): string | undefined {
    return this.ailyChatConfigService.getModelBillingLabel(this.getSelectedDisplayModel());
  }

  private getSelectedDisplayModel(): ModelConfig | null {
    const activeDisplayModel = this.chatService.getActiveDisplayModel() ?? null;
    if (!activeDisplayModel) {
      return null;
    }

    if (!isDefaultAutoPresetSelected(this.chatService.currentModel)) {
      return activeDisplayModel;
    }

    return {
      ...activeDisplayModel,
      presetId: this.ailyChatConfigService.getDefaultModelPresetId(),
    };
  }

  syncRegisteredAgentNames(agentNames: readonly string[]): void {
    this.chatViewState.setAvailableAgents(agentNames);
  }

  get isWaiting() { return this._isWaiting; }
  set isWaiting(value: boolean) {
    this._isWaiting = value;
    this.chatService.isWaiting = value;
    AilyHost.get().blockly.aiWaiting = value;
    if (!value) {
      this.aiWriting = false;
      AilyHost.get().blockly.aiWaitWriting = false;
      void this.refreshRequestQuotaState();
    }
  }

  set aiWriting(value: boolean) {
    AilyHost.get().blockly.aiWriting = value;
  }

  get contextBudget$() { return this.contextBudgetViewService?.budget$; }

  get authQuotaSnapshot$() { return this.authQuotaStateService.authQuotaSnapshot$; }

  get chatInputNotice$() { return this.chatInputNoticeStateService.inputNotice$; }

  get authQuotaExhausted() { return this.authQuotaStateService.quotaExhausted; }

  get requestQuotaSnapshot$() { return this.requestQuotaStateService.requestQuotaSnapshot$; }

  get contextBudgetSnapshot(): ContextBudgetSnapshot | null {
    return this.contextBudgetViewService?.getSnapshot() ?? null;
  }

  get interactionBudgetSnapshot(): InteractionBudgetSnapshot | null {
    return createInteractionBudgetSnapshot(this.hostResponseProjection?.turnResponses ?? []);
  }

  get contextCompactionMetricsSnapshot(): MetricsSnapshot | null {
    return this.lexStream.compactionMetricsSnapshot;
  }

  async continueCurrentExecution(): Promise<void> {
    const continuation = this.readLatestInteractionContinuation();
    const pendingState = continuation?.pendingState && typeof continuation.pendingState === 'object'
      ? continuation.pendingState as Record<string, unknown>
      : null;
    if ((typeof pendingState?.['kind'] === 'string' ? pendingState['kind'] : undefined) !== 'continue') {
      return;
    }

    await this.resumeRestoredInteraction('继续', { kind: 'continue' });
  }

  async submitInteractionActionRequest(
    content: string,
    interactionAction: NonNullable<TurnRequest['metadata']>['interactionAction'],
  ): Promise<void> {
    await this.resumeRestoredInteraction(content, interactionAction);
  }

  get requestQuotaSnapshot(): RequestQuotaSnapshot | null {
    return this.requestQuotaStateService.getRequestQuotaSnapshot();
  }

  private createMessageDisplayContext(): ConstructorParameters<typeof MessageDisplayHelper>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.list = value; },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      get sessionId() { return thisEngine.sessionId; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get ngZone() { return thisEngine.ngZone; },
      get toolCallStates() { return thisEngine.toolCallStates; },
    };
  }

  private createUserInteractionContext(): ConstructorParameters<typeof UserInteractionHelper>[0] {
    const thisEngine = this;

    return {
      get lexStream() { return thisEngine.lexStream; },
      get isLoggedIn() { return thisEngine.isLoggedIn; },
      getCurrentProjectPath: () => thisEngine.getCurrentProjectPath(),
      get sessionId() { return thisEngine.sessionId; },
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
    };
  }

  private createEditActionsContext(): ConstructorParameters<typeof EditActionsHelper>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.list = value; },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      get sessionId() { return thisEngine.sessionId; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get ngZone() { return thisEngine.ngZone; },
      get isWaiting() { return thisEngine.isWaiting; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get pendingEditFeedback() { return thisEngine.pendingEditFeedback; },
      set pendingEditFeedback(value) { thisEngine.pendingEditFeedback = value; },
      get sessionAllowedPaths() { return thisEngine.sessionAllowedPaths; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      getCurrentProjectPath: () => this.getCurrentProjectPath(),
      get absAutoSyncService() { return thisEngine.absAutoSyncService; },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get workspaceCheckpointProvider() { return thisEngine.workspaceCheckpointProvider; },
      get resourceManager() { return thisEngine.resourceManager; },
      get message() { return thisEngine.message; },
      get lexStream() { return thisEngine.lexStream; },
      get session() { return thisEngine.session; },
      confirmRestoreCheckpoint: (confirmation) => thisEngine.confirmRestoreCheckpoint(confirmation),
      get hostResponseProjection() { return thisEngine.hostResponseProjection; },
      restoreSharedHostProjectionState: (state) => thisEngine.restoreSharedHostProjectionState(state),
      replaceSharedHostProjectionState: (state) => thisEngine.replaceSharedHostProjectionState(state),
      send: (sender, content, clear) => this.send(sender, content, clear),
    };
  }

  private async confirmRestoreCheckpoint(confirmation: RestoreCheckpointConfirmation): Promise<boolean> {
    if (this.restoreCheckpointDialogOpen) {
      return false;
    }

    const dialogData = this.buildRestoreCheckpointConfirmationDialogData(confirmation);

    return new Promise<boolean>((resolve) => {
      this.restoreCheckpointDialogOpen = true;

      const modalRef = this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzBodyStyle: {
          padding: '0',
        },
        nzWidth: '350px',
        nzContent: UnsaveDialogComponent,
        nzData: dialogData,
      });

      modalRef.afterClose.subscribe(result => {
        this.restoreCheckpointDialogOpen = false;
        resolve(result?.result === 'confirm');
      });
    });
  }

  private buildRestoreCheckpointConfirmationDialogData(
    confirmation: RestoreCheckpointConfirmation,
  ): UnsaveDialogData {
    return {
      title: confirmation.requestCount === 1
        ? this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.TITLE_SINGLE',
          'Do you want to undo your last edit?',
        )
        : this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.TITLE_MULTIPLE',
          'Do you want to undo {{count}} edits?',
          { count: confirmation.requestCount },
        ),
      text: this.buildRestoreCheckpointConfirmationMessage(confirmation),
      buttons: [
        {
          text: this.translateRestoreCheckpointDialogText('UNSAVE_DIALOG.CANCEL', 'Cancel'),
          type: 'default',
          action: 'cancel',
        },
        {
          text: this.translateRestoreCheckpointDialogText('CHECKPOINT_RESTORE_DIALOG.CONFIRM', 'Yes'),
          type: 'primary',
          danger: true,
          action: 'confirm',
        },
      ],
    };
  }

  private buildRestoreCheckpointConfirmationMessage(
    confirmation: RestoreCheckpointConfirmation,
  ): string {
    const isLastRequest = confirmation.requestCount === 1;

    if (confirmation.fileCount === 1 && confirmation.fileLabel) {
      return isLastRequest
        ? this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_LAST_SINGLE_FILE',
          'This will remove your last request and undo the edits made to {{file}}. Do you want to proceed?',
          { file: confirmation.fileLabel },
        )
        : this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_MULTI_SINGLE_FILE',
          'This will remove all subsequent requests and undo edits made to {{file}}. Do you want to proceed?',
          { file: confirmation.fileLabel },
        );
    }

    if (confirmation.fileCount > 0) {
      return isLastRequest
        ? this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_LAST_MULTI_FILE',
          'This will remove your last request and undo edits made to {{count}} files in your working set. Do you want to proceed?',
          { count: confirmation.fileCount },
        )
        : this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_MULTI_FILE',
          'This will remove all subsequent requests and undo edits made to {{count}} files in your working set. Do you want to proceed?',
          { count: confirmation.fileCount },
        );
    }

    return isLastRequest
      ? this.translateRestoreCheckpointDialogText(
        'CHECKPOINT_RESTORE_DIALOG.MESSAGE_LAST_NO_FILE',
        'This will remove your last request and restore the chat to that point. Do you want to proceed?',
      )
      : this.translateRestoreCheckpointDialogText(
        'CHECKPOINT_RESTORE_DIALOG.MESSAGE_MULTI_NO_FILE',
        'This will remove all subsequent requests and restore the chat to that point. Do you want to proceed?',
      );
  }

  private translateRestoreCheckpointDialogText(
    key: string,
    fallback: string,
    params?: Record<string, string | number>,
  ): string {
    const translated = this.translate?.instant?.(key, params);
    if (typeof translated === 'string' && translated !== key) {
      return translated;
    }

    return this.interpolateRestoreCheckpointDialogText(fallback, params);
  }

  private interpolateRestoreCheckpointDialogText(
    template: string,
    params?: Record<string, string | number>,
  ): string {
    if (!params) {
      return template;
    }

    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token: string) => {
      const value = params[token];
      return typeof value === 'undefined' ? '' : String(value);
    });
  }

  private createSessionLifecycleContext(): ConstructorParameters<typeof SessionLifecycleHelper>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.list = value; },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      get menuManager() { return thisEngine.menuManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      get sessionId() { return thisEngine.sessionId; },
      set sessionId(value) { thisEngine.sessionId = value; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get ngZone() { return thisEngine.ngZone; },
      get isWaiting() { return thisEngine.isWaiting; },
      set isWaiting(value) { thisEngine.isWaiting = value; },
      get isSessionStarting() { return thisEngine.isSessionStarting; },
      set isSessionStarting(value) { thisEngine.isSessionStarting = value; },
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get toolCallingIteration() { return thisEngine.toolCallingIteration; },
      set toolCallingIteration(value) { thisEngine.toolCallingIteration = value; },
      get mcpInitialized() { return thisEngine.mcpInitialized; },
      set mcpInitialized(value) { thisEngine.mcpInitialized = value; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get messageSubscription() { return thisEngine.messageSubscription; },
      set messageSubscription(value) { thisEngine.messageSubscription = value; },
      get activeToolExecutions() { return thisEngine.activeToolExecutions; },
      set activeToolExecutions(value) { thisEngine.activeToolExecutions = value; },
      get hasInitializedForThisLogin() { return thisEngine.hasInitializedForThisLogin; },
      set hasInitializedForThisLogin(value) { thisEngine.hasInitializedForThisLogin = value; },
      get legacyActivatedDeferredTools() { return thisEngine.legacyActivatedDeferredTools; },
      get sessionTitle() { return thisEngine.sessionTitle; },
      get sessionAllowedPaths() { return thisEngine.sessionAllowedPaths; },
      set sessionAllowedPaths(value) { thisEngine.sessionAllowedPaths = value; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get chatService() { return thisEngine.chatService; },
      get currentMode() { return thisEngine.currentMode; },
      get currentModel() { return thisEngine.currentModel; },
      get prjPath() { return thisEngine.prjPath; },
      get prjRootPath() { return thisEngine.prjRootPath; },
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get repetitionDetectionService() { return thisEngine.repetitionDetectionService; },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get mcpService() { return thisEngine.mcpService; },
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
      get resourceManager() { return thisEngine.resourceManager; },
      get message() { return thisEngine.message; },
      get translate() { return thisEngine.translate; },
      get interaction() { return thisEngine.interaction; },
      get lexStream() { return thisEngine.lexStream; },
      resumeRestoredInteraction: (content, interactionAction) => thisEngine.resumeRestoredInteraction(content, interactionAction),
      send: (sender, content, clear) => this.send(sender, content, clear),
      get session() { return thisEngine.session; },
      get hostRequestModel() { return thisEngine.hostRequestModel; },
      get hostResponseProjection() { return thisEngine.hostResponseProjection; },
      restoreSharedHostProjectionState: (state) => this.restoreSharedHostProjectionState(state),
      replaceSharedHostProjectionState: (state) => this.replaceSharedHostProjectionState(state),
    };
  }

  private createLexOwnerContext(): ConstructorParameters<typeof LexOwnerFacade>[0] {
    const thisEngine = this;

    return {
      get prjPath() { return thisEngine.prjPath; },
      get prjRootPath() { return thisEngine.prjRootPath; },
      get currentModel() { return thisEngine.currentModel; },
      get sessionId() { return thisEngine.sessionId; },
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      get mcpService() { return thisEngine.mcpService; },
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
      handleToolApproval: request => this.handleToolApproval(request),
      get lexStream() { return thisEngine.lexStream; },
      openSettings: () => this.openSettings(),
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get ngZone() { return thisEngine.ngZone; },
      get message() { return thisEngine.message; },
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.list = value; },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      get inputValue() { return thisEngine.inputValue; },
      set inputValue(value) { thisEngine.inputValue = value; },
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      set currentMessageSource(value) { thisEngine.currentMessageSource = value; },
      get toolCallingIteration() { return thisEngine.toolCallingIteration; },
      set toolCallingIteration(value) { thisEngine.toolCallingIteration = value; },
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get isWaiting() { return thisEngine.isWaiting; },
      set isWaiting(value) { thisEngine.isWaiting = value; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get session() { return thisEngine.session; },
      applyPendingSwitch: () => this.applyPendingSwitch(),
      get repetitionDetectionService() { return thisEngine.repetitionDetectionService; },
      get editActions() { return thisEngine.editActions; },
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get activeToolExecutions() { return thisEngine.activeToolExecutions; },
      set activeToolExecutions(value) { thisEngine.activeToolExecutions = value; },
      get currentStatelessMode() { return thisEngine.currentStatelessMode; },
      set currentStatelessMode(value) { thisEngine.currentStatelessMode = value; },
    };
  }

  private createTitleCoordinatorContext(): ConstructorParameters<typeof ChatTitleCoordinator>[0] {
    const thisEngine = this;

    return {
      get sessionId() { return thisEngine.sessionId; },
      get sessionTitle() { return thisEngine.sessionTitle; },
      get chatService() { return thisEngine.chatService; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModel() { return thisEngine.currentModel; },
      get session() { return thisEngine.session; },
      get lexStream() { return thisEngine.lexStream; },
    };
  }

  private createStopCoordinatorContext(): ConstructorParameters<typeof ChatStopCoordinator>[0] {
    const thisEngine = this;

    return {
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get messageSubscription() { return thisEngine.messageSubscription; },
      set messageSubscription(value) { thisEngine.messageSubscription = value; },
      get pendingUserInput() { return thisEngine.pendingUserInput; },
      set pendingUserInput(value) { thisEngine.pendingUserInput = value; },
      get activeToolExecutions() { return thisEngine.activeToolExecutions; },
      set activeToolExecutions(value) { thisEngine.activeToolExecutions = value; },
      get currentStatelessMode() { return thisEngine.currentStatelessMode; },
      set currentStatelessMode(value) { thisEngine.currentStatelessMode = value; },
      get isWaiting() { return thisEngine.isWaiting; },
      set isWaiting(value) { thisEngine.isWaiting = value; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get lexStream() { return thisEngine.lexStream; },
      get session() { return thisEngine.session; },
      applyPendingSwitch: () => this.applyPendingSwitch(),
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get viewAdapter() { return thisEngine.viewAdapter; },
    };
  }

  private createSwitchCoordinatorContext(): ConstructorParameters<typeof ChatSwitchCoordinator>[0] {
    const thisEngine = this;

    return {
      get isWaiting() { return thisEngine.isWaiting; },
      get _pendingModelSwitch() { return thisEngine._pendingModelSwitch; },
      set _pendingModelSwitch(value) { thisEngine._pendingModelSwitch = value; },
      get _pendingModeSwitch() { return thisEngine._pendingModeSwitch; },
      set _pendingModeSwitch(value) { thisEngine._pendingModeSwitch = value; },
      get currentModel() { return thisEngine.currentModel; },
      get currentMode() { return thisEngine.currentMode; },
      get chatService() { return thisEngine.chatService; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get languageModelsService() { return thisEngine.languageModelsService; },
      get message() { return thisEngine.message; },
      get lexStream() { return thisEngine.lexStream; },
    };
  }

  private createConversationActionCoordinatorContext(): ConstructorParameters<typeof ChatConversationActionCoordinator>[0] {
    const thisEngine = this;

    return {
      get isWaiting() { return thisEngine.isWaiting; },
      get sessionId() { return thisEngine.sessionId; },
      send: (sender, content, clear) => this.send(sender, content, clear),
      get message() { return thisEngine.message; },
      get scrollManager() { return thisEngine.scrollManager; },
    };
  }

  // ==================== 构造函数 ====================

  constructor(
    public chatService: ChatService,
    public mcpService: McpService,
    public ailyChatConfigService: AilyChatConfigService,
    public languageModelsService: AilyChatLanguageModelsService,
    public chatHistoryService: ChatHistoryService,
    public repetitionDetectionService: RepetitionDetectionService,
    public contextBudgetService: ContextBudgetService,
    public configService: ConfigService,
    private contextBudgetViewService: ContextBudgetViewService,
    public authQuotaStateService: AuthQuotaStateService,
    public chatInputNoticeStateService: ChatInputNoticeStateService,
    public ngZone: NgZone,
    public absAutoSyncService: AbsAutoSyncService,
    public editCheckpointService: EditCheckpointService,
    public workspaceCheckpointProvider: GitWorkspaceCheckpointProviderService,
    public translate: TranslateService,
    public message: NzMessageService,
    public scrollManager: ScrollManagerService,
    public resourceManager: ResourceManagerService,
    public menuManager: MenuManagerService,
    public runtimeInteractionHost: ChatRuntimeInteractionHostService,
    public requestQuotaStateService: RequestQuotaStateService,
  ) {
    this.editCheckpointService.setWorkspaceCheckpointProvider(this.workspaceCheckpointProvider);

    // 初始化 viewAdapter（需要 ngZone 已注入）
    (this as any).viewAdapter = new ChatViewAdapter(
      () => this.list,
      (msg) => this.list.push(msg),
      () => this.currentMessageSource,
      () => this.currentModelName || undefined,
      () => this.currentModelBillingLabel || undefined,
      () => this._isWaiting,
      () => { if (this.sessionId) { this.chatHistoryService.markDirty(this.sessionId); } },
      this.ngZone,
      undefined, // cdCallback — 由 component 通过 setCdCallback 注入
      () => this.scrollManager.captureAutoScrollState(),
      (shouldFollow) => this.scrollManager.scrollToBottomIfNeeded(shouldFollow, 'auto'),
    );

    this.chatHistoryService.setLiveSessionProvider(() => this.session.buildHostSessionRecord());

    // H1: wire the cache as the host stream listener for incremental turn events.
    this.lexStream.setHostStreamListener(this.liveHostRequestGraphCache);
  }

  /** 注册 OnPush CD 回调（由 component 调用 cdr.markForCheck） */
  setCdCallback(cb: () => void): void {
    this.viewAdapter.setCdCallback(cb);
  }

  /**
   * 同步 detectChanges 回调 — 在 runOutsideAngular 场景中使用。
   * markForCheck 在 zone 外不会触发实际 CD，此回调直接同步执行 detectChanges。
   */
  private _syncDetectChanges: (() => void) | null = null;

  setSyncDetectChanges(cb: () => void): void {
    this._syncDetectChanges = cb;
  }

  invalidateHostRequestGraph(): void {
    this.liveHostRequestGraphCache.markDirty();
  }

  /** 同步触发变更检测（zone 安全） */
  triggerSyncDetectChanges(): void {
    if (this._syncDetectChanges) {
      this.ngZone.run(() => this._syncDetectChanges!());
    }
  }

  openSettings(): void {
    this.chatViewState.openSettings();
    this.triggerSyncDetectChanges();
  }

  // ==================== 初始化 / 销毁 ====================

  /**
   * 引擎初始化 — 由 Component 的 ngOnInit 调用
   * @param chatTextareaRef 输入框 ElementRef（用于自动聚焦）
   */
  init(chatTextareaRef: ElementRef | null): void {
    this.chatTextareaRef = chatTextareaRef;
    this.chatService.isWaiting = this._isWaiting;
    void this.refreshRequestQuotaState();

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
    this.liveHostRequestGraphCache.clear();
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
    this.requestQuotaStateSubscription = this.requestQuotaStateService.requestQuotaSnapshot$
      .pipe(distinctUntilChanged())
      .subscribe(() => this.triggerSyncDetectChanges());
  }

  private cleanupSubscriptions(): void {
    this.requestQuotaStateSubscription?.unsubscribe();
    this.requestQuotaStateSubscription = null;
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

  async compactConversation(): Promise<boolean> {
    const changed = await this.lexStream.compactConversation();
    if (changed) {
      this.invalidateHostRequestGraph();
      this.triggerSyncDetectChanges();
    }
    return changed;
  }

  // ==================== 消息发送 ====================

  async send(sender: string, content: string, clear: boolean = true): Promise<void> {
    await maybeAutoSwitchToDefaultModelAfterRateLimit(this);

    const prepared = this.sendCoordinator.prepareSend(sender, content);
    if (!prepared) return;

    this.lexStream.turn.begin(prepared.llmText, prepared.displayText, prepared.requestMetadata);
    if (clear) {
      this.inputValue = '';
      this.triggerSyncDetectChanges();
    }

    await this.lexStream.turn.run(prepared.llmText, prepared.displayText);
    this.acceptLiveRequestQuotaState();
    this.refreshAuthQuotaStateAfterSuccessfulTurn();

    if (this.chatService.currentSessionId) {
      await this.chatService.syncResolvedActiveModelAfterSuccessfulTurn(
        this.chatService.currentSessionId,
        this.hostResponseProjection?.turnResponses ?? [],
      );
      this.triggerSyncDetectChanges();
    }
  }

  private async resumeRestoredInteraction(
    content: string,
    interactionAction: NonNullable<TurnRequest['metadata']>['interactionAction'],
  ): Promise<void> {
    if (!this.sessionId || this.isWaiting) {
      return;
    }

    this.lexStream.turn.begin(
      content,
      content,
      this.sendCoordinator?.applyRuntimePromptContext?.({ interactionAction }) ?? { interactionAction },
    );
    await this.lexStream.turn.run(content, content);
    this.acceptLiveRequestQuotaState();
    this.refreshAuthQuotaStateAfterSuccessfulTurn();

    if (this.chatService.currentSessionId) {
      await this.chatService.syncResolvedActiveModelAfterSuccessfulTurn(
        this.chatService.currentSessionId,
        this.hostResponseProjection?.turnResponses ?? [],
      );
      this.triggerSyncDetectChanges();
    }
  }

  private readLatestInteractionContinuation(): TurnResponseTurn['response']['continuation'] | undefined {
    const turns = this.hostResponseProjection?.turnResponses ?? [];
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const continuation = turns[index]?.response?.continuation;
      if (continuation) {
        return continuation;
      }
    }

    return undefined;
  }

  private refreshAuthQuotaStateAfterSuccessfulTurn(): void {
    // Successful turn responses already carry premium_interactions quota data.
    // Avoid a second auth/me quota fetch on every send; user center refreshes on demand.
  }

  private refreshAuthQuotaStateFromHost(): void {
    this.authQuotaStateService.syncAuthSnapshotFromHost();
  }

  private async refreshRequestQuotaState(): Promise<void> {
    await this.requestQuotaStateService.refresh();
  }

  private acceptLiveRequestQuotaState(): void {
    this.requestQuotaStateService.acceptTurnResponseQuotaSnapshot(
      this.hostResponseProjection?.turnResponses ?? [],
    );
    this.projectAuthQuotaStateFromRequestQuota();
  }

  private projectAuthQuotaStateFromRequestQuota(): void {
    const premiumInteractions = this.requestQuotaStateService.getSnapshot()?.quotaSnapshots?.['premium_interactions'];
    if (!premiumInteractions) {
      return;
    }

    const hostMetadata = readAuthQuotaStateSnapshot(AilyHost.get().auth.getSnapshot?.() ?? null);
    const quotaInfo: AuthQuotaInfo = {
      source: 'token',
      usageUnit: 'interactions',
      quota: premiumInteractions.entitlement,
      used: premiumInteractions.entitlement >= 0
        ? Math.max(0, premiumInteractions.entitlement - premiumInteractions.remaining)
        : 0,
      remaining: premiumInteractions.remaining,
      percentRemaining: Math.max(0, Math.min(100, premiumInteractions.percentRemaining)),
      ...(premiumInteractions.unlimited === true || premiumInteractions.entitlement < 0
        ? { unlimited: true }
        : {}),
      ...(typeof premiumInteractions.overageCount === 'number'
        ? { overageCount: premiumInteractions.overageCount }
        : {}),
      ...(typeof premiumInteractions.overagePermitted === 'boolean'
        ? { overagePermitted: premiumInteractions.overagePermitted }
        : {}),
      ...(typeof premiumInteractions.resetAt === 'string'
        ? { resetTime: premiumInteractions.resetAt }
        : {}),
    };

    this.authQuotaStateService.acceptProjectedQuotaInfo(quotaInfo, {
      ...(typeof hostMetadata.plan === 'string' ? { plan: hostMetadata.plan } : {}),
      ...(typeof hostMetadata.serviceTier === 'string' ? { serviceTier: hostMetadata.serviceTier } : {}),
      ...(typeof hostMetadata.subscriptionStatus === 'string'
        ? { subscriptionStatus: hostMetadata.subscriptionStatus }
        : {}),
      ...(typeof hostMetadata.subscriptionEndDate === 'string'
        ? { subscriptionEndDate: hostMetadata.subscriptionEndDate }
        : {}),
    });
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

  async switchToReasoningEffort(reasoningEffort: NonNullable<ModelConfig['reasoningEffort']>): Promise<void> {
    await this.switchCoordinator.switchToReasoningEffort(reasoningEffort);
  }

  async switchToModelConfiguration(
    model: ModelConfig,
    update: { key: string; value: unknown },
  ): Promise<void> {
    await this.switchCoordinator.switchToModelConfiguration(model, update);
  }

  /**
   * 应用延迟的模型/模式切换。
   * 在 turn 完成（finalizeStatelessTurn / stream complete / stop）后调用。
   */
  async applyPendingSwitch(): Promise<void> {
    await this.switchCoordinator.applyPendingSwitch();
  }

  // ==================== 任务操作 ====================

  private handleTaskAction(event: ChatTaskActionEvent): void {
    this.taskActionCoordinator.handle(event.detail);
  }

  async continueConversation(): Promise<void> {
    await this.conversationActionCoordinator.continueConversation();
  }

  async retryLastAction(): Promise<void> {
    await this.conversationActionCoordinator.retryLastAction();
  }

  // ==================== 委托到 EditActionsHelper ====================

  editAndResendFromTurn(target: DialogTurnContext, newText: string, resources: ResourceItem[]): Promise<void> {
    return this.editActions.editAndResendFromTurn(target, newText, resources);
  }

  // ==================== 委托到 UserInteractionHelper ====================

  handleToolApproval(
    request: import('../helpers/tool-approval-ui').ToolApprovalRequest,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    return this.interaction.handleToolApproval(request);
  }

  resolveAskUserResponse(answer: string, wasFreeform: boolean): void {
    this.interaction.resolveAskUserResponse(answer, wasFreeform);
  }

  skipAskUserResponse(): void {
    this.interaction.skipAskUserResponse();
  }

  approveToolExecution(
    toolCallId: string,
    scope: 'once' | 'session' | 'workspace' | 'session-all-terminal' | 'session-safe' = 'once',
    actionId?: string,
  ): void {
    this.interaction.approveToolExecution(toolCallId, scope, actionId);
  }

  rejectToolExecution(toolCallId: string, reason?: string): void {
    this.interaction.rejectToolExecution(toolCallId, reason);
  }
}

async function maybeAutoSwitchToDefaultModelAfterRateLimit(engine: {
  chatService?: {
    currentModel?: ModelConfig | null;
    getRateLimitAutoSwitchToAutoEnabled?: () => boolean;
  };
  hostResponseProjection?: HostResponseProjection | null;
  ailyChatConfigService?: {
    getDefaultModelPresetId: () => string;
    resolvePresetModel: (presetId: string) => ModelConfig | null;
  };
  switchToModel?: (model: ModelConfig) => Promise<void>;
}): Promise<void> {
  if (!engine.chatService?.getRateLimitAutoSwitchToAutoEnabled?.()) {
    return;
  }

  if (isDefaultAutoPresetSelected(engine.chatService.currentModel)) {
    return;
  }

  const latestErrorCode = readLatestErrorCode(engine.hostResponseProjection);
  if (!latestErrorCode?.startsWith('user_model_rate_limited')) {
    return;
  }

  const configService = engine.ailyChatConfigService;
  if (!configService) {
    return;
  }

  const autoModel = configService.resolvePresetModel(configService.getDefaultModelPresetId());
  if (!autoModel || typeof engine.switchToModel !== 'function') {
    return;
  }

  await engine.switchToModel(autoModel);
}

function readLatestErrorCode(hostProjection: HostResponseProjection | null | undefined): string | undefined {
  const turns = hostProjection?.turnResponses;
  if (!Array.isArray(turns) || turns.length === 0) {
    return undefined;
  }

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const parts = turns[turnIndex]?.response?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex] as {
        type?: string;
        metadata?: { errorDetails?: { code?: unknown } };
      };
      if (part?.type !== 'error') {
        continue;
      }

      const errorCode = part.metadata?.errorDetails?.code;
      if (typeof errorCode === 'string' && errorCode.trim().length > 0) {
        return errorCode;
      }
    }
  }

  return undefined;
}
