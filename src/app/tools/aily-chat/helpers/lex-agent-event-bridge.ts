import type { IChatContext } from '../core/chat-context';
import type { PartEventProcessor } from '../core/part-event-processor';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';
import type { LexMessageLifecycleBridge } from './lex-message-lifecycle-bridge';
import { LexRuntimeEventBridge } from './lex-runtime-event-bridge';
import { LexSessionDiagnosticsEventBridge } from './lex-session-diagnostics-event-bridge';
import { LexStateEventBridge } from './lex-state-event-bridge';

/**
 * Handles AgentEvent -> blockly UI/runtime bridge updates for the lex stream path.
 */
export class LexAgentEventBridge {
  private readonly stateEventBridge: LexStateEventBridge;
  private readonly runtimeEventBridge: LexRuntimeEventBridge;
  private readonly sessionDiagnosticsEventBridge: LexSessionDiagnosticsEventBridge;
  private readonly messageLifecycleBridge: Pick<LexMessageLifecycleBridge, 'ensureAilyMessage'>;

  constructor(
    ctx: IChatContext,
    partProcessor: PartEventProcessor,
    hostSyncBridge: LexHostSyncBridge,
    messageLifecycleBridge: LexMessageLifecycleBridge,
  ) {
    this.messageLifecycleBridge = messageLifecycleBridge;
    this.stateEventBridge = new LexStateEventBridge(partProcessor);
    this.runtimeEventBridge = new LexRuntimeEventBridge(ctx, partProcessor, hostSyncBridge, messageLifecycleBridge);
    this.sessionDiagnosticsEventBridge = new LexSessionDiagnosticsEventBridge();
  }

  processEvent(event: any): void {
    this.messageLifecycleBridge.ensureAilyMessage();

    if (this.stateEventBridge.processEvent(event)) {
      return;
    }

    if (this.runtimeEventBridge.processEvent(event)) {
      return;
    }

    this.sessionDiagnosticsEventBridge.processEvent(event);
  }
}