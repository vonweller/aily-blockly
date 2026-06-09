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
  & Pick<IChatViewAccess, 'viewAdapter'>
  & {
    dismissPendingInteractions?(sessionId?: string | null): void;
    markExplicitInterrupt?(sessionId?: string | null): void;
    awaitPendingLexRequestCompleted?(sessionId?: string | null): Promise<void>;
    stopSettleTimeoutMs?: number;
    processPendingFollowupRequests?(sessionId?: string | null): Promise<boolean> | boolean;
    requestStop?(sessionId?: string | null): boolean;
  };

const DEFAULT_STOP_SETTLE_TIMEOUT_MS = 1000;
const REQUEST_STATE_TRACE_PREFIX = '[AilyChat][RequestStateTrace]';

/**
 * Coordinates host-side cleanup when the visible current turn is stopped.
 *
 * Detached runtime interruption is handled by the engine-owned session action
 * owner so this coordinator can stay focused on the visible finalize path.
 */
export class ChatStopCoordinator {
  constructor(private readonly ctx: ChatStopCoordinatorContext) {}

  private async waitForAbortSettle(sessionId?: string): Promise<void> {
    if (typeof this.ctx.awaitPendingLexRequestCompleted !== 'function') {
      return;
    }

    const settlePromise = Promise.resolve(this.ctx.awaitPendingLexRequestCompleted(sessionId)).then(
      () => undefined,
      () => undefined,
    );
    const timeoutMs = typeof this.ctx.stopSettleTimeoutMs === 'number'
      && Number.isFinite(this.ctx.stopSettleTimeoutMs)
      && this.ctx.stopSettleTimeoutMs > 0
      ? Math.floor(this.ctx.stopSettleTimeoutMs)
      : DEFAULT_STOP_SETTLE_TIMEOUT_MS;

    await Promise.race([
      settlePromise,
      new Promise<void>(resolve => {
        if (typeof globalThis.setTimeout !== 'function') {
          resolve();
          return;
        }

        const timerHandle = globalThis.setTimeout(() => {
          resolve();
        }, timeoutMs);

        void settlePromise.finally(() => {
          if (typeof globalThis.clearTimeout === 'function') {
            globalThis.clearTimeout(timerHandle);
          }
        });
      }),
    ]);
  }

  private shouldRefreshLocalEstimate(): boolean {
    const snapshot = this.ctx.contextBudgetService.getSnapshot();
    return snapshot.currentTokens <= 0 || snapshot.maxContextTokens <= 0;
  }

  async stopVisibleSession(sessionId?: string): Promise<void> {
    const pendingUserInputBeforeStop = this.ctx.pendingUserInput === true;
    const activeToolExecutionsBeforeStop = this.ctx.activeToolExecutions;
    this.ctx.isCancelled = true;
    if (typeof this.ctx.requestStop === 'function') {
      this.ctx.requestStop(sessionId);
    } else {
      this.ctx.lexStream.agent.stop(sessionId);
    }

    if (this.ctx.messageSubscription) {
      this.ctx.messageSubscription.unsubscribe();
      this.ctx.messageSubscription = null;
    }

    this.ctx.pendingUserInput = false;
    this.ctx.activeToolExecutions = 0;
    this.ctx.currentStatelessMode = false;
    this.ctx.dismissPendingInteractions?.(sessionId);

    const turnDraft = this.ctx.lexStream.turn.draft();
    const turnControl = this.ctx.lexStream.turns;
    const hasContent = turnDraft.partCount > 0;
    console.info(REQUEST_STATE_TRACE_PREFIX, {
      phase: 'stop',
      action: 'stop',
      sessionId: sessionId ?? null,
      requestId: null,
      state: 'running',
      pendingUserInput: pendingUserInputBeforeStop,
      activeToolExecutions: activeToolExecutionsBeforeStop,
      hasContent,
      partCount: turnDraft.partCount,
    });
    if (hasContent) {
      turnControl.complete(turnDraft.assistantText || '');
      this.ctx.lexStream.finalizeCurrentTurnResponse('cancelled');
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
    this.ctx.markExplicitInterrupt?.(sessionId);

    await this.waitForAbortSettle(sessionId);
    await this.ctx.applyPendingSwitch(sessionId);
    await this.ctx.processPendingFollowupRequests?.(sessionId);
  }
}
