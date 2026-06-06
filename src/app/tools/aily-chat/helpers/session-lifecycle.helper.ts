/**
 * SessionLifecycleHelper — 会话生命周期辅助类
 *
 * 负责会话的创建、关闭、保存、历史加载等逻辑。
 * 负责本地 session/projection/restore 协调；interaction 的 authoritative state
 * 仍由 services 返回的 continuation / pendingState 决定，不在这里本地判定 lease 或 pending 合法性。
 */

import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IChatViewAccess,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import type { LiveHostSessionRecord } from '../services/chat-history.service';
import type {
  HostSessionRecord,
  ImportedDebugSessionRecord,
} from '../services/chat-history.service';
import type { ChatSessionRuntimeState } from '../services/chat-session-runtime-store.service';
import type {
  ChatSessionEntryStateService,
  PersistedChatSessionEntryTarget,
} from '../services/chat-session-entry-state.service';
import { AilyHost } from '../core/host';
import { SkillRegistry } from '../core/skill-registry';
import {
  readHostSessionRestoreFailureDetails,
  type RuntimeRestoreHostRecordRequest,
  type HostSessionRestoreFailureDetails,
} from './host-session-restore-bridge';
import { HostSessionSaveBridge } from './host-session-save-bridge';
import type { HostSessionSaveTarget } from './host-session-save-bridge';
import type { ChatViewWriteBridgeContext } from './chat-view-write-bridge';
import type { ResourceItem } from '../core/chat-types';
import type { HostResponseProjection } from './host-turn-response-state';
import type { ChatListItem } from '../services/chat-history.service';
import type { ChatSelectedMode } from '../core/chat-mode';
import { DEFAULT_CHAT_SESSION_TYPE, normalizeChatSelectedMode, normalizeChatSessionType, normalizeChatSurfaceModeId } from '../core/chat-mode';
import {
  buildHostSessionCurrentPickerInputState,
  createHostSessionProviderOptionsKey,
  normalizeHostSessionProviderOptions,
  resolveHostSessionProviderOptions,
  resolveHostSessionSelectedMode,
  type HostSessionProviderOptions,
} from './host-session-input-state';
import {
  buildHostSessionCurrentPickerRoutingSummary,
  normalizeHostSessionRequestRoutingSummary,
} from './host-session-request-routing';
import { type ChatSessionTitleSource } from '../core/chat-session-title';
import { HostSessionItemController } from './host-session-item-controller';
import type { HostSessionSwitchRestoreDiagnostics } from './host-session-item-controller';
import {
  HostSessionContentProvider,
  resolveHostSessionProjectPathHint,
  type HostSessionContent,
  type HostSessionContentMetadataSource,
} from './host-session-content-provider';
import type { ChatSessionItemsService } from '../services/chat-session-items.service';
import { ChatSessionEntryCoordinator } from './chat-session-entry-coordinator';
import { ChatPerformanceTracer } from '../services/chat-perf-tracer';

type LexInteractionAction = NonNullable<import('aily-lex/browser').TurnRequest['metadata']>['interactionAction'];

function applyCurrentSessionTitle(
  chatService: {
    currentSessionTitle?: string;
    setCurrentSessionTitle?: (candidate: { text: string; source: ChatSessionTitleSource }) => void;
  },
  candidate: { text: string; source: ChatSessionTitleSource },
): void {
  if (typeof chatService.setCurrentSessionTitle === 'function') {
    chatService.setCurrentSessionTitle(candidate);
    return;
  }

  chatService.currentSessionTitle = candidate.text;
}

type SessionLifecycleContext = ChatViewWriteBridgeContext
  & Pick<
    IAgentLifecycle,
    | 'isWaiting'
    | 'isSessionStarting'
    | 'isCancelled'
    | 'toolCallingIteration'
    | 'mcpInitialized'
    | 'isCompleted'
    | 'messageSubscription'
    | 'activeToolExecutions'
    | 'hasInitializedForThisLogin'
    | 'legacyActivatedDeferredTools'
  >
  & Pick<ISessionAccess, 'sessionTitle' | 'sessionAllowedPaths' | 'conversationMessages' | 'chatService'>
  & Pick<IProjectContext, 'currentMode' | 'currentModel' | 'prjPath' | 'prjRootPath' | 'isLoggedIn'>
  & Pick<
    IChatServiceAccess,
    | 'contextBudgetService'
    | 'repetitionDetectionService'
    | 'editCheckpointService'
    | 'mcpService'
    | 'ailyChatConfigService'
    | 'runtimeInteractionHost'
    | 'resourceManager'
    | 'message'
    | 'translate'
  >
  & Pick<IChatCoordination, 'interaction' | 'lexStream' | 'send' | 'session'>
  & {
    readonly chatSessionItemsService?: Pick<ChatSessionItemsService, 'sessionItemController' | 'refreshHistoryList' | 'requestSessionListRefresh' | 'loadInitialSummaries' | 'sessionListItems'>;
    readonly chatSessionEntryStateService?: Pick<
      ChatSessionEntryStateService,
      'readSessionEntryTarget' | 'setSessionEntryTarget' | 'clearSessionEntryTarget'
    >;
    readonly hostRequestModel?: import('./host-turn-response-state').HostRequestModel | null;
    readonly hostResponseProjection?: import('./host-turn-response-state').HostResponseProjection | null;
    captureActiveSessionRuntimeState?(): void;
    clearSessionRuntimeState?(sessionId?: string | null): void;
    readSessionRuntimeState?(sessionId?: string | null): Readonly<ChatSessionRuntimeState> | undefined;
    projectRestoredRuntimeAuxiliary?(sessionId: string, auxiliary: HostSessionRecord['auxiliary'] | null | undefined): void;
    detachSessionRuntimeView?(sessionId?: string | null): boolean;
    attachCurrentSessionView?(): Promise<void>;
    ensureBackgroundSessionCanRerun?(sessionId?: string | null): void;
    resetVisibleSessionProjection(options?: {
      readonly clearResolvedActiveModel?: boolean;
      readonly clearTurns?: boolean;
      readonly resetContextBudget?: boolean;
      readonly clearEditSummary?: boolean;
      readonly resetToolCallingIteration?: boolean;
      readonly detectChanges?: boolean;
    }): void;
    stopSessionAction(sessionId?: string | null): boolean;
    disposeSessionAction(sessionId?: string | null): boolean;
    buildRuntimeRestoreHostRecord?(request: RuntimeRestoreHostRecordRequest): HostSessionRecord | null;
    restoreSessionHostRecord(hostRecord: HostSessionRecord, options?: { readonly isCurrent?: () => boolean }): Promise<void>;
    resumeRestoredInteraction?(
      content: string,
      interactionAction: LexInteractionAction,
      options?: {
        readonly sessionId?: string | null;
        readonly requestMetadata?: import('aily-lex/browser').TurnRequest['metadata'];
      },
    ): Promise<void>;
    restoreSharedHostProjectionState?(state: import('./host-turn-response-state').HostTurnResponseState | null): void;
    replaceSharedHostProjectionState?(state: import('./host-turn-response-state').HostTurnResponseState | null): void;
  };

const GENERIC_SESSION_START_ERROR_MESSAGE = 'Sorry, something went wrong.';
type SessionSwitchRestoreStage = 'session-start' | 'host-restore';
const ENTRY_DISPOSE_RUNTIME_GUARD_PREFIX = '[AilyChat][EntryLifecycleGuard]';

export interface SessionLifecycleRestoreErrorDetails {
  readonly stage: SessionSwitchRestoreStage;
  readonly diagnostics: HostSessionSwitchRestoreDiagnostics;
  readonly restoreFailure: HostSessionRestoreFailureDetails | null;
}

export interface SessionLifecycleSwitchOptions {
  readonly fallbackProjectPath?: string | null;
  readonly hostRecordOverride?: HostSessionRecord | null;
}

export class SessionLifecycleSupersededError extends Error {
  constructor(message = '[SessionLifecycle] Session activation superseded by a newer request') {
    super(message);
    this.name = 'SessionLifecycleSupersededError';
  }
}

export class SessionLifecycleRestoreError extends Error {
  readonly details: SessionLifecycleRestoreErrorDetails;

  constructor(
    message: string,
    details: SessionLifecycleRestoreErrorDetails,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'SessionLifecycleRestoreError';
    this.details = details;
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function readSessionLifecycleRestoreErrorDetails(value: unknown): SessionLifecycleRestoreErrorDetails | null {
  return value instanceof SessionLifecycleRestoreError
    ? value.details
    : null;
}

export function isSessionLifecycleSupersededError(value: unknown): value is SessionLifecycleSupersededError {
  return value instanceof SessionLifecycleSupersededError;
}

export class SessionLifecycleHelper {
  private readonly _hostSessionSaveBridge: HostSessionSaveBridge;
  private readonly _hostSessionContentProvider: HostSessionContentProvider;
  private _localHostSessionItemController: HostSessionItemController | null = null;
  private readonly _entryCoordinator: ChatSessionEntryCoordinator;
  private sessionActivationRequestId = 0;

  constructor(private ctx: SessionLifecycleContext) {
    this._hostSessionSaveBridge = new HostSessionSaveBridge(this.ctx);
    this._hostSessionContentProvider = new HostSessionContentProvider(this.ctx);
    this._entryCoordinator = new ChatSessionEntryCoordinator({
      get isLoggedIn() {
        return ctx.isLoggedIn;
      },
      get hasCurrentSession() {
        return !!ctx.sessionId;
      },
      enterEntryState: (options) => this.enterEntryState(options),
      enterBlankSessionShell: (options) => this.enterBlankSessionShell(options),
      startSession: () => this.startSession(),
      restorePersistedSessionTarget: () => this.restorePersistedSessionTarget(),
      requestSessionListRefresh: (input) => this.requestSessionListRefresh(input),
    });
  }

  private warmupHardwareIndexForAI(debugSource: string): void {
    void (async () => {
      try {
        console.info('[SessionLifecycle][debug] warm hardware index in background', {
          debugSource,
        });
        const config = AilyHost.get().config;
        if (config.scheduleHardwareIndexRefreshForAI) {
          config.scheduleHardwareIndexRefreshForAI(debugSource, { force: true });
          return;
        }
        await config.loadHardwareIndexForAI?.();
      } catch (err) {
        console.warn('[AilyChat] 加载硬件索引失败:', err);
      }
    })();
  }

  private get hostSessionItemController(): HostSessionItemController {
    const sessionItemsService = this.ctx.chatSessionItemsService;
    if (sessionItemsService?.sessionItemController) {
      return sessionItemsService.sessionItemController;
    }

    if (!this._localHostSessionItemController) {
      this._localHostSessionItemController = new HostSessionItemController(this.ctx);
    }

    return this._localHostSessionItemController;
  }

  buildHostSessionRecord(options?: {
    previousHostProjection?: HostResponseProjection | null;
    hostProjection?: HostResponseProjection | null;
    visibleChatList?: readonly ChatListItem[];
    turnResponsesOverride?: readonly import('aily-lex/browser').TurnResponseTurn[];
    target?: HostSessionSaveTarget | null;
  }): LiveHostSessionRecord | null {
    return this._hostSessionSaveBridge.buildHostSessionRecord(options);
  }

  buildLiveHostSessionRecord(options?: {
    hostProjection?: HostResponseProjection | null;
    visibleChatList?: readonly ChatListItem[];
    turnResponsesOverride?: readonly import('aily-lex/browser').TurnResponseTurn[];
    sessionSnapshotOverride?: import('aily-lex/browser').SessionSnapshot | null;
  }): LiveHostSessionRecord | null {
    return this._hostSessionSaveBridge.buildLiveHostSessionRecord(options);
  }

  async importDebugSnapshot(data: Uint8Array): Promise<ImportedDebugSessionRecord | null> {
    return this.ctx.chatHistoryService.importDebugSnapshot?.(data) ?? null;
  }

  async openImportedDebugSnapshot(sessionId: string): Promise<boolean> {
    const imported = this.ctx.chatHistoryService.getImportedDebugSnapshot?.(sessionId) ?? null;
    return !!imported;
  }

  async restorePersistedSessionTarget(): Promise<boolean> {
    const entryStateService = this.ctx.chatSessionEntryStateService;
    if (!entryStateService) {
      return false;
    }

    const currentProjectPathHint = this.resolveCurrentProjectPath();
    const target = entryStateService.readSessionEntryTarget(currentProjectPathHint);
    if (!target?.sessionId) {
      return false;
    }

    if (this.ctx.chatHistoryService.findEntry(target.sessionId)) {
      await this.switchToSession(target.sessionId);
      return true;
    }

    const projectPathHint = target.projectPath ?? this.resolveCurrentProjectPath();
    const persistedHostRecord = this.ctx.chatHistoryService.loadHostRecord?.(target.sessionId, projectPathHint);
    if (!persistedHostRecord && !this.ctx.readSessionRuntimeState?.(target.sessionId)) {
      entryStateService.clearSessionEntryTarget(target.sessionId, projectPathHint);
      return false;
    }

    const restored = await this.restoreManagedSessionTarget(target);
    if (!restored) {
      entryStateService.clearSessionEntryTarget(target.sessionId, projectPathHint);
    }

    return restored;
  }

  async initializeEntryInventory(options?: { readonly restorePersistedTarget?: boolean }): Promise<boolean> {
    return this._entryCoordinator.initializeEntryInventory(options);
  }

  async forkFromTurn(options: {
    turnId: string;
    requestContent: string;
    displayContent: string;
    resources: ResourceItem[];
  }): Promise<boolean> {
    if (this.ctx.isWaiting) {
      this.ctx.message.warning('正在处理中，请稍候...');
      return false;
    }

    if (!this.ctx.sessionId) {
      this.ctx.message.warning('当前没有可分叉的会话');
      return false;
    }

    const sourceRecord = this.resolveForkSourceRecord();
    const sourceTurnResponses = sourceRecord?.turnResponses ?? [];
    const targetTurnIndex = sourceTurnResponses.findIndex(turn => turn['turnId'] === options.turnId);
    if (targetTurnIndex < 0) {
      this.ctx.message.info('未找到该请求对应的会话边界');
      return false;
    }

    this.saveCurrentSession();

    const retainedTurnResponses = sourceTurnResponses.slice(0, targetTurnIndex);
    const retainedTurnIds = new Set(retainedTurnResponses.map(turn => turn['turnId']));
    const forkedSessionId = `lex-${Date.now()}-fork`;
    const sourceSessionContent = sourceRecord
      ? this._hostSessionContentProvider.provideCurrentChatSessionContent(
          this.resolveCurrentSessionProjectPath(),
          {
            hostRecordOverride: sourceRecord as HostSessionRecord,
            metadataFallback: this.ctx.chatHistoryService.findEntry(this.ctx.sessionId) ?? null,
            fallbackProviderOptions: this.resolveCurrentSessionProviderOptions(),
          },
        )
      : null;
    const selectedMode = this.resolveForkSelectedMode(
      sourceSessionContent?.metadata,
      sourceTurnResponses,
      retainedTurnResponses,
    );
    const forkedProviderOptions = sourceSessionContent?.providerOptions ?? this.resolveCurrentSessionProviderOptions();
    const forkedInputState = buildHostSessionCurrentPickerInputState(selectedMode, forkedProviderOptions);
    const forkedRequestRouting = buildHostSessionCurrentPickerRoutingSummary(
      selectedMode,
      undefined,
      forkedProviderOptions.permissionLevel,
      forkedProviderOptions.approvalsReviewer,
      forkedProviderOptions.approvalPolicy,
    );
    const forkedItem = this.hostSessionItemController.createForkedChatSessionItem({
      sessionId: forkedSessionId,
      title: this.buildForkedSessionTitle(
        sourceSessionContent?.title
        || this.ctx.chatService.currentSessionTitle
        || options.displayContent,
      ),
      projectPath: forkedProviderOptions.folderPath,
      createdAt: Date.now(),
      inputState: forkedInputState,
      mode: selectedMode.modeId,
      requestRouting: forkedRequestRouting,
    });
    const forkedMetadata = {
      sessionId: forkedSessionId,
      title: forkedItem.title,
      projectPath: forkedItem.projectPath,
      createdAt: forkedItem.createdAt,
      updatedAt: forkedItem.createdAt,
      mode: forkedItem.mode ?? selectedMode.modeId,
      inputState: forkedItem.inputState ?? forkedInputState,
      requestRouting: forkedItem.requestRouting ?? forkedRequestRouting,
      model: this.resolveCurrentModelName(),
      toolCallingIteration: retainedTurnResponses.length,
    };
    const forkedRecord: HostSessionRecord = {
      metadata: forkedMetadata,
      ...(retainedTurnResponses.length > 0 ? { turnResponses: retainedTurnResponses } : {}),
    };

    if (retainedTurnResponses.length > 0) {
      this.ctx.chatHistoryService.saveHostRecord({
        sessionId: forkedSessionId,
        metadata: forkedMetadata,
        turnResponses: retainedTurnResponses,
      });
    }

    await this.switchToSession(forkedSessionId, forkedRecord);
    this.ctx.scrollManager.setScrollLock(true);
    this.ctx.scrollManager.scrollToBottom();

    return true;
  }

  // ==================== 会话持久化 ====================

  saveCurrentSession(options?: {
    hostProjection?: HostResponseProjection | null;
    visibleChatList?: readonly ChatListItem[];
    target?: HostSessionSaveTarget | null;
  }): void {
    const currentSessionId = options?.target?.sessionId || this.ctx.chatService.currentSessionId || this.ctx.sessionId;
    this.ctx.captureActiveSessionRuntimeState?.();
    if (this._hostSessionSaveBridge.saveCurrentSession(options)) {
      this.refreshHistoryList();
      return;
    }

    if (currentSessionId) {
      this.hostSessionItemController.discardChatSessionItem(currentSessionId);
      this.clearPersistedSessionEntryTarget(currentSessionId);
      this.refreshHistoryList();
    }
  }

  refreshHistoryList(): void {
    const currentProjectPath = AilyHost.get().project.currentProjectPath || AilyHost.get().project.projectRootPath;
    const projectRootPath = AilyHost.get().project.projectRootPath;
    const sessionItemsService = this.ctx.chatSessionItemsService as {
      refreshHistoryList?: (projectPath?: string | null, projectRootPath?: string | null) => void;
    } | undefined;

    if (typeof sessionItemsService?.refreshHistoryList !== 'function') {
      throw new Error('[SessionLifecycleHelper] ChatSessionItemsService.refreshHistoryList is required for shared session read-side');
    }

    ChatPerformanceTracer.increment('session_list.sync_refresh_history');
    ChatPerformanceTracer.mark('session_list.sync_refresh_history');
    sessionItemsService.refreshHistoryList(currentProjectPath, projectRootPath);
  }

  requestSessionListRefresh(input: {
    reason: 'open' | 'entry' | 'reopen' | 'filter' | 'state' | 'runtime' | 'manual' | 'project' | 'service-created' | 'shell';
    scope: 'summary' | 'visible-details' | 'full';
    priority: 'after-paint' | 'normal' | 'idle';
  }): void {
    const currentProjectPath = AilyHost.get().project.currentProjectPath || AilyHost.get().project.projectRootPath;
    const projectRootPath = AilyHost.get().project.projectRootPath;
    const sessionItemsService = this.ctx.chatSessionItemsService as {
      requestSessionListRefresh?: (request: {
        reason: 'open' | 'entry' | 'reopen' | 'filter' | 'state' | 'runtime' | 'manual' | 'project' | 'service-created' | 'shell';
        scope: 'summary' | 'visible-details' | 'full';
        priority: 'after-paint' | 'normal' | 'idle';
        projectPath?: string | null;
        projectRootPath?: string | null;
      }) => void;
      loadInitialSummaries?: (limit?: number, projectPath?: string | null, projectRootPath?: string | null) => void;
      refreshHistoryList?: (projectPath?: string | null, projectRootPath?: string | null) => void;
    } | undefined;

    if (typeof sessionItemsService?.requestSessionListRefresh === 'function') {
      ChatPerformanceTracer.increment(`session_list.request.${input.scope}`);
      ChatPerformanceTracer.mark('session_list.request_scheduled', `${input.reason}:${input.scope}:${input.priority}`);
      sessionItemsService.requestSessionListRefresh({
        ...input,
        projectPath: currentProjectPath,
        projectRootPath,
      });
      return;
    }

    if (input.scope === 'summary' && typeof sessionItemsService?.loadInitialSummaries === 'function') {
      sessionItemsService.loadInitialSummaries(undefined, currentProjectPath, projectRootPath);
      return;
    }

    if (typeof sessionItemsService?.refreshHistoryList === 'function') {
      sessionItemsService.refreshHistoryList(currentProjectPath, projectRootPath);
      return;
    }

    throw new Error('[SessionLifecycleHelper] ChatSessionItemsService session list refresh API is required for shared session read-side');
  }

  private isSamePath(leftPath: string | null | undefined, rightPath: string | null | undefined): boolean {
    const normalize = (value: string | null | undefined) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return normalize(leftPath) === normalize(rightPath);
  }

  private getPersistableProjectPath(projectPath: string | null | undefined): string | null {
    const rootPath = AilyHost.get().project.projectRootPath;
    return projectPath && !this.isSamePath(projectPath, rootPath) ? projectPath : null;
  }

  private getCurrentSessionPersistPath(previousProjectPath?: string | null): string | null {
    const cachedPath = this.ctx.chatService.currentSessionPath;
    return this.getPersistableProjectPath(cachedPath) || this.getPersistableProjectPath(previousProjectPath);
  }

  private getLatestProjectSessionEntry(projectPath: string): { sessionId: string; title?: string } | null {
    const rootPath = AilyHost.get().project.projectRootPath;
    const entries = this.ctx.chatHistoryService.getHistoryList('current-project', projectPath, rootPath);
    return entries[0] || null;
  }

  private clearClientSessionStateForProjectSwitch(): void {
    this.ctx.resetVisibleSessionProjection?.({
      clearResolvedActiveModel: true,
      clearTurns: true,
      resetContextBudget: true,
      clearEditSummary: true,
      resetToolCallingIteration: true,
    });
    this.ctx.isWaiting = false;
  }

  async startNewProjectSession(
    projectPath: string,
    previousProjectPath?: string | null,
    currentAlreadySaved = false,
  ): Promise<void> {
    if (!projectPath || this.ctx.isSessionStarting) {
      return;
    }

    if (!currentAlreadySaved) {
      const persistPath = this.getCurrentSessionPersistPath(previousProjectPath);
      if (persistPath) {
        this.ctx.chatService.currentSessionPath = persistPath;
      }
      this.saveCurrentSession();
    }

    try {
      await this.stopAndCloseSession(true);
    } catch (error) {
      console.warn('[SessionLifecycle] 切换项目前停止会话失败:', error);
    }

    this.clearClientSessionStateForProjectSwitch();
    this.ctx.lexStream.agent.dispose();
    this.setActiveSessionId('');
    this.ctx.chatService.currentSessionTitle = '';
    this.ctx.chatService.currentSessionPath = this.getPersistableProjectPath(projectPath) || '';
    this.ctx.isSessionStarting = false;
    this.ctx.hasInitializedForThisLogin = false;

    if (this.ctx.isLoggedIn) {
      await this.startSession();
    }

    this.refreshHistoryList();
    this.ctx.triggerSyncDetectChanges();
  }

  async loadLatestProjectSession(projectPath: string, previousProjectPath?: string | null): Promise<boolean> {
    if (!projectPath || this.ctx.isSessionStarting) {
      return false;
    }

    const persistPath = this.getCurrentSessionPersistPath(previousProjectPath);
    if (persistPath) {
      this.ctx.chatService.currentSessionPath = persistPath;
    }
    this.saveCurrentSession();
    this.ctx.chatHistoryService.reloadProjectIndex(projectPath);

    const latestEntry = this.getLatestProjectSessionEntry(projectPath);
    if (!latestEntry) {
      await this.startNewProjectSession(projectPath, previousProjectPath, true);
      return false;
    }

    const previousSessionId = this.ctx.sessionId;
    if (previousSessionId && previousSessionId !== latestEntry.sessionId) {
      try {
        await this.stopAndCloseSession(true);
      } catch (error) {
        console.warn('[SessionLifecycle] 加载项目历史前关闭旧会话失败:', error);
      }
    }

    this.clearClientSessionStateForProjectSwitch();
    this.ctx.chatService.currentSessionTitle = latestEntry.title || '';
    this.ctx.chatService.currentSessionPath = this.getPersistableProjectPath(projectPath) || '';
    await this.startSessionWithId(latestEntry.sessionId);
    await this.getHistory();
    this.ctx.isCompleted = true;
    this.refreshHistoryList();
    this.ctx.triggerSyncDetectChanges();
    return true;
  }

  async initializeSessionForCurrentProject(): Promise<void> {
    const currentProjectPath = AilyHost.get().project.currentProjectPath;
    const persistableProjectPath = this.getPersistableProjectPath(currentProjectPath);

    if (persistableProjectPath) {
      this.ctx.chatHistoryService.reloadProjectIndex(persistableProjectPath);
      const latestEntry = this.getLatestProjectSessionEntry(persistableProjectPath);
      if (latestEntry) {
        this.clearClientSessionStateForProjectSwitch();
        this.ctx.chatService.currentSessionTitle = latestEntry.title || '';
        this.ctx.chatService.currentSessionPath = persistableProjectPath;
        await this.startSessionWithId(latestEntry.sessionId);
        await this.getHistory();
        this.ctx.isCompleted = true;
        this.refreshHistoryList();
        this.ctx.triggerSyncDetectChanges();
        return;
      }
    }

    await this.startSession();
    await this.getHistory();
    this.ctx.triggerSyncDetectChanges();
  }

  // ==================== 会话启动 ====================

  async startSession(): Promise<void> {
    if (this.ctx.isSessionStarting) return Promise.resolve();
    this.ctx.isSessionStarting = true;
    this.ctx.isCancelled = false;

    this.ctx.interaction.resetApprovalState();
    this.ctx.chatService.clearResolvedActiveModel?.();
    this.ctx.lexStream.resetSessionState();

    this.ctx.lexStream.turns.clear();
    this.ctx.toolCallingIteration = 0;
    this.ctx.contextBudgetService.reset();
    this.ctx.sessionAllowedPaths = [];
    this.ctx.repetitionDetectionService.resetAll();
    this.ctx.legacyActivatedDeferredTools.clear();
    SkillRegistry.clearSessionState('startSession');

    // 初始化 Skills 系统（扫描全局 + 项目级 skills）
    const projectRoot = AilyHost.get().project?.currentProjectPath || AilyHost.get().project?.projectRootPath;
    SkillRegistry.initialize(projectRoot, {
      debugSource: 'startSession',
      userSkillFolders: this.ctx.ailyChatConfigService?.userSkillFolders,
      projectSkillFolders: this.ctx.ailyChatConfigService?.projectSkillFolders,
    }).catch(err => {
      console.warn('[AilyChat] Skills 初始化失败:', err);
    });

    this.ctx.isCompleted = false;

    // VS Code creates the ChatModel/sessionResource synchronously, then activates the default agent in the background.
    // Keep our owner session id stable before any awaited provider/tool initialization so detach/save can target it.
    const pendingSessionId = this.createSessionId();
    const providerOptions = this.resolveCurrentProjectProviderOptions();
    const providerOptionsKey = this.applySessionProviderOptions(providerOptions);
    this.setActiveSessionId(pendingSessionId);
    applyCurrentSessionTitle(this.ctx.chatService, { text: '', source: 'empty' });
    this.applySessionType(DEFAULT_CHAT_SESSION_TYPE);
    this.applySessionProviderOptions(providerOptions);
    this.hostSessionItemController.createNewChatSessionItem(pendingSessionId, {
      projectPath: this.ctx.chatService.currentSessionPath || null,
    });
    this.persistSessionEntryTarget(this.buildFreshSessionEntryTarget(pendingSessionId));
    this.requestSessionListRefresh({
      reason: 'state',
      scope: 'summary',
      priority: 'after-paint',
    });

    if (!this.ctx.mcpInitialized) {
      this.ctx.mcpInitialized = true;
      await this.ctx.mcpService.init();
      this.warmupHardwareIndexForAI('startSession');
    }

    // 初始化 aily-lex agent
    try {
      const agentReady = await this.ctx.lexStream.agent.ensureAgent(pendingSessionId, providerOptionsKey);
      if (!agentReady) {
        const msg = GENERIC_SESSION_START_ERROR_MESSAGE;
        console.error('[SessionLifecycle]', msg);
        this.ctx.lexStream.turn.appendError(msg);
        this.ctx.isSessionStarting = false;
        return;
      }
    } catch (err) {
      console.error('[SessionLifecycle] aily-lex agent 初始化失败:', err);
      this.ctx.lexStream.turn.appendError(GENERIC_SESSION_START_ERROR_MESSAGE);
      this.ctx.isSessionStarting = false;
      throw err;
    }

    await this.ctx.chatService.syncResolvedActiveModelFromContextInfo?.(pendingSessionId);

    this.ctx.isSessionStarting = false;
  }

  /** 清理当前会话的本地 agent 资源 */
  dispose(): void {
    this.ctx.disposeSessionAction(this.ctx.chatService.currentSessionId || this.ctx.sessionId);
  }

  enterEntryState(options: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean } = {}): void {
    const explicitSessionId = typeof options.sessionId === 'string' ? options.sessionId.trim() : '';
    const currentSessionId = explicitSessionId || this.ctx.chatService.currentSessionId || this.ctx.sessionId;
    this.ctx.resetVisibleSessionProjection({
      clearEditSummary: true,
    });

    if (options.disposeRuntime === true) {
      console.warn(ENTRY_DISPOSE_RUNTIME_GUARD_PREFIX, {
        action: 'ignore-entry-dispose-runtime',
        sessionId: currentSessionId || null,
      });
    }
    this.setActiveSessionId('');
    this.ctx.chatService.hasBlankSessionShell = false;
    applyCurrentSessionTitle(this.ctx.chatService, { text: '', source: 'empty' });
    this.applySessionType(DEFAULT_CHAT_SESSION_TYPE);
    this.ctx.chatService.currentSessionPath = '';
    this.ctx.chatService.clearResolvedActiveModel?.();
    this.ctx.isSessionStarting = false;

    if (options.resetInitialization === true) {
      this.ctx.hasInitializedForThisLogin = false;
    }
  }

  enterBlankSessionShell(options: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean } = {}): void {
    this.enterEntryState(options);
    this.ctx.chatService.hasBlankSessionShell = true;
  }

  async returnToEntryInventory(options: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean } = {}): Promise<void> {
    const targetSessionId = typeof options.sessionId === 'string' && options.sessionId.trim().length > 0
      ? options.sessionId.trim()
      : this.ctx.chatService.currentSessionId || this.ctx.sessionId;

    if (targetSessionId) {
      this.ctx.captureActiveSessionRuntimeState?.();
      this.ctx.detachSessionRuntimeView?.(targetSessionId);
    }

    await this._entryCoordinator.returnToEntryInventory({
      ...options,
      disposeRuntime: false,
    });

    if (targetSessionId) {
      this.clearPersistedSessionEntryTarget(targetSessionId);
    }
  }

  /** 简化的停止+清理（替代旧 stopAndCloseSession） */
  async stopAndCloseSession(skipSave: boolean = false): Promise<void> {
    const currentSessionId = this.ctx.chatService.currentSessionId || this.ctx.sessionId;
    if (!skipSave) { this.saveCurrentSession(); }
    this.ctx.stopSessionAction(currentSessionId);
    this.ctx.chatService.clearResolvedActiveModel?.();
    this.ctx.isWaiting = false;
  }

  // ==================== 新建 / 历史 ====================

  async newChat(): Promise<void> {
    if (this.ctx.isSessionStarting) return;
    const currentSessionId = this.ctx.chatService.currentSessionId || this.ctx.sessionId;
    this.saveCurrentSession();
    this.ctx.captureActiveSessionRuntimeState?.();
    if (currentSessionId && !this.hasSessionRuntimeState(currentSessionId)) {
      this.hostSessionItemController.discardChatSessionItem(currentSessionId);
      this.clearPersistedSessionEntryTarget(currentSessionId);
    }
    if (currentSessionId) {
      this.ctx.detachSessionRuntimeView?.(currentSessionId);
    }
    this.enterBlankSessionShell({
      sessionId: currentSessionId,
      disposeRuntime: false,
    });
    this.requestSessionListRefresh({
      reason: 'entry',
      scope: 'summary',
      priority: 'after-paint',
    });
  }

  async ensureSessionReadyForSubmit(): Promise<boolean> {
    if (this.ctx.sessionId) {
      return true;
    }

    if (!this.ctx.isLoggedIn) {
      return false;
    }

    return this._entryCoordinator.bootstrapNewSession();
  }

  async getHistory(): Promise<void> {
    if (!this.ctx.sessionId) return;
    this.persistSessionEntryTarget(this.buildCurrentSessionEntryTarget(this.ctx.sessionId));
    this.ctx.resetVisibleSessionProjection({
      clearResolvedActiveModel: true,
      clearTurns: true,
      resetToolCallingIteration: true,
      resetContextBudget: true,
    });
    const sessionContent = this._hostSessionContentProvider.provideCurrentChatSessionContent(
      this.resolveCurrentSessionProjectPath(),
    );
    const hostRecord = sessionContent?.hostRecord ?? null;
    if (hostRecord) {
      try {
        await this.ctx.restoreSessionHostRecord(hostRecord);
      } catch (error) {
        console.warn('[SessionLifecycle] session history restore failed:', error);
        this.ctx.message.warning('会话历史加载失败，已继续打开当前会话');
      }
    } else {
      this.ctx.editCheckpointService?.clear();
      this.ctx.editCheckpointService?.dismissSummary();
    }
    this.ctx.chatHistoryService.clearRecordedRestoreFailure?.(this.ctx.sessionId);
  }

  private createSessionId(): string {
    return `lex-${Date.now()}`;
  }

  private setActiveSessionId(sessionId: string): void {
    this.ctx.sessionId = sessionId;
    this.ctx.chatService.currentSessionId = sessionId;
  }

  private hasSessionRuntimeState(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    return !!normalizedSessionId && !!this.ctx.readSessionRuntimeState?.(normalizedSessionId);
  }

  private resolveCurrentProjectPath(): string | null {
    return AilyHost.get().project.currentProjectPath
      || AilyHost.get().project.projectRootPath
      || null;
  }

  private resolveCurrentSessionProjectPath(): string | null {
    return this.resolveSessionContentProjectPath();
  }

  private resolveSessionContentProjectPath(hostRecord?: HostSessionRecord | null): string | null {
    const recordProjectPath = typeof hostRecord?.metadata?.projectPath === 'string'
      ? hostRecord.metadata.projectPath
      : null;

    return resolveHostSessionProjectPathHint(
      { currentSessionPath: recordProjectPath || this.ctx.chatService.currentSessionPath },
      this.resolveCurrentProjectPath(),
    );
  }

  private resolveCurrentModelName(): string | null {
    const currentModel = this.ctx.currentModel as { name?: string; model?: string } | null | undefined;
    return currentModel?.model ?? currentModel?.name ?? null;
  }

  private buildForkedSessionTitle(sourceTitle: string): string {
    const normalized = sourceTitle.trim() || 'New Chat';
    return normalized.startsWith('Forked: ')
      ? normalized
      : `Forked: ${normalized}`;
  }

  private resolveForkSourceRecord(): HostSessionRecord | LiveHostSessionRecord | null {
    const liveRecord = this.buildLiveHostSessionRecord();
    if (liveRecord?.sessionId === this.ctx.sessionId) {
      return liveRecord;
    }

    return this._hostSessionContentProvider.provideCurrentChatSessionContent(
      this.resolveCurrentSessionProjectPath(),
    )?.hostRecord ?? null;
  }

  private resolveForkSelectedMode(
    sourceMetadata: HostSessionContentMetadataSource | null | undefined,
    sourceTurnResponses: NonNullable<HostSessionRecord['turnResponses']>,
    retainedTurnResponses: NonNullable<HostSessionRecord['turnResponses']>,
  ): ChatSelectedMode {
    if (sourceMetadata) {
      return resolveHostSessionSelectedMode({
        metadata: {
          mode: sourceMetadata.mode ?? this.ctx.currentMode,
          inputState: sourceMetadata.inputState,
          requestRouting: sourceMetadata.requestRouting,
        },
        turnResponses: retainedTurnResponses.length > 0
          ? retainedTurnResponses
          : sourceTurnResponses,
      } as HostSessionRecord, {
        resolveModeById: (modeId) => this.ctx.chatService.findResolvedModeById?.(modeId),
      });
    }

    return normalizeChatSelectedMode(this.ctx.chatService.selectedMode ?? {
      modeId: this.ctx.currentMode,
      customAgentTarget: this.ctx.chatService.currentCustomAgentTarget,
    });
  }

  async switchToSession(
    sessionId: string,
    optionsOrHostRecordOverride?: SessionLifecycleSwitchOptions | HostSessionRecord | null,
  ): Promise<boolean> {
    const switchOptions = this.normalizeSwitchOptions(optionsOrHostRecordOverride);
    const restoreRequest = this.hostSessionItemController.resolveSessionSwitchRestoreRequest(sessionId, {
      fallbackProjectPath: switchOptions.fallbackProjectPath ?? this.resolveCurrentProjectPath(),
      hostRecordOverride: switchOptions.hostRecordOverride,
    });

    await this.activateSessionFromRestoreRequest(restoreRequest, {
      preferDetachedRuntimeAttach: true,
    });
    return true;
  }

  private normalizeSwitchOptions(
    optionsOrHostRecordOverride?: SessionLifecycleSwitchOptions | HostSessionRecord | null,
  ): SessionLifecycleSwitchOptions {
    if (!optionsOrHostRecordOverride) {
      return {};
    }

    if (this.isHostSessionRecord(optionsOrHostRecordOverride)) {
      return {
        hostRecordOverride: optionsOrHostRecordOverride,
      };
    }

    return optionsOrHostRecordOverride;
  }

  private isHostSessionRecord(value: unknown): value is HostSessionRecord {
    return !!value && typeof value === 'object' && 'metadata' in value;
  }

  private async activateSessionFromRestoreRequest(
    restoreRequest: {
      readonly target: {
        readonly sessionId: string;
        readonly sessionType: string;
        readonly projectPath: string | null;
        readonly inputState?: import('../core/chat-mode').ChatSessionInputState;
      };
      readonly sessionContent: HostSessionContent;
      readonly hostRecord: HostSessionRecord | null;
      readonly diagnostics: HostSessionSwitchRestoreDiagnostics;
    },
    options: {
      readonly ensureManagedItem?: boolean;
      readonly preferDetachedRuntimeAttach?: boolean;
    } = {},
  ): Promise<void> {
    const activationRequestId = ++this.sessionActivationRequestId;
    this.resetForSessionActivation();

    if (options.ensureManagedItem) {
      this.hostSessionItemController.createNewChatSessionItem(restoreRequest.target.sessionId, {
        title: restoreRequest.sessionContent.title,
        sessionType: restoreRequest.sessionContent.sessionType,
        projectPath: restoreRequest.sessionContent.projectPathHint
          ?? restoreRequest.sessionContent.providerOptions.folderPath
          ?? restoreRequest.target.projectPath,
        inputState: restoreRequest.sessionContent.inputState ?? restoreRequest.target.inputState,
        mode: typeof restoreRequest.sessionContent.metadata?.mode === 'string'
          ? normalizeChatSurfaceModeId(restoreRequest.sessionContent.metadata.mode)
          : undefined,
        requestRouting: restoreRequest.sessionContent.metadata?.requestRouting
          ? normalizeHostSessionRequestRoutingSummary(
              restoreRequest.sessionContent.metadata.requestRouting,
              restoreRequest.sessionContent.metadata.mode ?? this.ctx.currentMode,
            )
          : undefined,
      });
    }

    if (options.preferDetachedRuntimeAttach === true
      && this.shouldReattachDetachedRuntimeSession(restoreRequest.target.sessionId)) {
      await this.reattachDetachedRuntimeSession(restoreRequest, activationRequestId);
      return;
    }

    try {
      await this.startSessionWithId(restoreRequest.target.sessionId, restoreRequest.sessionContent, activationRequestId);
      this.throwIfSessionActivationSuperseded(activationRequestId);
    } catch (error) {
      if (isSessionLifecycleSupersededError(error)) {
        throw error;
      }
      throw this.createSessionRestoreError('session-start', restoreRequest.diagnostics, error);
    }

    const hostRecordToRestore = this.ctx.buildRuntimeRestoreHostRecord?.(restoreRequest) ?? restoreRequest.hostRecord;

    if (hostRecordToRestore) {
      try {
        await this.ctx.restoreSessionHostRecord(hostRecordToRestore, {
          isCurrent: () => this.isCurrentSessionActivationRequest(activationRequestId),
        });
        this.throwIfSessionActivationSuperseded(activationRequestId);
      } catch (error) {
        if (isSessionLifecycleSupersededError(error)) {
          throw error;
        }
        throw this.createSessionRestoreError('host-restore', restoreRequest.diagnostics, error);
      }
    }

    this.throwIfSessionActivationSuperseded(activationRequestId);
    this.ctx.chatHistoryService.clearRecordedRestoreFailure?.(restoreRequest.target.sessionId);

    this.requestSessionListRefresh({
      reason: 'reopen',
      scope: 'summary',
      priority: 'after-paint',
    });
  }

  private shouldReattachDetachedRuntimeSession(sessionId: string): boolean {
    const runtimeState = this.ctx.readSessionRuntimeState?.(sessionId);
    return !!runtimeState && runtimeState.attachedView === false;
  }

  private async reattachDetachedRuntimeSession(
    restoreRequest: {
      readonly target: {
        readonly sessionId: string;
      };
      readonly sessionContent: HostSessionContent;
    },
    activationRequestId: number,
  ): Promise<void> {
    const sessionId = restoreRequest.target.sessionId;
    const providerOptions = restoreRequest.sessionContent.providerOptions;

    this.throwIfSessionActivationSuperseded(activationRequestId);
    this.setActiveSessionId(sessionId);
    const runtimeTurnResponses = this.ctx.readSessionRuntimeState?.(sessionId)?.turnResponses;
    const restoredTitle = resolveRestoredSessionTitle(restoreRequest.sessionContent, runtimeTurnResponses);
    if (restoredTitle.source !== 'empty') {
      applyCurrentSessionTitle(this.ctx.chatService, restoredTitle);
    }
    this.applySessionType(restoreRequest.sessionContent.sessionType);
    this.applySessionProviderOptions(providerOptions);
    this.persistSessionEntryTarget(this.buildSessionEntryTarget(sessionId, restoreRequest.sessionContent));
    this.ctx.isSessionStarting = false;
    this.ctx.isCancelled = false;

    if (typeof this.ctx.attachCurrentSessionView === 'function') {
      await this.ctx.attachCurrentSessionView();
      this.ctx.ensureBackgroundSessionCanRerun?.(sessionId);
      this.throwIfSessionActivationSuperseded(activationRequestId);
    }

    this.ctx.chatHistoryService.clearRecordedRestoreFailure?.(sessionId);
    this.requestSessionListRefresh({
      reason: 'reopen',
      scope: 'summary',
      priority: 'after-paint',
    });
  }

  private isCurrentSessionActivationRequest(activationRequestId: number): boolean {
    return activationRequestId === this.sessionActivationRequestId;
  }

  private throwIfSessionActivationSuperseded(activationRequestId: number): void {
    if (!this.isCurrentSessionActivationRequest(activationRequestId)) {
      throw new SessionLifecycleSupersededError();
    }
  }

  private resetForSessionActivation(): void {
    const targetSessionId = this.ctx.chatService.currentSessionId || this.ctx.sessionId;

    this.ctx.captureActiveSessionRuntimeState?.();
    this.ctx.detachSessionRuntimeView?.(targetSessionId);

    this.ctx.resetVisibleSessionProjection({
      clearEditSummary: true,
    });

    this.setActiveSessionId('');
    applyCurrentSessionTitle(this.ctx.chatService, { text: '', source: 'empty' });
    this.applySessionType(DEFAULT_CHAT_SESSION_TYPE);
    this.ctx.chatService.currentSessionPath = '';
    this.ctx.isSessionStarting = false;
    this.ctx.hasInitializedForThisLogin = false;
  }

  private createSessionRestoreError(
    stage: SessionSwitchRestoreStage,
    diagnostics: HostSessionSwitchRestoreDiagnostics,
    cause: unknown,
  ): SessionLifecycleRestoreError {
    const restoreFailureDetails = readHostSessionRestoreFailureDetails(cause);
    const causeMessage = cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'unknown error';
    const detail = [
      `stage=${stage}`,
      `sessionId=${diagnostics.sessionId}`,
      `projectPath=${diagnostics.projectPath ?? 'unknown'}`,
      `requestSource=${diagnostics.requestSource}`,
      `hostRecordSource=${diagnostics.hostRecordSource}`,
      `metadataSource=${diagnostics.metadataSource}`,
      ...(restoreFailureDetails ? [`restoreKind=${restoreFailureDetails.kind}`] : []),
      ...(restoreFailureDetails?.hostRecordSessionId ? [`hostRecordSessionId=${restoreFailureDetails.hostRecordSessionId}`] : []),
      ...(restoreFailureDetails?.storedSnapshotState ? [`storedSnapshotState=${restoreFailureDetails.storedSnapshotState}`] : []),
    ].join(', ');
    return new SessionLifecycleRestoreError(
      `[SessionLifecycle] Session restore failed (${detail}): ${causeMessage}`,
      {
        stage,
        diagnostics,
        restoreFailure: restoreFailureDetails,
      },
      cause,
    );
  }

  private async startSessionWithId(
    sessionId: string,
    sessionContent?: HostSessionContent | null,
    activationRequestId?: number,
  ): Promise<void> {
    if (this.ctx.isSessionStarting) return Promise.resolve();
    this.ctx.isSessionStarting = true;
    this.ctx.isCancelled = false;

    const hostRecord = sessionContent?.hostRecord ?? null;
    const providerOptions = sessionContent?.providerOptions
      ?? (hostRecord
        ? resolveHostSessionProviderOptions(hostRecord)
        : this.resolveCurrentProjectProviderOptions());

    this.ctx.interaction.resetApprovalState();
    this.ctx.lexStream.resetSessionState();

    this.ctx.lexStream.turns.clear();
    this.ctx.toolCallingIteration = 0;
    this.ctx.contextBudgetService.reset();
    this.ctx.sessionAllowedPaths = [];
    this.ctx.repetitionDetectionService.resetAll();
    this.ctx.legacyActivatedDeferredTools.clear();
    SkillRegistry.clearSessionState(`startSessionWithId:${sessionId}`);

    const projectRoot = AilyHost.get().project?.currentProjectPath || AilyHost.get().project?.projectRootPath;
    SkillRegistry.initialize(projectRoot, {
      debugSource: `startSessionWithId:${sessionId}`,
      userSkillFolders: this.ctx.ailyChatConfigService?.userSkillFolders,
      projectSkillFolders: this.ctx.ailyChatConfigService?.projectSkillFolders,
    }).catch(err => {
      console.warn('[AilyChat] Skills 初始化失败:', err);
    });

    if (!this.ctx.mcpInitialized) {
      this.ctx.mcpInitialized = true;
      await this.ctx.mcpService.init();
      this.warmupHardwareIndexForAI(`startSessionWithId:${sessionId}`);
    }

    if (activationRequestId !== undefined) {
      this.throwIfSessionActivationSuperseded(activationRequestId);
    }

    this.ctx.isCompleted = false;
    const providerOptionsKey = this.applySessionProviderOptions(providerOptions);

    try {
      const agentReady = await this.ctx.lexStream.agent.ensureAgent(sessionId, providerOptionsKey);
      if (activationRequestId !== undefined) {
        this.throwIfSessionActivationSuperseded(activationRequestId);
      }
      if (!agentReady) {
        const msg = GENERIC_SESSION_START_ERROR_MESSAGE;
        console.error('[SessionLifecycle]', msg);
        this.ctx.lexStream.turn.appendError(msg);
        this.ctx.isSessionStarting = false;
        return;
      }
    } catch (err) {
      if (activationRequestId !== undefined && !this.isCurrentSessionActivationRequest(activationRequestId)) {
        this.ctx.isSessionStarting = false;
        throw new SessionLifecycleSupersededError();
      }
      console.error('[SessionLifecycle] aily-lex agent 初始化失败:', err);
      this.ctx.lexStream.turn.appendError(GENERIC_SESSION_START_ERROR_MESSAGE);
      this.ctx.isSessionStarting = false;
      throw err;
    }

    this.setActiveSessionId(sessionId);
    const runtimeTurnResponses = this.ctx.readSessionRuntimeState?.(sessionId)?.turnResponses;
    const restoredTitle = resolveRestoredSessionTitle(sessionContent, runtimeTurnResponses);
    if (restoredTitle.source !== 'empty') {
      applyCurrentSessionTitle(this.ctx.chatService, restoredTitle);
    }
    this.applySessionType(sessionContent?.sessionType);
    this.applySessionProviderOptions(providerOptions);
    this.persistSessionEntryTarget(this.buildSessionEntryTarget(sessionId, sessionContent));

    this.ctx.isSessionStarting = false;
  }

  private async restoreManagedSessionTarget(target: PersistedChatSessionEntryTarget): Promise<boolean> {
    if (!target.sessionId) {
      return false;
    }
    const restoreRequest = this.hostSessionItemController.resolveSessionEntryRestoreRequest(target, {
      fallbackProjectPath: this.resolveCurrentProjectPath(),
    });

    await this.activateSessionFromRestoreRequest(restoreRequest, {
      ensureManagedItem: true,
    });
    return true;
  }

  private buildFreshSessionEntryTarget(sessionId: string): PersistedChatSessionEntryTarget {
    const providerOptions = this.resolveCurrentSessionProviderOptions();
    const selectedMode = normalizeChatSelectedMode(
      this.ctx.chatService.selectedMode ?? { modeId: this.ctx.currentMode },
    );

    return {
      sessionId,
      projectPath: providerOptions.folderPath ?? null,
      providerOptions,
      inputState: buildHostSessionCurrentPickerInputState(selectedMode, providerOptions),
      mode: selectedMode.modeId,
      requestRouting: buildHostSessionCurrentPickerRoutingSummary(
        selectedMode,
        undefined,
        providerOptions.permissionLevel,
        providerOptions.approvalsReviewer,
        providerOptions.approvalPolicy,
      ),
    };
  }

  private buildCurrentSessionEntryTarget(sessionId: string): PersistedChatSessionEntryTarget | null {
    const sessionContent = this._hostSessionContentProvider.provideCurrentChatSessionContent(
      this.resolveCurrentSessionProjectPath(),
      {
        metadataFallback: this.ctx.chatHistoryService.findEntry(sessionId) ?? null,
        fallbackProviderOptions: this.resolveCurrentSessionProviderOptions(),
      },
    );

    return this.buildSessionEntryTarget(sessionId, sessionContent);
  }

  private buildSessionEntryTarget(
    sessionId: string,
    sessionContent?: HostSessionContent | null,
  ): PersistedChatSessionEntryTarget | null {
    if (!sessionId) {
      return null;
    }

    const providerOptions = sessionContent?.providerOptions ?? this.resolveCurrentSessionProviderOptions();
    const metadata = sessionContent?.metadata;

    return {
      sessionId,
      projectPath: sessionContent?.projectPathHint ?? providerOptions.folderPath ?? null,
      providerOptions,
      inputState: sessionContent?.inputState,
      mode: typeof metadata?.mode === 'string' ? normalizeChatSurfaceModeId(metadata.mode) : undefined,
      requestRouting: metadata?.requestRouting
        ? normalizeHostSessionRequestRoutingSummary(metadata.requestRouting, metadata?.mode ?? this.ctx.currentMode)
        : undefined,
    };
  }

  private persistSessionEntryTarget(target: PersistedChatSessionEntryTarget | null): void {
    if (!target) {
      return;
    }

    const projectPathHint = target.projectPath ?? target.providerOptions?.folderPath ?? this.resolveCurrentProjectPath();
    this.ctx.chatSessionEntryStateService?.setSessionEntryTarget(target, projectPathHint);
  }

  private clearPersistedSessionEntryTarget(sessionId: string): void {
    if (!sessionId) {
      return;
    }

    const projectPathHint = this.resolveCurrentProjectPath();
    this.ctx.chatSessionEntryStateService?.clearSessionEntryTarget(sessionId, projectPathHint);
  }

  private resolveCurrentProjectProviderOptions(): HostSessionProviderOptions {
    const currentProjectPath = AilyHost.get().project.currentProjectPath;
    const projectRootPath = AilyHost.get().project.projectRootPath;
    return {
      folderPath: currentProjectPath && currentProjectPath !== projectRootPath
        ? currentProjectPath
        : null,
      permissionMode: this.ctx.chatService.currentSessionPermissionMode,
      ...(this.ctx.chatService.currentSessionPermissionLevel
        ? { permissionLevel: this.ctx.chatService.currentSessionPermissionLevel }
        : {}),
    };
  }

  private resolveCurrentSessionProviderOptions(): HostSessionProviderOptions {
    return {
      folderPath: this.ctx.chatService.currentSessionPath || null,
      permissionMode: this.ctx.chatService.currentSessionPermissionMode,
      ...(this.ctx.chatService.currentSessionPermissionLevel
        ? { permissionLevel: this.ctx.chatService.currentSessionPermissionLevel }
        : {}),
    };
  }

  private applySessionProviderOptions(providerOptions: HostSessionProviderOptions): string {
    const normalizedProviderOptions = this.ctx.chatService.applySessionProviderOptions(providerOptions);
    return createHostSessionProviderOptionsKey(normalizedProviderOptions);
  }

  private applySessionType(sessionType: unknown): void {
    const normalizedSessionType = normalizeChatSessionType(sessionType, DEFAULT_CHAT_SESSION_TYPE);
    if (typeof this.ctx.chatService.setCurrentSessionType === 'function') {
      this.ctx.chatService.setCurrentSessionType(normalizedSessionType);
    } else {
      this.ctx.chatService.currentSessionType = normalizedSessionType;
    }
  }

  resetChat(): Promise<void> { return this.newChat(); }
}

function resolveRestoredSessionTitle(
  sessionContent?: HostSessionContent | null,
  runtimeTurnResponses?: readonly unknown[] | null,
): { text: string; source: ChatSessionTitleSource } {
  const persistedTitle = typeof sessionContent?.title === 'string'
    ? sessionContent.title.trim()
    : '';
  if (isMeaningfulRestoredSessionTitle(persistedTitle)) {
    return {
      text: persistedTitle,
      source: 'restored-custom',
    };
  }

  const fallbackDefaultTitle = deriveDefaultTitleFromTurnResponses(
    sessionContent?.hostRecord?.turnResponses,
    runtimeTurnResponses,
  );
  return isMeaningfulRestoredSessionTitle(fallbackDefaultTitle)
    ? {
      text: fallbackDefaultTitle,
      source: 'default-first-request',
    }
    : {
      text: '',
      source: 'empty',
    };
}

function deriveDefaultTitleFromTurnResponses(
  turnResponses: readonly unknown[] | null | undefined,
  runtimeTurnResponses?: readonly unknown[] | null,
): string {
  const candidates = Array.isArray(turnResponses) && turnResponses.length > 0
    ? turnResponses
    : (Array.isArray(runtimeTurnResponses) ? runtimeTurnResponses : []);
  if (candidates.length === 0) {
    return '';
  }

  for (const turnResponse of candidates) {
    const request = (turnResponse as { request?: unknown })?.request;
    const title = deriveDefaultTitleFromRequest(request);
    if (title) {
      return title;
    }
  }

  return '';
}

function deriveDefaultTitleFromRequest(request: unknown): string {
  const direct = readRequestTextCandidate(request);
  if (direct) {
    return direct;
  }

  if (request && typeof request === 'object') {
    const nested = readRequestTextCandidate((request as { message?: unknown }).message);
    if (nested) {
      return nested;
    }
  }

  return '';
}

function readRequestTextCandidate(candidate: unknown): string {
  const text = typeof candidate === 'string'
    ? candidate
    : candidate && typeof candidate === 'object'
      ? ((candidate as { messageText?: unknown }).messageText
        ?? (candidate as { prompt?: unknown }).prompt
        ?? (candidate as { text?: unknown }).text
        ?? (candidate as { content?: unknown }).content)
      : undefined;

  if (typeof text !== 'string') {
    return '';
  }

  const normalized = text.trim();
  if (!normalized) {
    return '';
  }

  return normalized.split('\n')[0]?.trim().substring(0, 200) ?? '';
}

function isMeaningfulRestoredSessionTitle(title: unknown): boolean {
  if (typeof title !== 'string') {
    return false;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return false;
  }

  const normalizedLower = normalizedTitle.toLowerCase();
  if (/^lex-\d{6,}$/i.test(normalizedTitle)) {
    return false;
  }
  if (/^untitled(?:\s+chat)?(?:\s*\d+)?$/i.test(normalizedTitle)) {
    return false;
  }

  return normalizedLower !== 'new session'
    && normalizedLower !== 'new chat'
    && normalizedLower !== 'current session'
    && normalizedLower !== 'chat'
    && normalizedTitle !== '新会话'
    && normalizedTitle !== '新对话'
    && normalizedTitle !== '无标题会话';
}
