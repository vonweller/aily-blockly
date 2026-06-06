import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { filter, Subject } from 'rxjs';

import { IMenuItem } from '../../../configs/menu.config';
import { normalizeAgentIdentifier, normalizeAgentIdentifiers } from '../core/agent-identifiers';
import {
  CHAT_CONFIGURE_CUSTOM_AGENTS_ACTION_LABEL,
  CHAT_PICKER_CONFIGURE_CUSTOM_AGENTS_ACTION_ID,
} from '../helpers/chat-configure-custom-agents-action';
import {
  insertComposerLineBreak,
  resolveComposerKeyAction as _resolveComposerKeyAction,
  resolveAgentSuggestionKeyAction,
  type AgentSuggestionKeyAction,
  type ComposerKeyAction,
  type ComposerLineBreakEdit,
} from '../helpers/chat-composer-view';
import { buildChatModelMenuState } from '../helpers/chat-model-menu-builder';
import {
  AilyChatConfigService,
} from './aily-chat-config.service';
import { AilyChatLanguageModelsService } from './aily-chat-language-models.service';
import { ChatDebugBrowserService } from './chat-debug-browser.service';
import { ChatSessionItemsService, type ChatSessionListLoadState } from './chat-session-items.service';
import { ChatSessionsControlService } from './chat-sessions-control.service';
import { ChatService } from './chat.service';
import { type ChatSessionListItem, type MenuPosition } from './menu-manager.service';
import {
  createPlanChatResolvedMode,
  isPlanChatResolvedMode,
  resolveChatCurrentMode,
  type ChatResolvedMode,
  type ChatResolvedModeTarget,
  type ChatSurfaceModeId,
} from '../core/chat-mode';
import { isCustomSessionTitleSource, normalizeChatSessionTitleSource, type ChatSessionDisplayTitle, type ChatSessionTitleSource } from '../core/chat-session-title';
import type { ChatHostHeaderActionContext } from '../core/chat-host-header-actions';
import type { ChatHostHeaderActionRequest } from '../core/chat-host-header-actions';
import type { ChatSessionTitleActionContext, ChatSessionTitleActionRequest, ChatSessionTitleSurfaceModel } from '../core/chat-session-title-actions';
import { ChatHostHeaderActionRegistry } from '../helpers/chat-host-header-action-registry';
import { ChatSessionTitleActionRegistry } from '../helpers/chat-session-title-action-registry';
import type { ChatSessionInventoryGroup } from '../helpers/chat-session-presentation';

const BUILTIN_AGENT_PICKER_NAMES = new Set(['agent', 'ask', 'edit', 'qa']);

export type ChatPaneSurface = 'chat' | 'blank-session' | 'entry' | 'welcome' | 'login' | 'debug-home' | 'debug-session';

export interface ChatPaneSessionListSurfaceModel {
  readonly title: string;
  readonly variant: 'sidebar' | 'entry';
  readonly groups: readonly ChatSessionInventoryGroup[];
  readonly loadState: ChatSessionListLoadState;
  readonly hostClasses: readonly string[];
}

export interface ChatPaneSessionPickerSurfaceModel {
  readonly groups: readonly ChatSessionInventoryGroup[];
  readonly selectedSessionId: string;
  readonly revealSessionId: string;
  readonly position: MenuPosition;
  readonly width: number;
  readonly maxHeight: number;
}

export interface ChatPaneEntryInfoSurfaceModel {
  readonly iconClass: string;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly actionLabelKey: string;
  readonly hostClasses: readonly string[];
}

export interface ChatPaneStageSurfaceModel {
  readonly paneSurface: 'chat' | 'blank-session' | 'entry' | 'welcome';
  readonly showConversation: boolean;
  readonly guideSurface: ChatPaneEntryInfoSurfaceModel | null;
  readonly showSidebarSessionList: boolean;
  readonly sidebarSessionListSurface: ChatPaneSessionListSurfaceModel | null;
  readonly showStackedSessionList: boolean;
  readonly stackedSessionListSurface: ChatPaneSessionListSurfaceModel | null;
  readonly showSender: boolean;
}

interface ChatPaneChromeActionBindings {
  readonly runNewChatAction: () => boolean;
  readonly runToggleSettingsAction: () => boolean;
  readonly runGoBackAction: () => boolean;
  readonly runPickSessionAction: (event: MouseEvent) => boolean;
}

/**
 * ChatViewService
 *
 * 收拢 aily-chat 组件中的纯视图状态，避免 host shell 继续堆积
 * 与 agent/runtime 无关的 UI 字段与派生逻辑。
 */
@Injectable()
export class ChatViewService {
  readonly senderMinHeight = 180;
  readonly senderMaxHeight = 600;

  currentUrl = '';
  bottomHeight = this.senderMinHeight;
  showSettings = false;
  showAgentSuggestions = false;
  agentSuggestions: string[] = [];
  private readonly sessionViewModelChangedSubject = new Subject<void>();
  private paneChromeActionBindings: ChatPaneChromeActionBindings | null = null;
  private lastPaneDiagnosticsKey = '';

  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly ailyChatConfigService = inject(AilyChatConfigService);
  private readonly languageModelsService = inject(AilyChatLanguageModelsService);
  private readonly debugBrowser = inject(ChatDebugBrowserService);
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly chatSessionsControlService = inject(ChatSessionsControlService);
  private readonly chatService = inject(ChatService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostHeaderActionRegistry = new ChatHostHeaderActionRegistry(() => ({
    ...this.readHostHeaderActionContext(),
    runNewChatAction: () => this.paneChromeActionBindings?.runNewChatAction() ?? false,
    runToggleSettingsAction: () => this.paneChromeActionBindings?.runToggleSettingsAction() ?? false,
  }));
  private readonly sessionTitleActionRegistry = new ChatSessionTitleActionRegistry(() => ({
    ...this.readSessionTitleActionContext({
      hasConversationContent: this.hasConversationContent,
    }),
    runGoBackAction: () => this.paneChromeActionBindings?.runGoBackAction() ?? false,
    runPickSessionAction: (event: MouseEvent) => this.paneChromeActionBindings?.runPickSessionAction(event) ?? false,
  }));

  private availableCustomModes: ChatResolvedMode[] = [];
  readonly sessionViewModelChanged$ = this.sessionViewModelChangedSubject.asObservable();

  constructor() {
    this.currentUrl = this.router.url;
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl = event.urlAfterRedirects;
      });

    this.chatSessionsControlService.controlChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.refreshSessionViewModel();
      });
    this.chatSessionItemsService.sessionListLoadStateChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.refreshSessionViewModel();
      });
    this.chatService.sessionInputStateChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.refreshSessionViewModel();
      });
    (this.chatService.sessionDisplayTitleChanged$ ?? this.chatService.sessionTitleChanged$)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.sessionViewModelChangedSubject.next();
      });
    this.debugBrowser.onDidChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.syncSessionViewerSuppression();
        this.refreshSessionViewModel();
      });

    this.syncSessionViewerSuppression();
  }

  get isStandaloneWindow(): boolean {
    return this.currentUrl === '/aily-chat';
  }

  get sessionListItems(): readonly ChatSessionListItem[] {
    return this.chatSessionsControlService.sessionListItems;
  }

  get sessionSidebarMinWidth(): number {
    return this.chatSessionsControlService.sessionSidebarMinWidth;
  }

  get sessionSidebarDefaultWidth(): number {
    return this.chatSessionsControlService.sessionSidebarDefaultWidth;
  }

  get sessionSidebarResizeMinWidth(): number {
    return this.chatSessionsControlService.sessionSidebarResizeMinWidth;
  }

  get sessionViewportWidth(): number {
    return this.chatSessionsControlService.sessionViewportWidth;
  }

  get sessionSidebarWidth(): number {
    return this.chatSessionsControlService.sessionSidebarWidth;
  }

  get sessionSidebarMaxWidth(): number {
    return this.chatSessionsControlService.sessionSidebarMaxWidth;
  }

  get entrySessionItems(): ReadonlyArray<{ sessionId: string; title: string; current: boolean }> {
    return this.sessionListItems.map(item => ({
      sessionId: item.sessionId,
      title: item.title,
      current: item.current,
    }));
  }

  get currentSessionDisplayTitle(): ChatSessionDisplayTitle {
    const projectedTitle = this.readProjectedCurrentSessionDisplayTitle();
    const liveTitle = this.readLiveCurrentSessionDisplayTitle();

    if (projectedTitle.text && (!liveTitle.text || !liveTitle.durable)) {
      return projectedTitle;
    }

    if (liveTitle.text) {
      return liveTitle;
    }

    if (projectedTitle.text) {
      return projectedTitle;
    }

    return {
      text: '',
      source: 'empty',
      durable: false,
    };
  }

  get currentSessionTitle(): string {
    return this.currentSessionDisplayTitle.text;
  }

  get currentPaneTitle(): string {
    switch (this.currentPaneSurface) {
      case 'debug-session':
        return this.debugBrowser.activeImportedResourceSummary?.displayTitle ?? '';
      case 'chat':
      case 'blank-session':
        return this.currentSessionDisplayTitle.text;
      default:
        return '';
    }
  }

  get showSessionPicker(): boolean {
    return this.chatSessionsControlService.showSessionPicker;
  }

  get sessionPickerPosition(): MenuPosition {
    return this.chatSessionsControlService.sessionPickerPosition;
  }

  get selectedSessionId(): string {
    return this.chatSessionsControlService.selectedSessionId;
  }

  get pickerRevealSessionId(): string {
    return this.chatSessionsControlService.pickerRevealSessionId;
  }

  get sessionListGroups(): readonly ChatSessionInventoryGroup[] {
    return this.chatSessionsControlService.sessionListGroups;
  }

  get sessionPickerGroups(): readonly ChatSessionInventoryGroup[] {
    return this.chatSessionsControlService.sessionPickerGroups;
  }

  get sessionListDisplayMode(): 'hidden' | 'stacked' | 'sidebar' {
    return this.chatSessionsControlService.sessionListDisplayMode;
  }

  get showSessionSidebar(): boolean {
    return this.chatSessionsControlService.showSessionSidebar;
  }

  get showStackedSessionList(): boolean {
    return this.chatSessionsControlService.showStackedSessionList;
  }

  get showLoginSurface(): boolean {
    return this.chatSessionsControlService.showLoginSurface;
  }

  get showWelcomeSurface(): boolean {
    return this.currentPaneSurface === 'welcome';
  }

  get hasConversationContent(): boolean {
    return this.chatSessionsControlService.hasConversationContent;
  }

  get sessionTitleSurfaceModel(): ChatSessionTitleSurfaceModel {
    return this.sessionTitleActionRegistry.getSurfaceModel(this.currentPaneTitle);
  }

  get isSessionTitleSurfaceClickEnabled(): boolean {
    return this.currentPaneSurface === 'chat' || this.currentPaneSurface === 'blank-session';
  }

  get hostHeaderActions() {
    return this.hostHeaderActionRegistry.getActions();
  }

  get sidebarSessionListSurfaceModel(): ChatPaneSessionListSurfaceModel {
    return this.buildSessionListSurfaceModel('sidebar');
  }

  get stackedSessionListSurfaceModel(): ChatPaneSessionListSurfaceModel {
    return this.buildSessionListSurfaceModel('stacked');
  }

  get sessionPickerSurfaceModel(): ChatPaneSessionPickerSurfaceModel | null {
    if (!this.showSessionPicker) {
      return null;
    }

    return {
      groups: this.sessionPickerGroups,
      selectedSessionId: this.selectedSessionId,
      revealSessionId: this.pickerRevealSessionId,
      position: this.sessionPickerPosition,
      width: 320,
      maxHeight: 360,
    };
  }

  get paneStageSurfaceModel(): ChatPaneStageSurfaceModel | null {
    const paneSurface = this.currentPaneSurface;
    if (paneSurface !== 'chat' && paneSurface !== 'blank-session' && paneSurface !== 'entry' && paneSurface !== 'welcome') {
      return null;
    }

    const showSidebarSessionList = paneSurface !== 'welcome'
      && this.showSessionSidebar;
    const showStackedSessionList = paneSurface !== 'welcome'
      && this.showStackedSessionList;

    return {
      paneSurface,
      showConversation: paneSurface === 'chat',
      guideSurface: this.buildGuideSurfaceModel(
        paneSurface === 'entry' || paneSurface === 'welcome'
          ? paneSurface
          : null,
      ),
      showSidebarSessionList,
      sidebarSessionListSurface: showSidebarSessionList ? this.buildSessionListSurfaceModel('sidebar') : null,
      showStackedSessionList,
      stackedSessionListSurface: showStackedSessionList ? this.buildSessionListSurfaceModel('stacked') : null,
      showSender: paneSurface === 'chat' || paneSurface === 'blank-session' || paneSurface === 'entry',
    };
  }

  get entryInfoSurfaceModel(): ChatPaneEntryInfoSurfaceModel | null {
    return this.buildGuideSurfaceModel(this.currentPaneSurface === 'entry' ? 'entry' : null);
  }

  get currentPaneSurface(): ChatPaneSurface {
    if (this.debugBrowser.isOpen) {
      return this.debugBrowser.activeImportedResourceSummary ? 'debug-session' : 'debug-home';
    }

    if (this.showLoginSurface) {
      return 'login';
    }

    if (this.chatSessionsControlService.showWelcomeSurface) {
      return 'welcome';
    }

    if (!this.chatSessionsControlService.hasConversationContent) {
      if (this.hasCurrentSessionIdentity) {
        return 'blank-session';
      }
      return 'entry';
    }

    return 'chat';
  }

  openSessionPicker(anchor?: MouseEvent | null): void {
    this.chatSessionsControlService.openSessionPicker(anchor);
  }

  bindPaneChromeActions(bindings: ChatPaneChromeActionBindings): void {
    this.paneChromeActionBindings = bindings;
    this.refreshSessionViewModel();
  }

  runSessionTitleAction(request: ChatSessionTitleActionRequest): boolean {
    return this.sessionTitleActionRegistry.runAction(request);
  }

  runHostHeaderAction(request: ChatHostHeaderActionRequest): boolean {
    return this.hostHeaderActionRegistry.runAction(request);
  }

  closeSessionPicker(): void {
    this.chatSessionsControlService.closeSessionPicker();
  }

  retrySessionListLoad(): void {
    this.chatSessionItemsService.retryLastSessionListRefresh();
  }

  selectSession(sessionId: string): void {
    this.chatSessionsControlService.selectSession(sessionId);
  }

  syncSessionViewerLayout(input: {
    hasConversationContent: boolean;
    isAuthenticated: boolean;
  }): void {
    this.chatSessionsControlService.syncViewerLayout({
      hasConversationContent: input.hasConversationContent,
      hasCurrentSession: this.hasCurrentSessionIdentity,
      isAuthenticated: input.isAuthenticated,
    });
    this.syncSessionViewerSuppression();
  }

  readSessionListDisplayMode(hasConversationContent: boolean): 'hidden' | 'stacked' | 'sidebar' {
    this.syncSessionViewerLayout({
      hasConversationContent,
      isAuthenticated: this.chatSessionsControlService.isAuthenticated,
    });

    return this.sessionListDisplayMode;
  }

  readSessionTitleActionContext(input: {
    hasConversationContent: boolean;
  }): ChatSessionTitleActionContext {
    this.syncSessionViewerLayout({
      hasConversationContent: input.hasConversationContent,
      isAuthenticated: this.chatSessionsControlService.isAuthenticated,
    });

    const paneSurface = this.currentPaneSurface;
    return this.chatSessionsControlService.readSessionTitleActionContext({
      isChatSurface: paneSurface === 'chat' || paneSurface === 'blank-session',
      isBlankSessionSurface: paneSurface === 'blank-session',
    });
  }

  readHostHeaderActionContext(): ChatHostHeaderActionContext {
    return {
      currentPaneSurface: this.currentPaneSurface,
      showSettings: this.showSettings,
    };
  }

  private syncSessionViewerSuppression(): void {
    const suppressForSurface = this.currentPaneSurface !== 'chat'
      && this.currentPaneSurface !== 'blank-session'
      && this.currentPaneSurface !== 'entry';
    this.chatSessionsControlService.setSessionViewerSuppressed(this.showSettings || suppressForSurface);
  }

  private buildSessionListSurfaceModel(displayMode: 'sidebar' | 'stacked'): ChatPaneSessionListSurfaceModel {
    if (displayMode === 'sidebar') {
      return {
        title: 'Sessions',
        variant: 'sidebar',
        groups: this.sessionListGroups,
        loadState: this.chatSessionItemsService.sessionListLoadState,
        hostClasses: ['chat-session-sidebar-content'],
      };
    }

    return {
      title: 'Sessions',
      variant: 'entry',
      groups: this.sessionListGroups,
      loadState: this.chatSessionItemsService.sessionListLoadState,
      hostClasses: ['entry-session-control'],
    };
  }

  private buildGuideSurfaceModel(surface: 'entry' | 'welcome' | null): ChatPaneEntryInfoSurfaceModel | null {
    if (surface === 'entry') {
      return {
        iconClass: 'fa-light fa-star-christmas',
        titleKey: 'AILY_CHAT.SERVICE_TITLE',
        descriptionKey: 'AILY_CHAT.DISCLAIMER',
        actionLabelKey: 'AILY_CHAT.USAGE_GUIDE',
        hostClasses: ['guide-box', 'ccenter', 'entry-surface-guide'],
      };
    }

    if (surface === 'welcome') {
      return {
        iconClass: 'fa-light fa-star-christmas',
        titleKey: 'AILY_CHAT.SERVICE_TITLE',
        descriptionKey: 'AILY_CHAT.DISCLAIMER',
        actionLabelKey: 'AILY_CHAT.USAGE_GUIDE',
        hostClasses: ['guide-box', 'ccenter', 'welcome-surface-guide'],
      };
    }

    return null;
  }

  private refreshSessionViewModel(): void {
    this.emitPaneDiagnostics();
    this.sessionViewModelChangedSubject.next();
  }

  private emitPaneDiagnostics(): void {
    const paneSurface = this.currentPaneSurface;
    const diagnostics = {
      paneSurface,
      hasConversationContent: this.chatSessionsControlService.hasConversationContent,
      hasCurrentSessionIdentity: this.hasCurrentSessionIdentity,
      hasCurrentSession: this.chatSessionsControlService.hasCurrentSession,
      hasBlankSessionShell: this.chatService.hasBlankSessionShell === true,
      currentSessionId: this.chatService.currentSessionId,
      currentPaneTitle: this.currentPaneTitle,
      liveSessionTitle: this.chatService.currentSessionTitle,
      projectedSessionTitle: this.currentSessionViewItem?.title ?? '',
      sessionListDisplayMode: this.chatSessionsControlService.sessionListDisplayMode,
      titleSurfaceShouldRender: this.sessionTitleSurfaceModel.shouldRender,
      titleSurfaceNavigationIconActionCount: this.sessionTitleSurfaceModel.navigationIconActions.length,
      titleSurfaceHasTitleAction: this.sessionTitleSurfaceModel.titleAction !== null,
      titleSurfaceActionCount: this.sessionTitleSurfaceModel.actions.length,
    };
    const key = JSON.stringify(diagnostics);
    if (key === this.lastPaneDiagnosticsKey) {
      return;
    }

    this.lastPaneDiagnosticsKey = key;
    console.info('[AilyChat][PaneState]', diagnostics);
  }

  private get currentSessionViewItem(): ChatSessionListItem | null {
    return this.chatSessionItemsService.readCurrentSessionViewItem();
  }

  private readProjectedCurrentSessionDisplayTitle(): ChatSessionDisplayTitle {
    const projectedItem = this.currentSessionViewItem;
    const currentSessionId = this.chatService.currentSessionId;
    const projectedTitle = projectedItem?.title ?? '';
    if (!isMeaningfulSessionTitle(projectedTitle, currentSessionId)) {
      return {
        text: '',
        source: 'empty',
        durable: false,
      };
    }

    const projectedSource = typeof projectedItem?.titleSource === 'string'
      ? normalizeChatSessionTitleSource(projectedItem.titleSource)
      : (projectedItem?.titleDurable === true ? 'legacy-custom' : 'default-first-request');
    const durable = projectedItem?.titleDurable === true || isCustomSessionTitleSource(projectedSource);

    return {
      text: projectedTitle,
      source: durable ? (isCustomSessionTitleSource(projectedSource) ? projectedSource : 'legacy-custom') : projectedSource,
      durable,
    };
  }

  private readLiveCurrentSessionDisplayTitle(): ChatSessionDisplayTitle {
    const liveTitle = this.chatService.currentSessionTitle;
    const currentSessionId = this.chatService.currentSessionId;
    if (!isMeaningfulSessionTitle(liveTitle, currentSessionId)) {
      return {
        text: '',
        source: 'empty',
        durable: false,
      };
    }

    const liveTitleSource = this.readCurrentSessionTitleSource();
    if (liveTitleSource === undefined) {
      return {
        text: liveTitle,
        source: 'legacy-custom',
        durable: true,
      };
    }

    return {
      text: liveTitle,
      source: liveTitleSource,
      durable: isCustomSessionTitleSource(liveTitleSource),
    };
  }

  private readCurrentSessionTitleSource(): ChatSessionTitleSource | undefined {
    const titleSource = (this.chatService as { readonly currentSessionTitleSource?: unknown }).currentSessionTitleSource;
    if (typeof titleSource !== 'string') {
      return undefined;
    }

    return normalizeChatSessionTitleSource(titleSource);
  }

  private get hasCurrentSessionIdentity(): boolean {
    return this.currentSessionViewItem !== null
      || this.chatService.currentSessionId.trim().length > 0
      || this.chatService.hasBlankSessionShell === true;
  }

  private getCurrentResolvedMode(): ChatResolvedMode {
    const currentResolvedMode = this.chatService.currentResolvedMode;
    if (currentResolvedMode && typeof currentResolvedMode === 'object' && !Array.isArray(currentResolvedMode)) {
      return currentResolvedMode;
    }

    if (this.chatService.currentMode === 'agent') {
      const providerBackedMode = this.findAvailableCustomModeByAgentTarget(this.chatService.currentCustomAgentTarget);
      if (providerBackedMode) {
        return providerBackedMode;
      }
    }

    return resolveChatCurrentMode({
      modeId: this.chatService.currentMode,
      customAgentTarget: this.chatService.currentCustomAgentTarget,
    });
  }

  private findAvailableCustomModeByAgentTarget(agentTarget: string | null | undefined): ChatResolvedMode | undefined {
    const normalizedAgentTarget = normalizeAgentIdentifier(agentTarget);
    if (!normalizedAgentTarget) {
      return undefined;
    }

    return this.getAvailableCustomModes().find((mode) =>
      normalizeAgentIdentifier(mode.customAgentTarget ?? mode.name) === normalizedAgentTarget);
  }

  private getAvailableCustomModes(): readonly ChatResolvedMode[] {
    const runtimeModes = Array.isArray(this.chatService.availableResolvedCustomModes)
      ? this.chatService.availableResolvedCustomModes
      : [];
    return runtimeModes.length > 0 ? runtimeModes : this.availableCustomModes;
  }

  private getHiddenCustomAgentTargets(): Set<string> {
    return new Set(normalizeAgentIdentifiers(this.ailyChatConfigService.hiddenCustomAgentTargets));
  }

  private getCurrentSessionCustomAgentTarget(): ChatResolvedModeTarget | undefined {
    return typeof this.chatService.getCurrentSessionCustomAgentTarget === 'function'
      ? this.chatService.getCurrentSessionCustomAgentTarget()
      : undefined;
  }

  private getPlanMode(): ChatResolvedMode {
    const availablePlanMode = this.getAvailableCustomModes().find((mode) => isPlanChatResolvedMode(mode));
    if (availablePlanMode) {
      return availablePlanMode;
    }

    const currentResolvedMode = this.getCurrentResolvedMode();
    return isPlanChatResolvedMode(currentResolvedMode)
      ? currentResolvedMode
      : createPlanChatResolvedMode();
  }

  private isModeVisibleInCurrentPicker(
    mode: ChatResolvedMode,
    currentSessionCustomAgentTarget: ChatResolvedModeTarget | undefined,
  ): boolean {
    return !currentSessionCustomAgentTarget
      || mode.target === undefined
      || mode.target === 'undefined'
      || mode.target === currentSessionCustomAgentTarget;
  }

  private getAvailableAgentTargets(): string[] {
    const hiddenTargets = this.getHiddenCustomAgentTargets();
    return [...new Set(this.getAvailableCustomModes()
      .filter((mode) => mode.hidden !== true)
      .filter((mode) => mode.enabled !== false)
      .filter((mode) => mode.visibility?.userInvocable !== false)
      .map((mode) => mode.customAgentTarget ?? mode.name)
      .filter((target): target is string => Boolean(target))
      .filter((target) => !hiddenTargets.has(target))
      .filter((target) => !BUILTIN_AGENT_PICKER_NAMES.has(target.toLowerCase())))]
      .sort((left, right) => left.localeCompare(right));
  }

  get modeMenuItems(): IMenuItem[] {
    const currentResolvedMode = this.getCurrentResolvedMode();
    const hiddenTargets = this.getHiddenCustomAgentTargets();
    const currentSessionCustomAgentTarget = this.getCurrentSessionCustomAgentTarget();
    const planMode = this.getPlanMode();
    const planCustomAgentTarget = planMode.customAgentTarget ?? planMode.name;
    const items: IMenuItem[] = [
      {
        name: this.translate.instant('AILY_CHAT.MODE_AGENT_FULL'),
        action: 'agent-mode',
        icon: 'fa-light fa-user-astronaut',
        current: currentResolvedMode.isBuiltin && currentResolvedMode.kind === 'agent',
        data: { mode: 'agent' satisfies ChatSurfaceModeId },
      },
    ];

    if (planCustomAgentTarget
      && planMode.hidden !== true
      && planMode.enabled !== false
      && planMode.visibility?.userInvocable !== false
      && !hiddenTargets.has(planCustomAgentTarget)
      && this.isModeVisibleInCurrentPicker(planMode, currentSessionCustomAgentTarget)) {
      items.push({
        name: planMode.label,
        action: 'plan-mode',
        icon: 'fa-light fa-list-check',
        current: isPlanChatResolvedMode(currentResolvedMode),
        ...(planMode.description ? { tooltip: planMode.description } : {}),
        data: {
          mode: 'agent' satisfies ChatSurfaceModeId,
          modeId: planMode.id,
          customAgentTarget: planCustomAgentTarget,
        },
      });
    }

    if (!currentSessionCustomAgentTarget) {
      items.push({
        name: this.translate.instant('AILY_CHAT.MODE_QA_FULL'),
        action: 'ask-mode',
        icon: 'fa-light fa-comment-smile',
        current: currentResolvedMode.isBuiltin && currentResolvedMode.kind === 'ask',
        data: { mode: 'ask' satisfies ChatSurfaceModeId },
      });
    }

    const customAgentItems = this.getAvailableCustomModes()
      .filter((mode) => {
        const customAgentTarget = mode.customAgentTarget ?? mode.name;
        return !mode.isBuiltin
          && !isPlanChatResolvedMode(mode)
          && mode.hidden !== true
          && mode.enabled !== false
          && mode.visibility?.userInvocable !== false
            && this.isModeVisibleInCurrentPicker(mode, currentSessionCustomAgentTarget)
          && Boolean(customAgentTarget)
          && !hiddenTargets.has(customAgentTarget)
          && !BUILTIN_AGENT_PICKER_NAMES.has(customAgentTarget.toLowerCase());
      })
      .map((mode) => {
        const customAgentTarget = mode.customAgentTarget ?? mode.name;
        return {
        name: mode.label,
        action: 'custom-agent-mode',
        icon: 'fa-light fa-user-astronaut',
        current: !currentResolvedMode.isBuiltin && currentResolvedMode.id === mode.id,
        ...(mode.description ? { tooltip: mode.description } : {}),
        data: {
          mode: 'agent' satisfies ChatSurfaceModeId,
          modeId: mode.id,
          customAgentTarget,
        },
      } satisfies IMenuItem;
      });

    if (customAgentItems.length > 0) {
      items.push({ sep: true }, ...customAgentItems);
    }

    items.push(
      { sep: true },
      {
        name: CHAT_CONFIGURE_CUSTOM_AGENTS_ACTION_LABEL,
        action: CHAT_PICKER_CONFIGURE_CUSTOM_AGENTS_ACTION_ID,
        icon: 'fa-light fa-gear',
      },
    );

    return items;
  }

  get modelMenuItems(): IMenuItem[] {
    return [...this.buildModelMenuState().modelMenuItems];
  }

  get currentReasoningEffortLabel(): string {
    return this.buildModelMenuState().currentReasoningEffortLabel;
  }

  get currentReasoningEffortDisplayLabel(): string {
    return this.buildModelMenuState().currentReasoningEffortDisplayLabel;
  }

  get hasReasoningEffortOptions(): boolean {
    return this.buildModelMenuState().hasReasoningEffortOptions;
  }

  get currentReasoningEffortMenuItems(): IMenuItem[] {
    return [...this.buildModelMenuState().currentReasoningEffortMenuItems];
  }

  get firstAgentSuggestion(): string | undefined {
    return this.agentSuggestions[0];
  }

  resolveSuggestionKeyAction(key: string): AgentSuggestionKeyAction {
    return resolveAgentSuggestionKeyAction(key, this.agentSuggestions);
  }

  applyComposerLineBreak(value: string, selectionStart: number, selectionEnd: number): ComposerLineBreakEdit {
    return insertComposerLineBreak(value, selectionStart, selectionEnd);
  }

  resolveComposerKeyAction(input: {
    key: string;
    ctrlKey: boolean;
    altKey: boolean;
    inputValue: string;
    selectionStart: number;
    selectionEnd: number;
    isWaiting: boolean;
  }): ComposerKeyAction {
    return _resolveComposerKeyAction({
      ...input,
      suggestions: this.agentSuggestions,
    });
  }

  setCurrentUrl(url: string): void {
    this.currentUrl = url;
  }

  setBottomHeight(height: number): void {
    if (typeof height === 'number' && !Number.isNaN(height)) {
      this.bottomHeight = Math.min(this.senderMaxHeight, Math.max(this.senderMinHeight, height));
    }
  }

  setSessionViewportWidth(width: number): void {
    this.chatSessionsControlService.setSessionViewportWidth(width);
  }

  setSessionSidebarWidth(width: number, options?: { persist?: boolean }): void {
    this.chatSessionsControlService.setSessionSidebarWidth(width, options);
  }

  resolveSessionListDisplayMode(input: {
    hasSessions: boolean;
    hasConversationContent: boolean;
    hasCurrentSession?: boolean;
  }): 'hidden' | 'stacked' | 'sidebar' {
    return this.chatSessionsControlService.resolveSessionListDisplayMode({
      hasSessions: input.hasSessions,
      hasConversationContent: input.hasConversationContent,
      hasCurrentSession: input.hasCurrentSession === true,
    });
  }

  setSettingsVisible(visible: boolean): void {
    this.showSettings = visible;
    this.syncSessionViewerSuppression();
    this.refreshSessionViewModel();
  }

  openSettings(): void {
    this.setSettingsVisible(true);
  }

  toggleSettings(): void {
    this.setSettingsVisible(!this.showSettings);
  }

  closeSettings(): void {
    this.setSettingsVisible(false);
  }

  setAvailableAgents(agentNames: readonly string[]): void {
    this.availableCustomModes = normalizeAgentIdentifiers(agentNames)
      .filter((agentName) => !BUILTIN_AGENT_PICKER_NAMES.has(agentName.toLowerCase()))
      .sort((left, right) => left.localeCompare(right))
      .map((agentName) => resolveChatCurrentMode({ modeId: 'agent', customAgentTarget: agentName }));
  }

  setAvailableAgentModes(agentModes: readonly ChatResolvedMode[]): void {
    const nextModes = new Map<string, ChatResolvedMode>();
    for (const agentMode of agentModes) {
      const customAgentTarget = typeof agentMode.customAgentTarget === 'string' && agentMode.customAgentTarget.trim()
        ? agentMode.customAgentTarget.trim()
        : typeof agentMode.name === 'string' && agentMode.name.trim()
          ? agentMode.name.trim()
          : '';
      if (!customAgentTarget || BUILTIN_AGENT_PICKER_NAMES.has(customAgentTarget.toLowerCase())) {
        continue;
      }

      nextModes.set(customAgentTarget, {
        ...agentMode,
        customAgentTarget,
      });
    }

    this.availableCustomModes = Array.from(nextModes.values())
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  updateAgentSuggestions(inputValue: string): void {
    if (!inputValue.startsWith('@')) {
      this.hideAgentSuggestions();
      return;
    }

    const query = inputValue.slice(1).split(/\s/)[0].toLowerCase();
    this.agentSuggestions = this.getAvailableAgentTargets()
      .filter((agentTarget) => agentTarget.toLowerCase().startsWith(query));
    this.showAgentSuggestions = this.agentSuggestions.length > 0 && !inputValue.includes(' ');
  }

  hideAgentSuggestions(): void {
    this.showAgentSuggestions = false;
    this.agentSuggestions = [];
  }

  applyAgentSelection(agentName: string): string {
    this.hideAgentSuggestions();
    return `@${agentName} `;
  }

  private buildModelMenuState() {
    return buildChatModelMenuState({
      currentModel: this.chatService.currentModel,
      recentModelPresetIds: typeof this.chatService.getRecentModelPresetIds === 'function'
        ? this.chatService.getRecentModelPresetIds()
        : [],
      pinnedModelIds: typeof this.chatService.getPinnedModelIds === 'function'
        ? this.chatService.getPinnedModelIds()
        : [],
      ailyChatConfigService: this.ailyChatConfigService,
      languageModelsService: this.languageModelsService,
    });
  }
}

function isMeaningfulSessionTitle(title: unknown, sessionId?: string): boolean {
  if (typeof title !== 'string') {
    return false;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return false;
  }

  return !isTechnicalSessionTitle(normalizedTitle, sessionId)
    && !isPlaceholderSessionTitle(normalizedTitle);
}

function isTechnicalSessionTitle(title: string, sessionId?: string): boolean {
  const normalizedTitle = title.trim();
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (normalizedSessionId && normalizedTitle === normalizedSessionId) {
    return true;
  }

  return /^lex-\d{6,}$/i.test(normalizedTitle);
}

function isPlaceholderSessionTitle(title: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  if (!normalizedTitle) {
    return true;
  }

  if (/^untitled(?:\s+chat)?(?:\s*\d+)?$/i.test(normalizedTitle)) {
    return true;
  }

  return normalizedTitle === 'new chat'
    || normalizedTitle === 'new session'
    || normalizedTitle === 'current session'
    || normalizedTitle === '新对话'
    || normalizedTitle === '新会话';
}
