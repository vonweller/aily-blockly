import type { SessionSnapshot, RenderEvent } from 'aily-lex/browser';

import type { IChatContext } from '../core/chat-context';
import { RenderEventPartAdapter } from '../core/render-event-part-adapter';
import { ChatViewWriteBridge } from './chat-view-write-bridge';

import type { HostSessionRecord } from '../services/chat-history.service';

/**
 * Restores host-side persisted chat history back into the active UI/session state.
 *
 * Keeps host record application, Part reconstruction, lex restore handoff,
 * and post-restore host sync out of SessionLifecycleHelper.
 */
export class HostSessionRestoreBridge {
  private readonly viewWriteBridge: ChatViewWriteBridge;

  constructor(private readonly ctx: IChatContext) {
    this.viewWriteBridge = new ChatViewWriteBridge(ctx);
  }

  async restore(hostRecord: HostSessionRecord): Promise<void> {
    this.applyChatList(hostRecord);
    this.restoreSessionMetadata(hostRecord);

    const restoredLexSession = await this.ctx.lexStream.session.restore(
      this.ctx.sessionId,
      hostRecord.turns,
    );

    const lexSnapshot = restoredLexSession
      ? this.ctx.lexStream.session.snapshot()
      : null;
    this.restoreExecutionNarrative(lexSnapshot);

    // Restore context budget: prefer persisted lex-derived values over local estimate
    const savedBudget = hostRecord.metadata?.contextBudget;
    if (savedBudget && savedBudget.maxContextTokens > 0 && savedBudget.currentTokens > 0) {
      this.ctx.contextBudgetService?.applyLexBudgetEvent(
        savedBudget.maxContextTokens,
        savedBudget.currentTokens,
        { usagePercent: savedBudget.usagePercent },
      );
    } else {
      this.ctx.contextBudgetService?.refreshLocalEstimate(
        restoredLexSession ? this.ctx.conversationMessages : [],
        this.ctx.lexStream.runtime.tools(),
      );
    }

    await this.restoreEditCheckpoints();
    this.finalizeRestoreUi(restoredLexSession);
  }

  private applyChatList(hostRecord: HostSessionRecord): void {
    this.viewWriteBridge.replaceHistoryList(hostRecord.chatList);
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

  private async restoreEditCheckpoints(): Promise<void> {
    this.ctx.editCheckpointService?.clear();
    try {
      const fileHistory = this.ctx.lexStream.agent.getAgent()?.getFileHistory?.();
      if (fileHistory) {
        this.ctx.editCheckpointService.setFileHistory(fileHistory);
      }
    } catch {
      // ignore file history restore failures
    }

    await this.ctx.editCheckpointService?.loadFromFileHistory();

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

  private restoreExecutionNarrative(snapshot: SessionSnapshot | null): void {
    // Phase 3: only the RenderEvent path remains.
    // When it cannot run (no lex snapshot / no renderSessionHistory), the Parts
    // already deserialized by applyChatList → replaceHistoryList serve as static fallback.
    if (snapshot) {
      this.tryRestoreFromRenderEvents(snapshot);
    }
  }

  /**
   * R3.3 — New restore path using renderSessionHistory() → RenderEventPartAdapter.
   *
   * Produces a flat RenderEvent[] from the lex SessionSnapshot, then replays
   * them through the adapter to reconstruct all Parts (tool calls, subagents,
   * thinking, background tasks, todos) in a single pass.
   *
   * Phase 1.3: each turn targets a distinct existing aily message (matched by
   * position), so multi-turn sessions restore into separate messages instead of
   * being concatenated into one.
   *
   * Returns true if it handled the restore, false to fall back to legacy path.
   */
  private tryRestoreFromRenderEvents(snapshot: SessionSnapshot): boolean {
    // renderSessionHistory is available on ctx.lexStream from the lex bootstrap
    const renderFn = this.ctx.lexStream?.agent?.getLex?.()?.renderSessionHistory as
      ((snap: SessionSnapshot) => RenderEvent[]) | undefined;
    if (!renderFn) return false;

    const events = renderFn(snapshot);
    if (events.length === 0) return false;

    // Build a queue of existing aily message indices from the chat list.
    // These were created by applyChatList → replaceHistoryList.
    const ailyMsgIndices: number[] = [];
    for (let i = 0; i < this.ctx.list.length; i++) {
      if (this.ctx.list[i].role === 'aily') {
        ailyMsgIndices.push(i);
      }
    }

    const adapter = new RenderEventPartAdapter(this.ctx.partStore);
    let ailyMsgCursor = 0; // index into ailyMsgIndices
    let currentMsgIndex = -1;

    try {
      for (const event of events) {
        if (event.type === 'turn_begin') {
          const turnId = event.turnId;

          if (ailyMsgCursor < ailyMsgIndices.length) {
            // Target the next existing aily message
            currentMsgIndex = ailyMsgIndices[ailyMsgCursor];
            ailyMsgCursor++;

            // Clear old deserialized Parts — we will re-populate from render events
            this.ctx.partStore.clearMessage(currentMsgIndex);

            // Tag the message with turnId
            const msg = this.ctx.list[currentMsgIndex];
            if (msg) {
              if (turnId) msg.turnId = turnId;
            }
          } else {
            // More turns than existing aily messages — create a new one
            currentMsgIndex = this.viewWriteBridge.ensureTrailingAilyPartsMessage({
              source: 'mainAgent',
              state: 'done',
              scrollOnCreate: false,
              forceNew: true,
              turnId,
            });
          }

          adapter.setMsgIndex(currentMsgIndex);
          adapter.reset();
          continue;
        }

        if (event.type === 'turn_end') {
          // Finalize the current message
          if (currentMsgIndex >= 0 && currentMsgIndex < this.ctx.list.length) {
            this.ctx.list[currentMsgIndex].state = 'done';
            this.ctx.list[currentMsgIndex].content = this.ctx.partStore.serializeToContent(currentMsgIndex);
          }
          continue;
        }

        // If we haven't seen a turn_begin yet (shouldn't happen normally), skip
        if (currentMsgIndex < 0) continue;

        adapter.process(event);
      }

      // Finalize the last message (in case there was no trailing turn_end)
      if (currentMsgIndex >= 0 && currentMsgIndex < this.ctx.list.length) {
        const msg = this.ctx.list[currentMsgIndex];
        if (msg.state !== 'done') msg.state = 'done';
        msg.content = this.ctx.partStore.serializeToContent(currentMsgIndex);
      }
    } finally {
      adapter.dispose();
    }

    this.ctx.triggerSyncDetectChanges();
    return true;
  }

}
