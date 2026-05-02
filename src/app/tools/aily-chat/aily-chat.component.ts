import { Component, ElementRef, ViewChild, ViewChildren, QueryList, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { XDialogComponent } from './components/x-dialog/x-dialog.component';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { ToolContainerComponent } from '../../components/tool-container/tool-container.component';
import { UiService } from '../../services/ui.service';
import { NzResizableModule } from 'ng-zorro-antd/resizable';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { CommonModule } from '@angular/common';
import { ChatService } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
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
import './tools/registered/register-all';
import { AilyHost } from './core/host';
import { createElectronHostAdapter } from './adapters/electron-host-adapter';
import { ScrollManagerService } from './services/scroll-manager.service';
import { ResourceManagerService } from './services/resource-manager.service';
import { MenuManagerService } from './services/menu-manager.service';
import { ChatViewService } from './services/chat-view.service';
import { ChatEngineService } from './services/chat-engine.service';
import { EditCheckpointService } from './services/edit-checkpoint.service';
import { ChatSessionShellCoordinator } from './helpers/chat-session-shell-coordinator';
import { ChatSwitchShellCoordinator } from './helpers/chat-switch-shell-coordinator';
import { ChatEditResourceShellCoordinator } from './helpers/chat-edit-resource-shell-coordinator';
import { ChatSurfaceShellCoordinator } from './helpers/chat-surface-shell-coordinator';
import { ChatSubmitShellCoordinator } from './helpers/chat-submit-shell-coordinator';
import { ChatComposerShellCoordinator } from './helpers/chat-composer-shell-coordinator';
import { ChatViewportShellCoordinator } from './helpers/chat-viewport-shell-coordinator';
import { ChatComponentLifecycleCoordinator } from './helpers/chat-component-lifecycle-coordinator';
import { ChatComponentViewModel } from './helpers/chat-component-view-model';

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
import { AilyChatSettingsComponent } from './components/settings/settings.component';
import { OnboardingService } from '../../services/onboarding.service';
import { AbsAutoSyncService } from './services/abs-auto-sync.service';
import { RepetitionDetectionService } from './services/repetition-detection.service';
import { ChatHistoryService } from './services/chat-history.service';

// 共享类型从 core/chat-types.ts 导入并重新导出（保持向后兼容）
import { Tool, ResourceItem, ChatMessage, ToolCallState, ToolCallInfo } from './core/chat-types';
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
    AilyChatSettingsComponent
  ],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    ScrollManagerService,
    ResourceManagerService,
    MenuManagerService,
    ChatViewService,
    EditCheckpointService,
    ChatEngineService,
  ],
})
export class AilyChatComponent implements OnDestroy {
  @ViewChild('chatContainer') chatContainer: ElementRef;
  @ViewChild('chatTextarea') chatTextarea: ElementRef;
  @ViewChildren(XDialogComponent) xDialogComponents: QueryList<XDialogComponent>;

  public readonly vm: ChatComponentViewModel;
  public isManualCompacting = false;

  public readonly sessionShellCoordinator: ChatSessionShellCoordinator;
  public readonly switchShellCoordinator: ChatSwitchShellCoordinator;
  public readonly editResourceShellCoordinator: ChatEditResourceShellCoordinator;
  public readonly surfaceShellCoordinator: ChatSurfaceShellCoordinator;
  public readonly submitShellCoordinator: ChatSubmitShellCoordinator;
  public readonly composerShellCoordinator: ChatComposerShellCoordinator;
  public readonly viewportShellCoordinator: ChatViewportShellCoordinator;
  private readonly lifecycleCoordinator: ChatComponentLifecycleCoordinator;

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
    private cdr: ChangeDetectorRef,
    private builderService: BuilderService,
    public engine: ChatEngineService,
    public scrollManager: ScrollManagerService,
    public resourceManager: ResourceManagerService,
    public menuManager: MenuManagerService,
    public viewState: ChatViewService,
  ) {
    this.vm = new ChatComponentViewModel({
      engine: this.engine,
      viewState: this.viewState,
    });
    // 注册 OnPush CD 回调 — viewAdapter 每次 flush/appendImmediate 后调用 markForCheck
    this.engine.setCdCallback(() => this.cdr.markForCheck());
    // 注册同步 detectChanges 回调 — 供 zone 外场景直接触发 CD（如 _ensureAilyMessage）
    this.engine.setSyncDetectChanges(() => this.cdr.detectChanges());
    this.sessionShellCoordinator = new ChatSessionShellCoordinator({
      modal: this.modal,
      menuManager: this.menuManager,
      editCheckpointService: this.engine.editCheckpointService,
      viewState: this.viewState,
      chatService: this.chatService,
    }, {
      saveCurrentSession: () => this.engine.saveCurrentSession(),
      getHistory: () => this.engine.getHistory(),
      newChat: () => this.engine.newChat(),
      refreshHistoryList: () => this.engine.refreshHistoryList(),
      markForCheck: () => this.cdr.markForCheck(),
      setCompleted: () => {
        this.engine.isCompleted = true;
      },
    });
    this.switchShellCoordinator = new ChatSwitchShellCoordinator({
      menuManager: this.menuManager,
      getCurrentMode: () => this.vm.currentMode,
      getCurrentModel: () => this.vm.currentModel,
    }, {
      switchToMode: (mode) => this.engine.switchToMode(mode),
      switchToModel: (model) => this.engine.switchToModel(model),
      switchToReasoningEffort: (reasoningEffort) => this.engine.switchToReasoningEffort(reasoningEffort),
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
      getSessionAllowedPaths: () => this.engine.sessionAllowedPaths,
      getSessionId: () => this.vm.sessionId,
      getInputValue: () => this.vm.inputValue,
      isWaiting: () => this.vm.isWaiting,
      stop: () => this.engine.stop(),
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
      refreshHistoryList: () => this.engine.refreshHistoryList(),
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
        MermaidCodeComponent.setMermaidInstance(instance, { startOnLoad: false, ...MERMAID_DARK_THEME });
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
      destroyEngine: () => this.engine.destroy(),
    });
  }

  ngOnInit() {
    this.lifecycleCoordinator.initialize();
  }

  ngAfterViewInit(): void {
    this.viewportShellCoordinator.initialize(this.chatContainer);
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
    this.lifecycleCoordinator.destroy();
  }
}
