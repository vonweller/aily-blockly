import type { IChatContext } from '../core/chat-context';

/**
 * Handles host-side main-agent turn startup orchestration.
 *
 * Keeps waiting/source/checkpoint/budget side effects out of ChatEngineService
 * and trims LexOwnerFacade down to runtime delegation.
 */
export class LexTurnStartupBridge {
  constructor(
    private readonly ctx: IChatContext,
    private readonly startTurn: (userMessage: string) => string | undefined,
    private readonly ensureAilyMessage: () => void,
    private readonly getConversationMessages: () => any[],
    private readonly getCurrentTools: () => any[],
  ) {}

  beginMainAgentTurn(userMessage: string): string | undefined {
    const turnId = this.startTurn(userMessage);

    this.ctx.isCompleted = false;
    this.ctx.isCancelled = false;
    this.ctx.isWaiting = true;
    this.ctx.currentMessageSource = 'mainAgent';
    this.ctx.toolCallingIteration = 0;
    this.ctx.repetitionDetectionService.resetStreamTokens();

    this.ensureAilyMessage();

    this.ctx.editActions.ensureAbsExport();
    this.ctx.editCheckpointService.autoSaveEdits = this.ctx.ailyChatConfigService.autoSaveEdits;
    this.ctx.editActions.saveCheckpointToDisk();

    const conversationMessages = this.getConversationMessages();
    this.ctx.editCheckpointService.startTurn(
      0,
      conversationMessages.length - 1,
      this.ctx.list.length - 1,
      turnId,
    );
    this.ctx.contextBudgetService.refreshLocalEstimate(
      conversationMessages,
      this.getCurrentTools(),
    );
    this.ctx.scrollManager.autoScrollEnabled = true;

    return turnId;
  }
}