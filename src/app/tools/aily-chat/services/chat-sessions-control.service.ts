import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Subject } from 'rxjs';

import { AilyHost } from '../core/host';
import { groupChatSessionItemsByDate, type ChatSessionInventoryGroup } from '../helpers/chat-session-presentation';
import type { ChatSessionTitleActionContext } from '../core/chat-session-title-actions';
import { AilyChatConfigService, type ChatSessionViewerOrientationSetting } from './aily-chat-config.service';
import { ChatSessionSelectionService } from './chat-session-selection.service';
import { ChatSessionItemsService } from './chat-session-items.service';
import type { ChatSessionListItemsDelta } from './chat-session-items.service';
import { ChatService } from './chat.service';
import { MenuManagerService, type ChatSessionListItem, type MenuPosition } from './menu-manager.service';

const SESSION_SIDEBAR_WIDTH_CONFIG_KEY = 'aiChatSessionsSidebarWidth';

@Injectable()
export class ChatSessionsControlService {
  readonly sessionSidebarDefaultWidth = 300;
  readonly sessionSidebarResizeMinWidth = 240;
  readonly sessionStageMinWidth = 300;
  readonly sessionSidebarMinWidth = 600;

  private _showSessionPicker = false;
  private _sessionPickerPosition: MenuPosition = { x: 0, y: 0 };
  private _selectedSessionId = '';
  private _pickerRevealSessionId = '';
  private _sessionViewportWidth = 0;
  private _hasConversationContent = false;
  private _hasCurrentSession = false;
  private _isAuthenticated = true;
  private _isSessionViewerSuppressed = false;
  private _sessionViewerOrientation = 'sideBySide' as ChatSessionViewerOrientationSetting;
  private _requestedSessionSidebarWidth = this.readPersistedSessionSidebarWidth();
  private _sessionSidebarWidth = this.sessionSidebarDefaultWidth;
  private _sessionSidebarMaxWidth = this.sessionSidebarDefaultWidth;
  private _sessionListDisplayMode: 'hidden' | 'stacked' | 'sidebar' = 'stacked';
  private readonly controlChangedSubject = new Subject<void>();

  readonly controlChanged$ = this.controlChangedSubject.asObservable();

  private readonly translate = inject(TranslateService);
  private readonly message = inject(NzMessageService);
  private readonly ailyChatConfigService = inject(AilyChatConfigService);
  private readonly menuManager = inject(MenuManagerService);
  private readonly chatService = inject(ChatService);
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly chatSessionSelectionService = inject(ChatSessionSelectionService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this._sessionViewerOrientation = this.ailyChatConfigService.sessionViewerOrientation;
    this._sessionSidebarWidth = this.normalizeRequestedSessionSidebarWidth(this._requestedSessionSidebarWidth);
    this._sessionSidebarMaxWidth = this.resolveSessionSidebarMaxWidth(this._sessionViewportWidth);

    const sessionListItemsDelta$ = (this.chatSessionItemsService as unknown as {
      sessionListItemsDelta$?: { pipe: (...args: unknown[]) => { subscribe: (callback: (delta: ChatSessionListItemsDelta) => void) => unknown } };
    }).sessionListItemsDelta$;
    if (sessionListItemsDelta$) {
      sessionListItemsDelta$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((delta: ChatSessionListItemsDelta) => {
          this.handleSessionListItemsDelta(delta);
        });
    } else {
      this.chatSessionItemsService.sessionListItemsChanged$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          this.handleSessionListItemsDelta({ kind: 'full', affectsOrder: true });
        });
    }

    this.chatSessionSelectionService.selectedSessionIdChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sessionId) => {
        const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
        if (normalizedSessionId.length === 0) {
          return;
        }

        this._selectedSessionId = normalizedSessionId;
        if (this._showSessionPicker) {
          this._pickerRevealSessionId = normalizedSessionId;
        }
        this.controlChangedSubject.next();
      });

    this.ailyChatConfigService.configChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.applyConfiguredSessionViewerOrientation(this.ailyChatConfigService.sessionViewerOrientation);
      });

    this.reconcileSelection();
  }

  private handleSessionListItemsDelta(delta: ChatSessionListItemsDelta): void {
    this.reconcileSelection();
    if (delta.affectsOrder && !this.updateLayoutProjection()) {
      this.controlChangedSubject.next();
      return;
    }

    if (!delta.affectsOrder) {
      this.controlChangedSubject.next();
    }
  }

  get sessionListItems(): readonly ChatSessionListItem[] {
    return this.chatSessionItemsService.sessionListItems;
  }

  get sessionListGroups(): readonly ChatSessionInventoryGroup[] {
    return groupChatSessionItemsByDate(this.sessionListItems, { includeArchived: true });
  }

  get sessionPickerGroups(): readonly ChatSessionInventoryGroup[] {
    return groupChatSessionItemsByDate(this.sessionListItems, { includeArchived: false });
  }

  get showSessionPicker(): boolean {
    return this._showSessionPicker;
  }

  get sessionPickerPosition(): MenuPosition {
    return this._sessionPickerPosition;
  }

  get selectedSessionId(): string {
    return this._selectedSessionId;
  }

  get pickerRevealSessionId(): string {
    return this._pickerRevealSessionId;
  }

  get sessionViewportWidth(): number {
    return this._sessionViewportWidth;
  }

  get sessionSidebarWidth(): number {
    return this._sessionSidebarWidth;
  }

  get sessionSidebarMaxWidth(): number {
    return this._sessionSidebarMaxWidth;
  }

  get hasConversationContent(): boolean {
    return this._hasConversationContent;
  }

  get hasCurrentSession(): boolean {
    return this._hasCurrentSession;
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  get sessionListDisplayMode(): 'hidden' | 'stacked' | 'sidebar' {
    return this._sessionListDisplayMode;
  }

  get sessionViewerOrientation(): ChatSessionViewerOrientationSetting {
    return this._sessionViewerOrientation;
  }

  get showLoginSurface(): boolean {
    return !this._isAuthenticated;
  }

  get showWelcomeSurface(): boolean {
    return this.resolveWelcomeSurfaceVisibility({
      hasSessions: this.sessionListItems.length > 0,
      hasConversationContent: this._hasConversationContent,
      hasCurrentSession: this._hasCurrentSession,
    });
  }

  get isSessionViewerSuppressed(): boolean {
    return this._isSessionViewerSuppressed;
  }

  get showSessionSidebar(): boolean {
    return this._sessionListDisplayMode === 'sidebar';
  }

  get showStackedSessionList(): boolean {
    return this._sessionListDisplayMode === 'stacked';
  }

  readSessionTitleActionContext(input?: {
    isChatSurface?: boolean;
    isBlankSessionSurface?: boolean;
  }): ChatSessionTitleActionContext {
    return {
      isChatSurface: input?.isChatSurface !== false,
      isBlankSessionSurface: input?.isBlankSessionSurface === true,
      hasSessions: this.sessionListItems.length > 0,
      hasConversationContent: this._hasConversationContent,
      hasCurrentSession: this._hasCurrentSession,
      sessionListDisplayMode: this._sessionListDisplayMode,
    };
  }

  setSessionViewportWidth(width: number): void {
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width === this._sessionViewportWidth) {
      return;
    }

    this._sessionViewportWidth = width;
    this.updateLayoutProjection();
  }

  setSessionSidebarWidth(width: number, options?: { persist?: boolean }): void {
    const nextRequestedWidth = this.normalizeRequestedSessionSidebarWidth(width);
    if (nextRequestedWidth === this._requestedSessionSidebarWidth) {
      if (options?.persist !== false) {
        this.persistSessionSidebarWidth(nextRequestedWidth);
      }
      this.updateLayoutProjection();
      return;
    }

    this._requestedSessionSidebarWidth = nextRequestedWidth;
    if (options?.persist !== false) {
      this.persistSessionSidebarWidth(nextRequestedWidth);
    }
    this.updateLayoutProjection();
  }

  syncViewerLayout(input: {
    hasConversationContent: boolean;
    hasCurrentSession: boolean;
    isAuthenticated: boolean;
  }): void {
    const nextHasConversationContent = input.hasConversationContent === true;
    const nextHasCurrentSession = input.hasCurrentSession === true;
    const nextIsAuthenticated = input.isAuthenticated === true;

    if (nextHasConversationContent === this._hasConversationContent
      && nextHasCurrentSession === this._hasCurrentSession
      && nextIsAuthenticated === this._isAuthenticated) {
      return;
    }

    this._hasConversationContent = nextHasConversationContent;
    this._hasCurrentSession = nextHasCurrentSession;
    this._isAuthenticated = nextIsAuthenticated;
    if (!this.updateLayoutProjection()) {
      this.controlChangedSubject.next();
    }
  }

  setSessionViewerSuppressed(suppressed: boolean): void {
    const nextSuppressed = suppressed === true;
    if (nextSuppressed === this._isSessionViewerSuppressed) {
      return;
    }

    this._isSessionViewerSuppressed = nextSuppressed;
    if (!this.updateLayoutProjection()) {
      this.controlChangedSubject.next();
    }
  }

  resolveSessionListDisplayMode(input: {
    hasSessions: boolean;
    hasConversationContent: boolean;
    hasCurrentSession: boolean;
  }): 'hidden' | 'stacked' | 'sidebar' {
    if (!this._isAuthenticated) {
      return 'hidden';
    }

    if (this._isSessionViewerSuppressed) {
      return 'hidden';
    }

    if (!input.hasConversationContent) {
      if (this.resolveWelcomeSurfaceVisibility(input)) {
        return 'hidden';
      }

      return this.resolveEntryStateDisplayMode();
    }

    if (!input.hasSessions) {
      return 'hidden';
    }

    if (this._sessionViewerOrientation === 'stacked') {
      return 'hidden';
    }

    return this.shouldPreferSideBySideSessionViewer()
      ? 'sidebar'
      : 'hidden';
  }

  resolveWelcomeSurfaceVisibility(input: {
    hasSessions: boolean;
    hasConversationContent: boolean;
    hasCurrentSession: boolean;
  }): boolean {
    if (!this._isAuthenticated) {
      return false;
    }

    // VS Code only shows the pane welcome view when there is no core/default chat
    // path available. aily-chat currently always has a default submit path, so a
    // fresh pane should stay in entry state and let the first submit create the
    // new session instead of hiding the input behind a generic welcome surface.
    return false;
  }

  openSessionPicker(anchor?: MouseEvent | null): void {
    if (this.sessionListItems.length === 0) {
      this.message.info(this.translate.instant('AILY_CHAT.NO_HISTORY_SESSION') || '没有历史会话记录');
      return;
    }

    this.menuManager.closeAll();
    const preferredSessionId = this.resolvePreferredSessionId();
    if (preferredSessionId) {
      this._selectedSessionId = preferredSessionId;
      this._pickerRevealSessionId = preferredSessionId;
    }

    this._sessionPickerPosition = this.resolveSessionPickerPosition(anchor);
    this._showSessionPicker = !this._showSessionPicker;
    if (!this._showSessionPicker) {
      this._pickerRevealSessionId = '';
    }

    this.controlChangedSubject.next();
  }

  closeSessionPicker(): void {
    if (!this._showSessionPicker && this._pickerRevealSessionId.length === 0) {
      return;
    }

    this._showSessionPicker = false;
    this._pickerRevealSessionId = '';
    this.controlChangedSubject.next();
  }

  selectSession(sessionId: string): void {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (normalizedSessionId.length === 0 || normalizedSessionId === this._selectedSessionId) {
      return;
    }

    this._selectedSessionId = normalizedSessionId;
    if (this._showSessionPicker) {
      this._pickerRevealSessionId = normalizedSessionId;
    }
    this.controlChangedSubject.next();
  }

  private reconcileSelection(): void {
    const preferredSessionId = this.resolvePreferredSessionId();
    this._selectedSessionId = preferredSessionId;

    if (!this._showSessionPicker) {
      this._pickerRevealSessionId = '';
      return;
    }

    this._pickerRevealSessionId = preferredSessionId;
  }

  private updateLayoutProjection(): boolean {
    const nextSidebarMaxWidth = this.resolveSessionSidebarMaxWidth(this._sessionViewportWidth);
    const nextSidebarWidth = this.resolveEffectiveSessionSidebarWidth(this._sessionViewportWidth, this._requestedSessionSidebarWidth);
    const nextDisplayMode = this.resolveSessionListDisplayMode({
      hasSessions: this.sessionListItems.length > 0,
      hasConversationContent: this._hasConversationContent,
      hasCurrentSession: this._hasCurrentSession,
    });

    if (nextDisplayMode === this._sessionListDisplayMode
      && nextSidebarWidth === this._sessionSidebarWidth
      && nextSidebarMaxWidth === this._sessionSidebarMaxWidth) {
      return false;
    }

    this._sessionListDisplayMode = nextDisplayMode;
    this._sessionSidebarWidth = nextSidebarWidth;
    this._sessionSidebarMaxWidth = nextSidebarMaxWidth;
    this.controlChangedSubject.next();
    return true;
  }

  private readPersistedSessionSidebarWidth(): number {
    const persistedWidth = AilyHost.get().config.data?.[SESSION_SIDEBAR_WIDTH_CONFIG_KEY];
    return this.normalizeRequestedSessionSidebarWidth(persistedWidth);
  }

  private persistSessionSidebarWidth(width: number): void {
    const config = AilyHost.get().config;
    if (config.data) {
      config.data[SESSION_SIDEBAR_WIDTH_CONFIG_KEY] = width;
    }
    config.save?.();
  }

  private normalizeRequestedSessionSidebarWidth(width: unknown): number {
    return typeof width === 'number' && Number.isFinite(width)
      ? Math.max(this.sessionSidebarResizeMinWidth, Math.round(width))
      : this.sessionSidebarDefaultWidth;
  }

  private resolveSessionSidebarMaxWidth(viewportWidth: number): number {
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
      return Math.max(this.sessionSidebarResizeMinWidth, this.sessionSidebarDefaultWidth);
    }

    return Math.max(this.sessionSidebarResizeMinWidth, Math.floor(viewportWidth - this.sessionStageMinWidth));
  }

  private resolveEffectiveSessionSidebarWidth(viewportWidth: number, requestedWidth: number): number {
    const nextMaxWidth = this.resolveSessionSidebarMaxWidth(viewportWidth);
    return Math.max(this.sessionSidebarResizeMinWidth, Math.min(requestedWidth, nextMaxWidth));
  }

  private resolveEntryStateDisplayMode(): 'stacked' | 'sidebar' {
    if (this._sessionViewerOrientation === 'stacked') {
      return 'stacked';
    }

    return this.shouldPreferSideBySideSessionViewer()
      ? 'sidebar'
      : 'stacked';
  }

  private shouldPreferSideBySideSessionViewer(): boolean {
    return this._sessionViewportWidth >= this.sessionSidebarMinWidth;
  }

  private applyConfiguredSessionViewerOrientation(orientation: ChatSessionViewerOrientationSetting): void {
    if (orientation === this._sessionViewerOrientation) {
      return;
    }

    this._sessionViewerOrientation = orientation;
    if (!this.updateLayoutProjection()) {
      this.controlChangedSubject.next();
    }
  }

  private resolvePreferredSessionId(): string {
    const items = this.sessionListItems;
    if (items.length === 0) {
      return '';
    }

    const currentSessionId = typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    const currentItem = items.find(item => item.current || (currentSessionId.length > 0 && item.sessionId === currentSessionId));
    if (currentItem?.sessionId) {
      return currentItem.sessionId;
    }

    const selectedSessionId = this._selectedSessionId.trim();
    if (selectedSessionId.length > 0 && items.some(item => item.sessionId === selectedSessionId)) {
      return selectedSessionId;
    }
    return currentItem?.sessionId ?? items[0]?.sessionId ?? '';
  }

  private resolveSessionPickerPosition(anchor?: MouseEvent | null): MenuPosition {
    const anchorRect = this.extractSessionPickerAnchorRect(anchor);
    if (!anchorRect) {
      return { x: window.innerWidth - 302, y: 72 };
    }

    const pickerWidth = 300;
    const pickerHeight = 360;
    const gap = 4;
    let x = anchorRect.left;
    let y = anchorRect.bottom + gap;

    if (x + pickerWidth > window.innerWidth - 8) {
      x = Math.max(8, anchorRect.right - pickerWidth);
    }

    if (y + pickerHeight > window.innerHeight - 8) {
      y = Math.max(8, anchorRect.top - pickerHeight - gap);
    }

    return { x: Math.max(0, x), y: Math.max(0, y) };
  }

  private extractSessionPickerAnchorRect(anchor?: MouseEvent | null): { left: number; right: number; top: number; bottom: number } | null {
    if (anchor && typeof anchor.preventDefault === 'function') {
      anchor.preventDefault();
    }
    if (anchor && typeof anchor.stopPropagation === 'function') {
      anchor.stopPropagation();
    }

    const directRect = this.readRectLike(anchor as unknown);
    if (directRect) {
      return directRect;
    }

    const currentTarget = anchor && typeof anchor === 'object' && 'currentTarget' in anchor
      ? (anchor as { currentTarget?: unknown }).currentTarget
      : undefined;
    return this.readRectLike(currentTarget);
  }

  private readRectLike(value: unknown): { left: number; right: number; top: number; bottom: number } | null {
    const rectSource = value && typeof value === 'object' && 'getBoundingClientRect' in value
      ? (value as { getBoundingClientRect?: () => Partial<{ left: number; right: number; top: number; bottom: number }> }).getBoundingClientRect?.()
      : value;

    if (!rectSource || typeof rectSource !== 'object') {
      return null;
    }

    const left = (rectSource as { left?: unknown }).left;
    const right = (rectSource as { right?: unknown }).right;
    const top = (rectSource as { top?: unknown }).top;
    const bottom = (rectSource as { bottom?: unknown }).bottom;

    return typeof left === 'number'
      && typeof right === 'number'
      && typeof top === 'number'
      && typeof bottom === 'number'
      ? { left, right, top, bottom }
      : null;
  }
}
