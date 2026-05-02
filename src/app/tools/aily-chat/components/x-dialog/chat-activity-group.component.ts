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
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatPart, ConfirmationPart, StatePart, TerminalPart, ThinkingPart, ToolCallPart } from '../../core/chat-parts';
import {
  buildConfirmationActivityDisplayItem,
  buildPrimaryActivitySummary,
  buildSubagentActivityItems,
  buildActivityGroupPresentation,
  buildTerminalActivityDisplayItem,
  buildToolActivityDisplayItem,
  buildResolvedApprovalSummary,
  buildThinkingActivityPresentation,
  buildStateActivityShellPresentation,
  buildChatPartIdentity,
  getPreparedDetailSections,
  isSubagentToolCall,
} from './chat-activity-group-projection';
import { ChatActivityListComponent } from './chat-activity-list.component';
import type { ActivityGroupDisplayItem, ActivityGroupHeaderDisplayData } from './chat-activity-group.types';
import type { DetailSectionDescriptor } from './x-aily-state-viewer/activity-detail-items';

@Component({
  selector: 'aily-chat-activity-group',
  standalone: true,
  imports: [CommonModule, ChatActivityListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cag" [attr.data-state]="groupState" [class.cag-expanded]="expanded">
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
        <aily-chat-activity-list [items]="displayItems" />
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
      border-radius: 3px;
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
      font-size: 13px;
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
  `],
})
export class ChatActivityGroupComponent implements OnChanges {
  @Input() parts: readonly ChatPart[] = [];
  @Input() doing = false;

  expanded = false;
  groupState: 'doing' | 'done' | 'error' = 'doing';
  groupHeader: ActivityGroupHeaderDisplayData = { kind: 'default', title: '' };
  displayItems: ActivityGroupDisplayItem[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parts'] || changes['doing']) {
      this._refresh();
    }
  }

  toggle(): void {
    this.expanded = !this.expanded;
  }

  get isGroupSpinning(): boolean {
    return this.groupState === 'doing';
  }

  get groupIconClass(): string {
    switch (this.groupState) {
      case 'done':  return 'fa-light fa-circle-check';
      case 'error': return 'fa-light fa-circle-exclamation';
      default:      return 'fa-light fa-spinner-third';
    }
  }

  private _refresh(): void {
    if (!this.parts.length) {
      return;
    }
    const pres = buildActivityGroupPresentation(this.parts);
    this.groupState = pres.state;
    this.groupHeader = pres.header;
    this.displayItems = this.parts.flatMap((part, i) => this._buildItems(part, i));
  }

  private _buildItems(part: ChatPart, index: number): ActivityGroupDisplayItem[] {
    const id = buildChatPartIdentity(part, index);

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
        pill: '',
        pillTone: 'neutral',
      }];
    }

    if (part.type === 'tool_call') {
      if (isSubagentToolCall(part)) {
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
