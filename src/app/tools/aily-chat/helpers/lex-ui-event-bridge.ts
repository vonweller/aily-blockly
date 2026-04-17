import type { IChatContext } from '../core/chat-context';
import { mkApproval, mkError, mkQuestion } from '../core/chat-parts';
import type { ApprovalPart, QuestionItem, QuestionPart } from '../core/chat-parts';
import type { PartEventProcessor } from '../core/part-event-processor';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';
import type { LexMessageLifecycleBridge, LexTurnDraft } from './lex-message-lifecycle-bridge';
import { LexAgentEventBridge } from './lex-agent-event-bridge';
import { LexSubagentPartBridge } from './lex-subagent-part-bridge';
import { ChatViewWriteBridge } from './chat-view-write-bridge';

/**
 * LexUiEventBridge
 *
 * 将主 agent、subagent 和 pending lifecycle 事件压到同一个 UI 入口，
 * 避免 LexOwnerFacade / TurnExecutionBridge 分别感知多个 bridge。
 */
export class LexUiEventBridge {
  private readonly mainEventBridge: LexAgentEventBridge;
  private readonly subagentEventBridge: LexSubagentPartBridge;
  private readonly viewWriteBridge: ChatViewWriteBridge;

  constructor(
    private readonly ctx: IChatContext,
    partProcessor: PartEventProcessor,
    hostSyncBridge: LexHostSyncBridge,
    private readonly messageLifecycleBridge: LexMessageLifecycleBridge,
    getCurrentMsgIndex: () => number,
  ) {
    this.mainEventBridge = new LexAgentEventBridge(
      ctx,
      partProcessor,
      hostSyncBridge,
      this.messageLifecycleBridge,
    );
    this.subagentEventBridge = new LexSubagentPartBridge(ctx, getCurrentMsgIndex);
    this.viewWriteBridge = new ChatViewWriteBridge(ctx);
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

  finalizeTurn(): void {
    this.messageLifecycleBridge.finalize();
  }

  appendLifecycleError(message: string): void {
    this.ensureAilyMessage();
    this.viewWriteBridge.appendPartToMessage(
      this.messageLifecycleBridge.currentMsgIndex,
      mkError(message),
      { state: 'done' },
    );
  }

  appendExecutionError(message: string, options: { retry?: boolean } = {}): void {
    this.appendLifecycleError(message);
    if (options.retry) {
      const blocks = [
        `\`\`\`aily-button\n[${JSON.stringify({ text: '重试', action: 'retry', type: 'primary' })}]\n\`\`\`\n\n`,
      ];
      this.viewWriteBridge.appendMarkdownToMessage(this.messageLifecycleBridge.currentMsgIndex, blocks.join(''));
    }
  }

  presentQuestion(questions: QuestionItem[]): void {
    this.ensureAilyMessage();
    this.viewWriteBridge.appendPartToMessage(this.messageLifecycleBridge.currentMsgIndex, mkQuestion(questions));
  }

  updateQuestionAnswers(answers: QuestionPart['answers']): boolean {
    return this.viewWriteBridge.updateQuestionAnswersOnLatestAilyPartsMessage(answers);
  }

  presentApproval(askId: string, message: string, toolName?: string, source?: string): void {
    this.ensureAilyMessage();
    this.viewWriteBridge.appendPartToMessage(
      this.messageLifecycleBridge.currentMsgIndex,
      mkApproval(askId, message, toolName, source),
    );
  }

  resolveApproval(
    askId: string,
    approved: boolean,
    scope?: ApprovalPart['scope'],
  ): boolean {
    return this.viewWriteBridge.updateApprovalResultOnLatestAilyPartsMessage(askId, {
      resolved: true,
      result: approved ? 'approved' : 'rejected',
      scope,
    });
  }
}