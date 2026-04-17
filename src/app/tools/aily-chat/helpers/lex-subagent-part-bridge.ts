import type { IChatContext } from '../core/chat-context';
import type { SubagentPart, SubagentChildItem } from '../core/chat-parts';
import { ChatPartMutationBridge, type MutableSubagentPart } from '../core/chat-part-mutation-bridge';

/**
 * Handles real-time forwarding of lex subagent events into blockly SubagentPart child items.
 */
export class LexSubagentPartBridge {
  private readonly partMutations: ChatPartMutationBridge;

  constructor(
    ctx: IChatContext,
    getCurrentMsgIndex: () => number,
  ) {
    this.partMutations = new ChatPartMutationBridge(ctx.partStore, getCurrentMsgIndex);
  }

  processEvent(event: any): void {
    const activeSubagent = this.partMutations.findLatestRunningSubagentOnCurrentMessage();
    if (!activeSubagent) return;

    const nextPart: MutableSubagentPart = {
      ...activeSubagent.part,
      _toolTimers: { ...(activeSubagent.part._toolTimers ?? {}) },
      childItems: [...(activeSubagent.part.childItems ?? [])],
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
        nextPart._toolTimers = nextPart._toolTimers ?? {};
        nextPart._toolTimers[event.toolCallId] = Date.now();
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
        const durationSec = nextPart._toolTimers?.[event.toolCallId]
          ? (Date.now() - nextPart._toolTimers[event.toolCallId]) / 1000
          : undefined;
        const isError = event.result?.isError;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].kind === 'tool' && items[i].toolCallId === event.toolCallId) {
            items[i].state = isError ? 'error' : 'done';
            items[i].duration = durationSec != null ? +durationSec.toFixed(1) : undefined;
            break;
          }
        }
        break;
      }

      case 'error':
        items.push({ kind: 'text', content: `❌ Error: ${event.error}` });
        break;

      default:
        return;
    }

      nextPart.childItems = items;
      nextPart.resultText = this.serializeChildItems(items);
      this.partMutations.replacePart(activeSubagent.msgIndex, activeSubagent.partIndex, nextPart);
  }

  private serializeChildItems(items: SubagentChildItem[]): string {
    let text = '';
    for (const item of items) {
      switch (item.kind) {
        case 'thinking':
          text += `<think>${item.content}</think>`;
          break;
        case 'tool': {
          const icon = item.state === 'doing' ? '⏳' : item.state === 'error' ? '❌' : '✅';
          const dur = item.duration != null ? ` (${item.duration}s)` : '';
          text += `\n${icon} \`${item.toolName}\`${item.argsSummary ? ' ' + item.argsSummary : ''}${dur}\n`;
          break;
        }
        case 'text':
          text += item.content;
          break;
      }
    }
    return text;
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