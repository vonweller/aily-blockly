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

import { ChatPart, MarkdownPart, ErrorPart, QuestionPart } from '../../core/chat-parts';
import { AilyChatCodeComponent } from './aily-chat-code.component';
import { XAilyErrorViewerComponent } from './x-aily-error-viewer/x-aily-error-viewer.component';
import { XAilyQuestionViewerComponent } from './x-aily-question-viewer/x-aily-question-viewer.component';
import { ChatActivityGroupComponent } from './chat-activity-group.component';
import { ChatStandaloneToolCallComponent } from './chat-standalone-tool-call.component';
import { isGroupableActivityPart, isSubagentToolCall } from './chat-activity-group-projection';

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
          <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" />
        }
      }
      @case ('tool_call') {
        @if (shouldUseStandaloneSubagentGroup()) {
          <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" />
        } @else if (isStandaloneToolCall()) {
          <aily-chat-standalone-tool-call [part]="asToolCall()" />
        }
      }
      @case ('state') {
        <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" />
      }
      @case ('error') {
        <x-aily-error-viewer [data]="getErrorData()" />
      }
      @case ('question') {
        <x-aily-question-viewer [data]="getQuestionData()" />
      }
      @case ('confirmation') {
        <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" />
      }
      @case ('terminal') {
        <aily-chat-activity-group [parts]="getStandaloneActivityParts()" [doing]="doing" />
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
  `],
})
export class ChatMessagePartItemComponent implements OnChanges {
  @Input() part: ChatPart | null = null;
  @Input() doing = false;

  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };
  streamingConfig = signal<StreamingOption>({ hasNextChunk: false, enableAnimation: false });

  private readonly questionDataCache = new WeakMap<ChatPart, any>();
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
    return this.part ? [this.part] : [];
  }

  shouldUseStandaloneActivityGroup(): boolean {
    return !!this.part && (this.part.type === 'state' || isGroupableActivityPart(this.part));
  }

  shouldUseStandaloneSubagentGroup(): boolean {
    return !!this.part && this.part.type === 'tool_call' && isSubagentToolCall(this.part);
  }

  isStandaloneToolCall(): boolean {
    return !!this.part && this.part.type === 'tool_call' && !isSubagentToolCall(this.part);
  }

  asToolCall(): any {
    return this.part as any;
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
      cached = { questions: qp.questions, answers: qp.answers, isHistory: qp.isHistory };
      this.questionDataCache.set(this.part, cached);
    }
    return cached;
  }

}