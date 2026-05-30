import { Injectable, OnDestroy } from '@angular/core';
import type { IMenuItem } from '../../../configs/menu.config';
import type { ChatSessionInputState } from '../core/chat-mode';
import type { HostSessionRequestRoutingSummary } from '../helpers/host-session-request-routing';
import type {
  HostSessionListItemChanges,
  HostSessionListItemMetadata,
  HostSessionListItemTiming,
} from '../helpers/host-session-item-controller';

export interface MenuPosition {
  x: number;
  y: number;
  anchorBottom?: number;
}

export interface ChatSessionListAction {
  readonly icon: string;
  readonly action: string;
  readonly title: string;
  readonly active?: boolean;
}

export interface ChatSessionListItem {
  readonly sessionId: string;
  readonly title: string;
  readonly description: string;
  readonly sessionType?: string;
  readonly projectPath?: string | null;
  readonly badge?: string;
  readonly status?: string;
  readonly timing?: HostSessionListItemTiming;
  readonly metadata?: HostSessionListItemMetadata;
  readonly changes?: HostSessionListItemChanges;
  readonly mode?: string;
  readonly requestRouting?: HostSessionRequestRoutingSummary;
  readonly inputState?: ChatSessionInputState;
  readonly archived?: boolean;
  readonly pinned?: boolean;
  readonly read?: boolean;
  readonly markedUnread?: boolean;
  readonly current: boolean;
  readonly actions: readonly ChatSessionListAction[];
}

export type ChatSessionPickerAction = ChatSessionListAction;

/**
 * 管理聊天界面的所有菜单/下拉面板状态：
 * - 会话列表
 * - 模式切换菜单
 * - 模型切换菜单
 * - 会话的重命名/删除操作
 */
@Injectable()
export class MenuManagerService implements OnDestroy {
  showMode = false;
  showModelMenu = false;
  showReasoningMenu = false;
  showActionMenu = false;
  modeListPosition: MenuPosition = { x: 0, y: 0 };
  modelListPosition: MenuPosition = { x: 0, y: 0 };
  reasoningMenuPosition: MenuPosition = { x: 0, y: 0 };
  actionMenuPosition: MenuPosition = { x: 0, y: 0 };

  ngOnDestroy(): void {
    return;
  }

  closeAll(): void {
    this.showMode = false;
    this.showModelMenu = false;
    this.showReasoningMenu = false;
    this.showActionMenu = false;
  }

  /** 切换模式菜单的显示/隐藏 */
  toggleModeMenu(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      const menuHeight = 68;
      let x = rect.left;
      let y = rect.top - menuHeight - 1;
      let anchorBottom: number | undefined = rect.top - 1;
      if (x < 0) x = rect.left;
      if (y < 0) {
        y = rect.bottom - 1;
        anchorBottom = undefined;
      }
      this.modeListPosition = { x: Math.max(0, x), y: Math.max(0, y), anchorBottom };
    } else {
      this.modeListPosition = { x: window.innerWidth - 302, y: window.innerHeight - 280 };
    }
    event.preventDefault();
    event.stopPropagation();
    this.showReasoningMenu = false;
    this.showModelMenu = false;
    this.showMode = !this.showMode;
  }

  /** 切换模型菜单的显示/隐藏 */
  toggleModelMenu(event: MouseEvent, modelItems: IMenuItem[]): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      const menuHeight = this.estimateMenuHeight(modelItems, { includeGlobalFilter: true });
      const estimatedMenuWidth = 320;
      let x = rect.left;
      let y = rect.top - menuHeight - 1;
      let anchorBottom: number | undefined = rect.top - 1;

      if (x + estimatedMenuWidth > window.innerWidth - 8) {
        x = Math.max(8, rect.right - estimatedMenuWidth);
      }

      if (y < 8) {
        y = Math.max(8, rect.bottom - 1);
        anchorBottom = undefined;
      }

      this.modelListPosition = { x: Math.max(0, x), y: Math.max(0, y), anchorBottom };
    } else {
      this.modelListPosition = { x: window.innerWidth - 302, y: window.innerHeight - 280 };
    }
    event.preventDefault();
    event.stopPropagation();
    this.showMode = false;
    this.showReasoningMenu = false;
    this.showModelMenu = !this.showModelMenu;
  }

  toggleReasoningMenu(event: MouseEvent, reasoningItems: IMenuItem[]): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      const menuHeight = this.estimateMenuHeight(reasoningItems);
      const estimatedMenuWidth = 220;
      let x = rect.left;
      let y = rect.bottom + 4;

      if (x + estimatedMenuWidth > window.innerWidth - 8) {
        x = Math.max(8, rect.right - estimatedMenuWidth);
      }

      if (y + menuHeight > window.innerHeight - 8) {
        y = Math.max(8, rect.top - menuHeight - 4);
      }

      this.reasoningMenuPosition = { x: Math.max(0, x), y: Math.max(0, y) };
    } else {
      this.reasoningMenuPosition = { x: window.innerWidth - 240, y: window.innerHeight - 280 };
    }

    event.preventDefault();
    event.stopPropagation();
    this.showMode = false;
    this.showModelMenu = false;
    this.showActionMenu = false;
    this.showReasoningMenu = !this.showReasoningMenu;
  }

  toggleActionMenu(event: MouseEvent, actionItems: IMenuItem[]): void {
    const target = event.currentTarget as HTMLElement;
    if (target) {
      const rect = target.getBoundingClientRect();
      const menuHeight = this.estimateMenuHeight(actionItems);
      const estimatedMenuWidth = 300;
      let x = rect.left;
      let y = rect.bottom + 4;

      if (x + estimatedMenuWidth > window.innerWidth - 8) {
        x = Math.max(8, rect.right - estimatedMenuWidth);
      }

      if (y + menuHeight > window.innerHeight - 8) {
        y = Math.max(8, rect.top - menuHeight - 4);
      }

      this.actionMenuPosition = { x: Math.max(0, x), y: Math.max(0, y) };
    } else {
      this.actionMenuPosition = { x: window.innerWidth - 320, y: 72 };
    }

    event.preventDefault();
    event.stopPropagation();
    this.showMode = false;
    this.showModelMenu = false;
    this.showActionMenu = !this.showActionMenu;
  }

  private estimateMenuHeight(items: IMenuItem[] | null | undefined, options?: { includeGlobalFilter?: boolean }): number {
    if (!Array.isArray(items) || items.length === 0) {
      return 40;
    }

    const collapsedSections: Record<string, boolean> = {};
    for (const item of items) {
      const action = typeof item?.action === 'string' ? item.action : '';
      if (!action.startsWith('section-toggle-')) {
        continue;
      }

      const sectionId = typeof item?.extra?.sectionId === 'string'
        ? item.extra.sectionId
        : action.slice('section-toggle-'.length);
      if (!sectionId) {
        continue;
      }

      collapsedSections[sectionId] = item.extra?.collapsed !== false;
    }

    let height = 8;
    if (options?.includeGlobalFilter) {
      height += 40;
    }

    for (const item of items) {
      if (item?.sep) {
        height += 6;
        continue;
      }

      const scopedSectionId = typeof item?.extra?.section === 'string' ? item.extra.section : '';
      if (scopedSectionId && collapsedSections[scopedSectionId]) {
        continue;
      }

      if (typeof item?.action === 'string' && item.action.startsWith('section-')) {
        if (item.action.startsWith('section-filter-') && options?.includeGlobalFilter) {
          continue;
        }
        if (item.action.startsWith('section-toggle-')) {
          height += 28;
        } else if (item.action.startsWith('section-filter-')) {
          height += 34;
        } else {
          height += 20;
        }
        continue;
      }

      height += 28;
    }

    return height + 8;
  }
}
