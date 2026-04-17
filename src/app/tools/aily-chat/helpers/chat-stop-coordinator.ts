import type { IChatContext } from '../core/chat-context';

/**
 * Coordinates host-side cleanup when the current turn is stopped.
 *
 * This keeps ChatEngineService.stop focused on shell delegation while the
 * cancel/finalize bookkeeping stays in one place.
 */
export class ChatStopCoordinator {
  constructor(private readonly ctx: IChatContext) {}

  stop(): void {
    this.ctx.isCancelled = true;
    this.ctx.lexStream.agent.stop();

    if (this.ctx.messageSubscription) {
      this.ctx.messageSubscription.unsubscribe();
      this.ctx.messageSubscription = null;
    }

    this.ctx.pendingUserInput = false;
    this.ctx.activeToolExecutions = 0;
    this.ctx.currentStatelessMode = false;

    const turnDraft = this.ctx.lexStream.turn.draft();
    const turnControl = this.ctx.lexStream.turns;
    const hasContent = !!turnDraft.assistantText || turnDraft.toolCallCount > 0;
    if (hasContent) {
      turnControl.complete(turnDraft.assistantText || '');
    } else {
      turnControl.discardIncomplete();
    }

    this.ctx.contextBudgetService.refreshLocalEstimate(
      this.ctx.conversationMessages,
      this.ctx.lexStream.runtime.tools(),
    );

    this.ctx.editCheckpointService.commitCurrentTurn();
    this.ctx.viewAdapter.markLastMessageDone();
    this.ctx.isWaiting = false;
    this.ctx.isCompleted = true;
    this.ctx.session.saveCurrentSession();

    void this.ctx.applyPendingSwitch();
  }
}