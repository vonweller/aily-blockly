import type { IChatContext } from '../core/chat-context';
import type { ChatPart } from '../core/chat-parts';
import { AilyHost } from '../core/host';
import { ChatViewWriteBridge } from './chat-view-write-bridge';

/** Minimal interface that both PartEventProcessor and LexRenderEventBridge satisfy. */
export interface ITurnPartProcessor {
  reset(): void;
  finalize?(): void;
}

export interface LexTurnDraft {
  assistantText: string;
  toolCallCount: number;
}

/**
 * Handles assistant message lifecycle concerns for the lex stream path.
 *
 * Keeps message creation, native thinking state, Parts -> content rebuild,
 * and finalize side effects out of LexOwnerFacade.
 */
export class LexMessageLifecycleBridge {
  /** 原生 thinking 事件是否已开启（已输出 <think> 标签，等待闭合） */
  private _nativeThinkStarted = false;
  /** 当前 aily 消息在 list 中的索引（用于 Part 定位） */
  private _currentMsgIndex = -1;
  private readonly viewWriteBridge: ChatViewWriteBridge;

  constructor(
    private readonly ctx: IChatContext,
    private readonly partProcessor: ITurnPartProcessor,
    private readonly clearAbortController: () => void,
  ) {
    this.viewWriteBridge = new ChatViewWriteBridge(ctx);
  }

  get currentMsgIndex(): number {
    return this._currentMsgIndex;
  }

  startNativeThinking(): void {
    if (!this._nativeThinkStarted) {
      this._nativeThinkStarted = true;
    }
  }

  closeNativeThinking(): void {
    if (this._nativeThinkStarted) {
      this._nativeThinkStarted = false;
    }
  }

  resetTurnState(): void {
    this.closeNativeThinking();
    this._currentMsgIndex = -1;
    this.partProcessor.reset();
  }

  getCurrentTurnDraft(): LexTurnDraft {
    if (this._currentMsgIndex < 0) {
      return { assistantText: '', toolCallCount: 0 };
    }

    const parts = this.ctx.partStore.getParts(this._currentMsgIndex);
    let assistantText = '';
    let toolCallCount = 0;

    for (const part of parts) {
      if (part.type === 'markdown') {
        assistantText += part.content;
        continue;
      }

      if (this.isToolBearingPart(part)) {
        toolCallCount++;
      }
    }

    return { assistantText, toolCallCount };
  }

  /**
   * ★ Phase 4: 预创建 aily 消息条目
    * 不再依赖 legacy appendMessage/appendStreaming 自动创建，而是在 turn 开始时显式推入空消息。
   * 同时处理 source 切换（subagent）— 自动为新 source 创建消息。
   *
    * ★ Phase 2: 所有 aily 消息统一走 Part-based 渲染，无需 useParts 标记。
    * 主发送路径和 regenerate 都统一走 ensureAilyMessage()。
   */
  ensureAilyMessage(turnId?: string): void {
    const msgSource = this.ctx.currentMessageSource || 'mainAgent';
    this._currentMsgIndex = this.viewWriteBridge.ensureTrailingAilyPartsMessage({
      source: msgSource,
      state: 'doing',
      scrollOnCreate: true,
      turnId,
    });
  }

  finalize(): void {
    this.closeNativeThinking();
    this.partProcessor.finalize?.();
    this.rebuildContentFromParts();

    this.ctx.editCheckpointService.commitCurrentTurn();
    if (this.ctx.editCheckpointService.hasEditsInCurrentTurn()) {
      if (this.ctx.ailyChatConfigService.autoSaveEdits) {
        this.ctx.editCheckpointService.acceptAllAsBaseline();
        this.ctx.editCheckpointService.dismissSummary();
      } else {
        const summary = this.ctx.editCheckpointService.getEditsSummary();
        this.ctx.editCheckpointService.publishSummary(summary);
      }
    }

    this.ctx.viewAdapter.markLastMessageDone();
    this.ctx.ngZone.run(() => {
      this.ctx.isWaiting = false;
      this.ctx.isCompleted = true;
    });

    this.ctx.session.saveCurrentSession();

    if (!AilyHost.get().electron?.isWindowFocused()) {
      AilyHost.get().electron?.notify('Aily', '对话已完成');
    }

    void this.ctx.applyPendingSwitch();
    this.clearAbortController();
  }

  /**
   * ★ Phase 4: 从 Parts 重建 content string
   * 在 finalize 阶段调用，确保持久化和多轮 LLM 上下文有完整的 content。
   */
  private rebuildContentFromParts(): void {
    this.viewWriteBridge.syncPartsMessagesToContent();
  }

  private isToolBearingPart(part: ChatPart): boolean {
    return part.type === 'tool_call' || part.type === 'subagent';
  }
}