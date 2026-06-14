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
import type { TurnRequest, TurnResponseTurn } from 'aily-lex/browser';

import { ChatPart, MarkdownPart, ErrorPart, QuestionPart } from '../../core/chat-parts';
import { AilyChatConfigService } from '../../services/aily-chat-config.service';
import { isDefaultAutoPresetSelected } from '../../helpers/model-billing-label';
import { AilyChatCodeComponent } from './aily-chat-code.component';
import { XAilyErrorViewerComponent, type ErrorActionItem } from './x-aily-error-viewer/x-aily-error-viewer.component';
import { XAilyQuestionViewerComponent } from './x-aily-question-viewer/x-aily-question-viewer.component';
import { ChatActivityGroupComponent } from './chat-activity-group.component';
import { ChatStandaloneToolCallComponent } from './chat-standalone-tool-call.component';
import { isGroupableActivityPart, isSubagentToolCall } from './chat-activity-group-projection';
import { isProgressMessageDisplayPart, type ProgressMessageDisplayPart, type RenderableChatPart } from './chat-render-parts';
import { ChatEngineService } from '../../services/chat-engine.service';
import { ChatRuntimeInteractionHostService } from '../../services/chat-runtime-interaction-host.service';
import { ChatService, type ModelConfig } from '../../services/chat.service';

interface ContinueOnErrorConfirmationData {
  readonly ailyContinueOnError: true;
}

interface SwitchToAutoOnRateLimitConfirmationData {
  readonly ailySwitchToAutoOnRateLimit: true;
  readonly alwaysSwitchToAuto: boolean;
}

type ErrorConfirmationData = ContinueOnErrorConfirmationData | SwitchToAutoOnRateLimitConfirmationData;

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
        <x-aily-error-viewer [data]="getErrorData()" (action)="onErrorAction($event)" />
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
  @Input() turnResponse: TurnResponseTurn | null = null;

  readonly componentMap: ComponentMap = { code: AilyChatCodeComponent };
  streamingConfig = signal<StreamingOption>({ hasNextChunk: false, enableAnimation: false });

  private readonly questionDataCache = new WeakMap<RenderableChatPart, {
    questions: QuestionPart['questions'];
    answers: QuestionPart['answers'];
    answersSignature: string;
    isHistory: boolean;
    data: any;
  }>();
  private readonly chatEngine = inject(ChatEngineService, { optional: true });
  private readonly chatService = inject(ChatService, { optional: true });
  private readonly ailyChatConfigService = inject(AilyChatConfigService, { optional: true });
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

  getErrorData(): {
    message: string;
    severity?: ErrorPart['severity'];
    metadata?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
    actions?: readonly ErrorActionItem[];
  } {
    const errorPart = this.part as ErrorPart;
    const metadata = isRecord(errorPart.metadata) ? errorPart.metadata : undefined;
    const continuation = this.turnResponse?.response?.continuation as unknown as Record<string, unknown> | undefined;
    const budgets = continuation?.['budgets'];
    const continuationDiagnostics = isRecord(continuation?.['diagnostics']) ? continuation['diagnostics'] : undefined;
    const identity = isRecord(continuationDiagnostics?.['identity']) ? continuationDiagnostics['identity'] : undefined;
    const trace = isRecord(continuationDiagnostics?.['trace']) ? continuationDiagnostics['trace'] : undefined;
    const usage = isRecord(continuationDiagnostics?.['usage']) ? continuationDiagnostics['usage'] : undefined;
    const outcome = isRecord(continuationDiagnostics?.['outcome']) ? continuationDiagnostics['outcome'] : undefined;
    const behavior = isRecord(continuationDiagnostics?.['behavior']) ? continuationDiagnostics['behavior'] : undefined;
    const executionId = isRecord(budgets) ? readString(budgets['executionId']) : undefined;
    const diagnostics = compactRecord({
      interactionId: readString(continuation?.['interactionId']) ?? readString(identity?.['interactionId']),
      executionId: executionId ?? readString(identity?.['executionId']),
      requestId: readString(identity?.['requestId']),
      toolCallId: readString(trace?.['toolCallId']),
      stopReason: readString(continuation?.['stopReason']) ?? readString(outcome?.['stopReason']),
      hardStopReason: readString(continuation?.['hardStopReason']),
      status: readString(continuation?.['status']) ?? readString(outcome?.['status']),
      errorCode: readString(outcome?.['errorCode']),
      sourceEvent: readString(outcome?.['sourceEvent']),
      resolvedModel: readString(usage?.['resolvedModel']),
      modelBillingLabel: readString(usage?.['modelBillingLabel']),
      promptTokens: readNumberText(usage?.['promptTokens']),
      completionTokens: readNumberText(usage?.['completionTokens']),
      cacheReadTokens: readNumberText(usage?.['cacheReadTokens']),
      cacheCreationTokens: readNumberText(usage?.['cacheCreationTokens']),
      repeatedTextScore: readNumberText(behavior?.['repeatedTextScore']),
      repeatedChunkStreak: readNumberText(behavior?.['repeatedChunkStreak']),
      noProgressRounds: readNumberText(behavior?.['noProgressRounds']),
      repeatedToolCallStreak: readNumberText(behavior?.['repeatedToolCallStreak']),
      repeatedPendingStreak: readNumberText(behavior?.['repeatedPendingStreak']),
      syncConflictStreak: readNumberText(behavior?.['syncConflictStreak']),
      pendingInterruptions: readNumberText(behavior?.['pendingInterruptions']),
      pendingReplyOscillationCount: readNumberText(behavior?.['pendingReplyOscillationCount']),
      sameToolFingerprintCount: readNumberText(behavior?.['sameToolFingerprintCount']),
      samePendingFingerprintCount: readNumberText(behavior?.['samePendingFingerprintCount']),
      lastProgressAtRound: readNumberText(behavior?.['lastProgressAtRound']),
    });
    const actions = this.getErrorActions(metadata);

    return {
      message: errorPart.message,
      severity: errorPart.severity,
      ...(metadata ? { metadata } : {}),
      ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
      ...(actions.length > 0 ? { actions } : {}),
    };
  }

  getQuestionData(): any {
    if (!this.part) {
      return null;
    }

    const qp = this.part as QuestionPart;
    const hasAnswers = !!qp.answers && Object.keys(qp.answers).length > 0;
    const isHistory = !!qp.isHistory || hasAnswers;
    const answersSignature = stringifyQuestionAnswers(qp.answers);
    const cached = this.questionDataCache.get(this.part);
    if (
      cached
      && cached.questions === qp.questions
      && cached.answers === qp.answers
      && cached.answersSignature === answersSignature
      && cached.isHistory === isHistory
    ) {
      return cached.data;
    }

    const data = { questions: qp.questions, answers: qp.answers, isHistory };
    this.questionDataCache.set(this.part, {
      questions: qp.questions,
      answers: qp.answers,
      answersSignature,
      isHistory,
      data,
    });
    return data;
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
    if (!!answers && Object.keys(answers).length > 0) {
      return true;
    }

    return Array.isArray(data.questions) && data.questions.length > 0;
  }

  isInteractiveInlineQuestion(): boolean {
    return false;
  }

  onInlineQuestionAnswered(result: { answers: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }> }): void {
    if (!this.isInteractiveInlineQuestion()) {
      return;
    }

    if (!this.sessionId || !this.hasActiveInlineQuestion()) {
      return;
    }

    this.runtimeInteractionHost?.completeQuestion(this.sessionId, result);
  }

  onErrorAction(action: ErrorActionItem): void {
    void this.handleErrorAction(action);
  }

  private async handleErrorAction(action: ErrorActionItem): Promise<void> {
    if (!this.chatEngine) {
      return;
    }

    if (isSwitchToAutoOnRateLimitConfirmation(action.data)) {
      const autoModel = this.resolveDefaultAutoModel();
      if (!autoModel || this.isDefaultAutoModelSelected()) {
        return;
      }

      if (action.data.alwaysSwitchToAuto) {
        this.chatService.setRateLimitAutoSwitchToAuto(true);
      }

      await this.chatEngine.switchToModel(autoModel);
    } else if (!isContinueOnErrorConfirmation(action.data)) {
      return;
    }

    await this.chatEngine.submitInteractionActionRequest(
      action.label,
      this.buildErrorConfirmationInteractionAction(action),
      undefined,
      this.sessionId,
    );
  }

  private hasActiveInlineQuestion(): boolean {
    if (!this.sessionId || this.part?.type !== 'question') {
      return false;
    }

    const activeQuestion = this.runtimeInteractionHost?.getQuestionWidget(this.sessionId);
    return !!activeQuestion && activeQuestion.partId === (this.part as QuestionPart).partId;
  }

  private getErrorActions(metadata: Record<string, unknown> | undefined): readonly ErrorActionItem[] {
    const errorDetails = isRecord(metadata?.['errorDetails']) ? metadata['errorDetails'] : undefined;
    const confirmationButtons = Array.isArray(errorDetails?.['confirmationButtons'])
      ? errorDetails['confirmationButtons']
      : [];

    return confirmationButtons
      .map((button, index) => this.toErrorAction(button, index))
      .filter((button): button is ErrorActionItem => button !== null);
  }

  private toErrorAction(value: unknown, index: number): ErrorActionItem | null {
    if (!isRecord(value)) {
      return null;
    }

    const label = readString(value['label']);
    const data = this.readErrorConfirmationData(value);
    if (!label || !data) {
      return null;
    }

    if (isSwitchToAutoOnRateLimitConfirmation(data)) {
      const autoModel = this.resolveDefaultAutoModel();
      if (!autoModel || this.isDefaultAutoModelSelected()) {
        return null;
      }
    }

    return {
      id: `error-action-${index}`,
      label,
      data,
      ...(value['isSecondary'] === true ? { isSecondary: true } : {}),
      ...(value['disabled'] === true ? { disabled: true } : {}),
    };
  }

  private readErrorConfirmationData(value: Record<string, unknown>): ErrorConfirmationData | null {
    const rawData = value['data'];
    if (isContinueOnErrorConfirmation(rawData) || isSwitchToAutoOnRateLimitConfirmation(rawData)) {
      return rawData;
    }

    const legacyAction = readString(value['action']);
    switch (legacyAction) {
      case 'switch_to_auto':
        return { ailySwitchToAutoOnRateLimit: true, alwaysSwitchToAuto: false };
      case 'try_again':
        return { ailyContinueOnError: true };
      default:
        return null;
    }
  }

  private buildErrorConfirmationInteractionAction(action: ErrorActionItem): NonNullable<TurnRequest['metadata']>['interactionAction'] {
    const confirmationData = action.data === undefined ? [] : [action.data];
    return {
      kind: 'confirmation',
      payload: {
        result: action.isSecondary === true ? 'rejected' : 'approved',
        source: 'error_details',
        ...(action.isSecondary === true
          ? { rejectedConfirmationData: confirmationData }
          : { acceptedConfirmationData: confirmationData }),
      },
    };
  }

  private isDefaultAutoModelSelected(): boolean {
    return !!this.chatService?.currentModel && isDefaultAutoPresetSelected(this.chatService.currentModel);
  }

  private resolveDefaultAutoModel(): ModelConfig | null {
    if (!this.ailyChatConfigService) {
      return null;
    }

    return this.ailyChatConfigService.resolvePresetModel(
      this.ailyChatConfigService.getDefaultModelPresetId(),
    );
  }

}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readNumberText(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value}`
    : undefined;
}

function compactRecord(record: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(record).filter((entry): entry is [string, string] => {
    const value = entry[1];
    return typeof value === 'string' && value.length > 0;
  });

  return Object.fromEntries(entries);
}

function stringifyQuestionAnswers(answers: QuestionPart['answers']): string {
  if (!answers || Object.keys(answers).length === 0) {
    return '';
  }

  try {
    return JSON.stringify(answers);
  } catch {
    return Object.keys(answers).join('\n');
  }
}

function isContinueOnErrorConfirmation(value: unknown): value is ContinueOnErrorConfirmationData {
  return isRecord(value) && value['ailyContinueOnError'] === true;
}

function isSwitchToAutoOnRateLimitConfirmation(value: unknown): value is SwitchToAutoOnRateLimitConfirmationData {
  return isRecord(value)
    && value['ailySwitchToAutoOnRateLimit'] === true
    && typeof value['alwaysSwitchToAuto'] === 'boolean';
}
