import type { TurnRequest, TurnResponseTurn, SessionSnapshot } from 'aily-lex/browser';

import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  ISessionAccess,
} from '../core/chat-context';
import {
  buildHostProjectionStateFromPersistedRecord,
  buildTurnNativeRestoreChatList,
  type HostResponseProjection,
  type HostTurnResponseState,
} from './host-turn-response-state';
import { ChatViewWriteBridge, type ChatViewWriteBridgeContext } from './chat-view-write-bridge';
import { projectTurnResponsesToHistory } from './turn-response-history-projector';

import type { HostSessionRecord } from '../services/chat-history.service';
import type { AskUserAnswer, AskUserQuestion } from '../core/ask-user';
import type { ConfirmationPart, QuestionPart } from '../core/chat-parts';

type LexInteractionAction = NonNullable<TurnRequest['metadata']>['interactionAction'];
type LexTurnContinuation = NonNullable<TurnResponseTurn['response']['continuation']>;
type LexSessionInteractionContinuation = NonNullable<
  NonNullable<SessionSnapshot['requestContext']>['interactionContinuation']
>;

function readInteractionPendingRecord(
  continuation: LexSessionInteractionContinuation | LexTurnContinuation | undefined,
): Record<string, unknown> | undefined {
  const pending = continuation?.pendingState;
  return pending && typeof pending === 'object' ? pending : undefined;
}
type HostSessionRestoreContext = ChatViewWriteBridgeContext
  & Pick<IAgentLifecycle, 'toolCallingIteration'>
  & Pick<ISessionAccess, 'conversationMessages' | 'chatService'>
  & Pick<IChatServiceAccess, 'contextBudgetService' | 'editCheckpointService' | 'ailyChatConfigService' | 'runtimeInteractionHost'>
  & Pick<IChatCoordination, 'lexStream'>
  & {
    resumeRestoredInteraction?(content: string, interactionAction: LexInteractionAction): Promise<void>;
    restoreSharedHostProjectionState?(state: HostTurnResponseState | null): void;
    replaceSharedHostProjectionState?(state: HostTurnResponseState | null): void;
  };

type HostSessionRestoreViewWriteContext = ConstructorParameters<typeof ChatViewWriteBridge>[0];

type HostSessionRestoreViewWriteAccess = Pick<
  ChatViewWriteBridge,
  'restoreLegacyHistoryList' | 'restoreTurnNativeHistoryList'
>;

/**
 * Restores host-side persisted chat history back into the active UI/session state.
 *
 * Keeps host record application, Part reconstruction, lex restore handoff,
 * and post-restore host sync out of SessionLifecycleHelper.
 */
export class HostSessionRestoreBridge {
  private readonly viewWriteBridge: HostSessionRestoreViewWriteAccess;

  constructor(private readonly ctx: HostSessionRestoreContext) {
    const viewWriteContext: HostSessionRestoreViewWriteContext = {
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
    this.viewWriteBridge = new ChatViewWriteBridge(viewWriteContext);
  }

  async restore(hostRecord: HostSessionRecord): Promise<void> {
    this.restoreSessionMetadata(hostRecord);

    const restoredLexSession = await this.ctx.lexStream.session.restore(
      this.ctx.sessionId,
      hostRecord.turnResponses,
    );

    const turnResponses = this.resolveTurnResponsesForRestore(hostRecord) ?? [];
    this.ctx.lexStream.hydrateTurnResponses?.(turnResponses);
    const supportsTurnNativeRestore = turnResponses.length > 0;
    const hostResponseState = buildHostProjectionStateFromPersistedRecord({
      turnResponses,
    });
    if (this.ctx.restoreSharedHostProjectionState) {
      this.ctx.restoreSharedHostProjectionState(hostResponseState);
    } else {
      this.ctx.replaceSharedHostProjectionState?.(hostResponseState);
    }
    this.applyHostView(hostResponseState);
    this.restorePendingRuntimeInteraction(hostResponseState.turnResponses);

    // Restore context budget: prefer persisted lex-derived values over local estimate
    const savedBudget = hostRecord.metadata?.contextBudget;
    if (savedBudget && savedBudget.maxContextTokens > 0 && savedBudget.currentTokens > 0) {
      this.ctx.contextBudgetService?.applyLexBudgetEvent(
        savedBudget.maxContextTokens,
        savedBudget.currentTokens,
        {
          usagePercent: savedBudget.usagePercent,
          systemTokens: savedBudget.systemTokens,
          baseSystemTokens: savedBudget.baseSystemTokens,
          instructionTokens: savedBudget.instructionTokens,
          skillTokens: savedBudget.skillTokens,
          toolsTokens: savedBudget.toolsTokens,
          toolSourceTokens: savedBudget.toolSourceTokens,
          messagesTokens: savedBudget.messagesTokens,
          toolResultsTokens: savedBudget.toolResultsTokens,
          messageCount: savedBudget.messageCount,
        },
      );
    } else {
      this.ctx.contextBudgetService?.refreshLocalEstimate(
        restoredLexSession ? this.ctx.conversationMessages : [],
        this.ctx.lexStream.runtime.tools(),
      );
    }

    await this.restoreEditCheckpoints(hostResponseState.turnResponses);
    this.finalizeRestoreUi(restoredLexSession);
  }

  private applyHostView(hostResponseState: Pick<HostResponseProjection, 'turnResponses' | 'chatList'>): void {
    if (hostResponseState.turnResponses.length === 0) {
      this.viewWriteBridge.restoreLegacyHistoryList(hostResponseState.chatList);
      return;
    }

    const turnIds = new Set(hostResponseState.turnResponses.map(turn => turn.turnId));
    this.viewWriteBridge.restoreTurnNativeHistoryList(
      buildTurnNativeRestoreChatList(hostResponseState.chatList, turnIds),
      turnIds,
    );

    projectTurnResponsesToHistory(this.ctx, hostResponseState.turnResponses);
  }

  private restoreSessionMetadata(hostRecord: HostSessionRecord): void {
    if (hostRecord.metadata?.title) {
      this.ctx.chatService.currentSessionTitle = hostRecord.metadata.title;
    } else {
      const indexEntry = this.ctx.chatHistoryService.findEntry(this.ctx.sessionId);
      if (indexEntry?.title) {
        this.ctx.chatService.currentSessionTitle = indexEntry.title;
      }
    }

    this.ctx.toolCallingIteration = hostRecord.metadata?.toolCallingIteration || 0;
  }

  private async restoreEditCheckpoints(turnResponses: readonly TurnResponseTurn[]): Promise<void> {
    this.ctx.editCheckpointService?.clear();
    try {
      const fileHistory = this.ctx.lexStream.agent.getHandle?.()?.getFileHistory()
        ?? this.ctx.lexStream.agent.getAgent()?.getFileHistory?.();
      if (fileHistory) {
        this.ctx.editCheckpointService.setFileHistory(fileHistory);
      }
    } catch {
      // ignore file history restore failures
    }

    if (turnResponses.length > 0) {
      await this.ctx.editCheckpointService?.rebuildFromTurnResponses?.(turnResponses);
    }

    if (this.ctx.editCheckpointService?.hasUnsavedEdits()) {
      if (this.ctx.ailyChatConfigService.autoSaveEdits) {
        this.ctx.editCheckpointService.acceptAllAsBaseline();
        this.ctx.editCheckpointService.dismissSummary();
      } else {
        this.ctx.editCheckpointService.publishCurrentSummary();
      }
      return;
    }

    this.ctx.editCheckpointService?.dismissSummary();
  }

  private finalizeRestoreUi(_restoredLexSession: boolean): void {
    this.ctx.scrollManager.scrollToBottom('auto');
  }

  private resolveTurnResponsesForRestore(
    hostRecord: HostSessionRecord,
  ): TurnResponseTurn[] | null {
    if (!hostRecord.turnResponses?.length) {
      return null;
    }

    return [...hostRecord.turnResponses];
  }

  private restorePendingRuntimeInteraction(turnResponses: readonly TurnResponseTurn[]): void {
    const interactionContinuation = this.ctx.lexStream.session.snapshot()?.requestContext?.interactionContinuation;
    const pending = readInteractionPendingRecord(interactionContinuation);
    if (!pending || pending['kind'] === 'none') {
      return;
    }

    if (pending['kind'] === 'question') {
      this.restorePendingQuestion(turnResponses);
      return;
    }

    if (pending['kind'] === 'confirmation') {
      this.restorePendingConfirmation(turnResponses, interactionContinuation!);
    }
  }

  private restorePendingQuestion(turnResponses: readonly TurnResponseTurn[]): void {
    const questionPart = findPendingQuestionPart(turnResponses);
    if (!questionPart?.partId) {
      return;
    }

    const questions = questionPart.questions.map<AskUserQuestion>((question) => ({
      question: question.question,
      options: question.options?.map(option => ({
        label: option.label,
        description: option.description,
        recommended: option.recommended,
      })),
      allow_freeform: question.allow_freeform,
      multi_select: question.multi_select,
    }));

    void this.ctx.runtimeInteractionHost.presentQuestion(this.ctx.sessionId, questionPart.partId, questions)
      .then(async (result) => {
        if (!result?.answers) {
          return;
        }

        this.ctx.lexStream.ui.updateQuestionAnswers(result.answers, questionPart.partId!);
        await this.ctx.resumeRestoredInteraction?.(
          buildQuestionAnswerResumeContent(result.answers),
          {
            kind: 'question_answer',
            payload: { answers: result.answers },
          },
        );
      })
      .catch(() => undefined);
  }

  private restorePendingConfirmation(
    turnResponses: readonly TurnResponseTurn[],
    continuation: LexTurnContinuation,
  ): void {
    const confirmationPart = findPendingConfirmationPart(turnResponses, continuation);
    if (!confirmationPart?.partId) {
      return;
    }

    void this.ctx.runtimeInteractionHost.presentConfirmation(this.ctx.sessionId, {
      askId: confirmationPart.askId,
      partId: confirmationPart.partId,
      toolName: confirmationPart.toolName,
      title: confirmationPart.title,
      subtitle: confirmationPart.subtitle,
      message: confirmationPart.message,
      args: isRecord(confirmationPart.args) ? confirmationPart.args : undefined,
      actions: Array.isArray(confirmationPart.actions) ? confirmationPart.actions : [],
      primaryScope: confirmationPart.primaryScope ?? 'once',
    })
      .then(async (result) => {
        this.ctx.lexStream.ui.resolveConfirmation(
          confirmationPart.partId!,
          confirmationPart.askId,
          result.approved,
          result.scope,
        );
        await this.ctx.resumeRestoredInteraction?.(
          buildConfirmationResumeContent(confirmationPart, result.approved),
          buildConfirmationInteractionAction(continuation, confirmationPart, result),
        );
      })
      .catch(() => undefined);
  }
}

function findPendingQuestionPart(turnResponses: readonly TurnResponseTurn[]): QuestionPart | null {
  for (let turnIndex = turnResponses.length - 1; turnIndex >= 0; turnIndex--) {
    const parts = turnResponses[turnIndex]?.response?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex] as Partial<QuestionPart> | undefined;
      if (part?.type !== 'question' || !Array.isArray(part.questions) || part.answers) {
        continue;
      }
      return part as QuestionPart;
    }
  }

  return null;
}

function findPendingConfirmationPart(
  turnResponses: readonly TurnResponseTurn[],
  continuation: LexTurnContinuation,
): ConfirmationPart | null {
  const pendingRecord = readInteractionPendingRecord(continuation);
  const pendingRequestId = typeof pendingRecord?.['requestId'] === 'string'
    ? pendingRecord['requestId']
    : undefined;

  for (let turnIndex = turnResponses.length - 1; turnIndex >= 0; turnIndex--) {
    const parts = turnResponses[turnIndex]?.response?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex] as Partial<ConfirmationPart> | undefined;
      if (part?.type !== 'confirmation' || part.resolved === true || typeof part.askId !== 'string') {
        continue;
      }

      if (pendingRequestId && part.askId !== pendingRequestId) {
        continue;
      }

      return part as ConfirmationPart;
    }
  }

  return null;
}

function buildQuestionAnswerResumeContent(answers: Record<string, AskUserAnswer>): string {
  const summary = Object.entries(answers)
    .map(([question, answer]) => {
      const parts = [
        ...answer.selected,
        ...(typeof answer.freeText === 'string' && answer.freeText.trim().length > 0 ? [answer.freeText.trim()] : []),
      ];
      const answerText = answer.skipped ? '已跳过' : (parts.join('，') || '已回答');
      return `${question}: ${answerText}`;
    })
    .filter(text => text.length > 0)
    .join('；');

  return summary.length > 0 ? `已回答问题：${summary}` : '已回答问题。';
}

function buildConfirmationResumeContent(part: ConfirmationPart, approved: boolean): string {
  const action = approved ? '已确认' : '已拒绝';
  const target = typeof part.toolName === 'string' && part.toolName.length > 0
    ? `${action}执行 ${part.toolName}。`
    : `${action}继续当前确认。`;
  return target;
}

function buildConfirmationInteractionAction(
  continuation: LexTurnContinuation,
  part: ConfirmationPart,
  result: { approved: boolean; scope?: string; reason?: string; actionId?: string },
): LexInteractionAction {
  const pendingRecord = readInteractionPendingRecord(continuation);
  const payload: Record<string, unknown> = {
    result: result.approved ? 'approved' : 'rejected',
    source: pendingRecord?.['sourceEvent'] === 'approval_request' ? 'approval' : 'confirmation',
    ...(typeof part.toolName === 'string' && part.toolName.length > 0 ? { toolName: part.toolName } : {}),
    ...(typeof pendingRecord?.['toolCallId'] === 'string' ? { toolCallId: pendingRecord['toolCallId'] } : {}),
    ...(typeof result.scope === 'string' ? { scope: result.scope } : {}),
    ...(typeof result.reason === 'string' && result.reason.length > 0 ? { reason: result.reason } : {}),
    ...(typeof result.actionId === 'string' && result.actionId.length > 0 ? { actionId: result.actionId } : {}),
  };

  return {
    kind: 'confirmation',
    payload,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
