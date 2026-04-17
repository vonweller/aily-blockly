import type { ChatPartStore } from './chat-part-store';
import type { ChatPart, StatePart, SubagentPart, TerminalPart, ToolCallPart } from './chat-parts';

export interface MutableSubagentPart extends SubagentPart {
  _toolTimers?: Record<string, number>;
}

export class ChatPartMutationBridge {
  constructor(
    private readonly store: ChatPartStore,
    private readonly getMsgIndex: () => number,
  ) {}

  currentMsgIndex(): number {
    return this.getMsgIndex();
  }

  getCurrentParts(): ChatPart[] {
    return this.store.getParts(this.currentMsgIndex());
  }

  addPartToCurrentMessage(part: ChatPart): number {
    return this.store.addPart(this.currentMsgIndex(), part);
  }

  addTerminalPartForToolCall(toolCallId: string, part: TerminalPart): number {
    const msgIdx = this.findToolCallMsgIndex(toolCallId) ?? this.currentMsgIndex();
    return this.store.addPart(msgIdx, part);
  }

  appendMarkdownToCurrentMessage(text: string): number {
    return this.store.appendToMarkdown(this.currentMsgIndex(), text);
  }

  appendThinkingToCurrentMessage(text: string): number {
    return this.store.appendToThinking(this.currentMsgIndex(), text);
  }

  completeThinkingOnCurrentMessage(): void {
    this.store.completeThinking(this.currentMsgIndex());
  }

  findToolCallMsgIndex(toolCallId: string): number | undefined {
    return this.store.findToolCallMsgIndex(toolCallId);
  }

  updateToolCall(
    toolCallId: string,
    state: ToolCallPart['state'],
    text: string,
  ): void {
    const msgIdx = this.findToolCallMsgIndex(toolCallId) ?? this.currentMsgIndex();
    this.store.updateToolCall(msgIdx, toolCallId, state, text);
  }

  updateSubagent(
    toolCallId: string,
    state: SubagentPart['state'],
    resultText: string,
  ): void {
    const msgIdx = this.findToolCallMsgIndex(toolCallId) ?? this.currentMsgIndex();
    this.store.updateSubagent(msgIdx, toolCallId, state, resultText);
  }

  updateState(
    stateId: string,
    next: {
      state: StatePart['state'];
      text: string;
      progress?: number;
      kind?: StatePart['kind'];
      metadata?: Record<string, unknown>;
    },
  ): void {
    this.store.updateState(this.currentMsgIndex(), stateId, next);
  }

  findLatestRunningSubagentOnCurrentMessage(): { msgIndex: number; partIndex: number; part: MutableSubagentPart } | null {
    const msgIndex = this.currentMsgIndex();
    const parts = this.store.getParts(msgIndex);

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex];
      if (part.type === 'subagent' && part.state === 'doing') {
        return {
          msgIndex,
          partIndex,
          part: part as MutableSubagentPart,
        };
      }
    }

    return null;
  }

  replacePart(msgIndex: number, partIndex: number, part: ChatPart): void {
    this.store.updatePart(msgIndex, partIndex, part);
  }
}