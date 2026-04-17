import type { IAgentLifecycle, IChatViewAccess } from '../core/chat-context';
import type { RenderEvent } from 'aily-lex';
import { RenderEventPartAdapter } from '../core/render-event-part-adapter';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';
import type { LexMessageLifecycleBridge, ITurnPartProcessor } from './lex-message-lifecycle-bridge';
import { LexSideEffectHandler } from './lex-side-effect-handler';

/** Narrow context: only needs partStore for rendering + toolCallingIteration for turn tracking */
type LexRenderEventBridgeContext = Pick<IChatViewAccess, 'partStore'> & Pick<IAgentLifecycle, 'toolCallingIteration'>;

/**
 * LexRenderEventBridge — unified bridge that consumes RenderEvent
 * and writes to ChatPartStore via RenderEventPartAdapter.
 *
 * Replaces the chain of:
 *   LexAgentEventBridge → LexRuntimeEventBridge
 *                        → LexStateEventBridge
 *                        → LexSubagentPartBridge
 *                        → PartEventProcessor
 *
 * Also implements ITurnPartProcessor so LexMessageLifecycleBridge can
 * call reset()/finalize() without knowing which processor is in use.
 *
 * Side effects previously scattered across those bridges are handled inline.
 */
export class LexRenderEventBridge implements ITurnPartProcessor {
  private readonly _adapter: RenderEventPartAdapter;
  private readonly _sideEffects: LexSideEffectHandler;
  /** Current lex turnId (set by turn_begin events). */
  private _currentTurnId: string | undefined;

  constructor(
    private readonly ctx: LexRenderEventBridgeContext,
    private readonly hostSyncBridge: LexHostSyncBridge,
    private readonly messageLifecycleBridge: LexMessageLifecycleBridge,
  ) {
    this._adapter = new RenderEventPartAdapter(ctx.partStore);
    this._sideEffects = new LexSideEffectHandler(ctx, hostSyncBridge);
  }

  /** Sync adapter msgIndex with the current assistant message. */
  syncMsgIndex(): void {
    this._adapter.setMsgIndex(this.messageLifecycleBridge.currentMsgIndex);
  }

  /** Process a single RenderEvent. */
  processEvent(event: RenderEvent): void {
    // Capture turnId from turn_begin for message tagging
    if (event.type === 'turn_begin') {
      this._currentTurnId = event.turnId;
    }

    this.messageLifecycleBridge.ensureAilyMessage(this._currentTurnId);
    this.syncMsgIndex();

    // Side effects (file-edit tracking, turn counting, todo sync)
    this._sideEffects.processEvent(event);

    // Core Part mutation via adapter
    this._adapter.process(event);
  }

  /** Flush an array of pending RenderEvents. */
  flushPendingEvents(events: readonly RenderEvent[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  /** Reset per-turn state. Satisfies ITurnPartProcessor. */
  reset(): void {
    this._adapter.reset();
    this._currentTurnId = undefined;
  }

  /** Alias for reset(). */
  resetTurnState(): void {
    this.reset();
  }

  /** Clean up. */
  dispose(): void {
    this._adapter.dispose();
  }
}
