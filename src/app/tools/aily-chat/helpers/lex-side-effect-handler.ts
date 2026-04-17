import type { RenderEvent } from 'aily-lex';
import type { IAgentLifecycle } from '../core/chat-context';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';

/** Narrow context: only the mutable counter needed by side effects. */
type SideEffectContext = Pick<IAgentLifecycle, 'toolCallingIteration'>;

/**
 * Handles non-rendering side effects triggered by RenderEvents.
 *
 * Extracted from LexRenderEventBridge so that the bridge is a pure
 * RenderEvent → ChatPartStore mapper, and side effects (file-edit
 * tracking, turn counting, todo sync) live in a dedicated unit.
 */
export class LexSideEffectHandler {
  constructor(
    private readonly ctx: SideEffectContext,
    private readonly hostSyncBridge: LexHostSyncBridge,
  ) {}

  /** Process side effects for a single RenderEvent. */
  processEvent(event: RenderEvent): void {
    switch (event.type) {
      case 'tool_call_begin':
        // Track file edits for edit checkpoint service
        this.hostSyncBridge.recordFileToolEdit(event.toolName, event.input);
        break;

      case 'turn_begin':
        this.ctx.toolCallingIteration++;
        break;

      case 'todo_update':
        // Sync todos to blockly's todo storage
        this.hostSyncBridge.applyLexTodos(
          event.sessionId,
          event.items.map(item => ({
            id: item.id,
            title: item.title,
            status: item.status,
          })),
        );
        break;

      default:
        break;
    }
  }
}
