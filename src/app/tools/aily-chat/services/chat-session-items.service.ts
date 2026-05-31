import { Injectable, OnDestroy, Optional } from '@angular/core';
import { Subscription, Subject } from 'rxjs';

import { ChatService } from './chat.service';
import { ChatHistoryService } from './chat-history.service';
import { AilyHost } from '../core/host';
import { HostSessionItemController } from '../helpers/host-session-item-controller';
import { ChatSessionStateService } from './chat-session-state.service';
import type { ChatSessionRuntimeChangedEvent } from './chat-session-runtime-store.service';
import { ChatSessionRuntimeStoreService } from './chat-session-runtime-store.service';
import type { ChatSessionListAction, ChatSessionListItem } from './menu-manager.service';
import type {
  HostSessionHistoryItem,
  HostSessionListItem as HostSessionListProjectionItem,
  HostSessionListItemMetadata,
  HostSessionListItemTiming,
} from '../helpers/host-session-item-controller';
import { EditCheckpointService } from './edit-checkpoint.service';

type SessionListSourceLike = Partial<HostSessionHistoryItem> & Partial<HostSessionListProjectionItem> & Partial<ChatSessionListItem> & {
  readonly name?: string;
  readonly updatedAt?: number;
};

export interface ChatSessionListItemsDelta {
  readonly kind: 'full' | 'item';
  readonly affectsOrder: boolean;
  readonly sessionId?: string;
}

@Injectable()
export class ChatSessionItemsService implements OnDestroy {
  private _sessionListItems: ChatSessionListItem[] = [];
  private readonly hostSessionItemController: HostSessionItemController;
  private readonly controllerSubscription = new Subscription();
  private readonly sessionListItemsChangedSubject = new Subject<void>();
  private readonly sessionListItemsDeltaSubject = new Subject<ChatSessionListItemsDelta>();
  private readonly sessionListItemMap = new Map<string, ChatSessionListItem>();
  private readonly pendingSessionItemRefresh = new Set<string>();
  private pendingFullRefresh = false;
  private refreshScheduled = false;

  readonly sessionListItemsChanged$ = this.sessionListItemsChangedSubject.asObservable();
  readonly sessionListItemsDelta$ = this.sessionListItemsDeltaSubject.asObservable();

  constructor(
    private readonly chatService: ChatService,
    private readonly chatHistoryService: ChatHistoryService,
    private readonly chatSessionRuntimeStore: ChatSessionRuntimeStoreService,
    @Optional() private readonly editCheckpointService: EditCheckpointService | null = null,
    @Optional() private readonly chatSessionStateService: ChatSessionStateService | null = null,
  ) {
    this.hostSessionItemController = new HostSessionItemController({
      chatService: this.chatService,
      chatHistoryService: this.chatHistoryService,
      ...(this.editCheckpointService ? { editCheckpointService: this.editCheckpointService } : {}),
      ...(this.chatSessionStateService ? { chatSessionStateService: this.chatSessionStateService } : {}),
      readLiveSessionTurnResponses: (sessionId) => this.chatSessionRuntimeStore.readTurnResponses(sessionId),
      readLiveSessionRuntimeState: (sessionId) => this.chatSessionRuntimeStore.read(sessionId),
    });
    this.controllerSubscription.add(this.hostSessionItemController.itemsChanged$.subscribe(() => {
      this.scheduleFullRefresh('controller-items-changed');
    }));
    this.controllerSubscription.add(this.chatSessionRuntimeStore.runtimeChanged$.subscribe((event) => {
      this.handleRuntimeChanged(event);
    }));
    this.refreshHistoryList();
  }

  ngOnDestroy(): void {
    this.controllerSubscription.unsubscribe();
  }

  get sessionItemController(): HostSessionItemController {
    return this.hostSessionItemController;
  }

  get sessionListItems(): ChatSessionListItem[] {
    return this._sessionListItems;
  }

  set sessionListItems(value: ChatSessionListItem[]) {
    this.commitSessionListItems(Array.isArray(value) ? [...value] : [], {
      kind: 'full',
      affectsOrder: true,
    });
  }

  readSessionListItems(
    projectPath?: string | null,
    projectRootPath?: string | null,
  ): readonly HostSessionListProjectionItem[] {
    const resolvedProjectPath = projectPath ?? this.resolveCurrentProjectPath();
    const resolvedProjectRootPath = projectRootPath ?? AilyHost.get().project.projectRootPath ?? null;
    return this.hostSessionItemController.readListItems(
      'current-project',
      resolvedProjectPath,
      resolvedProjectRootPath,
    );
  }

  readSessionViewItems(
    projectPath?: string | null,
    projectRootPath?: string | null,
  ): readonly ChatSessionListItem[] {
    return this.readSessionListItems(projectPath, projectRootPath).map(item => this.toSessionListItem(item));
  }

  readCurrentSessionViewItem(
    projectPath?: string | null,
    projectRootPath?: string | null,
  ): ChatSessionListItem | null {
    const currentSessionId = typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    if (!currentSessionId) {
      return null;
    }

    const currentItem = this.sessionListItemMap.get(currentSessionId);
    if (currentItem) {
      return currentItem;
    }

    return this._sessionListItems.find(item => item.current || item.sessionId === currentSessionId) ?? null;
  }

  refreshHistoryList(
    projectPath?: string | null,
    projectRootPath?: string | null,
  ): void {
    const nextItems = [...this.readSessionViewItems(projectPath, projectRootPath)];
    this.commitSessionListItems(nextItems, {
      kind: 'full',
      affectsOrder: !this.isSessionListOrderEqual(this._sessionListItems, nextItems),
    });
  }

  scheduleFullRefresh(_reason = 'scheduled-full-refresh'): void {
    this.pendingFullRefresh = true;
    this.pendingSessionItemRefresh.clear();
    this.scheduleRefreshFlush();
  }

  scheduleSessionItemRefresh(
    sessionId: string | null | undefined,
    _reason = 'scheduled-item-refresh',
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    if (this.pendingFullRefresh) {
      return;
    }

    this.pendingSessionItemRefresh.add(normalizedSessionId);
    this.scheduleRefreshFlush();
  }

  refreshSessionListItem(
    sessionId: string | null | undefined,
    _reason = 'manual-item-refresh',
    projectPath?: string | null,
    projectRootPath?: string | null,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const resolvedProjectPath = projectPath ?? this.resolveCurrentProjectPath();
    const resolvedProjectRootPath = projectRootPath ?? AilyHost.get().project.projectRootPath ?? null;
    const projectionItem = this.hostSessionItemController.readListItem(
      normalizedSessionId,
      'current-project',
      resolvedProjectPath,
      resolvedProjectRootPath,
    );
    const nextItem = projectionItem ? this.toSessionListItem(projectionItem) : null;

    const previousItems = this._sessionListItems;
    const previousIndex = previousItems.findIndex(item => item.sessionId === normalizedSessionId);

    if (!nextItem && previousIndex < 0) {
      return;
    }

    const nextItems = [...previousItems];
    if (!nextItem && previousIndex >= 0) {
      nextItems.splice(previousIndex, 1);
      this.commitSessionListItems(nextItems, {
        kind: 'item',
        sessionId: normalizedSessionId,
        affectsOrder: true,
      });
      return;
    }

    if (!nextItem) {
      return;
    }

    if (previousIndex >= 0) {
      if (this.isSameSessionListItem(previousItems[previousIndex], nextItem)) {
        return;
      }

      nextItems.splice(previousIndex, 1, nextItem);
    } else {
      nextItems.push(nextItem);
    }

    nextItems.sort((left, right) => this.compareSessionListItems(left, right));
    this.commitSessionListItems(nextItems, {
      kind: 'item',
      sessionId: normalizedSessionId,
      affectsOrder: !this.isSessionListOrderEqual(previousItems, nextItems),
    });
  }

  private handleRuntimeChanged(event: ChatSessionRuntimeChangedEvent): void {
    if (event.sessionId === null || event.reason === 'clearAll') {
      this.scheduleFullRefresh('runtime-clear-all');
      return;
    }

    if (!event.listAffecting) {
      return;
    }

    this.scheduleSessionItemRefresh(event.sessionId, `runtime-${event.reason}`);
  }

  private scheduleRefreshFlush(): void {
    if (this.refreshScheduled) {
      return;
    }

    this.refreshScheduled = true;
    queueMicrotask(() => this.flushScheduledRefreshes());
  }

  private flushScheduledRefreshes(): void {
    this.refreshScheduled = false;
    if (this.pendingFullRefresh) {
      this.pendingFullRefresh = false;
      this.pendingSessionItemRefresh.clear();
      this.refreshHistoryList();
      return;
    }

    if (this.pendingSessionItemRefresh.size === 0) {
      return;
    }

    const sessionIds = [...this.pendingSessionItemRefresh.values()];
    this.pendingSessionItemRefresh.clear();
    for (const sessionId of sessionIds) {
      this.refreshSessionListItem(sessionId, 'runtime-batch');
    }
  }

  private normalizeSessionId(sessionId: string | null | undefined): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }

  private commitSessionListItems(
    items: readonly ChatSessionListItem[],
    delta: ChatSessionListItemsDelta,
  ): void {
    const normalizedItems = Array.isArray(items) ? [...items] : [];
    if (this.areSessionListItemsEqual(this._sessionListItems, normalizedItems)) {
      return;
    }

    this._sessionListItems = normalizedItems;
    this.sessionListItemMap.clear();
    for (const item of normalizedItems) {
      if (item.sessionId) {
        this.sessionListItemMap.set(item.sessionId, item);
      }
    }

    this.sessionListItemsChangedSubject.next();
    this.sessionListItemsDeltaSubject.next(delta);
  }

  private isSessionListOrderEqual(
    left: readonly ChatSessionListItem[],
    right: readonly ChatSessionListItem[],
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index++) {
      if (left[index].sessionId !== right[index].sessionId) {
        return false;
      }
    }

    return true;
  }

  private compareSessionListItems(left: ChatSessionListItem, right: ChatSessionListItem): number {
    if (!left.archived && right.archived) {
      return -1;
    }
    if (left.archived && !right.archived) {
      return 1;
    }

    if (!left.archived && !right.archived) {
      if (left.pinned && !right.pinned) {
        return -1;
      }
      if (!left.pinned && right.pinned) {
        return 1;
      }

      const leftNeedsInput = left.status === 'needs_input';
      const rightNeedsInput = right.status === 'needs_input';
      if (leftNeedsInput && !rightNeedsInput) {
        return -1;
      }
      if (!leftNeedsInput && rightNeedsInput) {
        return 1;
      }
    }

    const leftUpdated = left.timing?.updated ?? left.timing?.created ?? 0;
    const rightUpdated = right.timing?.updated ?? right.timing?.created ?? 0;
    return rightUpdated - leftUpdated;
  }

  private areSessionListItemsEqual(
    left: readonly ChatSessionListItem[],
    right: readonly ChatSessionListItem[],
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index++) {
      if (!this.isSameSessionListItem(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  private isSameSessionListItem(left: ChatSessionListItem, right: ChatSessionListItem): boolean {
    if (left === right) {
      return true;
    }

    return left.sessionId === right.sessionId
      && left.title === right.title
      && left.description === right.description
      && (left.sessionType ?? '') === (right.sessionType ?? '')
      && (left.projectPath ?? '') === (right.projectPath ?? '')
      && (left.badge ?? '') === (right.badge ?? '')
      && (left.status ?? '') === (right.status ?? '')
      && (left.mode ?? '') === (right.mode ?? '')
      && left.archived === right.archived
      && left.pinned === right.pinned
      && left.read === right.read
      && left.markedUnread === right.markedUnread
      && left.current === right.current
      && this.isSameSessionListTiming(left.timing, right.timing)
      && this.isSameSessionListMetadata(left.metadata, right.metadata)
      && this.isSameSessionListChanges(left.changes, right.changes)
      && this.isSameSerializableValue(left.requestRouting, right.requestRouting)
      && this.isSameSerializableValue(left.inputState, right.inputState)
      && this.isSameSessionListActions(left.actions, right.actions);
  }

  private isSameSessionListTiming(
    left: HostSessionListItemTiming | undefined,
    right: HostSessionListItemTiming | undefined,
  ): boolean {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }

    return left.created === right.created
      && left.updated === right.updated
      && (left.lastRequestStarted ?? null) === (right.lastRequestStarted ?? null)
      && (left.lastRequestEnded ?? null) === (right.lastRequestEnded ?? null);
  }

  private isSameSessionListMetadata(
    left: HostSessionListItemMetadata | undefined,
    right: HostSessionListItemMetadata | undefined,
  ): boolean {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }

    return left.providerLabel === right.providerLabel
      && (left.projectLabel ?? '') === (right.projectLabel ?? '')
      && (left.workingDirectoryPath ?? '') === (right.workingDirectoryPath ?? '');
  }

  private isSameSessionListChanges(
    left: HostSessionListProjectionItem['changes'] | undefined,
    right: HostSessionListProjectionItem['changes'] | undefined,
  ): boolean {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }

    return left.fileCount === right.fileCount
      && left.insertions === right.insertions
      && left.deletions === right.deletions;
  }

  private isSameSessionListActions(
    left: readonly ChatSessionListAction[] | undefined,
    right: readonly ChatSessionListAction[] | undefined,
  ): boolean {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index++) {
      if (left[index].icon !== right[index].icon
        || left[index].action !== right[index].action
        || left[index].title !== right[index].title
        || (left[index].active ?? false) !== (right[index].active ?? false)) {
        return false;
      }
    }

    return true;
  }

  private isSameSerializableValue(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }
    if (left === undefined || right === undefined) {
      return left === right;
    }

    return JSON.stringify(left) === JSON.stringify(right);
  }

  private toSessionListItem(item: SessionListSourceLike): ChatSessionListItem {
    const fallbackTitle = typeof item?.title === 'string' && item.title.trim().length > 0
      ? item.title.trim()
      : (typeof item?.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : this.resolveUntitledSessionFallback(item));

    const description = typeof item?.description === 'string' && item.description.trim().length > 0
      ? item.description.trim()
      : '';
    const timing = item?.timing ?? this.buildFallbackTiming(item);
    const metadata = item?.metadata ?? this.buildFallbackMetadata(item);
    const changes = item?.changes;

    return {
      sessionId: typeof item?.sessionId === 'string' ? item.sessionId : '',
      title: fallbackTitle,
      description,
      ...(typeof item?.sessionType === 'string' && item.sessionType.trim().length > 0 ? { sessionType: item.sessionType.trim() } : {}),
      ...(typeof item?.projectPath === 'string' || item?.projectPath === null ? { projectPath: item.projectPath ?? null } : {}),
      ...(typeof item?.badge === 'string' && item.badge.trim().length > 0 ? { badge: item.badge.trim() } : {}),
      ...(typeof item?.status === 'string' && item.status.trim().length > 0 ? { status: item.status.trim() } : {}),
      ...(timing ? { timing } : {}),
      ...(metadata ? { metadata } : {}),
      ...(changes ? { changes } : {}),
      ...(typeof item?.mode === 'string' && item.mode.trim().length > 0 ? { mode: item.mode.trim() } : {}),
      ...(item?.requestRouting ? { requestRouting: item.requestRouting } : {}),
      ...(item?.inputState ? { inputState: item.inputState } : {}),
      archived: item?.archived === true,
      pinned: item?.pinned === true,
      read: item?.read !== false,
      markedUnread: item?.markedUnread === true,
      current: item?.current === true,
      actions: Array.isArray(item?.actions) && item.actions.length > 0 ? item.actions : this.buildSessionActions(item),
    };
  }

  private buildSessionActions(item: SessionListSourceLike): readonly ChatSessionListAction[] {
    const archived = item?.archived === true;
    const pinned = item?.pinned === true;
    const read = item?.read === true && item?.markedUnread !== true;

    return [
      {
        icon: pinned ? 'fa-solid fa-thumbtack' : 'fa-light fa-thumbtack',
        action: pinned ? 'unpin-session' : 'pin-session',
        title: pinned ? '取消置顶' : '置顶',
        ...(pinned ? { active: true } : {}),
      },
      ...(!archived ? [{
        icon: read ? 'fa-light fa-envelope-open' : 'fa-light fa-envelope',
        action: read ? 'mark-session-unread' : 'mark-session-read',
        title: read ? '标为未读' : '标为已读',
        ...(!read ? { active: true } : {}),
      } satisfies ChatSessionListAction] : []),
      {
        icon: archived ? 'fa-solid fa-box-archive' : 'fa-light fa-box-archive',
        action: archived ? 'unarchive-session' : 'archive-session',
        title: archived ? '取消归档' : '归档',
        ...(archived ? { active: true } : {}),
      },
      { icon: 'fa-light fa-pen', action: 'rename-session', title: '重命名' },
      { icon: 'fa-light fa-trash', action: 'delete-session', title: '删除' },
    ];
  }

  private buildFallbackTiming(item: SessionListSourceLike): HostSessionListItemTiming | undefined {
    const created = typeof item?.timing?.created === 'number'
      ? item.timing.created
      : (typeof item?.createdAt === 'number' ? item.createdAt : undefined);
    const updated = typeof item?.timing?.updated === 'number'
      ? item.timing.updated
      : (typeof item?.updatedAt === 'number' ? item.updatedAt : created);

    if (created === undefined || updated === undefined) {
      return undefined;
    }

    return {
      created,
      updated,
      ...(typeof item?.timing?.lastRequestStarted === 'number' ? { lastRequestStarted: item.timing.lastRequestStarted } : {}),
      ...(typeof item?.timing?.lastRequestEnded === 'number' ? { lastRequestEnded: item.timing.lastRequestEnded } : {}),
    };
  }

  private buildFallbackMetadata(item: SessionListSourceLike): HostSessionListItemMetadata | undefined {
    if (item?.metadata?.providerLabel) {
      return item.metadata;
    }

    const providerLabel = this.describeSessionType(typeof item?.sessionType === 'string' ? item.sessionType : undefined);
    const workingDirectoryPath = typeof item?.projectPath === 'string' && item.projectPath.trim().length > 0
      ? item.projectPath.trim()
      : undefined;
    const projectLabel = this.describeProjectPath(workingDirectoryPath ?? null);

    if (!providerLabel && !projectLabel && !workingDirectoryPath) {
      return undefined;
    }

    return {
      providerLabel,
      ...(projectLabel ? { projectLabel } : {}),
      ...(workingDirectoryPath ? { workingDirectoryPath } : {}),
    };
  }

  private describeSessionType(sessionType?: string): string {
    const normalizedType = typeof sessionType === 'string' ? sessionType.trim() : '';
    switch (normalizedType) {
      case 'local':
        return 'Local';
      case 'claude-code':
        return 'Claude Code';
      case 'copilotcli':
        return 'Copilot CLI';
      case 'agent':
        return 'Agent';
      default:
        return normalizedType.length > 0
          ? normalizedType
            .split(/[-_\s]+/)
            .filter(part => part.length > 0)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
          : '';
    }
  }

  private describeProjectPath(projectPath: string | null): string {
    if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
      return '';
    }

    const normalizedPath = projectPath.replace(/[\\/]+$/, '');
    const segments = normalizedPath.split(/[\\/]+/).filter(segment => segment.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : normalizedPath;
  }

  private resolveCurrentProjectPath(): string | null {
    const currentProjectPath = AilyHost.get().project.currentProjectPath;
    const projectRootPath = AilyHost.get().project.projectRootPath;
    return currentProjectPath && currentProjectPath !== projectRootPath
      ? currentProjectPath
      : projectRootPath || null;
  }

  private resolveUntitledSessionFallback(item: SessionListSourceLike): string {
    return '新对话';
  }
}
