/**
 * ChatSubagentPartComponent — 内联子Agent可折叠渲染器
 *
 * VS Code Copilot Chat 风格：折叠面板 + 结构化子项（think / tool / text）。
 * 工具调用以简化的 aily-state 指示器渲染，而非纯文本。
 */

import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { XMarkdownComponent } from 'ngx-x-markdown';
import type { StreamingOption, ComponentMap } from 'ngx-x-markdown';
import { AilyChatCodeComponent } from '../aily-chat-code.component';
import { XAilyThinkViewerComponent } from '../x-aily-think-viewer/x-aily-think-viewer.component';
import type { SubagentChildItem } from '../../../core/chat-parts';

interface SubagentTimelineViewItem {
  id: string;
  phaseLabel: string;
  timeLabel?: string;
  note?: string;
  tone: 'info' | 'success' | 'warn' | 'error' | 'neutral';
}

@Component({
  selector: 'aily-chat-subagent-part',
  standalone: true,
  imports: [CommonModule, XMarkdownComponent, XAilyThinkViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sa" [class.expanded]="expanded" [class.streaming]="state === 'doing'">
      <div class="sa-header" (click)="expanded = !expanded">
        @if (state === 'doing') {
          <i class="fa-duotone fa-solid fa-loader sa-icon loading ac-spin"></i>
        } @else if (state === 'error') {
          <i class="fa-light fa-circle-xmark sa-icon error"></i>
        } @else {
          <i class="fa-light fa-check sa-icon done"></i>
        }
        <span class="sa-label" [class.shimmer]="state === 'doing'">
          {{ state === 'doing' ? headerLabel() : agentName }}
        </span>
        @if (description && state === 'doing') {
          <span class="sa-desc">{{ description }}</span>
        }
        <i class="fa-light fa-chevron-down sa-arrow"></i>
      </div>
      @if (expanded) {
        <div class="sa-body">
          @for (item of childItems; track $index) {
            @switch (item.kind) {
              @case ('thinking') {
                <x-aily-think-viewer
                  class="sa-child"
                  [data]="{ content: item.content, isComplete: state !== 'doing' || !isLastItem($index) }"
                />
              }
              @case ('tool') {
                <div class="sa-child sa-tool" [attr.data-tool-state]="item.state">
                  @if (item.state === 'doing') {
                    <i class="fa-light fa-spinner-third sa-tool-icon ac-spin"></i>
                  } @else if (item.state === 'error') {
                    <i class="fa-light fa-circle-xmark sa-tool-icon"></i>
                  } @else {
                    <i class="fa-light fa-circle-check sa-tool-icon"></i>
                  }
                  <span class="sa-tool-name">{{ item.toolName }}</span>
                  @if (item.argsSummary) {
                    <span class="sa-tool-args">{{ item.argsSummary }}</span>
                  }
                  @if (item.duration != null) {
                    <span class="sa-tool-dur">{{ item.duration }}s</span>
                  }
                </div>
              }
              @case ('text') {
                <x-markdown
                  class="sa-child"
                  [content]="item.content"
                  [streaming]="getTextStreaming($index)"
                  [components]="componentMap"
                  rootClassName="x-markdown-dark"
                />
              }
            }
          }
          @if ((!childItems || childItems.length === 0) && state === 'doing') {
            <div class="sa-child sa-placeholder">Working...</div>
          }

          @if (timelineItems.length > 1) {
            <div class="sa-timeline">
              <div class="sa-timeline-title">历史时间线</div>
              @for (item of timelineItems; track item.id) {
                <div class="sa-timeline-item" [attr.data-tone]="item.tone">
                  <div class="sa-timeline-head">
                    <span class="sa-timeline-phase">{{ item.phaseLabel }}</span>
                    @if (item.timeLabel) {
                      <span class="sa-timeline-time">{{ item.timeLabel }}</span>
                    }
                  </div>
                  @if (item.note) {
                    <div class="sa-timeline-note">{{ item.note }}</div>
                  }
                </div>
              }
            </div>
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

    .sa {
      position: relative;
      margin: 0;
      padding: 0;
      border-radius: 5px;
      background-color: #3a3a3a;
      overflow: hidden;
    }

    .sa-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 13px;
      color: #ccc;
      user-select: none;
      transition: background 0.15s;
    }

    .sa-header:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .sa-icon {
      flex-shrink: 0;
      font-size: 14px;
      width: 14px;
      text-align: center;
      margin-right: 5px;
    }

    .sa-icon.loading { color: #1890ff; }
    .sa-icon.done    { color: #52c41a; }
    .sa-icon.error   { color: #ff4d4f; }

    .sa-label {
      font-size: 13px;
      font-weight: 400;
      color: #ccc;
    }

    @keyframes sa-shimmer {
      0%   { background-position: 120% 0; }
      100% { background-position: -120% 0; }
    }

    .sa-label.shimmer {
      background: linear-gradient(90deg,
        #ccc 0%, #ccc 30%,
        #4fc3f7 50%,
        #ccc 70%, #ccc 100%);
      background-size: 400% 100%;
      background-clip: text;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: sa-shimmer 2s linear infinite;
    }

    .sa-desc {
      color: #888;
      font-size: 11px;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sa-arrow {
      margin-left: auto;
      font-size: 10px;
      color: #888;
      transition: transform 0.2s;
    }

    .sa.expanded .sa-arrow {
      transform: rotate(180deg);
    }

    /* 展开区 — 左侧连接线 */
    .sa-body {
      position: relative;
      padding: 8px 2px 8px 18px;
      margin: 0 0 0 0;
      max-height: 400px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
    }

    .sa-body::before {
      content: '';
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      width: 1px;
      background-color: rgba(255, 255, 255, 0.15);
      mask-image: linear-gradient(to bottom,
        transparent 0px, #000 8px, #000 calc(100% - 8px), transparent 100%);
      -webkit-mask-image: linear-gradient(to bottom,
        transparent 0px, #000 8px, #000 calc(100% - 8px), transparent 100%);
    }

    .sa-child {
      margin-bottom: 2px;
    }

    /* ===== Tool 指示器（简化版 aily-state） ===== */
    .sa-tool {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 2px 0;
      font-size: 13px;
      color: #bbb;
    }

    .sa-tool-icon {
      flex-shrink: 0;
      font-size: 13px;
      width: 14px;
      text-align: center;
    }

    .sa-tool[data-tool-state='doing'] .sa-tool-icon { color: #1890ff; }
    .sa-tool[data-tool-state='done']  .sa-tool-icon { color: #52c41a; }
    .sa-tool[data-tool-state='error'] .sa-tool-icon { color: #ff4d4f; }

    .sa-tool-name {
      font-size: 13px;
      color: #bbb;
    }

    .sa-tool-args {
      flex: 1;
      width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      color: #888;
    }

    .sa-tool-dur {
      flex-shrink: 0;
      font-size: 11px;
      color: #666;
    }

    .sa-placeholder {
      font-size: 12px;
      color: #888;
      padding: 4px 0;
    }

    .sa-timeline {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .sa-timeline-title {
      font-size: 11px;
      font-weight: 600;
      color: #8e8e8e;
      letter-spacing: 0.02em;
    }

    .sa-timeline-item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 6px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .sa-timeline-item[data-tone='info'] {
      border-left: 2px solid rgba(145, 202, 255, 0.55);
    }

    .sa-timeline-item[data-tone='success'] {
      border-left: 2px solid rgba(183, 235, 143, 0.6);
    }

    .sa-timeline-item[data-tone='warn'] {
      border-left: 2px solid rgba(255, 214, 102, 0.65);
    }

    .sa-timeline-item[data-tone='error'] {
      border-left: 2px solid rgba(255, 156, 156, 0.7);
    }

    .sa-timeline-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .sa-timeline-phase {
      color: #ededed;
      font-size: 12px;
      font-weight: 500;
    }

    .sa-timeline-time {
      color: #8e8e8e;
      font-size: 11px;
    }

    .sa-timeline-note {
      color: #c8c8c8;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    :host ::ng-deep .sa-body .x-markdown-dark {
      font-size: 13px;
      line-height: 1.5;
      color: #bbb;
    }

    @keyframes ac-spin { to { transform: rotate(360deg); } }
    .ac-spin { animation: ac-spin 0.8s linear infinite; display: inline-block; }
  `],
})
export class ChatSubagentPartComponent implements OnChanges {
  @Input() agentName = 'Agent';
  @Input() description = '';
  @Input() state: 'doing' | 'done' | 'error' = 'doing';
  @Input() resultText = '';
  @Input() childItems: SubagentChildItem[] = [];
  @Input() metadata: Record<string, unknown> | null = null;

  expanded = false;
  headerLabel = signal('Agent...');
  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };
  timelineItems: SubagentTimelineViewItem[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['state']) {
      if (this.state === 'doing') {
        this.expanded = true;
      } else if (this.state === 'done' || this.state === 'error') {
        this.expanded = false;
      }
    }

    // 更新 header label（显示当前正在执行的工具）
    if (changes['childItems'] || changes['state']) {
      this._updateHeaderLabel();
    }

    if (changes['metadata']) {
      this._updateTimelineItems();
    }
  }

  isLastItem(index: number): boolean {
    return index === this.childItems.length - 1;
  }

  getTextStreaming(index: number): StreamingOption {
    const isLast = this.isLastItem(index);
    return {
      hasNextChunk: isLast && this.state === 'doing',
      enableAnimation: isLast && this.state === 'doing',
    };
  }

  private _updateHeaderLabel(): void {
    if (this.state !== 'doing') {
      this.headerLabel.set(this.agentName);
      return;
    }
    // 找到最后一个正在执行的工具名称
    const items = this.childItems || [];
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === 'tool' && items[i].state === 'doing') {
        this.headerLabel.set(`${this.agentName} · ${items[i].toolName}...`);
        return;
      }
    }
    this.headerLabel.set(`${this.agentName}...`);
  }

  private _updateTimelineItems(): void {
    const timeline = this.asArray(this.metadata?.['timeline'])
      .map(item => this.asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item);

    this.timelineItems = timeline.map((item, index) => this.toTimelineItem(item, index));
  }

  private toTimelineItem(entry: Record<string, unknown>, index: number): SubagentTimelineViewItem {
    const recordId = this.asString(entry['recordId']) || `subagent-timeline-${index}`;
    const phase = this.asString(entry['phase']);
    const timestamp = this.asNumber(entry['timestamp']);
    const summary = this.asString(entry['summary']);
    const activity = this.asRecord(entry['activity']);

    return {
      id: recordId,
      phaseLabel: this.formatNarrativePhase(phase),
      timeLabel: this.formatClock(timestamp),
      note: this.buildTimelineNote(summary, activity),
      tone: this.toneFromNarrativePhase(phase),
    };
  }

  private buildTimelineNote(summary?: string, activity?: Record<string, unknown>): string | undefined {
    const notes: string[] = [];
    const pushNote = (value: string | undefined): void => {
      if (!value || notes.includes(value)) {
        return;
      }
      notes.push(value);
    };

    pushNote(summary);
    if (activity) {
      const kind = this.asString(activity['kind']);
      switch (kind) {
        case 'thinking':
        case 'text':
        case 'error':
          pushNote(this.asString(activity['content']));
          break;
        case 'tool_started': {
          const toolName = this.asString(activity['toolName']);
          const argsSummary = this.asString(activity['argsSummary']);
          pushNote([toolName ? `启动 ${toolName}` : '启动子工具', argsSummary].filter(Boolean).join(' · '));
          break;
        }
        case 'tool_completed':
        case 'tool_failed': {
          const toolName = this.asString(activity['toolName']);
          const resultText = this.asString(activity['resultText']);
          const durationMs = this.asNumber(activity['durationMs']);
          const durationText = typeof durationMs === 'number'
            ? `${Math.round(durationMs / 100) / 10}s`
            : undefined;
          pushNote([
            toolName ? `${kind === 'tool_failed' ? '失败' : '完成'} ${toolName}` : undefined,
            durationText,
            resultText,
          ].filter(Boolean).join(' · '));
          break;
        }
        default:
          break;
      }
    }

    return notes.length > 0 ? notes.join('\n') : undefined;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private formatNarrativePhase(phase?: string): string {
    const map: Record<string, string> = {
      started: '开始',
      progress: '进度',
      completed: '完成',
      failed: '失败',
      cancelled: '取消',
    };
    return map[phase || ''] || (phase || '事件');
  }

  private toneFromNarrativePhase(phase?: string): SubagentTimelineViewItem['tone'] {
    switch (phase) {
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'warn';
      case 'started':
      case 'progress':
        return 'info';
      default:
        return 'neutral';
    }
  }

  private formatClock(timestamp?: number): string | undefined {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      return undefined;
    }

    const date = new Date(timestamp);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}
