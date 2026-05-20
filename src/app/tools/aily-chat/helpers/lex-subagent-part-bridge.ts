import type { ChatPartStoreReadableHandle } from '../core/chat-part-store';
import type { SubagentChildItem } from '../core/chat-parts';
import {
  ChatPartMutationBridge,
  type ChatPartMutationStoreAccess,
  type MutableSubagentPart,
} from '../core/chat-part-mutation-bridge';

type LexSubagentPartMutations = Pick<
  ChatPartMutationBridge,
  'updateLatestRunningSubagentOnCurrentMessage'
>;

/**
 * Handles real-time forwarding of lex subagent events into tool_call metadata child items.
 */
export class LexSubagentPartBridge {
  private readonly partMutations: LexSubagentPartMutations;
  private readonly toolTimers = new Map<string, number>();

  constructor(
    partStore: ChatPartMutationStoreAccess,
    getCurrentMessageHandle: () => ChatPartStoreReadableHandle | null,
  ) {
    this.partMutations = new ChatPartMutationBridge(
      partStore,
      getCurrentMessageHandle,
    );
  }

  processEvent(event: any): void {
    switch (event.type) {
      case 'thinking':
      case 'text_delta':
      case 'tool_call_start':
      case 'tool_call_end':
      case 'error':
        break;
      default:
        return;
    }

    this.partMutations.updateLatestRunningSubagentOnCurrentMessage(activeSubagent => {
      const nextPart: MutableSubagentPart = {
        ...activeSubagent,
        childItems: [...(activeSubagent.childItems ?? [])],
      };
      const items = nextPart.childItems as SubagentChildItem[];

      switch (event.type) {
        case 'thinking': {
          const last = items.length > 0 ? items[items.length - 1] : null;
          if (last && last.kind === 'thinking') {
            last.content += event.text;
          } else {
            items.push({ kind: 'thinking', content: event.text });
          }
          break;
        }

        case 'text_delta': {
          const last = items.length > 0 ? items[items.length - 1] : null;
          if (last && last.kind === 'text') {
            last.content += event.text;
          } else {
            items.push({ kind: 'text', content: event.text });
          }
          break;
        }

        case 'tool_call_start': {
          this.toolTimers.set(event.toolCallId, Date.now());
          items.push({
            kind: 'tool',
            content: '',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            argsSummary: this.formatToolArgs(event.input),
            state: 'doing',
          });
          break;
        }

        case 'tool_call_end': {
          const startTime = this.toolTimers.get(event.toolCallId);
          const durationSec = typeof startTime === 'number'
            ? (Date.now() - startTime) / 1000
            : undefined;
          const isError = event.result?.isError;
          for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].kind === 'tool' && items[i].toolCallId === event.toolCallId) {
              items[i].state = isError ? 'error' : 'done';
              items[i].duration = durationSec != null ? +durationSec.toFixed(1) : undefined;
              break;
            }
          }
          this.toolTimers.delete(event.toolCallId);
          break;
        }

        case 'error':
          items.push({ kind: 'text', content: `❌ Error: ${event.error}` });
          break;
      }

      nextPart.childItems = items;
      return nextPart;
    });
  }

  private formatToolArgs(input: any): string {
    if (!input) return '';
    try {
      if (input.command) return `\`${(input.command as string).substring(0, 60)}\``;
      if (input.path) return `\`${(input.path as string).split(/[\\/]/).pop()}\``;
      if (input.query || input.keyword) return `"${input.query || input.keyword}"`;
      if (input.action) return input.action;
      if (input.info_type) return input.info_type;
    } catch {
      // ignore formatting failures
    }
    return '';
  }
}