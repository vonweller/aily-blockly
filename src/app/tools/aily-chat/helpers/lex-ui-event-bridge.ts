import type { IAgentLifecycle, IChatServiceAccess } from '../core/chat-context';
import type { ChatPartStoreReadableHandle } from '../core/chat-part-store';
import { buildConfirmationPartId, buildQuestionPartId, mkConfirmation, mkError, mkQuestion } from '../core/chat-parts';
import type { ConfirmationPart, QuestionItem, QuestionPart } from '../core/chat-parts';
import type { ToolApprovalRequest } from './tool-approval-ui';
import type { ChatListItem } from '../services/chat-history.service';
import type { ChatMessageHandle } from './chat-message-handle';
import type { LexTurnDraft } from './lex-message-lifecycle-bridge';
import type { RenderEvent } from 'aily-lex/browser';
import {
  LexAgentEventBridge,
  type LexAgentHostSyncAccess,
  type LexAgentPartProcessor,
} from './lex-agent-event-bridge';
import { LexSubagentPartBridge } from './lex-subagent-part-bridge';
import { ChatViewWriteBridge } from './chat-view-write-bridge';

type LexUiEventViewWriteContext = ConstructorParameters<typeof ChatViewWriteBridge>[0];

type LexUiEventContext = LexUiEventViewWriteContext
  & ConstructorParameters<typeof LexAgentEventBridge>[0];

type LexUiEventLifecycleAccess = {
  ensureAilyMessage(): void;
  resetTurnState(): void;
  getCurrentTurnDraft(): LexTurnDraft;
  finalize(): Promise<void>;
  readonly currentMessageHandle: ChatMessageHandle<ChatListItem> | null;
  closeNativeThinking(): void;
  startNativeThinking(): void;
};

type LexUiEventMainLifecycleAccess = Pick<
  LexUiEventLifecycleAccess,
  'ensureAilyMessage' | 'closeNativeThinking' | 'startNativeThinking'
>;

type LexUiEventOwnerLifecycleAccess = Pick<
  LexUiEventLifecycleAccess,
  'ensureAilyMessage' | 'resetTurnState' | 'getCurrentTurnDraft' | 'finalize' | 'currentMessageHandle'
>;

type LexUiEventWriteAccess = Pick<
  ChatViewWriteBridge,
  | 'appendPartToHandle'
  | 'appendMarkdownToHandle'
  | 'updateQuestionAnswersByPartId'
  | 'updateConfirmationResultByPartId'
  | 'updateToolCallApprovalRequestByToolCallId'
  | 'resolveToolCallApprovalByToolCallId'
>;

type LexUiEventMainEventBridge = Pick<
  LexAgentEventBridge,
  'processEvent'
>;

type LexUiEventSubagentEventBridge = Pick<
  LexSubagentPartBridge,
  'processEvent'
>;

type LexUiInteractionRenderEvent = Extract<RenderEvent, { type: 'approval_request' | 'approval_resolve' | 'question_request' }>;

type LexUiEventRenderAccess = {
  processInteractionEvent(event: LexUiInteractionRenderEvent): boolean;
  updateQuestionAnswers(answers: QuestionPart['answers'], partId: string): boolean;
};

/**
 * LexUiEventBridge
 *
 * 将主 agent、subagent 和 pending lifecycle 事件压到同一个 UI 入口，
 * 避免 LexOwnerFacade / TurnExecutionBridge 分别感知多个 bridge。
 */
export class LexUiEventBridge {
  private readonly mainEventBridge: LexUiEventMainEventBridge;
  private readonly subagentEventBridge: LexUiEventSubagentEventBridge;
  private readonly viewWriteBridge: LexUiEventWriteAccess;
  private readonly messageLifecycleBridge: LexUiEventOwnerLifecycleAccess;
  private readonly renderEventBridge?: LexUiEventRenderAccess;

  constructor(
    ctx: LexUiEventContext,
    partProcessor: LexAgentPartProcessor,
    hostSyncBridge: LexAgentHostSyncAccess,
    messageLifecycleBridge: LexUiEventLifecycleAccess,
    renderEventBridge?: LexUiEventRenderAccess,
  ) {
    const viewWriteContext: LexUiEventViewWriteContext = {
      get list() {
        return ctx.list;
      },
      set list(list) {
        ctx.list = list;
      },
      get partStore() {
        return ctx.partStore;
      },
      get viewAdapter() {
        return ctx.viewAdapter;
      },
      get scrollManager() {
        return ctx.scrollManager;
      },
      get invalidateHostRequestGraph() {
        return ctx.invalidateHostRequestGraph;
      },
      get triggerSyncDetectChanges() {
        return ctx.triggerSyncDetectChanges;
      },
      get sessionId() {
        return ctx.sessionId;
      },
      get chatHistoryService() {
        return ctx.chatHistoryService;
      },
      get currentModelName() {
        return ctx.currentModelName;
      },
      get currentMessageSource() {
        return ctx.currentMessageSource;
      },
      get ngZone() {
        return ctx.ngZone;
      },
    };
    const mainLifecycleBridge: LexUiEventMainLifecycleAccess = messageLifecycleBridge;
    const getCurrentMessageHandle = (): ChatPartStoreReadableHandle | null => messageLifecycleBridge.currentMessageHandle;
    this.messageLifecycleBridge = messageLifecycleBridge;
    this.renderEventBridge = renderEventBridge;
    this.mainEventBridge = new LexAgentEventBridge(
      ctx,
      partProcessor,
      hostSyncBridge,
      mainLifecycleBridge,
    );
    this.subagentEventBridge = new LexSubagentPartBridge(ctx.partStore, getCurrentMessageHandle);
    this.viewWriteBridge = new ChatViewWriteBridge(viewWriteContext);
  }

  ensureAilyMessage(): void {
    this.messageLifecycleBridge.ensureAilyMessage();
  }

  resetTurnState(): void {
    this.messageLifecycleBridge.resetTurnState();
  }

  getCurrentTurnDraft(): LexTurnDraft {
    return this.messageLifecycleBridge.getCurrentTurnDraft();
  }

  processEvent(event: any, scope: 'main' | 'subagent' = 'main'): void {
    if (scope === 'subagent') {
      this.subagentEventBridge.processEvent(event);
      return;
    }

    this.mainEventBridge.processEvent(event);
  }

  flushPendingEvents(events: readonly any[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  async finalizeTurn(): Promise<void> {
    await this.messageLifecycleBridge.finalize();
  }

  appendLifecycleError(message: string): void {
    this.ensureAilyMessage();
    const handle = this.messageLifecycleBridge.currentMessageHandle;
    if (!handle) {
      return;
    }

    this.viewWriteBridge.appendPartToHandle(handle, mkError(message), { state: 'done' });
  }

  appendExecutionError(message: string, options: { retry?: boolean } = {}): void {
    this.appendLifecycleError(message);
    if (options.retry) {
      const handle = this.messageLifecycleBridge.currentMessageHandle;
      if (!handle) {
        return;
      }

      const blocks = [
        `\`\`\`aily-button\n[${JSON.stringify({ text: '重试', action: 'retry', type: 'primary' })}]\n\`\`\`\n\n`,
      ];
      this.viewWriteBridge.appendMarkdownToHandle(handle, blocks.join(''));
    }
  }

  presentQuestion(questions: QuestionItem[]): string {
    const requestId = `question-${Date.now()}`;
    const partId = buildQuestionPartId(questions, requestId);
    if (this.renderEventBridge?.processInteractionEvent({
      type: 'question_request',
      requestId,
      questions: questions.map(question => ({
        question: question.question,
        options: question.options?.map(option => ({ ...option })),
        allowFreeform: question.allow_freeform,
        multiSelect: question.multi_select,
      })),
      timestamp: Date.now(),
    })) {
      return partId;
    }

    this.ensureAilyMessage();
    const handle = this.messageLifecycleBridge.currentMessageHandle;
    if (!handle) {
      throw new Error('Failed to create question part: no active aily message handle after ensureAilyMessage().');
    }

    this.viewWriteBridge.appendPartToHandle(handle, mkQuestion(questions, undefined, requestId));
    return partId;
  }

  updateQuestionAnswers(answers: QuestionPart['answers'], partId: string): boolean {
    const mirrored = this.renderEventBridge?.updateQuestionAnswers(answers, partId) ?? false;
    const updated = this.viewWriteBridge.updateQuestionAnswersByPartId(answers, partId);
    return mirrored || updated;
  }

  presentToolCallApproval(request: ToolApprovalRequest): string {
    if (this.viewWriteBridge.updateToolCallApprovalRequestByToolCallId(request)) {
      return request.toolCallId;
    }

    throw new Error(`Failed to present tool approval ${request.toolCallId}: no matching tool_call part found.`);
  }

  resolveToolCallApproval(
    toolCallId: string,
    approved: boolean,
    scope?: ConfirmationPart['scope'],
  ): void {
    if (this.viewWriteBridge.resolveToolCallApprovalByToolCallId(toolCallId, { approved, scope })) {
      return;
    }

    throw new Error(`Failed to resolve tool approval ${toolCallId}: no matching tool_call part found.`);
  }

  presentConfirmation(
    askId: string,
    message: string,
    toolName?: string,
    source?: string,
    presentation?: Partial<Pick<ConfirmationPart, 'title' | 'subtitle' | 'actions' | 'primaryScope' | 'args'>>,
  ): string {
    const partId = buildConfirmationPartId(askId);
    if (this.renderEventBridge?.processInteractionEvent({
      type: 'approval_request',
      requestId: askId,
      toolName: toolName ?? '',
      input: presentation?.args ?? {},
      message,
      title: presentation?.title,
      subtitle: presentation?.subtitle,
      actions: presentation?.actions,
      primaryScope: presentation?.primaryScope,
      source,
      timestamp: Date.now(),
    })) {
      return partId;
    }

    this.ensureAilyMessage();
    const handle = this.messageLifecycleBridge.currentMessageHandle;
    if (!handle) {
      throw new Error(`Failed to present confirmation ${askId}: no active aily message handle after ensureAilyMessage().`);
    }

    if (!this.viewWriteBridge.appendPartToHandle(handle, mkConfirmation(askId, message, toolName, source, presentation))) {
      throw new Error(`Failed to append confirmation part for ${askId}.`);
    }

    return partId;
  }

  resolveConfirmation(
    partId: string,
    askId: string,
    approved: boolean,
    scope?: ConfirmationPart['scope'],
  ): void {
    if (this.renderEventBridge?.processInteractionEvent({
      type: 'approval_resolve',
      requestId: askId,
      result: approved ? 'approved' : 'rejected',
      scope,
      timestamp: Date.now(),
    })) {
      return;
    }

    if (!this.viewWriteBridge.updateConfirmationResultByPartId(partId, {
      resolved: true,
      result: approved ? 'approved' : 'rejected',
      scope,
    })) {
      throw new Error(`Failed to resolve confirmation ${askId}: no matching confirmation part found.`);
    }
  }
}