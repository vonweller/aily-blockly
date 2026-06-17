/**
 * ChatActivityGroupComponent — 统一活动组渲染器
 *
 * 对标 Copilot `ChatThinkingContentPart extends ChatCollapsibleContentPart` 的结构，
 * 将 thinking/tool_call/state 等所有活动类 Part 聚合在单一可折叠组件中。
 *
 * DOM 对齐：
 *   .cag              → Copilot .chat-used-context / .chat-thinking-box
 *   button.cag-header → Copilot .chat-used-context-label button (border:0; padding:2px 6px 2px 2px)
 *   .cag-list         → Copilot .chat-used-context-list.chat-thinking-collapsible (border:none; margin-left:5px)
 *   .cag-item         → Copilot .chat-thinking-tool-wrapper / .chat-thinking-item
 *     .cag-item-icon  → Copilot .chat-thinking-icon (position:absolute; left:5px; top:9px; 12×12)
 */

import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TurnResponseTurn } from 'aily-lex/browser';

import { ChatPart, ConfirmationPart, MarkdownPart, StatePart, TerminalPart, ThinkingPart, ToolCallPart, getSubAgentInvocationId, isSubagentChildPart } from '../../core/chat-parts';
import { ChatRuntimeInteractionHostService } from '../../services/chat-runtime-interaction-host.service';
import {
  buildConfirmationActivityDisplayItem,
  buildPrimaryActivitySummary,
  buildSubagentActivityItems,
  buildActivityGroupPresentation,
  buildInvocationDetailDisplay,
  buildTerminalActivityDisplayItem,
  buildToolActivityDisplayItem,
  buildResolvedApprovalSummary,
  buildScopedMarkdownActivityDisplayItem,
  buildThinkingActivityPresentation,
  buildStateActivityShellPresentation,
  buildChatPartIdentity,
  getPreparedDetailSections,
  isSubagentToolCall,
} from './chat-activity-group-projection';
import { ChatActivityListComponent } from './chat-activity-list.component';
import type { ActivityGroupDisplayItem, ActivityGroupHeaderDisplayData } from './chat-activity-group.types';
import {
  buildTurnResponseContinuationDetailSections,
  type DetailSectionDescriptor,
} from './x-aily-state-viewer/activity-detail-items';
import { ChatPerformanceTracer } from '../../services/chat-perf-tracer';

@Component({
  selector: 'aily-chat-activity-group',
  standalone: true,
  imports: [CommonModule, ChatActivityListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="cag"
      [attr.data-state]="groupState"
      [class.cag-expanded]="expanded"
      [class.cag-fixed-streaming]="useFixedViewport"
      [class.cag-fade-top]="showDetailViewportTopFade"
      [class.cag-fade-bottom]="showDetailViewportBottomFade">
      <button
        type="button"
        class="cag-header"
        [attr.aria-expanded]="expanded"
        (click)="toggle()">
        <div class="cag-icon-shell ccenter" [class.loading-icon]="isGroupSpinning" [class.lloading]="isGroupSpinning">
          <i [class]="groupIconClass" class="cag-icon"></i>
        </div>
        @switch (groupHeader.kind) {
          @case ('subagent') {
            <span class="cag-title cag-subagent-prefix">{{ groupHeader.title }}:</span>
            @if (groupHeader.detail) {
              <span class="cag-subagent-detail cag-subtitle" [class.cag-shimmer]="isGroupSpinning && !expanded">{{ groupHeader.detail }}</span>
            }
          }
          @case ('thinking') {
            <span class="cag-group-thinking-header">
              <span class="cag-title cag-thinking-title">{{ groupHeader.title }}</span>
              @if (groupHeader.titleDetail) {
                <span class="cag-thinking-title-detail" [class.cag-shimmer]="isGroupSpinning && !expanded">{{ groupHeader.titleDetail }}</span>
              }
            </span>
          }
          @case ('tool') {
            <span class="cag-group-tool-header">
              <span class="cag-title cag-tool-group-title">{{ groupHeader.title }}</span>
              @if (groupHeader.detail) {
                <span class="cag-tool-group-detail cag-subtitle" [class.cag-shimmer]="isGroupSpinning && !expanded">{{ groupHeader.detail }}</span>
              }
            </span>
          }
          @case ('state') {
            <span class="cag-group-state-header">
              <span class="cag-title cag-state-title">{{ groupHeader.title }}</span>
              @if (groupHeader.detail) {
                <span class="cag-state-detail cag-subtitle" [class.cag-shimmer]="isGroupSpinning && !expanded">{{ groupHeader.detail }}</span>
              }
            </span>
          }
          @case ('collaboration') {
            <span class="cag-group-collaboration-header">
              <span class="cag-title cag-collaboration-title">{{ groupHeader.title }}</span>
              @if (groupHeader.detail) {
                <span class="cag-collaboration-detail cag-subtitle" [class.cag-shimmer]="isGroupSpinning && !expanded">{{ groupHeader.detail }}</span>
              }
            </span>
          }
          @default {
            <span class="cag-group-default-header">
              <span class="cag-title cag-default-title">{{ groupHeader.title }}</span>
              @if (groupHeader.detail) {
                <span class="cag-default-detail cag-subtitle" [class.cag-shimmer]="isGroupSpinning && !expanded">{{ groupHeader.detail }}</span>
              }
            </span>
          }
        }
        <span class="cag-chevron-wrap" aria-hidden="true">
          <i class="fa-light fa-chevron-down cag-chevron"></i>
        </span>
      </button>

      @if (expanded) {
        <div
          #detailViewport
          class="cag-detail-viewport"
          [class.cag-detail-viewport-fixed]="useFixedViewport"
          (scroll)="onDetailViewportScroll()">
          @if (displayItems.length) {
            <aily-chat-activity-list [items]="displayItems" [sessionId]="sessionId" />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
    }

    .cag {
      position: relative;
      margin: 2px 0;
      color: var(--chat-fg, #cccccc);
    }

    .cag.cag-expanded::after {
      content: '';
      position: absolute;
      left: 3px;
      top: 22px;
      height: 16px;
      width: 5px;
      border-left: 1px solid var(--chat-border, rgba(255,255,255,0.10));
      border-bottom: 1px solid var(--chat-border, rgba(255,255,255,0.10));
      border-bottom-left-radius: 5px;
      pointer-events: none;
    }

    .cag-header {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      width: 100%;
      min-width: 0;
      padding: 2px 6px 2px 2px;
      margin-left: -2px;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: initial;
      cursor: pointer;
      border-radius: 5px;
      transition: background 0.15s;
      min-height: 22px;
      line-height: unset;
    }

    .cag-header:hover {
      background: var(--chat-bg-hover, rgba(255,255,255,0.06));
    }

    .cag-icon-shell {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      margin-top: 1px;
    }

    .cag-icon {
      font-size: 12px;
      color: var(--chat-fg-muted, #6a6a6a);
    }

    .cag[data-state='doing'] > .cag-header .cag-icon { color: var(--chat-info, #75beff); }
    .cag[data-state='done']  > .cag-header .cag-icon { color: var(--chat-success, #89d185); }
    .cag[data-state='error'] > .cag-header .cag-icon { color: var(--chat-error, #f14c4c); }

    .cag-title {
      min-width: 0;
      font-size: 13px;
      font-weight: 500;
      color: var(--chat-fg-dim, #8e8e8e);
      line-height: 1.4;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .cag-thinking-title {
      font-weight: 500;
    }

    .cag-group-thinking-header,
    .cag-group-tool-header,
    .cag-group-state-header,
    .cag-group-collaboration-header,
    .cag-group-default-header {
      flex: 1;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      min-width: 0;
      gap: 1px 4px;
    }

    .cag-thinking-title-detail {
      min-width: 0;
      font-size: 13px;
      line-height: 1.4;
      color: var(--chat-fg-dim, #8e8e8e);
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      opacity: 0.7;
    }

    .cag-tool-group-title {
      font-weight: 500;
    }

    .cag-tool-group-detail {
      opacity: 0.7;
    }

    .cag-state-title,
    .cag-collaboration-title,
    .cag-default-title {
      font-weight: 500;
    }

    .cag-state-detail,
    .cag-collaboration-detail,
    .cag-default-detail {
      opacity: 0.7;
    }

    .cag-subtitle {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 11px;
      line-height: 1.4;
      color: var(--chat-fg-dim, #8e8e8e);
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      opacity: 0.7;
    }

    @keyframes cag-shimmer {
      0%   { background-position: 120% 0; }
      100% { background-position: -120% 0; }
    }

    .cag-shimmer {
      background: linear-gradient(90deg,
        var(--chat-fg-dim, #8e8e8e) 0%,
        var(--chat-fg-dim, #8e8e8e) 30%,
        var(--chat-shimmer, #4fc3f7) 50%,
        var(--chat-fg-dim, #8e8e8e) 70%,
        var(--chat-fg-dim, #8e8e8e) 100%);
      background-size: 400% 100%;
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: cag-shimmer 2s linear infinite;
    }

    .cag-chevron {
      font-size: 9px;
      color: var(--chat-fg-muted, #6a6a6a);
      transition: transform 0.15s ease;
    }

    .cag-chevron-wrap {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 12px;
      margin-left: auto;
      align-self: flex-start;
      padding-top: 2px;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    .cag-subtitle.cag-shimmer {
      opacity: 1;
    }

    .cag-header:hover .cag-chevron-wrap,
    .cag-header:focus-visible .cag-chevron-wrap,
    .cag-expanded .cag-chevron-wrap {
      opacity: 1;
    }

    .cag-expanded .cag-chevron {
      transform: rotate(180deg);
    }

    .cag-detail-viewport {
      position: relative;
      min-width: 0;
    }

    .cag-detail-viewport-fixed {
      max-height: 200px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--chat-border, rgba(255,255,255,0.10)) transparent;
      scrollbar-gutter: stable;
    }

    .cag.cag-fixed-streaming > .cag-detail-viewport-fixed {
      mask-image: none;
      -webkit-mask-image: none;
    }

    .cag.cag-fixed-streaming.cag-fade-top > .cag-detail-viewport-fixed {
      mask-image: linear-gradient(to bottom, transparent 0px, black 20px);
      -webkit-mask-image: linear-gradient(to bottom, transparent 0px, black 20px);
    }

    .cag.cag-fixed-streaming.cag-fade-bottom > .cag-detail-viewport-fixed {
      mask-image: linear-gradient(to top, transparent 0px, black 20px);
      -webkit-mask-image: linear-gradient(to top, transparent 0px, black 20px);
    }

    .cag.cag-fixed-streaming.cag-fade-top.cag-fade-bottom > .cag-detail-viewport-fixed {
      mask-image: linear-gradient(to bottom, transparent 0px, black 20px, black calc(100% - 20px), transparent 100%);
      -webkit-mask-image: linear-gradient(to bottom, transparent 0px, black 20px, black calc(100% - 20px), transparent 100%);
    }
  `],
})
export class ChatActivityGroupComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @Input() parts: readonly ChatPart[] = [];
  @Input() doing = false;
  @Input() sessionId = '';
  @Input() turnResponse: TurnResponseTurn | null = null;
  @ViewChild('detailViewport') private detailViewportRef?: ElementRef<HTMLElement>;

  expanded = false;
  groupState: 'doing' | 'done' | 'error' = 'doing';
  groupHeader: ActivityGroupHeaderDisplayData = { kind: 'default', title: '' };
  displayItems: ActivityGroupDisplayItem[] = [];

  private lastAutoExpanded = false;
  private detailViewportAutoScrollEnabled = true;
  private lastViewportScrollHeight = 0;
  private ignoreNextViewportScroll = false;
  private readonly runtimeInteractionHost = inject(ChatRuntimeInteractionHostService, { optional: true });
  private detailViewportSyncScheduled = false;
  private detailViewportFrameId: number | null = null;
  private detailViewportTimerId: ReturnType<typeof setTimeout> | null = null;
  showDetailViewportTopFade = false;
  showDetailViewportBottomFade = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parts'] || changes['doing'] || changes['turnResponse']) {
      this._refresh();
    }
  }

  ngAfterViewChecked(): void {
    this.scheduleDetailViewportSync();
  }

  ngOnDestroy(): void {
    if (this.detailViewportFrameId !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.detailViewportFrameId);
    }
    if (this.detailViewportTimerId !== null) {
      clearTimeout(this.detailViewportTimerId);
    }
    this.detailViewportFrameId = null;
    this.detailViewportTimerId = null;
    this.detailViewportSyncScheduled = false;
  }

  toggle(): void {
    this.expanded = !this.expanded;
    if (this.expanded && this.groupState === 'doing') {
      this.detailViewportAutoScrollEnabled = true;
      this.lastViewportScrollHeight = 0;
    }
  }

  get isGroupSpinning(): boolean {
    return this.doing;
  }

  get useFixedViewport(): boolean {
    return this.doing;
  }

  get groupIconClass(): string {
    switch (this.groupState) {
      case 'done':  return 'fa-light fa-circle-check';
      case 'error': return 'fa-light fa-circle-exclamation';
      default:      return 'fa-light fa-spinner-third';
    }
  }

  onDetailViewportScroll(): void {
    const viewport = this.detailViewportRef?.nativeElement;
    if (!viewport) {
      return;
    }

    if (this.ignoreNextViewportScroll) {
      this.ignoreNextViewportScroll = false;
      this.updateDetailViewportFades(viewport);
      return;
    }

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    this.detailViewportAutoScrollEnabled = maxScrollTop <= 0 || viewport.scrollTop >= maxScrollTop - 10;
    this.updateDetailViewportFades(viewport);
  }

  private _refresh(): void {
    if (!this.parts.length) {
      this.displayItems = [];
      return;
    }
    const refreshStartedAt = performance.now();
    const pres = buildActivityGroupPresentation(this.parts);
    const settledState = pres.state === 'doing' ? 'done' : pres.state;
    this.groupState = this.doing ? 'doing' : settledState;
    this.groupHeader = pres.header;
    this.displayItems = this._attachTurnResponseContinuation(this.parts.flatMap((part, i) => this._buildItems(part, i, this.parts)));
    this._syncExpandedState();
    ChatPerformanceTracer.recordDuration(
      'activity_group_refresh',
      performance.now() - refreshStartedAt,
      `parts=${this.parts.length},items=${this.displayItems.length},doing=${this.doing},state=${this.groupState}`,
      { slowThresholdMs: 8 },
    );
  }

  private _attachTurnResponseContinuation(items: ActivityGroupDisplayItem[]): ActivityGroupDisplayItem[] {
    const continuationSections = buildTurnResponseContinuationDetailSections({
      id: this.turnResponse?.turnId,
      continuation: this.turnResponse?.response?.continuation,
    });
    if (continuationSections.length === 0) {
      return items;
    }

    let targetIndex = -1;
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.kind === 'activity' && item.detailKind !== 'subagent') {
        targetIndex = index;
        break;
      }
    }

    if (targetIndex < 0) {
      return items;
    }

    const target = items[targetIndex];
    const detailSections = [...(target.detailSections ?? []), ...continuationSections];
    const detailKind = target.detailKind
      ?? (target.headerKind === 'tool' || target.invocationDetail || target.approval ? 'invocation' : 'state');

    return items.map((item, index) => {
      if (index !== targetIndex) {
        return item;
      }

      return {
        ...target,
        detailSections,
        detailKind,
        invocationDetail: detailKind === 'invocation'
          ? buildInvocationDetailDisplay({
              detailSections,
              postConfirmation: !!target.approvalSummary,
            })
          : target.invocationDetail,
      };
    });
  }

  private _syncExpandedState(): void {
    const shouldAutoExpand = this.doing || this.hasActivePendingInlineApproval();
    if (shouldAutoExpand === this.lastAutoExpanded) {
      return;
    }

    this.expanded = shouldAutoExpand;
    this.lastAutoExpanded = shouldAutoExpand;
    this.detailViewportAutoScrollEnabled = shouldAutoExpand;
    this.lastViewportScrollHeight = 0;
    this.showDetailViewportTopFade = false;
    this.showDetailViewportBottomFade = false;
  }

  private hasActivePendingInlineApproval(): boolean {
    if (!this.sessionId || !this.displayItems.length) {
      return false;
    }

    const activeConfirmation = this.runtimeInteractionHost?.getActiveConfirmation(this.sessionId);
    if (!activeConfirmation) {
      return false;
    }

    return this.displayItems.some((item) => {
      const approval = item.approval;
      if (!approval || approval.resolved === true) {
        return false;
      }

      if (activeConfirmation.partId && approval.partId) {
        return activeConfirmation.partId === approval.partId;
      }

      if (activeConfirmation.askId && approval.askId) {
        return activeConfirmation.askId === approval.askId;
      }

      if (activeConfirmation.toolCallId && approval.toolCallId) {
        return activeConfirmation.toolCallId === approval.toolCallId;
      }

      return false;
    });
  }

  private _syncDetailViewportScroll(): void {
    const syncStartedAt = performance.now();
    const recordSync = (detail: string): void => {
      ChatPerformanceTracer.recordDuration(
        'activity_group_scroll_sync',
        performance.now() - syncStartedAt,
        detail,
        { slowThresholdMs: 8 },
      );
    };

    if (!this.expanded || !this.useFixedViewport) {
      this.showDetailViewportTopFade = false;
      this.showDetailViewportBottomFade = false;
      recordSync('not-fixed');
      return;
    }

    const viewport = this.detailViewportRef?.nativeElement;
    if (!viewport) {
      recordSync('missing-viewport');
      return;
    }

    const scrollHeight = viewport.scrollHeight;
    if (!scrollHeight) {
      recordSync('empty-scroll-height');
      return;
    }

    if (scrollHeight === this.lastViewportScrollHeight && !this.detailViewportAutoScrollEnabled) {
      recordSync('unchanged-disabled');
      return;
    }

    this.lastViewportScrollHeight = scrollHeight;
    if (!this.detailViewportAutoScrollEnabled) {
      this.updateDetailViewportFades(viewport);
      recordSync('manual-scroll');
      return;
    }

    const maxScrollTop = Math.max(0, scrollHeight - viewport.clientHeight);
    if (maxScrollTop <= 0 || viewport.scrollTop >= maxScrollTop - 1) {
      this.updateDetailViewportFades(viewport);
      recordSync('already-bottom');
      return;
    }

    this.ignoreNextViewportScroll = true;
    viewport.scrollTop = maxScrollTop;
    this.updateDetailViewportFades(viewport);
    recordSync('auto-scroll');
  }

  private scheduleDetailViewportSync(): void {
    if (this.detailViewportSyncScheduled) {
      return;
    }

    this.detailViewportSyncScheduled = true;
    const callback = (): void => {
      this.detailViewportSyncScheduled = false;
      this.detailViewportFrameId = null;
      this.detailViewportTimerId = null;
      this._syncDetailViewportScroll();
    };

    if (typeof globalThis.requestAnimationFrame === 'function') {
      this.detailViewportFrameId = globalThis.requestAnimationFrame(callback);
      return;
    }

    this.detailViewportTimerId = setTimeout(callback, 16);
  }

  private updateDetailViewportFades(viewport: HTMLElement): void {
    if (!this.useFixedViewport) {
      this.showDetailViewportTopFade = false;
      this.showDetailViewportBottomFade = false;
      return;
    }

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    this.showDetailViewportTopFade = maxScrollTop > 0 && viewport.scrollTop > 5;
    this.showDetailViewportBottomFade = maxScrollTop > 0 && viewport.scrollTop < maxScrollTop - 5;
  }

  private _buildItems(part: ChatPart, index: number, groupParts: readonly ChatPart[]): ActivityGroupDisplayItem[] {
    const id = buildChatPartIdentity(part, index);

    if (part.type === 'markdown' && isSubagentChildPart(part)) {
      return [buildScopedMarkdownActivityDisplayItem(part as MarkdownPart, { id })];
    }

    if (part.type === 'thinking') {
      const tp = part as ThinkingPart;
      const isSpinning = !tp.isComplete;
      const thinking = buildThinkingActivityPresentation(tp);
      return [{
        id,
        kind: 'thinking',
        iconClass: thinking.iconClass,
        isSpinning,
        iconColor: thinking.iconColor,
        kicker: thinking.kicker,
        label: thinking.label,
        note: thinking.note,
        thinking: thinking.thinking,
        pill: '',
        pillTone: 'neutral',
      }];
    }

    if (part.type === 'tool_call') {
      if (isSubagentToolCall(part)) {
        if (hasScopedSubagentChildren(groupParts, part)) {
          return [];
        }
        return [...buildSubagentActivityItems(part)];
      }

      return [buildToolActivityDisplayItem(part as ToolCallPart, { id })];
    }

    if (part.type === 'confirmation') {
      return [buildConfirmationActivityDisplayItem(part as ConfirmationPart, { id })];
    }

    if (part.type === 'terminal') {
      return [buildTerminalActivityDisplayItem(part as TerminalPart, { id })];
    }

    if (part.type === 'state') {
      const sp = part as StatePart;
      const isSpinning = sp.state === 'doing';
      const activitySummary = buildPrimaryActivitySummary(part);
      const useEmbeddedStateBody = sp.kind === 'instructions';
      const detailSections = useEmbeddedStateBody ? undefined : getPreparedDetailSections(part);
      const shell = buildStateActivityShellPresentation({
        state: sp.state,
        defaultKicker: activitySummary?.kicker,
      });
      return [{
        id,
        kind: 'activity',
        iconClass: shell.iconClass,
        isSpinning,
        iconColor: shell.iconColor,
        kicker: shell.kicker,
        label: sp.text || '任务',
        subtitle: activitySummary?.subtitle,
        note: undefined,
        pill: shell.pill,
        pillTone: shell.pillTone,
        children: undefined,
        detailSections,
        detailExpanded: useEmbeddedStateBody,
        detailKind: detailSections?.length || useEmbeddedStateBody ? 'state' : undefined,
        instructionMetadata: useEmbeddedStateBody ? (sp.metadata || null) : undefined,
      }];
    }

    return [{
      id,
      kind: 'activity',
      iconClass: 'fa-light fa-circle',
      isSpinning: false,
      iconColor: 'var(--chat-fg-muted)',
      label: '项目',
      subtitle: '',
      note: '',
      pill: '',
      pillTone: 'neutral',
    }];
  }
}

function hasScopedSubagentChildren(parts: readonly ChatPart[], parent: ToolCallPart): boolean {
  const subAgentInvocationId = getSubAgentInvocationId(parent) || parent.toolCallId;
  return parts.some((part) => part !== parent
    && isSubagentChildPart(part)
    && getSubAgentInvocationId(part) === subAgentInvocationId);
}
