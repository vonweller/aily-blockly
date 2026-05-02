import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IChatViewAccess,
  ISessionAccess,
} from '../core/chat-context';

type ChatStopCoordinatorContext = Pick<
  IAgentLifecycle,
  'isCancelled' | 'messageSubscription' | 'pendingUserInput' | 'activeToolExecutions' | 'currentStatelessMode' | 'isWaiting' | 'isCompleted'
> & Pick<IChatCoordination, 'lexStream' | 'session' | 'applyPendingSwitch'>
  & Pick<IChatServiceAccess, 'contextBudgetService' | 'editCheckpointService'>
  & Pick<ISessionAccess, 'conversationMessages'>
  & Pick<IChatViewAccess, 'viewAdapter'>;

/**
 * Coordinates host-side cleanup when the current turn is stopped.
 *
 * This keeps ChatEngineService.stop focused on shell delegation while the
 * cancel/finalize bookkeeping stays in one place.
 */
export class ChatStopCoordinator {
  constructor(private readonly ctx: ChatStopCoordinatorContext) {}

  private shouldRefreshLocalEstimate(): boolean {
    const snapshot = this.ctx.contextBudgetService.getSnapshot();
    return snapshot.currentTokens <= 0 || snapshot.maxContextTokens <= 0;
  }

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
    const hasContent = turnDraft.partCount > 0;
    if (hasContent) {
      turnControl.complete(turnDraft.assistantText || '');
      this.ctx.lexStream.finalizeCurrentTurnResponse('completed');
    } else {
      turnControl.discardIncomplete();
    }

    if (this.shouldRefreshLocalEstimate()) {
      this.ctx.contextBudgetService.refreshLocalEstimate(
        this.ctx.conversationMessages,
        this.ctx.lexStream.runtime.tools(),
      );
    }

    this.ctx.editCheckpointService.commitCurrentTurn();
    this.ctx.viewAdapter.markLastMessageDone();
    this.ctx.isWaiting = false;
    this.ctx.isCompleted = true;
    this.ctx.session.saveCurrentSession();

    void this.ctx.applyPendingSwitch();
  }
}