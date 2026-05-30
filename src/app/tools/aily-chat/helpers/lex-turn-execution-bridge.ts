import type { IAgentLifecycle, IChatServiceAccess } from '../core/chat-context';
import { ChatPerformanceTracer } from '../services/chat-perf-tracer';
import type { RenderEvent, SessionSnapshot, TurnRequest, TurnResponseStatus, TurnResponseTurn } from 'aily-lex/browser';
import type { LexTurnDraft } from './lex-message-lifecycle-bridge';
import type { HostSessionSaveTarget } from './host-session-save-bridge';

type LexTurnExecutionContext = Pick<
  IAgentLifecycle,
  'activeToolExecutions' | 'currentStatelessMode' | 'toolCallingIteration' | 'isCancelled' | 'isWaiting'
> & Pick<IChatServiceAccess, 'ngZone'>;

type LexChatAgent = {
  chat(userMessage: string, signal: AbortSignal): AsyncIterable<any>;
};

/** An object that yields RenderEvent from chat (AgentHandle-like). */
type RenderEventSource = {
  chat(message: string, signal?: AbortSignal): AsyncIterable<RenderEvent>;
};

type RenderEventSink = {
  readonly turnResponses?: readonly TurnResponseTurn[];
  reset(): void;
  hydrateTurnResponses?(turnResponses: readonly TurnResponseTurn[]): void;
  prepareTurnRequest(requestContent: string, displayContent?: string, metadata?: TurnRequest['metadata']): void;
  processEvent(event: RenderEvent): void;
  flushPendingEvents(events: readonly RenderEvent[]): void;
  finalizeCurrentTurn?(fallbackStatus?: TurnResponseStatus): boolean;
  appendExecutionError(message: string): boolean;
};

type TurnUiEventSink = {
  ensureAilyMessage(): void;
  resetTurnState(): void;
  getCurrentTurnDraft(): LexTurnDraft;
  finalizeTurn(saveTarget?: HostSessionSaveTarget | null): Promise<void>;
  appendExecutionError(message: string, options?: { retry?: boolean }): void;
  processEvent(event: any, scope?: 'main' | 'subagent'): void;
  flushPendingEvents(events: readonly any[]): void;
};

const GENERIC_EXECUTION_ERROR_MESSAGE = 'Sorry, something went wrong.';

interface LexTurnExecutionRunState {
  readonly sessionId: string | null;
  readonly saveTarget: HostSessionSaveTarget | null;
  detachedRenderEventBridge: RenderEventSink | null;
  requestContent: string;
  requestDisplayContent?: string;
  requestMetadata?: TurnRequest['metadata'];
}

const BACKGROUND_SESSION_TRACE_FLAG = 'aily.chat.traceBackgroundSession';
const BACKGROUND_SESSION_TRACE_GLOBAL_KEYS = [
  '__AILY_CHAT_TRACE_BACKGROUND_SESSION__',
  'AILY_CHAT_TRACE_BACKGROUND_SESSION',
] as const;

function parseBackgroundSessionTraceFlag(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
  }
  return false;
}

function isBackgroundSessionTraceEnabled(): boolean {
  try {
    const runtime = globalThis as Record<string, unknown>;
    for (const key of BACKGROUND_SESSION_TRACE_GLOBAL_KEYS) {
      if (parseBackgroundSessionTraceFlag(runtime[key])) {
        return true;
      }
    }
    const localStorageValue = globalThis.localStorage?.getItem?.(BACKGROUND_SESSION_TRACE_FLAG);
    return parseBackgroundSessionTraceFlag(localStorageValue);
  } catch {
    return false;
  }
}

function traceBackgroundSessionExecution(event: string, details: Record<string, unknown>): void {
  if (!isBackgroundSessionTraceEnabled()) {
    return;
  }
  console.info('[AilyChat][bg-session][execution]', event, details);
}

/**
 * Handles lex turn execution scheduling for the blockly host path.
 *
 * Keeps runTurn orchestration, render yielding, and pending lifecycle event flush
 * out of LexOwnerFacade so the helper remains a thin runtime bridge.
 */
export class LexTurnExecutionBridge {
  private _renderEventBridge: RenderEventSink | null = null;

  constructor(
    private readonly ctx: LexTurnExecutionContext,
    private readonly uiEventBridge: TurnUiEventSink,
    private readonly setAbortController: (sessionId: string | null | undefined, controller: AbortController | null) => void,
    private readonly clearAbortController: (sessionId: string | null | undefined) => void,
    private readonly getCurrentSessionId: () => string | null | undefined,
    private readonly getCurrentRequestMetadata?: () => TurnRequest['metadata'] | undefined,
    private readonly captureExecutionSaveTarget?: (sessionId: string | null) => HostSessionSaveTarget | null,
    private readonly readExecutionSessionSnapshot?: (sessionId: string | null) => SessionSnapshot | null,
    private readonly readExecutionTurnResponses?: (sessionId: string | null) => readonly TurnResponseTurn[],
    private readonly syncExecutionRuntimeTurnResponses?: (
      sessionId: string | null,
      turnResponses: readonly TurnResponseTurn[] | null | undefined,
    ) => void,
    private readonly createDetachedRenderEventSink?: (
      sessionId: string,
      seedTurnResponses: readonly TurnResponseTurn[],
    ) => RenderEventSink | null,
    private readonly getExecutionSessionId?: () => string | null | undefined,
  ) {}

  /**
   * Set the RenderEvent bridge. When set, `runTurnWithRenderEvents()` is used
   * instead of the legacy AgentEvent path.
   */
  setRenderEventBridge(bridge: RenderEventSink): void {
    this._renderEventBridge = bridge;
  }

  runTurn(agent: LexChatAgent | null, userMessage: string): Promise<void> {
    traceBackgroundSessionExecution('run-legacy-turn-start', {
      hasAgent: !!agent,
      sessionId: this.captureExecutionSessionId(),
    });
    if (!agent) {
      console.error('[LexStream] Agent 未初始化，请先调用 ensureAgent()');
      this.uiEventBridge.appendExecutionError(GENERIC_EXECUTION_ERROR_MESSAGE);
      this.ctx.isWaiting = false;
      return Promise.resolve();
    }

    const executionState = this.createExecutionRunState(userMessage);
    const abortController = new AbortController();
    this.setAbortController(executionState.sessionId, abortController);
    const signal = abortController.signal;
    const turnSpan = ChatPerformanceTracer.begin('lex_runTurn');

    this.resetTurnState();

    try {
      return this.ctx.ngZone.runOutsideAngular(async () => {
        await this.preparePartsRendering();

        try {
          await this.consumeAgentEvents(executionState, agent, userMessage, signal);
        } catch (error: any) {
          this.reportExecutionError(error, executionState);
        }

        const turnDraft = this.uiEventBridge.getCurrentTurnDraft();
        ChatPerformanceTracer.end(turnSpan, 'lex_runTurn', `toolCalls=${turnDraft.toolCallCount}`);
        await this.finalizeTurnExecution(executionState);
      });
    } catch (error: any) {
      ChatPerformanceTracer.end(turnSpan, 'lex_runTurn', `error: ${error.message}`);
      return this.finalizeTurnExecution(executionState);
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
  runTurnWithRenderEvents(source: RenderEventSource, userMessage: string, displayContent?: string): Promise<void> {
    if (!this._renderEventBridge) {
      console.error('[LexStream] RenderEvent bridge not set, cannot use RenderEvent path');
      return Promise.resolve();
    }

    const executionState = this.createExecutionRunState(userMessage, displayContent);
    const abortController = new AbortController();
    this.setAbortController(executionState.sessionId, abortController);
    const signal = abortController.signal;
    const turnSpan = ChatPerformanceTracer.begin('lex_runTurn_render');

    this.resetRenderEventTurnState(executionState, userMessage, displayContent);

    try {
      return this.ctx.ngZone.runOutsideAngular(async () => {
        await this.preparePartsRendering();

        try {
          await this.consumeRenderEvents(executionState, source, userMessage, signal);
        } catch (error: any) {
          this.reportExecutionError(error, executionState);
        }

        const turnDraft = this.uiEventBridge.getCurrentTurnDraft();
        ChatPerformanceTracer.end(turnSpan, 'lex_runTurn_render', `toolCalls=${turnDraft.toolCallCount}`);
        await this.finalizeTurnExecution(executionState);
      });
    } catch (error: any) {
      ChatPerformanceTracer.end(turnSpan, 'lex_runTurn_render', `error: ${error.message}`);
      return this.finalizeTurnExecution(executionState);
    }
  }

  private createExecutionRunState(
    requestContent: string,
    requestDisplayContent?: string,
  ): LexTurnExecutionRunState {
    const sessionId = this.captureExecutionSessionId();
    return {
      sessionId,
      saveTarget: this.captureExecutionSaveTarget?.(sessionId) ?? null,
      detachedRenderEventBridge: null,
      requestContent,
      requestDisplayContent,
      requestMetadata: this.getCurrentRequestMetadata?.(),
    };
  }

  private captureExecutionSessionId(): string | null {
    const sessionId = this.getExecutionSessionId?.() ?? this.getCurrentSessionId();
    if (typeof sessionId !== 'string') {
      return null;
    }

    const trimmedSessionId = sessionId.trim();
    return trimmedSessionId.length > 0 ? trimmedSessionId : null;
  }

  private async finalizeTurnExecution(state: LexTurnExecutionRunState): Promise<void> {
    traceBackgroundSessionExecution('finalize-turn-execution', {
      sessionId: state.sessionId,
      hasDetachedSink: !!state.detachedRenderEventBridge,
    });
    try {
      if (state.detachedRenderEventBridge?.finalizeCurrentTurn) {
        const finalized = state.detachedRenderEventBridge.finalizeCurrentTurn('completed');
        traceBackgroundSessionExecution('finalize-detached-turn-fallback', {
          sessionId: state.sessionId,
          finalized,
        });
      }
      await this.uiEventBridge.finalizeTurn(this.buildExecutionSaveTarget(state));
    } finally {
      state.detachedRenderEventBridge = null;
      if (state.sessionId) {
        this.clearAbortController(state.sessionId);
      }
    }
  }

  private buildExecutionSaveTarget(state: LexTurnExecutionRunState): HostSessionSaveTarget | null {
    if (!state.saveTarget) {
      return null;
    }

    return {
      ...state.saveTarget,
      toolCallingIteration: this.ctx.toolCallingIteration,
      sessionSnapshot: this.readExecutionSessionSnapshot?.(state.sessionId) ?? state.saveTarget.sessionSnapshot ?? null,
      turnResponses: [...(this.readCurrentExecutionTurnResponses(state) ?? state.saveTarget.turnResponses ?? [])],
    };
  }

  private readCurrentExecutionTurnResponses(state: LexTurnExecutionRunState): readonly TurnResponseTurn[] | undefined {
    if (state.sessionId && this.isExecutionSessionVisible(state.sessionId)) {
      traceBackgroundSessionExecution('read-visible-turn-responses', {
        sessionId: state.sessionId,
        hasDetachedSink: !!state.detachedRenderEventBridge,
      });
      return this._renderEventBridge?.turnResponses
        ?? state.detachedRenderEventBridge?.turnResponses
        ?? this.readExecutionTurnResponses?.(state.sessionId);
    }

    if (state.detachedRenderEventBridge?.turnResponses) {
      return state.detachedRenderEventBridge.turnResponses;
    }

    return this.readExecutionTurnResponses?.(state.sessionId);
  }

  private resetRenderEventTurnState(
    state: LexTurnExecutionRunState,
    userMessage: string,
    displayContent?: string,
  ): void {
    if (state.sessionId && !this.isExecutionSessionVisible(state.sessionId)) {
      this.resolveExecutionRenderEventSink(state);
      this.ctx.activeToolExecutions = 0;
      this.ctx.currentStatelessMode = true;
      this.ctx.toolCallingIteration = 0;
      return;
    }

    this._renderEventBridge!.reset();
    this._renderEventBridge!.prepareTurnRequest(
      userMessage,
      displayContent,
      state.requestMetadata,
    );
    this.ctx.activeToolExecutions = 0;
    this.ctx.currentStatelessMode = true;
    this.ctx.toolCallingIteration = 0;
  }

  private async consumeRenderEvents(
    state: LexTurnExecutionRunState,
    source: RenderEventSource,
    userMessage: string,
    signal: AbortSignal,
  ): Promise<void> {
    traceBackgroundSessionExecution('consume-render-events-start', {
      sessionId: state.sessionId,
      hasDetachedSink: !!state.detachedRenderEventBridge,
    });
    let lastYieldTime = 0;
    let eventCount = 0;
    let ignoredCrossSessionCancel = false;
    let cancelled = false;
    for await (const event of source.chat(userMessage, signal)) {
      eventCount += 1;
      if (eventCount === 1) {
        traceBackgroundSessionExecution('consume-render-events-first', {
          sessionId: state.sessionId,
          eventType: event.type,
        });
      }
      const renderEventSink = this.resolveExecutionRenderEventSink(state);
      renderEventSink.processEvent(event);
      this.syncExecutionRuntimeState(state, renderEventSink);

      const cancellationApplies = this.isExecutionCancellationEffective(state);
      if (!cancellationApplies && this.ctx.isCancelled && !ignoredCrossSessionCancel) {
        ignoredCrossSessionCancel = true;
        traceBackgroundSessionExecution('consume-render-events-ignore-cross-session-cancel', {
          sessionId: state.sessionId,
          visibleSessionId: this.captureVisibleSessionId(),
        });
      }
      if (cancellationApplies) {
        cancelled = true;
        break;
      }

      if (!this.shouldYieldForRenderEvent(event.type)) {
        continue;
      }
      const now = performance.now();
      if (now - lastYieldTime >= 16) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYieldTime = performance.now();
      }
    }
    traceBackgroundSessionExecution('consume-render-events-end', {
      sessionId: state.sessionId,
      eventCount,
      cancelled,
    });
  }

  private shouldYieldForRenderEvent(eventType: string): boolean {
    return eventType === 'markdown_delta'
      || eventType === 'thinking_delta'
      || eventType === 'info_notice'
      || eventType === 'warning_notice'
      || eventType === 'subagent_begin'
      || eventType === 'subagent_activity'
      || eventType === 'subagent_end'
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
    state: LexTurnExecutionRunState,
    agent: LexChatAgent,
    userMessage: string,
    signal: AbortSignal,
  ): Promise<void> {
    let lastYieldTime = 0;
    for await (const event of agent.chat(userMessage, signal)) {
      this.uiEventBridge.processEvent(event);
      traceBackgroundSessionExecution('legacy-agent-event', {
        type: event?.type,
      });
      if (this.isExecutionCancellationEffective(state)) {
        break;
      }
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

  private reportExecutionError(error: any, state: LexTurnExecutionRunState): void {
    if (this.isExecutionCancellationEffective(state) || error?.name?.includes('Abort')) {
      return;
    }

    console.error('[LexStream] Agent 执行异常:', error);
    if (!this._renderEventBridge) {
      this.uiEventBridge.appendExecutionError(GENERIC_EXECUTION_ERROR_MESSAGE, { retry: true });
      return;
    }

    const renderEventSink = this.resolveExecutionRenderEventSink(state);
    if (renderEventSink.appendExecutionError(GENERIC_EXECUTION_ERROR_MESSAGE)) {
      this.syncExecutionRuntimeState(state, renderEventSink);
      return;
    }
    this.uiEventBridge.appendExecutionError(GENERIC_EXECUTION_ERROR_MESSAGE, { retry: true });
  }

  private syncExecutionRuntimeState(
    state: LexTurnExecutionRunState,
    renderEventSink?: RenderEventSink | null,
  ): void {
    const executionSessionId = state.sessionId;
    if (!executionSessionId) {
      return;
    }

    this.syncExecutionRuntimeTurnResponses?.(
      executionSessionId,
      renderEventSink?.turnResponses
        ?? this.readExecutionTurnResponses?.(executionSessionId),
    );
  }

  private resolveExecutionRenderEventSink(state: LexTurnExecutionRunState): RenderEventSink {
    if (!this._renderEventBridge) {
      throw new Error('RenderEvent bridge not set');
    }

    const executionSessionId = state.sessionId;
    if (!executionSessionId || this.isExecutionSessionVisible(executionSessionId)) {
      if (state.detachedRenderEventBridge?.turnResponses?.length) {
        traceBackgroundSessionExecution('reattach-visible-sink', {
          sessionId: executionSessionId ?? null,
          replayedTurnResponses: state.detachedRenderEventBridge.turnResponses.length,
        });
        this._renderEventBridge.hydrateTurnResponses?.(state.detachedRenderEventBridge.turnResponses);
      }
      state.detachedRenderEventBridge = null;
      return this._renderEventBridge;
    }

    if (!state.detachedRenderEventBridge) {
      const seedTurnResponses = this.readExecutionTurnResponses?.(executionSessionId)
        ?? this._renderEventBridge.turnResponses
        ?? [];
      traceBackgroundSessionExecution('detach-to-background-sink', {
        sessionId: executionSessionId,
        seedTurnResponses: seedTurnResponses.length,
      });
      state.detachedRenderEventBridge = this.createDetachedRenderEventSink?.(
        executionSessionId,
        seedTurnResponses,
      ) ?? null;
      if (state.detachedRenderEventBridge) {
        state.detachedRenderEventBridge.hydrateTurnResponses?.(seedTurnResponses);
        state.detachedRenderEventBridge.prepareTurnRequest(
          state.requestContent,
          state.requestDisplayContent,
          state.requestMetadata,
        );
      }
    }

    return state.detachedRenderEventBridge ?? this._renderEventBridge;
  }

  private isExecutionSessionVisible(executionSessionId: string): boolean {
    return this.captureVisibleSessionId() === executionSessionId;
  }

  private captureVisibleSessionId(): string | null {
    const currentSessionId = this.getCurrentSessionId();
    if (typeof currentSessionId !== 'string') {
      return null;
    }

    const trimmedSessionId = currentSessionId.trim();
    return trimmedSessionId.length > 0 ? trimmedSessionId : null;
  }

  private isExecutionCancellationEffective(state: LexTurnExecutionRunState): boolean {
    if (!this.ctx.isCancelled) {
      return false;
    }

    if (!state.sessionId) {
      return true;
    }

    return this.isExecutionSessionVisible(state.sessionId);
  }
}
