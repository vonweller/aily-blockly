import { Component, ElementRef, ViewChild, ViewChildren, QueryList, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Subscription } from 'rxjs';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import type { NzResizeEvent } from 'ng-zorro-antd/resizable';
import { XDialogComponent } from './components/x-dialog/x-dialog.component';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { ToolContainerComponent } from '../../components/tool-container/tool-container.component';
import { UiService } from '../../services/ui.service';
import { NzResizableModule } from 'ng-zorro-antd/resizable';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { CommonModule } from '@angular/common';
import { ChatService } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzNoAnimationDirective } from 'ng-zorro-antd/core/no-animation';
import { MenuComponent } from '../../components/menu/menu.component';
import { McpService } from './services/mcp.service';
import { ProjectService } from '../../services/project.service';
import { CmdService } from '../../services/cmd.service';
import { CrossPlatformCmdService } from '../../services/cross-platform-cmd.service';
import { PlatformService } from '../../services/platform.service';
import { ElectronService } from '../../services/electron.service';
import { BuilderService } from '../../services/builder.service';

import {
  getActiveWorkspace,
  configureBlockTool,
  deleteBlockTool,
  getWorkspaceOverviewTool,
  queryBlockDefinitionTool,
} from './tools/editBlockTool';
import { ConnectionGraphService } from '../../services/connection-graph.service';
import { NzModalService } from 'ng-zorro-antd/modal';
import { ConfigService } from '../../services/config.service';
import { AilyChatConfigService } from './services/aily-chat-config.service';
import { MERMAID_DARK_THEME, MermaidCodeComponent } from 'ngx-x-markdown';
import { AilyHost } from './core/host';
import { createElectronHostAdapter } from './adapters/electron-host-adapter';
import { ScrollManagerService } from './services/scroll-manager.service';
import { ResourceManagerService } from './services/resource-manager.service';
import { MenuManagerService, type ChatSessionListItem } from './services/menu-manager.service';
import { ChatSessionActionsService } from './services/chat-session-actions.service';
import { ChatSessionItemsService } from './services/chat-session-items.service';
import { ChatSessionsControlService } from './services/chat-sessions-control.service';
import {
  ChatSetupSuggestionService,
} from './services/chat-setup-suggestion.service';
import { ChatViewService } from './services/chat-view.service';
import { ChatEngineService } from './services/chat-engine.service';
import { EditCheckpointService } from './services/edit-checkpoint.service';
import { GitWorkspaceCheckpointProviderService } from './services/git-workspace-checkpoint-provider.service';
import { ChatPerformanceTracer } from './services/chat-perf-tracer';
import { ChatSwitchShellCoordinator } from './helpers/chat-switch-shell-coordinator';
import { ChatEditResourceShellCoordinator } from './helpers/chat-edit-resource-shell-coordinator';
import { ChatSurfaceShellCoordinator } from './helpers/chat-surface-shell-coordinator';
import { ChatSubmitShellCoordinator } from './helpers/chat-submit-shell-coordinator';
import { ChatComposerShellCoordinator } from './helpers/chat-composer-shell-coordinator';
import { ChatViewportShellCoordinator } from './helpers/chat-viewport-shell-coordinator';
import { ChatComponentLifecycleCoordinator } from './helpers/chat-component-lifecycle-coordinator';
import { ChatActionRegistry } from './helpers/chat-action-registry';
import { ChatComponentViewModel } from './helpers/chat-component-view-model';
import { importDebugSnapshotFromDialog } from './helpers/chat-debug-import.helper';
import { ChatMemoryShellCoordinator } from './helpers/chat-memory-shell-coordinator';
import { runChatTodoFocusAction } from './helpers/chat-todo-focus-action';
import { isSessionLifecycleSupersededError, readSessionLifecycleRestoreErrorDetails } from './helpers/session-lifecycle.helper';

import { NzMessageService } from 'ng-zorro-antd/message';
import { AuthService } from '../../services/auth.service';
import { FloatingTodoComponent } from './components/floating-todo/floating-todo.component';
import { AilyEditsViewerComponent } from './components/aily-edits-viewer/aily-edits-viewer.component';
import { TodoUpdateService } from './services/todoUpdate.service';
import { ArduinoLintService } from './services/arduino-lint.service';
import { BlocklyService } from '../../editors/blockly-editor/services/blockly.service';
import { TranslateModule } from '@ngx-translate/core';
import { LoginComponent } from '../../components/login/login.component';
import { NoticeService } from '../../services/notice.service';
import { AilyChatDebugHomeComponent } from './components/aily-chat-debug-home/aily-chat-debug-home.component';
import { AilyChatDebugCacheExplorerComponent } from './components/aily-chat-debug-cache/aily-chat-debug-cache.component';
import { AilyChatDebugFlowComponent } from './components/aily-chat-debug-flow/aily-chat-debug-flow.component';
import { AilyChatDebugLogsComponent } from './components/aily-chat-debug-logs/aily-chat-debug-logs.component';
import { AilyChatSettingsComponent } from './components/settings/settings.component';
import { AilyChatDebugViewerComponent } from './components/aily-chat-debug-viewer/aily-chat-debug-viewer.component';
import { ChatInputPartHostComponent } from './components/chat-input-part-host.component';
import { ChatRuntimeConfirmationCarouselComponent } from './components/chat-runtime-confirmation-carousel.component';
import { ChatRuntimePlanReviewComponent } from './components/chat-runtime-plan-review.component';
import { ChatSessionListComponent } from './components/chat-session-list.component';
import { ChatSessionPickerComponent } from './components/chat-session-picker.component';
import { ChatSessionTitleControlComponent } from './components/chat-session-title-control.component';
import { ChatContextToolbarComponent } from './components/chat-context-toolbar/chat-context-toolbar.component';
import {
  ChatPermissionConfirmDialogComponent,
  type ChatPermissionConfirmDialogResult,
} from './components/chat-permission-confirm-dialog.component';
import { OnboardingService } from '../../services/onboarding.service';
import { AbsAutoSyncService } from './services/abs-auto-sync.service';
import { RepetitionDetectionService } from './services/repetition-detection.service';
import { ChatHistoryService } from './services/chat-history.service';
import { ChatDebugBrowserService, ChatDebugBrowserViewState } from './services/chat-debug-browser.service';
import { ChatRuntimeInteractionHostService } from './services/chat-runtime-interaction-host.service';
import { ThemeService } from '../../services/theme.service';
import type {
  ChatPaneEntryInfoSurfaceModel,
  ChatPaneSessionPickerSurfaceModel,
  ChatPaneStageSurfaceModel,
  ChatPaneSurface,
  ChatPaneSessionListSurfaceModel,
} from './services/chat-view.service';

// 共享类型从 core/chat-types.ts 导入并重新导出（保持向后兼容）
import { Tool, ResourceItem, ChatMessage, ToolCallState, ToolCallInfo } from './core/chat-types';
import type { ChatHostHeaderActionRequest } from './core/chat-host-header-actions';
import type { ChatSessionTitleActionRequest, ChatSessionTitleSurfaceModel } from './core/chat-session-title-actions';
import type { IMenuItem } from '../../configs/menu.config';
export type { Tool, ResourceItem, ChatMessage, ToolCallInfo };
export { ToolCallState };

// import { reloadAbiJsonTool, reloadAbiJsonToolSimple } from './tools';

@Component({
  selector: 'app-aily-chat',
  imports: [
    SubWindowComponent,
    NzInputModule,
    FormsModule,
    CommonModule,
    XDialogComponent,
    NzButtonModule,
    ToolContainerComponent,
    NzResizableModule,
    NzToolTipModule,
    MenuComponent,
    FloatingTodoComponent,
    AilyEditsViewerComponent,
    TranslateModule,
    LoginComponent,
    AilyChatDebugHomeComponent,
    AilyChatDebugCacheExplorerComponent,
    AilyChatDebugFlowComponent,
    AilyChatDebugLogsComponent,
    AilyChatSettingsComponent,
    AilyChatDebugViewerComponent,
    ChatInputPartHostComponent,
    ChatRuntimeConfirmationCarouselComponent,
    ChatRuntimePlanReviewComponent,
    ChatSessionListComponent,
    ChatSessionPickerComponent,
    ChatSessionTitleControlComponent,
    ChatContextToolbarComponent,
    NzNoAnimationDirective,
  ],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AilyChatComponent implements OnDestroy {
  readonly debugBrowserViewState = {
    Home: ChatDebugBrowserViewState.Home,
    Overview: ChatDebugBrowserViewState.Overview,
    Logs: ChatDebugBrowserViewState.Logs,
    FlowChart: ChatDebugBrowserViewState.FlowChart,
    CacheExplorer: ChatDebugBrowserViewState.CacheExplorer,
  } as const;

  @ViewChild('chatContainer') chatContainer: ElementRef;
  @ViewChild('chatTextarea') chatTextarea: ElementRef;
  @ViewChild('windowBoxRoot')
  set windowBoxRoot(ref: ElementRef<HTMLElement> | undefined) {
    this.observeSessionViewport(ref?.nativeElement ?? null);
  }
  @ViewChild(ChatInputPartHostComponent) inputPartHost?: ChatInputPartHostComponent;
  @ViewChild('dialogsContent')
  set dialogsContent(ref: ElementRef<HTMLElement> | undefined) {
    this.observeDialogContent(ref?.nativeElement ?? null);
  }
  @ViewChildren(XDialogComponent) xDialogComponents: QueryList<XDialogComponent>;

  public readonly vm: ChatComponentViewModel;
  reasoningMenuItems: IMenuItem[] = [];
  public isManualCompacting = false;
  public isComposerFocused = false;

  public readonly switchShellCoordinator: ChatSwitchShellCoordinator;
  public readonly editResourceShellCoordinator: ChatEditResourceShellCoordinator;
  public readonly surfaceShellCoordinator: ChatSurfaceShellCoordinator;
  public readonly submitShellCoordinator: ChatSubmitShellCoordinator;
  public readonly composerShellCoordinator: ChatComposerShellCoordinator;
  public readonly viewportShellCoordinator: ChatViewportShellCoordinator;
  public readonly memoryShellCoordinator: ChatMemoryShellCoordinator;
  public readonly actionRegistry: ChatActionRegistry;
  private readonly lifecycleCoordinator: ChatComponentLifecycleCoordinator;
  private dialogsResizeObserver: ResizeObserver | null = null;
  private sessionViewportResizeObserver: ResizeObserver | null = null;
  private observedDialogsElement: HTMLElement | null = null;
  private observedSessionViewportElement: HTMLElement | null = null;
  private readonly rememberedFullAccessSessions = new Set<string>();
  private readonly debugBrowserChangeSubscription: Subscription;
  private readonly sessionViewModelChangeSubscription: Subscription;
  /** 用户消息重新编辑互斥：同时最多展开一条 */
  userMessageEditingTurnId: string | undefined;

  constructor(
    private uiService: UiService,
    private chatService: ChatService,
    private mcpService: McpService,
    private projectService: ProjectService,
    private cmdService: CmdService,
    private crossPlatformCmdService: CrossPlatformCmdService,
    private blocklyService: BlocklyService,
    private message: NzMessageService,
    private authService: AuthService,
    private modal: NzModalService,
    private configService: ConfigService,
    private ailyChatConfigService: AilyChatConfigService,
    private todoUpdateService: TodoUpdateService,
    private arduinoLintService: ArduinoLintService,
    private noticeService: NoticeService,
    private platformService: PlatformService,
    private electronService: ElectronService,
    private onboardingService: OnboardingService,
    private absAutoSyncService: AbsAutoSyncService,
    private connectionGraphService: ConnectionGraphService,
    private repetitionDetectionService: RepetitionDetectionService,
    private chatHistoryService: ChatHistoryService,
    public debugBrowser: ChatDebugBrowserService,
    private cdr: ChangeDetectorRef,
    private builderService: BuilderService,
    private themeService: ThemeService,
    public runtimeInteractionHost: ChatRuntimeInteractionHostService,
    public engine: ChatEngineService,
    public scrollManager: ScrollManagerService,
    public resourceManager: ResourceManagerService,
    public sessionActions: ChatSessionActionsService,
    public menuManager: MenuManagerService,
    public viewState: ChatViewService,
  ) {
    ChatPerformanceTracer.increment('entry_open.component_constructor');
    ChatPerformanceTracer.mark('entry_open.component_constructor');
    this.vm = new ChatComponentViewModel({
      engine: this.engine,
      viewState: this.viewState,
    });
    this.engine.setPaneSessionCommandHandlers({
      requestNewChat: () => this.requestNewChat(),
    });
    this.debugBrowserChangeSubscription = this.debugBrowser.onDidChange.subscribe(() => {
      this.cdr.markForCheck();
    });
    this.sessionViewModelChangeSubscription = this.viewState.sessionViewModelChanged$.subscribe(() => {
      this.syncSessionListDisplayState();
    });
    // 注册 OnPush CD 回调 — viewAdapter 每次 flush/appendImmediate 后调用 markForCheck
    this.engine.setCdCallback(() => {
      this.syncSessionListDisplayState();
    });
    // 注册同步 detectChanges 回调 — 供 zone 外场景直接触发 CD（如 _ensureAilyMessage）
    this.engine.setSyncDetectChanges(() => {
      this.syncSessionListDisplayState();
      this.cdr.detectChanges();
    });
    this.switchShellCoordinator = new ChatSwitchShellCoordinator({
      menuManager: this.menuManager,
      viewState: this.viewState,
      getCurrentMode: () => this.vm.currentMode,
      getCurrentModeId: () => this.engine.currentResolvedMode?.id,
      getCurrentCustomAgentTarget: () => this.vm.currentCustomAgentTarget,
      getCurrentModel: () => this.vm.currentModel,
    }, {
      switchToMode: (mode) => this.engine.switchToMode(mode),
      switchToCustomAgent: (selection) => this.engine.switchToCustomAgent(selection),
      configureCustomAgents: () => this.viewState.openSettings(),
      updatePermissionPreset: (preset) => this.updatePermissionPresetWithConfirmation(preset),
      switchToModel: (model) => this.engine.switchToModel(model),
      switchToModelConfiguration: (model, update) => this.engine.switchToModelConfiguration(model, update),
    });
    this.editResourceShellCoordinator = new ChatEditResourceShellCoordinator({
      getDialog: () => AilyHost.get().dialog,
      resolveTarget: ({ turnId }) => this.xDialogComponents?.find((dialog) => {
          return dialog.role === 'user' && dialog.actionTurnId === turnId;
      }),
    });
    this.surfaceShellCoordinator = new ChatSurfaceShellCoordinator({
      editAndResendFromTurn: (target, newText, resources) => this.engine.editAndResendFromTurn(target, newText, resources),
      closeTool: (toolId) => AilyHost.get().ui?.closeTool(toolId),
      openUrl: (url) => this.electronService.openUrl(url),
    });
    this.submitShellCoordinator = new ChatSubmitShellCoordinator({
      scrollManager: this.scrollManager,
      resourceManager: this.resourceManager,
      authQuota: this.engine.authQuotaStateService,
      inputNotice: this.engine.chatInputNoticeStateService,
      getSessionAllowedPaths: () => this.engine.sessionAllowedPaths,
      getSessionId: () => this.vm.sessionId,
      getInputValue: () => this.vm.inputValue,
      isWaiting: () => this.vm.isWaiting,
      ensureSession: () => this.engine.ensureSessionReadyForSubmit(),
      stop: (sessionId) => this.engine.stop(sessionId),
      send: (text) => this.engine.send('user', text, true),
    });
    this.composerShellCoordinator = new ChatComposerShellCoordinator({
      viewState: this.viewState,
      getInputValue: () => this.vm.inputValue,
      setInputValue: (value) => {
        this.engine.inputValue = value;
      },
      isWaiting: () => this.vm.isWaiting,
      submitCurrentInput: () => this.submitShellCoordinator.submitCurrentInput(),
      getTextareaRef: () => this.chatTextarea,
    });
    this.viewportShellCoordinator = new ChatViewportShellCoordinator({
      scrollManager: this.scrollManager,
      viewState: this.viewState,
      requestSessionListSummaryLoad: () => this.engine.requestSessionListRefresh({
        reason: 'shell',
        scope: 'summary',
        priority: 'after-paint',
      }),
    });
    this.memoryShellCoordinator = new ChatMemoryShellCoordinator({
      modal: this.modal,
      getHost: () => AilyHost.get(),
      getProjectPath: () => {
        const host = AilyHost.get();
        return host.project.currentProjectPath || host.project.projectRootPath || this.projectService.currentProjectPath || this.projectService.projectRootPath || '';
      },
      getSessionId: () => this.vm.sessionId,
      getCopilotMemoryEnabled: () => this.ailyChatConfigService.copilotMemoryEnabled === true,
      notifyInfo: (text) => this.message.info(text),
      notifyError: (text) => this.message.error(text),
    });
    this.actionRegistry = new ChatActionRegistry(() => ({
      currentMode: this.vm.currentMode,
      canRunManageModelsAction: () => Boolean(AilyHost.get().editor?.showTextDocument),
      runManageModelsAction: () => this.runManageModelsAction(),
      runShowMemoriesAction: () => this.memoryShellCoordinator.requestShowMemories(),
      runClearMemoriesAction: () => this.memoryShellCoordinator.requestClearMemories(),
      runConfigureCustomAgentsAction: () => {
        this.viewState.openSettings();
        return true;
      },
      runFocusTodosViewAction: () => this.runFocusTodosViewAction(),
      notifyManageModelsUnavailable: () => {
        this.message.warning('当前宿主无法打开模型配置文件');
      },
    }));
    this.viewState.bindPaneChromeActions({
      runNewChatAction: () => {
        this.requestNewChat();
        return true;
      },
      runToggleSettingsAction: () => {
        this.toggleSettings();
        return true;
      },
      runGoBackAction: () => {
        this.requestReturnToEntryInventory({
          saveCurrentSession: false,
          disposeRuntime: false,
        });
        return true;
      },
      runPickSessionAction: (event: MouseEvent) => {
        this.openSessionPicker(event);
        return true;
      },
    });
    this.lifecycleCoordinator = new ChatComponentLifecycleCoordinator({
      isHostInitialized: () => AilyHost.isInitialized(),
      initializeHost: () => {
        AilyHost.init(createElectronHostAdapter({
          projectService: this.projectService,
          configService: this.configService,
          authService: this.authService,
          builderService: this.builderService,
          platformService: this.platformService,
          noticeService: this.noticeService,
          blocklyService: this.blocklyService,
          connectionGraphService: this.connectionGraphService,
          cmdService: this.cmdService,
          crossPlatformCmdService: this.crossPlatformCmdService,
          absAutoSyncService: this.absAutoSyncService,
          electronService: this.electronService,
          uiService: this.uiService,
          onboardingService: this.onboardingService,
        }));
        this.ailyChatConfigService.reloadRemoteModelCatalog('host_initialized');
      },
      loadMermaid: () => import('mermaid'),
      setMermaidInstance: (instance) => {
        const mode = this.themeService.theme();
        const config =
          mode === 'dark'
            ? { startOnLoad: false, ...MERMAID_DARK_THEME }
            : { startOnLoad: false, theme: 'default' as const };
        MermaidCodeComponent.setMermaidInstance(instance, config);
      },
      exposeEditBlockTools: () => {
        (window as any).editBlockTool = {
          getActiveWorkspace,
          configureBlockTool,
          deleteBlockTool,
          getWorkspaceOverviewTool,
          queryBlockDefinitionTool,
        };
      },
      initializeEngine: () => this.engine.init(this.chatTextarea),
      detachEngineView: () => this.engine.detachView(),
    });
  }

  ngOnInit() {
    ChatPerformanceTracer.increment('entry_open.component_ng_on_init');
    ChatPerformanceTracer.mark('entry_open.component_ng_on_init');
    this.lifecycleCoordinator.initialize();
    this.syncSessionListDisplayState();
  }

  ngAfterViewInit(): void {
    ChatPerformanceTracer.increment('entry_open.pane_setup_complete');
    ChatPerformanceTracer.mark('entry_open.pane_setup_complete');
    this.viewportShellCoordinator.initialize(this.chatContainer);
    this.scrollManager.handleContentHeightChange();
    this.syncSessionListDisplayState();
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => {
        ChatPerformanceTracer.increment('entry_open.first_stable_paint');
        ChatPerformanceTracer.mark('entry_open.first_stable_paint');
      });
    }
  }

  get activeImportedDebugView() {
    return this.debugBrowser.activeImportedDebugView;
  }

  get activeImportedResourceSummary() {
    return this.debugBrowser.activeImportedResourceSummary;
  }

  get activeImportedDebugEvents() {
    return this.debugBrowser.activeImportedDebugEvents;
  }

  get entrySessionItems(): ReadonlyArray<{ sessionId: string; title: string; current: boolean }> {
    return this.viewState.entrySessionItems;
  }

  get currentPaneTitle(): string {
    return this.viewState.currentPaneTitle;
  }

  get currentPaneSurface(): ChatPaneSurface {
    return this.viewState.currentPaneSurface;
  }

  get currentSessionTitle(): string {
    return this.viewState.currentSessionTitle;
  }

  get sessionListItems(): readonly ChatSessionListItem[] {
    return this.viewState.sessionListItems;
  }

  get selectedSessionId(): string {
    return this.viewState.selectedSessionId;
  }

  get sessionPickerRevealSessionId(): string {
    return this.viewState.pickerRevealSessionId;
  }

  get sessionListDisplayMode(): 'hidden' | 'stacked' | 'sidebar' {
    return this.viewState.sessionListDisplayMode;
  }

  get showSessionSidebar(): boolean {
    return this.viewState.showSessionSidebar;
  }

  get showStackedSessionList(): boolean {
    return this.viewState.showStackedSessionList;
  }

  get showLoginSurface(): boolean {
    return this.viewState.showLoginSurface;
  }

  get sessionSidebarWidth(): number {
    return this.viewState.sessionSidebarWidth;
  }

  get sessionSidebarResizeMinWidth(): number {
    return this.viewState.sessionSidebarResizeMinWidth;
  }

  get sessionSidebarMaxWidth(): number {
    return this.viewState.sessionSidebarMaxWidth;
  }

  get sessionTitleSurfaceModel(): ChatSessionTitleSurfaceModel {
    return this.viewState.sessionTitleSurfaceModel;
  }

  get hostHeaderActions() {
    return this.viewState.hostHeaderActions;
  }

  get sidebarSessionListSurfaceModel(): ChatPaneSessionListSurfaceModel {
    return this.viewState.sidebarSessionListSurfaceModel;
  }

  get stackedSessionListSurfaceModel(): ChatPaneSessionListSurfaceModel {
    return this.viewState.stackedSessionListSurfaceModel;
  }

  get entryInfoSurfaceModel(): ChatPaneEntryInfoSurfaceModel | null {
    return this.viewState.entryInfoSurfaceModel;
  }

  get paneStageSurfaceModel(): ChatPaneStageSurfaceModel | null {
    return this.viewState.paneStageSurfaceModel;
  }

  get sessionPickerSurfaceModel(): ChatPaneSessionPickerSurfaceModel | null {
    return this.viewState.sessionPickerSurfaceModel;
  }

  handleSessionTitleActionRequested(request: ChatSessionTitleActionRequest): void {
    this.viewState.runSessionTitleAction(request);
  }

  focusChatInputFromTitleControl(): void {
    this.chatTextarea?.nativeElement?.focus();
  }

  handleHostHeaderActionRequested(request: ChatHostHeaderActionRequest): void {
    request.event.stopPropagation();
    this.viewState.runHostHeaderAction(request);
  }

  handleSessionListRetry(): void {
    this.viewState.retrySessionListLoad();
  }

  openDebugBrowserHome(): void {
    this.debugBrowser.openHome();
    this.cdr.markForCheck();
  }

  onSessionSidebarResize({ width }: NzResizeEvent): void {
    if (typeof width !== 'number' || !Number.isFinite(width)) {
      return;
    }

    this.viewState.setSessionSidebarWidth(width, { persist: false });
  }

  onSessionSidebarResizeEnd({ width }: NzResizeEvent): void {
    if (typeof width !== 'number' || !Number.isFinite(width)) {
      return;
    }

    this.viewState.setSessionSidebarWidth(width, { persist: true });
  }

  openImportedDebugSession(sessionId: string): void {
    if (!this.debugBrowser.openImportedSession(sessionId)) {
      return;
    }

    this.cdr.markForCheck();
  }

  openImportedDebugOverview(): void {
    this.debugBrowser.showView(ChatDebugBrowserViewState.Overview);
    this.cdr.markForCheck();
  }

  openImportedDebugLogs(): void {
    this.debugBrowser.showView(ChatDebugBrowserViewState.Logs);
    this.cdr.markForCheck();
  }

  openImportedDebugFlow(): void {
    this.debugBrowser.showView(ChatDebugBrowserViewState.FlowChart);
    this.cdr.markForCheck();
  }

  openImportedDebugCache(): void {
    this.debugBrowser.showView(ChatDebugBrowserViewState.CacheExplorer);
    this.cdr.markForCheck();
  }

  private async importDebugSnapshotFromDialog(): Promise<void> {
    const result = await importDebugSnapshotFromDialog({
      dialog: AilyHost.get().dialog,
      fs: AilyHost.get().fs,
      importDebugSnapshot: (data) => this.chatHistoryService.importDebugSnapshot(data),
    });

    if (result.kind === 'failed') {
      this.message.error('无法导入调试快照');
      return;
    }

    if (result.kind === 'imported') {
      this.debugBrowser.openImportedRecord(result.imported);
      this.cdr.markForCheck();
    }
  }

  closeDebugBrowser(): void {
    if (!this.debugBrowser.isOpen) {
      return;
    }

    this.debugBrowser.close();
    this.cdr.markForCheck();
  }

  async handleManualCompaction(event?: MouseEvent): Promise<void> {
    event?.stopPropagation();

    if (this.isManualCompacting || this.vm.isWaiting) {
      return;
    }

    this.isManualCompacting = true;
    this.cdr.markForCheck();

    try {
      const changed = await this.engine.compactConversation();
      if (changed) {
        this.engine.saveCurrentSession();
        this.engine.refreshHistoryList();
        this.message.success('对话已压缩');
      } else {
        this.message.info('当前没有可压缩的对话');
      }
    } catch (error) {
      console.error('[AilyChat] 手动压缩对话失败:', error);
      this.message.error('压缩对话失败');
    } finally {
      this.isManualCompacting = false;
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy() {
    this.debugBrowserChangeSubscription.unsubscribe();
    this.sessionViewModelChangeSubscription.unsubscribe();
    this.disconnectDialogContentObserver();
    this.disconnectSessionViewportObserver();
    this.lifecycleCoordinator.detachView();
  }

  focusTodosView(): boolean {
    if (!this.inputPartHost?.hasVisibleTodos()) {
      return false;
    }

    return this.inputPartHost.focusTodoList();
  }

  toggleTodosViewFocus(): boolean {
    if (!this.inputPartHost?.hasVisibleTodos()) {
      return false;
    }

    if (this.inputPartHost.isTodoListFocused()) {
      this.chatTextarea?.nativeElement?.focus();
      return true;
    }

    return this.inputPartHost.focusTodoList();
  }

  runFocusTodosViewAction(): boolean {
    return runChatTodoFocusAction({
      currentMode: this.vm.currentMode,
      toggleTodosViewFocus: () => this.toggleTodosViewFocus(),
      notifyUnavailable: () => this.message.info('当前没有可聚焦的 agent 待办事项'),
    });
  }

  runManageModelsAction(): boolean {
    const targetPath = this.engine.languageModelsService.prepareConfigurationFile();
    if (!targetPath) {
      this.message.error('无法准备聊天模型配置文件');
      return false;
    }

    const host = AilyHost.get();
    const projectPath = host.project.currentProjectPath || host.project.projectRootPath;
    const openResult = host.editor?.showTextDocument?.(targetPath, { projectPath });

    if (typeof (openResult as Promise<boolean> | undefined)?.then === 'function') {
      void (openResult as Promise<boolean>).then((opened) => {
        if (!opened) {
          this.message.error('无法打开聊天模型配置文件');
        }
      }).catch((err) => {
        console.error('打开聊天模型配置文件失败:', err);
        this.message.error('无法打开聊天模型配置文件');
      });
      return true;
    }

    if (!openResult) {
      this.message.error('无法打开聊天模型配置文件');
      return false;
    }

    return true;
  }

  get actionMenuItems() {
    return this.actionRegistry.getMenuItems();
  }

  get permissionMenuItems(): IMenuItem[] {
    const isAutoReview = this.engine.currentSessionApprovalsReviewer === 'auto_review';
    const isFullAccess = this.engine.currentSessionPermissionMode === 'bypassPermissions';
    const isDefault = !isAutoReview && !isFullAccess;

    return [
      {
        name: '默认权限',
        action: 'permission-default',
        icon: 'fa-light fa-shield-check',
        current: isDefault,
        tooltip: '使用默认权限。',
      },
      {
        name: '自动审查',
        action: 'permission-auto-review',
        icon: 'fa-light fa-robot',
        current: isAutoReview,
        tooltip: '将审批请求交给 Auto Review',
      },
      { sep: true },
      {
        name: '完全访问权限',
        action: 'permission-full-access',
        icon: 'fa-light fa-triangle-exclamation',
        current: isFullAccess,
        tooltip: '高风险：跳过权限拦截。仅在受控环境下使用。',
      },
    ];
  }

  get permissionButtonIconClass(): string {
    if (this.engine.currentSessionPermissionMode === 'bypassPermissions') {
      return 'fa-light fa-triangle-exclamation';
    }

    if (this.engine.currentSessionApprovalsReviewer === 'auto_review') {
      return 'fa-light fa-robot';
    }

    return 'fa-light fa-shield-check';
  }

  toggleActionMenu(event: MouseEvent): void {
    this.vm.closeSessionPicker();
    this.menuManager.toggleActionMenu(event, [...this.actionMenuItems]);
  }

  toggleReasoningMenu(event: MouseEvent): void {
    this.vm.closeSessionPicker();
    this.reasoningMenuItems = [...this.vm.currentReasoningEffortMenuItems];
    this.menuManager.toggleReasoningMenu(event, [...this.reasoningMenuItems]);
  }

  togglePermissionMenu(event: MouseEvent): void {
    this.switchShellCoordinator.togglePermissionMenu(event, this.permissionMenuItems);
  }

  handlePermissionMenuClick(item: IMenuItem): void {
    this.switchShellCoordinator.permissionMenuClick(item);
  }

  private async updatePermissionPresetWithConfirmation(preset: string): Promise<void> {
    const action = typeof preset === 'string' ? preset.trim() : '';
    if (!action) {
      return;
    }

    if (action !== 'permission-full-access') {
      this.engine.applyComposerPermissionPreset(action);
      this.notifyPermissionPresetApplied(action);
      return;
    }

    const sessionId = this.resolvePermissionTargetSessionId();
    if (sessionId && this.rememberedFullAccessSessions.has(sessionId)) {
      this.engine.applyComposerPermissionPreset(action, sessionId);
      this.notifyPermissionPresetApplied(action);
      return;
    }

    const decision = await this.confirmFullAccessPermission();
    if (!decision.confirmed) {
      return;
    }

    if (decision.rememberForSession && sessionId) {
      this.rememberedFullAccessSessions.add(sessionId);
    }

    this.engine.applyComposerPermissionPreset(action, sessionId);
    this.notifyPermissionPresetApplied(action, { remembered: decision.rememberForSession });
  }

  private notifyPermissionPresetApplied(
    action: string,
    options?: {
      remembered?: boolean;
    },
  ): void {
    if (action === 'permission-auto-review') {
      this.message.success('已切换为自动审查');
      return;
    }

    if (action === 'permission-full-access') {
      if (options?.remembered) {
        this.message.success('已切换为完全访问权限（本会话已记住）');
        return;
      }

      this.message.success('已切换为完全访问权限');
      return;
    }

    this.message.success('已切换为默认审批/默认权限');
  }

  private resolvePermissionTargetSessionId(): string {
    const engineSessionId = typeof this.engine.sessionId === 'string' ? this.engine.sessionId.trim() : '';
    if (engineSessionId) {
      return engineSessionId;
    }

    return typeof this.chatService.currentSessionId === 'string' ? this.chatService.currentSessionId.trim() : '';
  }

  private confirmFullAccessPermission(): Promise<ChatPermissionConfirmDialogResult> {
    return new Promise<ChatPermissionConfirmDialogResult>((resolve) => {
      const modalRef = this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzMaskClosable: false,
        nzKeyboard: false,
        nzWidth: 420,
        nzBodyStyle: { padding: '0' },
        nzContent: ChatPermissionConfirmDialogComponent,
        nzData: {
          title: '启用完全访问权限',
          message: '该设置会跳过权限拦截，允许执行高风险操作。请确认你正在受控环境中使用。',
          riskNote: '建议仅用于你完全信任的仓库与会话。',
          confirmLabel: '继续启用',
          cancelLabel: '取消',
          rememberLabel: '本会话内记住我的选择',
        },
      });

      modalRef.afterClose.subscribe((result: ChatPermissionConfirmDialogResult | undefined) => {
        resolve({
          confirmed: !!result?.confirmed,
          rememberForSession: !!result?.rememberForSession,
        });
      });
    });
  }

  handleModelMenuActionClick(payload: {
    event?: MouseEvent;
    action?: string;
    item?: IMenuItem & {
      data?: {
        model?: { presetId?: string; model?: string };
        modelSelectionId?: string;
        reasoningMenuItems?: IMenuItem[];
        configurationMenuItemsByAction?: Record<string, IMenuItem[]>;
      };
    };
  }): void {
    if (!(payload.event instanceof MouseEvent) || typeof payload.action !== 'string' || !payload.action.trim()) {
      return;
    }

    if (payload.action === 'pin-model' || payload.action === 'unpin-model') {
      const modelSelectionId = typeof payload.item?.data?.modelSelectionId === 'string' && payload.item.data.modelSelectionId.trim()
        ? payload.item.data.modelSelectionId.trim()
        : typeof payload.item?.data?.model?.presetId === 'string' && payload.item.data.model.presetId.trim()
          ? payload.item.data.model.presetId.trim()
          : typeof payload.item?.data?.model?.model === 'string'
            ? payload.item.data.model.model.trim()
            : '';
      if (!modelSelectionId) {
        return;
      }

      if (payload.action === 'pin-model') {
        this.chatService.pinModelId(modelSelectionId);
      } else {
        this.chatService.unpinModelId(modelSelectionId);
      }

      this.vm.closeSessionPicker();
      this.reasoningMenuItems = [];
      this.menuManager.showReasoningMenu = false;
      this.menuManager.showModelMenu = false;
      this.menuManager.toggleModelMenu(payload.event, [...this.vm.modelMenuItems]);
      return;
    }

    const configurationMenuItemsByAction = payload.item?.data?.configurationMenuItemsByAction;
    const reasoningMenuItems = configurationMenuItemsByAction && Array.isArray(configurationMenuItemsByAction[payload.action])
      ? configurationMenuItemsByAction[payload.action]
      : Array.isArray(payload.item?.data?.reasoningMenuItems)
        ? payload.item.data.reasoningMenuItems
        : [];
    const configurationMenuItems = Array.isArray(reasoningMenuItems)
      ? reasoningMenuItems
      : [];
    if (configurationMenuItems.length === 0) {
      return;
    }

    this.vm.closeSessionPicker();
    this.reasoningMenuItems = [...configurationMenuItems];
    this.menuManager.toggleReasoningMenu(payload.event, [...this.reasoningMenuItems]);
  }

  handleActionMenuClick(item: { action?: string }): void {
    this.menuManager.showActionMenu = false;
    this.actionRegistry.runMenuAction(item);
  }

  toggleSettings(): void {
    this.viewState.toggleSettings();
  }

  closeSettings(): void {
    this.viewState.closeSettings();
  }

  openSessionPicker(event?: MouseEvent): void {
    this.viewState.openSessionPicker(event);
  }

  handleSessionSelection(event: { sessionId: string; item: ChatSessionListItem }): void {
    void this.sessionActions.requestSwitchToSession(
      event.sessionId,
      this.chatService.currentSessionId,
      this.engine.editCheckpointService,
      this.createSessionSwitchCallbacks(),
      event.item,
    );
  }

  handleSessionAction(event: { action: string; data: any }): void {
    this.sessionActions.sessionActionClick(event, this.chatService.currentSessionId, this.createSessionRowActionCallbacks());
  }

  requestNewChat(): void {
    void this.sessionActions.requestNewChat(this.engine.editCheckpointService, this.createSessionCommandCallbacks());
  }

  requestReturnToEntryInventory(options?: { saveCurrentSession?: boolean; disposeRuntime?: boolean }): void {
    void this.sessionActions.requestReturnToEntryInventory(
      this.engine.editCheckpointService,
      this.createSessionEntryCommandCallbacks(),
      this.chatService.currentSessionId,
      {
        saveCurrentSession: options?.saveCurrentSession,
        disposeRuntime: options?.disposeRuntime,
      },
    );
  }

  requestImportDebugSnapshot(): void {
    void this.sessionActions.requestImportDebugSnapshot(this.engine.editCheckpointService, this.createSessionCommandCallbacks());
  }

  private createSessionSwitchCallbacks() {
    return {
      onCloseSessionPicker: () => this.viewState.closeSessionPicker(),
      onSaveCurrentSession: () => this.engine.saveCurrentSession(),
      onSwitchSession: (sessionId: string, fallbackProjectPath?: string | null) => this.runRestoreAwareSessionSwitch(sessionId, fallbackProjectPath),
      onSetCompleted: () => {
        this.engine.isCompleted = true;
      },
      onSetServerSessionInactive: () => undefined,
    };
  }

  private createSessionRowActionCallbacks() {
    return {
      onSwitchSession: (sessionId: string, fallbackProjectPath?: string | null) => this.runRestoreAwareSessionSwitch(sessionId, fallbackProjectPath),
      onNewChat: () => {
        this.closeDebugBrowser();
        return this.engine.newChat();
      },
      onEnterEntryState: (sessionId?: string | null) => {
        this.closeDebugBrowser();
        return this.engine.returnToEntryInventory({ sessionId });
      },
      onDetectChanges: () => this.cdr.markForCheck(),
      onUpdateTitle: (title: string) => {
        if (typeof this.chatService.setCurrentSessionTitle === 'function') {
          this.chatService.setCurrentSessionTitle({
            text: title,
            source: 'user',
          });
        } else {
          this.chatService.currentSessionTitle = title;
        }
      },
      onRefreshSessions: () => {
        this.closeDebugBrowser();
        return this.engine.refreshHistoryList();
      },
    };
  }

  private createSessionCommandCallbacks() {
    return {
      onSaveCurrentSession: () => this.engine.saveCurrentSession(),
      onNewChat: () => {
        this.closeDebugBrowser();
        return this.engine.newChat();
      },
      onImportDebugSnapshot: () => this.importDebugSnapshotFromDialog(),
    };
  }

  private createSessionEntryCommandCallbacks() {
    return {
      onSaveCurrentSession: () => this.engine.saveCurrentSession(),
      onEnterEntryState: (sessionId?: string | null, options?: { disposeRuntime?: boolean }) => {
        this.closeDebugBrowser();
        return this.engine.returnToEntryInventory({
          sessionId,
          disposeRuntime: options?.disposeRuntime,
        });
      },
    };
  }

  private async runRestoreAwareHistoryLoad(): Promise<void> {
    this.closeDebugBrowser();
    try {
      await this.engine.getHistory();
      const sessionId = this.chatService.currentSessionId || this.engine.sessionId;
      if (sessionId) {
        this.chatHistoryService.clearRecordedRestoreFailure?.(sessionId);
      }
    } catch (error) {
      this.reportSessionRestoreFailure(error);
    }
  }

  private async runRestoreAwareSessionSwitch(
    sessionId: string,
    fallbackProjectPath?: string | null,
  ): Promise<boolean> {
    this.closeDebugBrowser();
    try {
      return await this.engine.switchToSession(sessionId, {
        fallbackProjectPath: fallbackProjectPath ?? null,
      });
    } catch (error) {
      this.reportSessionRestoreFailure(error);
      return false;
    }
  }

  private reportSessionRestoreFailure(error: unknown): void {
    if (isSessionLifecycleSupersededError(error)) {
      return;
    }

    const restoreDetails = readSessionLifecycleRestoreErrorDetails(error);
    if (restoreDetails) {
      try {
        const imported = this.chatHistoryService.captureRestoreFailureDebugSnapshot?.(
          restoreDetails,
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : undefined,
        );
        if (imported) {
          this.debugBrowser.openImportedRecord(imported, ChatDebugBrowserViewState.Overview);
          this.cdr.markForCheck();
        }
      } catch (captureError) {
        console.warn('[AilyChatComponent] failed to capture restore failure debug snapshot:', captureError);
      }
    }

    const marker = restoreDetails?.restoreFailure?.kind ?? restoreDetails?.stage;
    if (marker) {
      this.message.error(`会话恢复失败（${marker}），请重试`);
      return;
    }
    this.message.error('会话恢复失败，请重试');
  }

  handleReasoningMenuClick(item: { data?: { model?: unknown; modelConfiguration?: { key?: string; value: unknown } } }): void {
    this.menuManager.showReasoningMenu = false;
    this.reasoningMenuItems = [];

    const model = item?.data?.model;
    const modelConfiguration = item?.data?.modelConfiguration;
    if (!model || typeof modelConfiguration?.key !== 'string' || !modelConfiguration.key.trim()) {
      return;
    }

    void this.engine.switchToModelConfiguration(model as Parameters<ChatEngineService['switchToModelConfiguration']>[0], {
      key: modelConfiguration.key.trim(),
      value: modelConfiguration.value,
    });
  }

  setComposerFocusState(focused: boolean): void {
    this.isComposerFocused = focused;
  }

  onUserMessageEditSessionOpened(turnId: string): void {
    this.userMessageEditingTurnId = turnId;
    this.cdr.markForCheck();
  }

  onUserMessageEditSessionClosed(): void {
    this.userMessageEditingTurnId = undefined;
    this.cdr.markForCheck();
  }

  closeChatSessionMenus(): void {
    this.vm.closeSessionPicker();
    this.menuManager.closeAll();
    this.cdr.markForCheck();
  }

  handleTodoFocusToggleShortcut(): void {
    this.runFocusTodosViewAction();
  }

  openAuthQuotaUsage(event?: MouseEvent): void {
    event?.stopPropagation();
    this.uiService.openTool('user-center');
  }

  dismissChatInputNotice(event?: MouseEvent): void {
    event?.stopPropagation();
    this.engine.chatInputNoticeStateService.dismissCurrentNotice();
  }

  async continueCurrentExecution(event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    try {
      await this.engine.continueCurrentExecution();
    } catch (error) {
      console.warn('[AilyChatComponent] continue current execution failed:', error);
      this.message.error('继续执行失败，请从最新状态重试');
    }
  }

  getChatInputNoticeSeverityClass(notice: { tone?: string } | null | undefined): string {
    switch (notice?.tone) {
      case 'error':
        return 'severity-error';
      case 'warning':
        return 'severity-warning';
      default:
        return 'severity-info';
    }
  }

  private observeDialogContent(element: HTMLElement | null): void {
    if (this.observedDialogsElement === element) {
      return;
    }

    this.disconnectDialogContentObserver();
    this.observedDialogsElement = element;

    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    this.dialogsResizeObserver = new ResizeObserver(() => {
      this.scrollManager.handleContentHeightChange();
    });
    this.dialogsResizeObserver.observe(element);
  }

  private observeSessionViewport(element: HTMLElement | null): void {
    if (this.observedSessionViewportElement === element) {
      return;
    }

    this.disconnectSessionViewportObserver();
    this.observedSessionViewportElement = element;

    if (!element) {
      this.viewState.setSessionViewportWidth(0);
      return;
    }

    this.viewState.setSessionViewportWidth(element.clientWidth);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.sessionViewportResizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect?.width ?? element.clientWidth;
      this.viewState.setSessionViewportWidth(nextWidth);
      this.syncSessionListDisplayState();
    });
    this.sessionViewportResizeObserver.observe(element);
  }

  private disconnectSessionViewportObserver(): void {
    this.sessionViewportResizeObserver?.disconnect();
    this.sessionViewportResizeObserver = null;
    this.observedSessionViewportElement = null;
  }

  private syncSessionListDisplayState(): void {
    this.viewState.syncSessionViewerLayout({
      hasConversationContent: this.vm.hasConversationContent,
      isAuthenticated: this.vm.isLoggedIn,
    });
    this.cdr.markForCheck();
  }

  private disconnectDialogContentObserver(): void {
    this.dialogsResizeObserver?.disconnect();
    this.dialogsResizeObserver = null;
    this.observedDialogsElement = null;
  }
}
