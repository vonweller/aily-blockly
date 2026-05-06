import type { TurnResponseTurn } from 'aily-lex/browser';

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

type HostSessionRestoreContext = ChatViewWriteBridgeContext
  & Pick<IAgentLifecycle, 'toolCallingIteration'>
  & Pick<ISessionAccess, 'conversationMessages' | 'chatService'>
  & Pick<IChatServiceAccess, 'contextBudgetService' | 'editCheckpointService' | 'ailyChatConfigService'>
  & Pick<IChatCoordination, 'lexStream'>
  & {
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
    this.ctx.replaceSharedHostProjectionState?.(hostResponseState);
    this.applyHostView(hostResponseState);

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
}
