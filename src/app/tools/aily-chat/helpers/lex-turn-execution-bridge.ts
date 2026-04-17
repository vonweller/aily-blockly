import type { IChatContext } from '../core/chat-context';
import { ChatPerformanceTracer } from '../services/chat-perf-tracer';
import type { LexUiEventBridge } from './lex-ui-event-bridge';
import type { LexRenderEventBridge } from './lex-render-event-bridge';
import type { RenderEvent } from 'aily-lex';

type LexChatAgent = {
  chat(userMessage: string, signal: AbortSignal): AsyncIterable<any>;
};

/** An object that yields RenderEvent from chat (AgentHandle-like). */
type RenderEventSource = {
  chat(message: string, signal?: AbortSignal): AsyncIterable<RenderEvent>;
};

/**
 * Handles lex turn execution scheduling for the blockly host path.
 *
 * Keeps runTurn orchestration, render yielding, and pending lifecycle event flush
 * out of LexOwnerFacade so the helper remains a thin runtime bridge.
 */
export class LexTurnExecutionBridge {
  private _renderEventBridge: LexRenderEventBridge | null = null;

  constructor(
    private readonly ctx: IChatContext,
    private readonly uiEventBridge: LexUiEventBridge,
    private readonly setAbortController: (controller: AbortController | null) => void,
  ) {}

  /**
   * Set the RenderEvent bridge. When set, `runTurnWithRenderEvents()` is used
   * instead of the legacy AgentEvent path.
   */
  setRenderEventBridge(bridge: LexRenderEventBridge): void {
    this._renderEventBridge = bridge;
  }

  runTurn(agent: LexChatAgent | null, userMessage: string): void {
    if (!agent) {
      console.error('[LexStream] Agent 未初始化，请先调用 ensureAgent()');
      this.uiEventBridge.appendExecutionError('aily-lex Agent 未初始化，请新建对话后重试');
      this.ctx.isWaiting = false;
      return;
    }

    const abortController = new AbortController();
    this.setAbortController(abortController);
    const signal = abortController.signal;
    const turnSpan = ChatPerformanceTracer.begin('lex_runTurn');

    this.resetTurnState();

    try {
      this.ctx.ngZone.runOutsideAngular(async () => {
        await this.preparePartsRendering();

        try {
          await this.consumeAgentEvents(agent, userMessage, signal);
        } catch (error: any) {
          this.reportExecutionError(error);
        }

        const turnDraft = this.uiEventBridge.getCurrentTurnDraft();
        ChatPerformanceTracer.end(turnSpan, 'lex_runTurn', `toolCalls=${turnDraft.toolCallCount}`);
        this.uiEventBridge.finalizeTurn();
      });
    } catch (error: any) {
      ChatPerformanceTracer.end(turnSpan, 'lex_runTurn', `error: ${error.message}`);
      this.uiEventBridge.finalizeTurn();
    }
  }

  flushPendingEvents(events: readonly any[]): void {
    if (this._renderEventBridge) {
      // RenderEvent path — events are already RenderEvent[]
      this._renderEventBridge.flushPendingEvents(events as readonly RenderEvent[]);
    } else {
      this.uiEventBridge.flushPendingEvents(events);
    }
  }

  /**
   * Run a turn consuming RenderEvent from an AgentHandle or RenderEventEmitter.
   *
   * This is the new R3 path: RenderEvent → LexRenderEventBridge → ChatPartStore.
   * No PartEventProcessor, no state-event/runtime-event bridge chain.
   */
  runTurnWithRenderEvents(source: RenderEventSource, userMessage: string): void {
    if (!this._renderEventBridge) {
      console.error('[LexStream] RenderEvent bridge not set, cannot use RenderEvent path');
      return;
    }

    const abortController = new AbortController();
    this.setAbortController(abortController);
    const signal = abortController.signal;
    const turnSpan = ChatPerformanceTracer.begin('lex_runTurn_render');

    this.resetRenderEventTurnState();

    try {
      this.ctx.ngZone.runOutsideAngular(async () => {
        await this.preparePartsRendering();

        try {
          await this.consumeRenderEvents(source, userMessage, signal);
        } catch (error: any) {
          this.reportExecutionError(error);
        }

        const turnDraft = this.uiEventBridge.getCurrentTurnDraft();
        ChatPerformanceTracer.end(turnSpan, 'lex_runTurn_render', `toolCalls=${turnDraft.toolCallCount}`);
        this.uiEventBridge.finalizeTurn();
      });
    } catch (error: any) {
      ChatPerformanceTracer.end(turnSpan, 'lex_runTurn_render', `error: ${error.message}`);
      this.uiEventBridge.finalizeTurn();
    }
  }

  private resetRenderEventTurnState(): void {
    this._renderEventBridge!.resetTurnState();
    this.ctx.activeToolExecutions = 0;
    this.ctx.currentStatelessMode = true;
    this.ctx.toolCallingIteration = 0;
  }

  private async consumeRenderEvents(
    source: RenderEventSource,
    userMessage: string,
    signal: AbortSignal,
  ): Promise<void> {
    let lastYieldTime = 0;
    for await (const event of source.chat(userMessage, signal)) {
      if (this.ctx.isCancelled) break;
      this._renderEventBridge!.processEvent(event);
      if (!this.shouldYieldForRenderEvent(event.type)) {
        continue;
      }
      const now = performance.now();
      if (now - lastYieldTime >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldTime = performance.now();
      }
    }
  }

  private shouldYieldForRenderEvent(eventType: string): boolean {
    return eventType === 'markdown_delta'
      || eventType === 'thinking_delta'
      || eventType === 'tool_call_begin'
      || eventType === 'tool_call_end'
      || eventType === 'state_update'
      || eventType === 'error_notice';
  }

  private resetTurnState(): void {
    this.uiEventBridge.resetTurnState();
    this.ctx.activeToolExecutions = 0;
    this.ctx.currentStatelessMode = true;
    this.ctx.toolCallingIteration = 0;
  }

  private async preparePartsRendering(): Promise<void> {
    this.uiEventBridge.ensureAilyMessage();

    // 等待同步 detectChanges 之后再进入 for-await，确保 Parts 组件已挂载。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  private async consumeAgentEvents(
    agent: LexChatAgent,
    userMessage: string,
    signal: AbortSignal,
  ): Promise<void> {
    let lastYieldTime = 0;
    for await (const event of agent.chat(userMessage, signal)) {
      if (this.ctx.isCancelled) break;
      this.uiEventBridge.processEvent(event);
      if (!this.shouldYieldForRendering(event.type)) {
        continue;
      }

      const now = performance.now();
      if (now - lastYieldTime >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldTime = performance.now();
      }
    }
  }

  private shouldYieldForRendering(eventType: string): boolean {
    return eventType === 'text_delta'
      || eventType === 'thinking'
      || eventType === 'tool_call_start'
      || eventType === 'tool_call_end'
      || eventType === 'instruction_state'
      || eventType === 'task_graph'
      || eventType === 'task_scheduler'
      || eventType === 'task_autonomy'
      || eventType === 'agent_team'
      || eventType === 'error';
  }

  private reportExecutionError(error: any): void {
    if (this.ctx.isCancelled || error?.name?.includes('Abort')) {
      return;
    }

    console.error('[LexStream] Agent 执行异常:', error);
    this.uiEventBridge.appendExecutionError(error.message || '执行异常', { retry: true });
  }
}