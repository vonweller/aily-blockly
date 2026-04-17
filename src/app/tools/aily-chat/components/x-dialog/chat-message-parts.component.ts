/**
 * ChatMessagePartsComponent — Part-based 消息渲染容器
 *
 * 直接消费 ChatPart[] 数组，按类型路由到对应的渲染器。
 * 与 x-dialog 的 preprocess → x-markdown → aily-chat-code 路径并行工作。
 *
 * Phase 1 支持：
 *   - MarkdownPart → x-markdown（保持现有 markdown 渲染）
 *   - ThinkingPart → x-aily-think-viewer（直接传入结构化数据）
 *   - ToolCallPart → x-aily-state-viewer（直接传入结构化数据）
 *   - ErrorPart → x-aily-error-viewer
 */

import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { XMarkdownComponent } from 'ngx-x-markdown';
import type { StreamingOption, ComponentMap } from 'ngx-x-markdown';
import { Subscription } from 'rxjs';

import { ChatPart, MarkdownPart, ThinkingPart, ToolCallPart, StatePart, ErrorPart, QuestionPart, ApprovalPart, TerminalPart, SubagentPart } from '../../core/chat-parts';
import { ChatPartStore, PartChange } from '../../core/chat-part-store';
import { AilyChatCodeComponent } from './aily-chat-code.component';
import { XAilyThinkViewerComponent } from './x-aily-think-viewer/x-aily-think-viewer.component';
import { XAilyStateViewerComponent } from './x-aily-state-viewer/x-aily-state-viewer.component';
import { XAilyErrorViewerComponent } from './x-aily-error-viewer/x-aily-error-viewer.component';
import { XAilyQuestionViewerComponent } from './x-aily-question-viewer/x-aily-question-viewer.component';
import { XAilyApprovalViewerComponent } from './x-aily-approval-viewer/x-aily-approval-viewer.component';
import { ChatTerminalPartComponent } from './chat-terminal-part/chat-terminal-part.component';
import { ChatSubagentPartComponent } from './chat-subagent-part/chat-subagent-part.component';

@Component({
  selector: 'aily-chat-message-parts',
  standalone: true,
  imports: [
    CommonModule,
    XMarkdownComponent,
    XAilyThinkViewerComponent,
    XAilyStateViewerComponent,
    XAilyErrorViewerComponent,
    XAilyQuestionViewerComponent,
    XAilyApprovalViewerComponent,
    ChatTerminalPartComponent,
    ChatSubagentPartComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (part of parts; track $index) {
      <div class="chat-part" [attr.data-part-type]="part.type">
        @switch (part.type) {
          @case ('markdown') {
            <x-markdown
              [content]="getMarkdownContent($index)"
              [streaming]="streamingConfig()"
              [components]="componentMap"
              rootClassName="x-markdown-dark"
            />
          }
          @case ('thinking') {
            <x-aily-think-viewer [data]="getThinkData(part)" />
          }
          @case ('tool_call') {
            <x-aily-state-viewer [data]="getToolCallData(part)" />
          }
          @case ('state') {
            <x-aily-state-viewer [data]="getStateData(part)" />
          }
          @case ('error') {
            <x-aily-error-viewer [data]="getErrorData(part)" />
          }
          @case ('question') {
            <x-aily-question-viewer [data]="getQuestionData(part)" />
          }
          @case ('approval') {
            <x-aily-approval-viewer [data]="getApprovalData(part)" />
          }
          @case ('terminal') {
            <aily-chat-terminal-part
              [command]="asTerminal(part).command"
              [output]="asTerminal(part).output"
              [stderr]="asTerminal(part).stderr || ''"
              [exitCode]="asTerminal(part).exitCode"
              [isRunning]="asTerminal(part).isRunning"
            />
          }
          @case ('subagent') {
            <aily-chat-subagent-part
              [agentName]="asSubagent(part).agentName"
              [description]="asSubagent(part).description"
              [state]="asSubagent(part).state"
              [resultText]="asSubagent(part).resultText"
              [childItems]="asSubagent(part).childItems || []"
              [metadata]="asSubagent(part).metadata || null"
            />
          }
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
    }
    .chat-part {
      margin-top: 4px;
      margin-bottom: 4px;
    }
    .chat-part:first-child {
      margin-top: 0;
    }
    .chat-part:last-child {
      margin-bottom: 0;
    }
  `],
})
export class ChatMessagePartsComponent implements OnChanges, OnDestroy {
  @Input() msgIndex = -1;
  @Input() store: ChatPartStore | null = null;
  @Input() doing = false;

  parts: ChatPart[] = [];
  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };
  streamingConfig = signal<StreamingOption>({ hasNextChunk: false, enableAnimation: false });

  private _sub: Subscription | null = null;
  /** 宏任务批量更新 handle */
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** ★ 缓存 question / approval data — 同一 Part 引用返回同一 data 对象（参考 VSCode hasSameContent 模式） */
  private _questionDataCache = new WeakMap<ChatPart, any>();
  private _approvalDataCache = new WeakMap<ChatPart, any>();

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['store'] || changes['msgIndex']) {
      this._unsubscribe();
      this._refresh();
      this._subscribe();
    }

    if (changes['doing']) {
      this.streamingConfig.set({
        hasNextChunk: this.doing,
        enableAnimation: this.doing,
      });
    }
  }

  ngOnDestroy(): void {
    this._unsubscribe();
    if (this._flushTimer !== null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  // ==================== 模板帮助方法 ====================

  getMarkdownContent(partIndex: number): string {
    const part = this.parts[partIndex];
    if (part?.type !== 'markdown') return '';
    return (part as MarkdownPart).content;
  }

  getThinkData(part: ChatPart): { content: string; isComplete: boolean } {
    const tp = part as ThinkingPart;
    return { content: tp.content, isComplete: tp.isComplete };
  }

  getToolCallData(part: ChatPart): {
    state: string;
    text: string;
    id: string;
    kind: 'tool_call';
    metadata?: Record<string, unknown> | null;
  } {
    const tc = part as ToolCallPart;
    return {
      state: tc.state,
      text: tc.text,
      id: tc.toolCallId,
      kind: 'tool_call',
      metadata: tc.metadata || null,
    };
  }

  getStateData(part: ChatPart): {
    state: string;
    text: string;
    id: string;
    progress?: number;
    kind?: StatePart['kind'];
    metadata?: StatePart['metadata'];
  } {
    const sp = part as StatePart;
    return {
      state: sp.state,
      text: sp.text,
      id: sp.stateId,
      progress: sp.progress,
      kind: sp.kind,
      metadata: sp.metadata,
    };
  }

  getErrorData(part: ChatPart): { message: string } {
    return { message: (part as ErrorPart).message };
  }

  getQuestionData(part: ChatPart): any {
    // ★ 稳定引用：同一 QuestionPart 实例始终返回同一 data 对象
    // 防止 parent CD 每次创建新对象导致 question-viewer 的 ngOnChanges/processData 重置选择状态
    let cached = this._questionDataCache.get(part);
    if (!cached) {
      const qp = part as QuestionPart;
      cached = { questions: qp.questions, answers: qp.answers, isHistory: qp.isHistory };
      this._questionDataCache.set(part, cached);
    }
    return cached;
  }

  getApprovalData(part: ChatPart): any {
    // ★ 同理：稳定引用防止 approval-viewer 状态重置
    let cached = this._approvalDataCache.get(part);
    if (!cached) {
      const ap = part as ApprovalPart;
      cached = {
        toolCallId: ap.askId,
        toolName: ap.toolName,
        title: ap.toolName ? `确认执行: ${ap.toolName}` : '确认操作',
        message: ap.message,
        resolved: ap.resolved,
        approved: ap.result === 'approved',
        scope: ap.scope,
      };
      this._approvalDataCache.set(part, cached);
    }
    return cached;
  }

  asTerminal(part: ChatPart): TerminalPart {
    return part as TerminalPart;
  }

  asSubagent(part: ChatPart): SubagentPart {
    return part as SubagentPart;
  }

  // ==================== 内部 ====================

  private _refresh(): void {
    if (!this.store || this.msgIndex < 0) {
      this.parts = [];
      return;
    }
    this.parts = this.store.getParts(this.msgIndex);
  }

  private _subscribe(): void {
    if (!this.store || this.msgIndex < 0) return;

    const targetIdx = this.msgIndex;
    this._sub = this.store.changes$.subscribe((change: PartChange) => {
      if (change.msgIndex !== targetIdx) return;
      // 批量合并：在 rAF 内刷新一次
      this._scheduleRefresh();
    });
  }

  private _scheduleRefresh(): void {
    if (this._flushTimer !== null) return;
    // ★ 使用 setTimeout(0) 而非 requestAnimationFrame：
    // Part 更新与 for-await 的 yield 都使用 setTimeout(0)，
    // 宏任务队列 FIFO 保证 detectChanges 在 yield 恢复循环之前执行。
    // rAF 依赖 vsync 时序，SSE 批量到达时可能在循环结束后才首次触发。
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._refresh();
      this.cdr.detectChanges();
    }, 0);
  }

  private _unsubscribe(): void {
    this._sub?.unsubscribe();
    this._sub = null;
  }
}
