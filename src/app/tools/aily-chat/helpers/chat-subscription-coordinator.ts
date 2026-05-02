import { Subscription, skip, distinctUntilChanged, combineLatest } from 'rxjs';

import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IChatViewAccess,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import { AilyHost } from '../core/host';
import type { ChatTextOptions } from '../services/chat.service';
import { ChatViewWriteBridge, type ChatViewWriteBridgeContext } from './chat-view-write-bridge';
import {
  hasHostResponseConversationContent,
  type HostResponseProjection,
} from './host-turn-response-state';
import type { ChatTaskActionEvent } from './chat-task-action-coordinator';

type ChatSubscriptionCoordinatorContext = ChatViewWriteBridgeContext
  & Pick<
    IAgentLifecycle,
    'hasInitializedForThisLogin' | 'isSessionStarting' | 'mcpInitialized' | 'isWaiting' | 'isCompleted' | 'messageSubscription'
  >
  & Pick<IChatViewAccess, 'toolCallStates'>
  & Pick<IProjectContext, 'currentUserGroup' | 'prjPath' | 'prjRootPath' | 'isLoggedIn'>
  & Pick<ISessionAccess, 'chatService' | 'chatHistoryService'>
  & Pick<IChatServiceAccess, 'resourceManager' | 'absAutoSyncService' | 'ailyChatConfigService' | 'message'>
  & Pick<IChatCoordination, 'session' | 'interaction'>
  & {
    readonly hostResponseProjection?: HostResponseProjection | null;
  };

type ChatSubscriptionViewWriteContext = ConstructorParameters<typeof ChatViewWriteBridge>[0];

interface SubscriptionCallbacks {
  receiveTextFromExternal: (text: string, options?: ChatTextOptions) => void;
  showAiWritingNotice: (isWaiting: boolean) => void;
  handleTaskAction: (event: ChatTaskActionEvent) => void;
  flushPendingAutoSend: () => void;
}

type ChatSubscriptionViewWriteAccess = Pick<ChatViewWriteBridge, 'clearChatView'>;

/**
 * Coordinates host-side subscriptions and teardown for ChatEngineService.
 */
export class ChatSubscriptionCoordinator {
  private textMessageSubscription: Subscription | null = null;
  private loginStatusSubscription: Subscription | null = null;
  private aiWritingSubscription: Subscription | null = null;
  private aiWaitingSubscription: Subscription | null = null;
  private projectPathSubscription: Subscription | null = null;
  private configChangedSubscription: Subscription | null = null;
  private blockSelectionSubscription: Subscription | null = null;
  private uiChatMessageSubscription: Subscription | null = null;
  private userInfoSubscription: Subscription | null = null;
  private taskActionHandler: ((event: Event) => void) | null = null;
  private active = false;
  private readonly viewWriteBridge: ChatSubscriptionViewWriteAccess;

  constructor(
    private readonly ctx: ChatSubscriptionCoordinatorContext,
    private readonly callbacks: SubscriptionCallbacks,
  ) {
    const viewWriteContext: ChatSubscriptionViewWriteContext = {
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
      invalidateHostRequestGraph: () => ctx.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => ctx.triggerSyncDetectChanges(),
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

  setup(): void {
    this.active = true;

    this.textMessageSubscription = this.ctx.chatService.getTextMessages().subscribe(message => {
      if (!message) {
        return;
      }

      this.callbacks.receiveTextFromExternal(message.text, message.options);
      this.ctx.chatService.clearBufferedTextMessage(message.timestamp);
    });

    const uiChatMessage$ = AilyHost.get().ui?.chatMessage$;
    if (uiChatMessage$) {
      this.uiChatMessageSubscription = uiChatMessage$.subscribe((message: any) => {
        this.callbacks.receiveTextFromExternal(message.text, message.options);
      });
    }

    const auth = AilyHost.get().authFull;
    auth?.initializeAuth().then(() => {
      if (!this.active) {
        return;
      }

      this.userInfoSubscription = auth?.userInfo$?.subscribe((userInfo: any) => {
        this.ctx.currentUserGroup = userInfo?.groups || [];
      }) ?? null;
    });

    this.aiWritingSubscription = AilyHost.get().blockly.aiWriting$.subscribe(this.callbacks.showAiWritingNotice);
    this.aiWaitingSubscription = AilyHost.get().blockly.aiWaiting$.subscribe(this.callbacks.showAiWritingNotice);

    this.blockSelectionSubscription = combineLatest([
      AilyHost.get().blockly.selectedBlockSubject,
      AilyHost.get().blockly.blockCodeMapSubject,
    ]).subscribe((results: any[]) => {
      this.ctx.resourceManager.updateBlockContext(
        results[0],
        () => AilyHost.get().blockly.getSelectedBlockContextLabel(),
      );
    });

    this.taskActionHandler = (event: Event) => {
      this.callbacks.handleTaskAction(event as ChatTaskActionEvent);
    };
    document.addEventListener('aily-task-action', this.taskActionHandler);

    this.projectPathSubscription = AilyHost.get().project.currentProjectPath$.pipe(
      distinctUntilChanged(),
      skip(1),
    ).subscribe((newPath: string) => {
      const rootPath = AilyHost.get().project.projectRootPath;
      this.ctx.prjPath = newPath === rootPath ? '' : newPath;
      this.ctx.prjRootPath = rootPath;

      if (newPath && newPath !== rootPath) {
        this.ctx.chatService.currentSessionPath = newPath;
      }

      if (newPath && newPath !== rootPath) {
        this.ctx.chatHistoryService.reloadProjectIndex(newPath);
        const adopted = this.ctx.chatHistoryService.adoptOrphanSessions(newPath, rootPath);
        if (adopted > 0) {
          console.log(`[ChatEngine] 项目切换，自动领养 ${adopted} 个孤儿会话到: ${newPath}`);
        }
      }

      this.ctx.session.refreshHistoryList();
      if (newPath && newPath !== rootPath) {
        this.ctx.absAutoSyncService.initialize(newPath);
      }
    });

    this.loginStatusSubscription = auth?.isLoggedIn$?.subscribe(async isLoggedIn => {
      if (!this.ctx.hasInitializedForThisLogin && !this.ctx.isSessionStarting && isLoggedIn) {
        this.ctx.isLoggedIn = isLoggedIn;
        this.ctx.hasInitializedForThisLogin = true;
        this.viewWriteBridge.clearChatView();
        this.ctx.session.startSession().then(() => {
          this.ctx.session.getHistory();
          this.ctx.interaction.checkFirstUsage();
          this.callbacks.flushPendingAutoSend();
        }).catch((err) => {
          console.error('[ChatEngine] startSession 失败:', err);
        });
      }

      if (isLoggedIn) {
        return;
      }

      try {
        await this.ctx.session.stopAndCloseSession();
      } catch (error) {
        console.warn('清理会话时出错:', error);
      }
      this.ctx.hasInitializedForThisLogin = false;
      this.ctx.mcpInitialized = false;
      this.ctx.isWaiting = false;
      this.ctx.isCompleted = false;
      this.ctx.isSessionStarting = false;
      this.ctx.chatService.currentSessionId = '';
      this.ctx.chatService.currentSessionPath = '';
      this.viewWriteBridge.clearChatView();
      this.ctx.toolCallStates = {};
      if (this.ctx.messageSubscription) {
        this.ctx.messageSubscription.unsubscribe();
        this.ctx.messageSubscription = null;
      }
    }) ?? null;

    this.configChangedSubscription = this.ctx.ailyChatConfigService.configChanged$.subscribe(async () => {
      const hasConversationHistory = this.hasConversationHistory();
      if (!hasConversationHistory && this.ctx.sessionId && this.ctx.isLoggedIn) {
        try {
          await this.ctx.session.stopAndCloseSession(true);
          await this.ctx.session.startSession();
          this.ctx.message.success('配置已更新并生效');
        } catch (error) {
          console.warn('重新启动会话失败:', error);
          this.ctx.message.warning('配置更新失败，请尝试新建对话');
        }
        return;
      }

      if (hasConversationHistory) {
        this.ctx.message.info('配置已保存，将在下次新建对话时生效');
      }
    });
  }

  cleanup(): void {
    this.active = false;
    if (this.ctx.messageSubscription) { this.ctx.messageSubscription.unsubscribe(); this.ctx.messageSubscription = null; }
    if (this.textMessageSubscription) { this.textMessageSubscription.unsubscribe(); this.textMessageSubscription = null; }
    if (this.loginStatusSubscription) { this.loginStatusSubscription.unsubscribe(); this.loginStatusSubscription = null; }
    if (this.userInfoSubscription) { this.userInfoSubscription.unsubscribe(); this.userInfoSubscription = null; }
    if (this.aiWritingSubscription) { this.aiWritingSubscription.unsubscribe(); this.aiWritingSubscription = null; }
    if (this.aiWaitingSubscription) { this.aiWaitingSubscription.unsubscribe(); this.aiWaitingSubscription = null; }
    if (this.projectPathSubscription) { this.projectPathSubscription.unsubscribe(); this.projectPathSubscription = null; }
    if (this.configChangedSubscription) { this.configChangedSubscription.unsubscribe(); this.configChangedSubscription = null; }
    if (this.blockSelectionSubscription) { this.blockSelectionSubscription.unsubscribe(); this.blockSelectionSubscription = null; }
    if (this.uiChatMessageSubscription) { this.uiChatMessageSubscription.unsubscribe(); this.uiChatMessageSubscription = null; }
    if (this.taskActionHandler) { document.removeEventListener('aily-task-action', this.taskActionHandler); this.taskActionHandler = null; }
    this.ctx.isSessionStarting = false;
    this.ctx.mcpInitialized = false;
    this.ctx.hasInitializedForThisLogin = false;
  }

  private hasConversationHistory(): boolean {
    return hasHostResponseConversationContent(
      this.ctx.hostResponseProjection ?? null,
    );
  }
}