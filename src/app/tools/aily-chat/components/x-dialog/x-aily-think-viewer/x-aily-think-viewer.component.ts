import {
  Component,
  Input,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { XMarkdownComponent } from 'ngx-x-markdown';
import type { StreamingOption, ComponentMap } from 'ngx-x-markdown';
import { AilyChatCodeComponent } from '../aily-chat-code.component';
import { getClosingTagsForOpenBlocks } from '../../../services/content-sanitizer.service';
import { getThinkContent } from '../../../core/think-content-store';

@Component({
  selector: 'x-aily-think-viewer',
  standalone: true,
  imports: [CommonModule, XMarkdownComponent],
  template: `
    <div class="ac-think" [class.expanded]="thinkExpanded" [class.streaming]="data?.isComplete === false">
      <div class="ac-think-header" (click)="thinkExpanded = !thinkExpanded">
        @if (data?.isComplete) {
          <i class="fa-light fa-circle-check ac-think-icon done"></i>
        } @else {
          <i class="fa-duotone fa-solid fa-loader ac-think-icon loading ac-spin"></i>
        }
        <span class="ac-think-label" [class.ac-think-shimmer]="data?.isComplete === false && !thinkExpanded">
          {{ displayLabel }}
        </span>
        <i class="fa-light fa-chevron-down ac-think-arrow"></i>
      </div>
      @if (thinkExpanded) {
        <div class="ac-think-body" #thinkBody (scroll)="onThinkBodyScroll($event)">
          @if (markdownContent()) {
            <x-markdown
              [content]="markdownContent()"
              [streaming]="streamingConfig()"
              [components]="componentMap"
              rootClassName="x-markdown-dark"
            />
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      /* ===== Semantic CSS Variables ===== */
      :host {
        display: block;
        width: 100%;
        min-width: 0;
        --ac-think-bg: #3a3a3a;
        --ac-think-fg: #ccc;
        --ac-think-fg-dim: #999;
        --ac-think-fg-heading: #bbb;
        --ac-think-accent: #1890ff;
        --ac-think-success: #52c41a;
        --ac-think-border: rgba(255, 255, 255, 0.08);
        --ac-think-connector: rgba(255, 255, 255, 0.15);
        --ac-think-shimmer: #4fc3f7;
        --ac-think-hover: rgba(255, 255, 255, 0.05);
      }

      .ac-think {
        border-radius: 5px;
        padding: 5px 10px;
        margin: 0;
        overflow: hidden;
        background-color: var(--ac-think-bg);
        color: var(--ac-think-fg);
      }
      .ac-think-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        cursor: pointer;
        font-size: 13px;
        user-select: none;
        transition: background 0.2s;
      }
      .ac-think-header:hover {
        background: var(--ac-think-hover);
        margin: -5px -10px;
        padding: 5px 10px;
      }
      .ac-think-icon { flex-shrink: 0; margin-right: 5px; }
      .ac-think-icon.loading { color: var(--ac-think-accent); }
      .ac-think-icon.done { color: var(--ac-think-success); }

      /* ===== Shimmer Animation (VS Code style) ===== */
      @keyframes ac-think-shimmer {
        0% { background-position: 120% 0; }
        100% { background-position: -120% 0; }
      }
      .ac-think-shimmer {
        background: linear-gradient(90deg,
          var(--ac-think-fg) 0%, var(--ac-think-fg) 30%,
          var(--ac-think-shimmer) 50%,
          var(--ac-think-fg) 70%, var(--ac-think-fg) 100%);
        background-size: 400% 100%;
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: ac-think-shimmer 2s linear infinite;
      }

      .ac-think-arrow {
        margin-left: auto;
        font-size: 10px;
        color: #888;
        transition: transform 0.2s;
      }
      .ac-think.expanded .ac-think-arrow {
        transform: rotate(180deg);
      }

      /* ===== Chain-of-thought Connector Line ===== */
      .ac-think-body {
        position: relative;
        padding: 8px 2px 8px 18px;
        margin: 5px -10px 0 0;
        max-height: 200px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        scrollbar-gutter: stable;
        user-select: text;
      }
      .ac-think-body::before {
        content: '';
        position: absolute;
        left: 4px;
        top: 0;
        bottom: 0;
        width: 1px;
        background-color: var(--ac-think-connector);
        mask-image: linear-gradient(to bottom,
          transparent 0px, #000 8px, #000 calc(100% - 8px), transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom,
          transparent 0px, #000 8px, #000 calc(100% - 8px), transparent 100%);
      }

      /* ===== Curved connector from header to body ===== */
      .ac-think.expanded.streaming .ac-think-header::after {
        content: '';
        position: absolute;
        left: 13px;
        top: 22px;
        height: 12px;
        width: 5px;
        border-left: 1px solid var(--ac-think-connector);
        border-bottom: 1px solid var(--ac-think-connector);
        border-bottom-left-radius: 5px;
      }

      :host ::ng-deep .ac-think-body .x-markdown-dark {
        font-size: 13px;
        line-height: 1.5;
        color: var(--ac-think-fg-dim);
        word-break: break-word;
        overflow-wrap: anywhere;
        white-space: normal;
        max-width: 100%;
        min-width: 0;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark * {
        max-width: 100%;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark p {
        margin: 2px 0;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark h1,
      :host ::ng-deep .ac-think-body .x-markdown-dark h2,
      :host ::ng-deep .ac-think-body .x-markdown-dark h3,
      :host ::ng-deep .ac-think-body .x-markdown-dark h4 {
        font-size: 13px;
        font-weight: 600;
        color: var(--ac-think-fg-heading);
        margin: 4px 0 2px;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark h2 {
        border-left: 4px solid #3794ff;
        padding-left: 6px;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark ul,
      :host ::ng-deep .ac-think-body .x-markdown-dark ol {
        padding-left: 1.2em;
        margin: 2px 0;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark pre {
        max-width: 100%;
        overflow-x: auto;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark table {
        max-width: 100%;
        display: block;
        overflow-x: auto;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark th,
      :host ::ng-deep .ac-think-body .x-markdown-dark td {
        padding: 4px 8px;
        font-size: 12px;
      }
      :host ::ng-deep .ac-think-body .x-markdown-dark blockquote {
        margin: 4px 0;
        padding: 2px 8px;
      }
      @keyframes ac-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .ac-spin {
        animation: ac-spin 0.8s linear infinite;
        display: inline-block;
      }
    `,
  ],
})
export class XAilyThinkViewerComponent implements AfterViewChecked, OnChanges, OnDestroy {
  @Input() data: {
    content?: string;
    encoded?: boolean;
    isComplete?: boolean;
    ref?: string;
    v?: number;
  } | null = null;
  @ViewChild('thinkBody') thinkBodyRef?: ElementRef<HTMLElement>;

  thinkContent = '';
  thinkExpanded = false;
  markdownContent = signal('');
  streamingConfig = signal<StreamingOption>({ hasNextChunk: false, enableAnimation: false });
  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };
  private shouldScrollThink = false;
  /** 用户未主动上滚时跟随流式到底部 */
  private thinkStickToBottom = true;
  private readonly thinkScrollBottomThresholdPx = 48;

  // ===== Title extraction & rotating phrases =====
  private _extractedTitle = '';
  private readonly _phrases = ['Thinking...', 'Reasoning...', 'Analyzing...', 'Considering...', 'Evaluating...'];
  private _phraseIndex = 0;
  private _phraseTimer: ReturnType<typeof setInterval> | null = null;
  displayLabel = 'Thinking...';

  /** 从 think 内容开头提取 **粗体标题** */
  private _extractTitle(content: string): string {
    if (!content) return '';
    const match = content.match(/^\s*\*\*([^*]+)\*\*/);
    return match ? match[1].trim() : '';
  }

  /** 更新显示标签：完成时显示提取的标题或 "Thought"，流式中显示旋转短语 */
  private _updateLabel(): void {
    if (this.data?.isComplete) {
      this.displayLabel = this._extractedTitle || 'Thought';
      this._stopPhraseRotation();
    } else {
      this.displayLabel = this._phrases[this._phraseIndex];
    }
  }

  private _startPhraseRotation(): void {
    if (this._phraseTimer) return;
    this._phraseTimer = setInterval(() => {
      this._phraseIndex = (this._phraseIndex + 1) % this._phrases.length;
      this.displayLabel = this._phrases[this._phraseIndex];
    }, 3000);
  }

  private _stopPhraseRotation(): void {
    if (this._phraseTimer) {
      clearInterval(this._phraseTimer);
      this._phraseTimer = null;
    }
  }

  // ===== Throttle state =====
  private _pendingRaw: string | null = null;
  private _throttleTimerId: ReturnType<typeof setTimeout> | null = null;
  private _lastRenderedRawLen = 0;

  // ===== Polling: 因 v 字段已移除，x-markdown 不再逐帧触发 ngOnChanges =====
  // think viewer 需自行轮询 store 获取最新内容
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['data'] || !this.data) return;

    const prevData = changes['data'].previousValue as { isComplete?: boolean } | null | undefined;
    const prevStreaming = prevData && prevData.isComplete === false;

    // 首次进入流式：重置滚动状态
    if (this.data.isComplete === false && !prevStreaming) {
      this.thinkStickToBottom = true;
    }

    // 获取原始内容
    let raw = '';
    if (this.data.ref) {
      raw = getThinkContent(this.data.ref);
    } else if (this.data.encoded && this.data.content) {
      try {
        raw = decodeURIComponent(atob(this.data.content));
      } catch {
        raw = this.data.content;
      }
    } else {
      raw = this.data.content || '';
    }

    this.thinkContent = raw;

    // 提取标题（每次内容更新时尝试）
    if (!this._extractedTitle && raw.length > 10) {
      this._extractedTitle = this._extractTitle(raw);
    }

    // ★ 关键修复：isComplete 变化时立即渲染（不做节流）
    if (this.data.isComplete === true && prevStreaming) {
      this._stopPolling();
      this._cancelThrottle();
      this._renderNow(raw, true);
      this.thinkExpanded = false;
      this._updateLabel();
      return;
    }

    if (this.data.isComplete === true) {
      this._stopPolling();
      this._updateLabel();
      // ★ 修复：首次以 isComplete=true 渲染时（历史/finalize），必须调用 _renderNow
      // 之前仅在 streaming→done 转换时渲染，直接 isComplete=true 时 raw 被计算但未渲染
      this._renderNow(raw, true);
      return;
    }

    if (!this.data.isComplete) {
      this.thinkExpanded = true;
      this.shouldScrollThink = true;
      this._scheduleRender(raw);
      this._startPhraseRotation();
      // 启动轮询：v 字段已移除，x-markdown 不再驱动 ngOnChanges，需自行拉取 store
      this._startPolling();
    }
  }

  /**
   * ★ 核心修复：节流渲染
   *
   * 问题：每个 think chunk 都触发 ngOnChanges → markdownContent.set() → x-markdown 全量 parse
   * 日志显示 2715 次 set()，平均每次 ~10ms，大量重复 work
   *
   * 修复：
   * - 存储最新 raw → _pendingRaw
   * - 如果距上次渲染增长 <500 bytes，跳过（batch 进 pending）
   * - 已在 pending 时不再重复 schedule
   * - 100ms 后在 rAF 中渲染
   *
   * 效果：think 内容每 100ms 最多 render 一次，每次只处理 500+ bytes 增量
   */
  private _scheduleRender(raw: string): void {
    const rawLen = raw.length;
    const prevRendered = this._lastRenderedRawLen;

    // 立即渲染的条件：
    // 1. 距上次渲染增长了 500+ bytes
    // 2. 这是第一次渲染（_lastRenderedRawLen === 0）
    // 3. 内容已完成（isComplete）
    if (rawLen >= prevRendered + 500 || prevRendered === 0) {
      this._cancelThrottle();
      this._renderNow(raw, false);
      return;
    }

    this._pendingRaw = raw;

    if (this._throttleTimerId !== null) return; // 已有 pending

    this._throttleTimerId = setTimeout(() => {
      this._throttleTimerId = null;
      if (this._pendingRaw !== null) {
        const pending = this._pendingRaw;
        this._pendingRaw = null;
        this._renderNow(pending, false);
      }
    }, 100);
  }

  private _cancelThrottle(): void {
    if (this._throttleTimerId !== null) {
      clearTimeout(this._throttleTimerId);
      this._throttleTimerId = null;
    }
    this._pendingRaw = null;
  }

  /** 启动轮询：每 200ms 从 store 读取最新 think 内容 */
  private _startPolling(): void {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => {
      if (!this.data?.ref || this.data.isComplete) {
        this._stopPolling();
        return;
      }
      const raw = getThinkContent(this.data.ref);
      if (raw && raw.length !== this._lastRenderedRawLen) {
        this.thinkContent = raw;
        this.shouldScrollThink = true;
        this._scheduleRender(raw);
      }
    }, 200);
  }

  /** 停止轮询 */
  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _renderNow(raw: string, isFinal: boolean): void {
    if (!raw) {
      this.markdownContent.set('');
      this._lastRenderedRawLen = 0;
      return;
    }

    // 非完成状态：追加闭合标签（修复流式过程中的 markdown 截断）
    const displayContent = isFinal ? raw : raw + getClosingTagsForOpenBlocks(raw);
    this.markdownContent.set(displayContent);
    this._lastRenderedRawLen = raw.length;
  }

  onThinkBodyScroll(event: Event): void {
    const el = event.target as HTMLElement | null;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.thinkStickToBottom = dist <= this.thinkScrollBottomThresholdPx;
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollThink && this.thinkBodyRef?.nativeElement) {
      const el = this.thinkBodyRef.nativeElement;
      if (this.thinkStickToBottom) {
        el.scrollTop = el.scrollHeight;
      }
      this.shouldScrollThink = false;
    }
  }

  ngOnDestroy(): void {
    this._cancelThrottle();
    this._stopPolling();
    this._stopPhraseRotation();
  }
}
