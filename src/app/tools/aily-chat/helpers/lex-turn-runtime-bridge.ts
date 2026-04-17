import type { LexAgentLifecycleBridge } from './lex-agent-lifecycle-bridge';
import type { LexTurnExecutionBridge } from './lex-turn-execution-bridge';
import type { LexTurnDraft } from './lex-message-lifecycle-bridge';
import type { LexTurnStartupBridge } from './lex-turn-startup-bridge';
import type { LexUiEventBridge } from './lex-ui-event-bridge';
import type { RenderEvent } from 'aily-lex';

/**
 * Groups the remaining turn-level startup/execution lifecycle entrypoints
 * so LexOwnerFacade can expose owner properties instead of thin method shims.
 */
export class LexTurnRuntimeBridge {
  constructor(
    private readonly agentLifecycleBridge: LexAgentLifecycleBridge,
    private readonly turnStartupBridge: LexTurnStartupBridge,
    private readonly turnExecutionBridge: LexTurnExecutionBridge,
    private readonly uiEventBridge: LexUiEventBridge,
  ) {}

  begin(userMessage: string): string | undefined {
    return this.turnStartupBridge.beginMainAgentTurn(userMessage);
  }

  async run(userMessage: string): Promise<void> {
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
      this.turnExecutionBridge.runTurnWithRenderEvents(source, userMessage);
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