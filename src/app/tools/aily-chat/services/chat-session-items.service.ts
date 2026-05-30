import { Injectable, OnDestroy, Optional } from '@angular/core';
import { Subscription, Subject } from 'rxjs';

import { ChatService } from './chat.service';
import { ChatHistoryService } from './chat-history.service';
import { AilyHost } from '../core/host';
import { HostSessionItemController } from '../helpers/host-session-item-controller';
import { ChatSessionStateService } from './chat-session-state.service';
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

@Injectable()
export class ChatSessionItemsService implements OnDestroy {
  private _sessionListItems: ChatSessionListItem[] = [];
  private readonly hostSessionItemController: HostSessionItemController;
  private readonly controllerSubscription = new Subscription();
  private readonly sessionListItemsChangedSubject = new Subject<void>();

  readonly sessionListItemsChanged$ = this.sessionListItemsChangedSubject.asObservable();

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
      this.refreshHistoryList();
    }));
    this.controllerSubscription.add(this.chatSessionRuntimeStore.runtimeChanged$.subscribe(() => {
      this.refreshHistoryList();
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
    this._sessionListItems = Array.isArray(value) ? [...value] : [];
    this.sessionListItemsChangedSubject.next();
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
    const currentSessionId = this.chatService.currentSessionId;
    if (!currentSessionId) {
      return null;
    }

    return this.readSessionViewItems(projectPath, projectRootPath)
      .find(item => item.current || item.sessionId === currentSessionId) ?? null;
  }

  refreshHistoryList(
    projectPath?: string | null,
    projectRootPath?: string | null,
  ): void {
    this.sessionListItems = [...this.readSessionViewItems(projectPath, projectRootPath)];
  }

  private toSessionListItem(item: SessionListSourceLike): ChatSessionListItem {
    const fallbackTitle = typeof item?.title === 'string' && item.title.trim().length > 0
      ? item.title.trim()
      : (typeof item?.name === 'string' && item.name.trim().length > 0 ? item.name.trim() : `q${item?.sessionId ?? ''}`);

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
}
