import type { LexTurnDraft } from './lex-message-lifecycle-bridge';
import type { AgentHandle, RenderEvent, TurnRequest } from 'aily-lex/browser';

type AgentLifecycleAccess = {
  getHandle?(): Pick<AgentHandle, 'chat'> | null;
  getAgent(): { chat(userMessage: string, signal?: AbortSignal): AsyncIterable<any> } | null;
  getLex(): { RenderEventEmitter?: new () => {
    process(event: any): readonly RenderEvent[];
    finalize(): readonly RenderEvent[];
  } } | undefined;
};

type TurnStartupAccess = {
  beginMainAgentTurn(userMessage: string, displayContent?: string, requestMetadata?: TurnRequest['metadata']): string | undefined;
};

type TurnExecutionAccess = {
  runTurn(agent: { chat(userMessage: string, signal?: AbortSignal): AsyncIterable<any> } | null, userMessage: string): void;
  runTurnWithRenderEvents(source: { chat(message: string, signal?: AbortSignal): AsyncIterable<RenderEvent> }, userMessage: string, displayContent?: string): void;
};

type TurnUiAccess = {
  getCurrentTurnDraft(): LexTurnDraft;
  ensureAilyMessage(): void;
  appendLifecycleError(message: string): void;
};

/**
 * Groups the remaining turn-level startup/execution lifecycle entrypoints
 * so LexOwnerFacade can expose owner properties instead of thin method shims.
 */
export class LexTurnRuntimeBridge {
  constructor(
    private readonly agentLifecycleBridge: AgentLifecycleAccess,
    private readonly turnStartupBridge: TurnStartupAccess,
    private readonly turnExecutionBridge: TurnExecutionAccess,
    private readonly uiEventBridge: TurnUiAccess,
  ) {}

  begin(userMessage: string, displayContent?: string, requestMetadata?: TurnRequest['metadata']): string | undefined {
    return this.turnStartupBridge.beginMainAgentTurn(userMessage, displayContent, requestMetadata);
  }

  async run(userMessage: string, displayContent?: string): Promise<void> {
    const handle = this.agentLifecycleBridge.getHandle?.() ?? null;
    if (handle) {
      this.turnExecutionBridge.runTurnWithRenderEvents(handle, userMessage, displayContent);
      return;
    }

    const agent = this.agentLifecycleBridge.getAgent();
    if (!agent) {
      this.turnExecutionBridge.runTurn(null, userMessage);
      return;
    }

    // Wrap raw AilyLexAgent into a RenderEventSource using RenderEventEmitter
    const lex = this.agentLifecycleBridge.getLex();
    if (lex?.RenderEventEmitter) {
      const RenderEventEmitter = lex.RenderEventEmitter;
      const source = {
        async *chat(message: string, signal?: AbortSignal): AsyncIterable<RenderEvent> {
          const emitter = new RenderEventEmitter();
          try {
            for await (const agentEvent of agent.chat(message, signal)) {
              const renderEvents = emitter.process(agentEvent);
              for (const re of renderEvents) {
                yield re;
              }
            }
          } finally {
            const finalEvents = emitter.finalize();
            for (const re of finalEvents) {
              yield re;
            }
          }
        },
      };
      this.turnExecutionBridge.runTurnWithRenderEvents(source, userMessage, displayContent);
    } else {
      // Fallback: legacy AgentEvent path
      this.turnExecutionBridge.runTurn(agent, userMessage);
    }
  }

  draft(): LexTurnDraft {
    return this.uiEventBridge.getCurrentTurnDraft();
  }

  ensureMessage(): void {
    this.uiEventBridge.ensureAilyMessage();
  }

  appendError(message: string): void {
    this.uiEventBridge.appendLifecycleError(message);
  }
}