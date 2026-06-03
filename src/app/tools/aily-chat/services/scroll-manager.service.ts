import { Injectable, ElementRef } from '@angular/core';

/**
 * 管理聊天窗口的滚动行为：
 * - 维护接近 VS Code ChatListWidget 的 scrollLock 语义
 * - scrollLock=true 表示保持贴底跟随；false 表示用户已脱离底部
 */
@Injectable()
export class ScrollManagerService {
  private _scrollLock = true;

  private _lastTop: number | null = null;
  private _lastHeight: number | null = null;
  private _lastAtBottom: boolean | null = null;
  private _scrollRequestId = 0;
  private _exchangeRevealRequestId = 0;
  private _programmaticScrollRequestId = 0;
  private _ignoreNextScrollEvent = false;
  private _followBottomAfterExchangeReveal = false;
  private readonly _pendingExchangeTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly _pendingScrollTimeouts = new Set<ReturnType<typeof setTimeout>>();

  private containerRef: ElementRef | null = null;

  /**
   * Canonical follow-bottom state, aligned with VS Code chat list terminology.
   * true = keep following the bottom, false = user has broken away from the bottom.
   */
  get scrollLock(): boolean {
    return this._scrollLock;
  }

  setScrollLock(value: boolean): void {
    this._scrollLock = value;
  }

  /** 绑定聊天容器 DOM 引用（组件 ngAfterViewInit 时调用） */
  setContainer(ref: ElementRef): void {
    this.cancelPendingExchangeReveal();
    this.cancelPendingBottomScroll();
    this.containerRef = ref;
    this.syncCurrentResponseMinHeight();
    const element = this.containerRef?.nativeElement as HTMLElement | undefined;
    if (element) {
      this._lastTop = element.scrollTop;
      this._lastHeight = element.scrollHeight;
      this._lastAtBottom = this.isAtBottom(element);
    }
  }

  /** 启用自动滚动 */
  enable(): void {
    this.setScrollLock(true);
  }

  captureAutoScrollState(): boolean {
    const element = this.containerRef?.nativeElement as HTMLElement | undefined;
    if (!element || !this.scrollLock) {
      return false;
    }

    if (this._pendingExchangeTimeouts.size > 0) {
      return false;
    }

    return this.isAtBottom(element);
  }

  scrollToBottomIfNeeded(shouldFollow: boolean, behavior: string = 'auto'): void {
    if (!shouldFollow) {
      return;
    }

    this.scrollToBottom(behavior);
  }

  handleContentHeightChange(): void {
    const element = this.containerRef?.nativeElement as HTMLElement | undefined;
    if (!element) {
      return;
    }

    this.syncCurrentResponseMinHeight();

    const previousHeight = this._lastHeight;
    const currentHeight = element.scrollHeight;
    const hasHeightChanged = previousHeight == null || currentHeight !== previousHeight;
    const shouldFollow = hasHeightChanged
      && this.scrollLock
      && (this._lastAtBottom ?? this.isAtBottom(element));

    if (shouldFollow) {
      if (this._pendingExchangeTimeouts.size > 0) {
        this._followBottomAfterExchangeReveal = true;
        this._lastTop = element.scrollTop;
        this._lastHeight = currentHeight;
        this._lastAtBottom = this._lastAtBottom ?? this.isAtBottom(element);
        return;
      }

      this.scrollToBottom('auto');
      return;
    }

    this._lastTop = element.scrollTop;
    this._lastHeight = currentHeight;
    this._lastAtBottom = this.isAtBottom(element);
  }

  /**
   * 新一轮用户消息开始时，将最新 user 消息锚定到视口顶部附近，
   * 后续再由流式增量的 scrollToBottom 负责跟随到底部。
   */
  startNewExchange(): void {
    const element = this.containerRef?.nativeElement as HTMLElement | undefined;

    this.cancelPendingExchangeReveal();
    this.setScrollLock(true);
    this._programmaticScrollRequestId = 0;
    this._followBottomAfterExchangeReveal = false;

    if (!element) {
      return;
    }

    const requestId = ++this._exchangeRevealRequestId;
    let attempts = 0;
    const maxAttempts = 20;

    const attemptReveal = () => {
      if (!this.scrollLock || requestId !== this._exchangeRevealRequestId) {
        return;
      }

      this.syncCurrentResponseMinHeight();

      const latestUserDialog = this.findLatestUserDialog(element);
      if (!latestUserDialog) {
        if (attempts >= maxAttempts) {
          this.flushQueuedFollowAfterExchangeReveal();
          return;
        }

        attempts++;
        this.scheduleExchangeAttempt(attemptReveal, 16);
        return;
      }

      const targetTop = this.computeDialogTop(element, latestUserDialog);
      this._ignoreNextScrollEvent = true;
      element.scrollTo({ top: targetTop, behavior: 'auto' });
      this._lastTop = targetTop;
      this._lastHeight = element.scrollHeight;
      this._lastAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 30;
      this.flushQueuedFollowAfterExchangeReveal();
    };

    this.scheduleExchangeAttempt(attemptReveal, 0);
  }

  /** 重置所有追踪状态（新会话时调用） */
  reset(): void {
    this.cancelPendingExchangeReveal();
    this.cancelPendingBottomScroll();
    this._scrollRequestId++;
    this._programmaticScrollRequestId = 0;
    this._followBottomAfterExchangeReveal = false;
    this.setScrollLock(true);
    this._lastTop = null;
    this._lastHeight = null;
    this._lastAtBottom = null;
    this.syncCurrentResponseMinHeight();
  }

  scrollToBottom(behavior: string = 'smooth'): void {
    if (!this.scrollLock) {
      return;
    }

    if (this._pendingExchangeTimeouts.size > 0) {
      this._followBottomAfterExchangeReveal = true;
      return;
    }

    const element = this.containerRef?.nativeElement;
    if (!element) {
      return;
    }

    if (this._pendingScrollTimeouts.size > 0) {
      return;
    }

    const requestId = ++this._scrollRequestId;
    this.scheduleBottomScrollAttempt(() => {
      if (!this.scrollLock || requestId !== this._scrollRequestId) {
        return;
      }

      try {
        this.syncCurrentResponseMinHeight();
        const scrollHeight = element.scrollHeight;
        const clientHeight = element.clientHeight;
        const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

        if (element.scrollTop < maxScrollTop - 2) {
          this._programmaticScrollRequestId = requestId;
          this._ignoreNextScrollEvent = true;
          element.scrollTo({ top: scrollHeight, behavior });
        }

        this._lastTop = element.scrollTop;
        this._lastHeight = element.scrollHeight;
        this._lastAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 30;
      } catch (error) {
        console.warn('滚动到底部失败:', error);
      }
    }, 16);
  }

  /**
   * 检查用户是否手动向上滚动，是则禁用自动滚动；
   * 回到底部时自动重新启用。
   */
  checkUserScroll(): void {
    const element = this.containerRef?.nativeElement;
    if (!element) {
      return;
    }

    this.syncCurrentResponseMinHeight();

    if (this._ignoreNextScrollEvent) {
      this._ignoreNextScrollEvent = false;
      this._lastTop = element.scrollTop;
      this._lastHeight = element.scrollHeight;
      this._lastAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 30;
      return;
    }

    const isAtBottom = this.isAtBottom(element);

    const prevTop = this._lastTop;
    const prevHeight = this._lastHeight;
    const deltaTop = (prevTop == null) ? 0 : (element.scrollTop - prevTop);
    const deltaHeight = (prevHeight == null) ? 0 : (element.scrollHeight - prevHeight);

    const contentGrew = prevHeight != null && deltaHeight > 0;
    const likelyReflowNudge = contentGrew && Math.abs(deltaTop) <= 10;
    const userScrolledUp = deltaTop < -30 && !likelyReflowNudge;
    const isProgrammaticFollow = this._programmaticScrollRequestId === this._scrollRequestId
      && this.scrollLock
      && isAtBottom
      && deltaTop >= 0;

    if (isProgrammaticFollow) {
      this._lastTop = element.scrollTop;
      this._lastHeight = element.scrollHeight;
      this._lastAtBottom = isAtBottom;
      return;
    }

    if (!isAtBottom && this.scrollLock) {
      const shouldDisable = userScrolledUp || (!contentGrew && (this._lastAtBottom === true));
      if (shouldDisable) {
        this.setScrollLock(false);
        this._scrollRequestId++;
        this._programmaticScrollRequestId = 0;
        this.cancelPendingExchangeReveal();
        this.cancelPendingBottomScroll();
      }
    } else if (isAtBottom && !this.scrollLock) {
      this.setScrollLock(true);
      this._programmaticScrollRequestId = 0;
    }

    this._lastTop = element.scrollTop;
    this._lastHeight = element.scrollHeight;
    this._lastAtBottom = isAtBottom;
  }

  private scheduleExchangeAttempt(callback: () => void, delayMs: number): void {
    const handle = setTimeout(() => {
      this._pendingExchangeTimeouts.delete(handle);
      callback();
    }, delayMs);
    this._pendingExchangeTimeouts.add(handle);
  }

  private scheduleBottomScrollAttempt(callback: () => void, delayMs: number): void {
    const handle = setTimeout(() => {
      this._pendingScrollTimeouts.delete(handle);
      callback();
    }, delayMs);
    this._pendingScrollTimeouts.add(handle);
  }

  private cancelPendingExchangeReveal(): void {
    this._pendingExchangeTimeouts.forEach((handle) => clearTimeout(handle));
    this._pendingExchangeTimeouts.clear();
    this._followBottomAfterExchangeReveal = false;
  }

  private flushQueuedFollowAfterExchangeReveal(): void {
    if (!this._followBottomAfterExchangeReveal || !this.scrollLock) {
      this._followBottomAfterExchangeReveal = false;
      return;
    }

    this._followBottomAfterExchangeReveal = false;
    this.scrollToBottom('auto');
  }

  private cancelPendingBottomScroll(): void {
    this._pendingScrollTimeouts.forEach((handle) => clearTimeout(handle));
    this._pendingScrollTimeouts.clear();
  }

  private syncCurrentResponseMinHeight(): void {
    const element = this.containerRef?.nativeElement as HTMLElement | undefined;
    if (!element) {
      return;
    }

    const latestResponse = element.querySelector<HTMLElement>('.dialog-box.chat-most-recent-response');
    if (!latestResponse) {
      element.style.removeProperty('--chat-current-response-min-height');
      return;
    }

    const dialogs = Array.from(element.querySelectorAll<HTMLElement>('.dialog-box'));
    const latestIndex = dialogs.indexOf(latestResponse);
    const secondToLast = latestIndex > 0 ? dialogs[latestIndex - 1] : null;
    const secondToLastHeight = secondToLast ? Math.min(secondToLast.offsetHeight || 150, 200) : 150;
    const minHeight = Math.max(element.clientHeight - (secondToLastHeight + 10), 0);
    element.style.setProperty('--chat-current-response-min-height', `${minHeight}px`);
  }

  private isAtBottom(element: HTMLElement, threshold: number = 30): boolean {
    return element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;
  }

  private findLatestUserDialog(container: HTMLElement): HTMLElement | null {
    const dialogs = container.querySelectorAll<HTMLElement>('.dialog-box.user');
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  private computeDialogTop(container: HTMLElement, dialog: HTMLElement): number {
    const containerRect = container.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const offsetTop = container.scrollTop + (dialogRect.top - containerRect.top);
    return Math.max(0, offsetTop);
  }
}
