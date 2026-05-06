import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { XMarkdownComponent } from 'ngx-x-markdown';
import type { StreamingOption, ComponentMap } from 'ngx-x-markdown';

import { ChatPart, MarkdownPart, ErrorPart, QuestionPart } from '../../core/chat-parts';
import { AilyChatCodeComponent } from './aily-chat-code.component';
import { XAilyErrorViewerComponent } from './x-aily-error-viewer/x-aily-error-viewer.component';
import { XAilyQuestionViewerComponent } from './x-aily-question-viewer/x-aily-question-viewer.component';
import { ChatActivityGroupComponent } from './chat-activity-group.component';
import { ChatStandaloneToolCallComponent } from './chat-standalone-tool-call.component';
import { isGroupableActivityPart, isSubagentToolCall } from './chat-activity-group-projection';
import { isProgressMessageDisplayPart, type ProgressMessageDisplayPart, type RenderableChatPart } from './chat-render-parts';
import { ChatRuntimeInteractionHostService } from '../../services/chat-runtime-interaction-host.service';

@Component({
  selector: 'aily-chat-message-part-item',
  standalone: true,
  imports: [
    CommonModule,
    XMarkdownComponent,
    XAilyErrorViewerComponent,
    XAilyQuestionViewerComponent,
    ChatActivityGroupComponent,
    ChatStandaloneToolCallComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (part?.type) {
      @case ('markdown') {
        <x-markdown
          [content]="getMarkdownContent()"
          [streaming]="streamingConfig()"
          [components]="componentMap"
          rootClassName="x-markdown-dark"
        />
      }
      @case ('thinking') {
        @if (shouldUseStandaloneActivityGroup()) {
          <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" [sessionId]="sessionId" />
        }
      }
      @case ('tool_call') {
        @if (shouldUseStandaloneSubagentGroup()) {
          <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" [sessionId]="sessionId" />
        } @else if (isStandaloneToolCall()) {
          <aily-chat-standalone-tool-call [part]="asToolCall()" />
        }
      }
      @case ('state') {
        <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" [sessionId]="sessionId" />
      }
      @case ('error') {
        <x-aily-error-viewer [data]="getErrorData()" />
      }
      @case ('question') {
        @if (shouldRenderInlineQuestion()) {
          <x-aily-question-viewer
            [data]="getQuestionData()"
            [interactive]="isInteractiveInlineQuestion()"
            (answered)="onInlineQuestionAnswered($event)" />
        }
      }
      @case ('confirmation') {
        <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" [sessionId]="sessionId" />
      }
      @case ('terminal') {
        <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" [sessionId]="sessionId" />
      }
      @case ('progress') {
        <div class="chat-working-progress" [attr.data-progress-kind]="getProgressData()?.progressKind || 'working'">
          <span class="chat-working-progress-icon ccenter">
            <i class="fa-light fa-spinner-third ac-spin"></i>
          </span>
          <span class="chat-working-progress-text">{{ getProgressData()?.content }}</span>
        </div>
      }
    }
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
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

    .chat-working-progress {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 2px 0;
      color: var(--chat-fg-dim, #8e8e8e);
      font-size: 12px;
      line-height: 1.5;
    }

    .chat-working-progress-icon {
      flex: 0 0 auto;
      width: 14px;
      height: 14px;
      color: var(--chat-info, #75beff);
      font-size: 11px;
    }

    .chat-working-progress-text {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
  `],
})
export class ChatMessagePartItemComponent implements OnChanges {
  @Input() part: RenderableChatPart | null = null;
  @Input() doing = false;
  @Input() sessionId = '';

  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };
  streamingConfig = signal<StreamingOption>({ hasNextChunk: false, enableAnimation: false });

  private readonly questionDataCache = new WeakMap<RenderableChatPart, any>();
  private readonly runtimeInteractionHost = inject(ChatRuntimeInteractionHostService, { optional: true });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['doing']) {
      this.streamingConfig.set({
        hasNextChunk: this.doing,
        enableAnimation: this.doing,
      });
    }
  }

  getMarkdownContent(): string {
    return this.part?.type === 'markdown' ? (this.part as MarkdownPart).content : '';
  }

  getStandaloneActivityParts(): readonly ChatPart[] {
    return this.part && !isProgressMessageDisplayPart(this.part) ? [this.part] : [];
  }

  shouldUseStandaloneActivityGroup(): boolean {
    return !!this.part && !isProgressMessageDisplayPart(this.part) && (this.part.type === 'state' || isGroupableActivityPart(this.part));
  }

  shouldUseStandaloneSubagentGroup(): boolean {
    return !!this.part && !isProgressMessageDisplayPart(this.part) && this.part.type === 'tool_call' && isSubagentToolCall(this.part);
  }

  isStandaloneToolCall(): boolean {
    return !!this.part && !isProgressMessageDisplayPart(this.part) && this.part.type === 'tool_call' && !isSubagentToolCall(this.part);
  }

  asToolCall(): any {
    return this.part as any;
  }

  getProgressData(): ProgressMessageDisplayPart | null {
    return isProgressMessageDisplayPart(this.part) ? this.part : null;
  }

  getStateData(): {
    state: string;
    text: string;
    id: string;
    progress?: number;
    kind?: any;
    metadata?: Record<string, unknown> | null;
  } {
    const sp = this.part as any;
    return {
      state: sp.state,
      text: sp.text,
      id: sp.stateId,
      progress: sp.progress,
      kind: sp.kind,
      metadata: sp.metadata || null,
    };
  }

  getErrorData(): { message: string } {
    return { message: (this.part as ErrorPart).message };
  }

  getQuestionData(): any {
    if (!this.part) {
      return null;
    }

    let cached = this.questionDataCache.get(this.part);
    if (!cached) {
      const qp = this.part as QuestionPart;
      const hasAnswers = !!qp.answers && Object.keys(qp.answers).length > 0;
      cached = { questions: qp.questions, answers: qp.answers, isHistory: qp.isHistory || hasAnswers };
      this.questionDataCache.set(this.part, cached);
    }
    return cached;
  }

  shouldRenderInlineQuestion(): boolean {
    const data = this.getQuestionData();
    if (!data) {
      return false;
    }

    if (data.isHistory) {
      return true;
    }

    const answers = data.answers;
    return (!!answers && Object.keys(answers).length > 0) || this.hasActiveInlineQuestion();
  }

  isInteractiveInlineQuestion(): boolean {
    return this.hasActiveInlineQuestion();
  }

  onInlineQuestionAnswered(result: { answers: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }> }): void {
    if (!this.sessionId || !this.hasActiveInlineQuestion()) {
      return;
    }

    this.runtimeInteractionHost?.completeQuestion(this.sessionId, result);
  }

  private hasActiveInlineQuestion(): boolean {
    if (!this.sessionId || this.part?.type !== 'question') {
      return false;
    }

    const activeQuestion = this.runtimeInteractionHost?.getQuestionWidget(this.sessionId);
    return !!activeQuestion && activeQuestion.partId === (this.part as QuestionPart).partId;
  }

}