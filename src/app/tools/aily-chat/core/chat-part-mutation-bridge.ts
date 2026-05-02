import type { ChatPartStore, ChatPartStoreReadableHandle } from './chat-part-store';
import type { ChatPart, StatePart, SubagentToolCallSnapshot, TerminalPart, ToolCallPart } from './chat-parts';

export interface MutableSubagentPart extends SubagentToolCallSnapshot {
  _toolTimers?: Record<string, number>;
}

export type ChatPartMutationStoreAccess = Pick<
  ChatPartStore,
  | 'addPartToHandle'
  | 'appendToMarkdownHandle'
  | 'appendToThinkingHandle'
  | 'completeThinkingHandle'
  | 'getPartsForHandle'
  | 'patchToolCallForHandle'
  | 'updateToolCallForHandle'
  | 'updateSubagentForHandle'
  | 'updateStateForHandle'
  | 'upsertStateForHandle'
  | 'postProcessMarkdownForHandle'
  | 'updateLatestRunningSubagentForHandle'
  | 'findToolCallOpaqueHandle'
>;

type ChatPartMutationStateUpdate = {
  state: StatePart['state'];
  text: string;
  progress?: number;
  kind?: StatePart['kind'];
  metadata?: Record<string, unknown>;
};

export class ChatPartMutationBridge {
  constructor(
    private readonly store: ChatPartMutationStoreAccess,
    private readonly getCurrentMessageHandle: () => ChatPartStoreReadableHandle | null,
  ) {}

  currentMessageHandle(): ChatPartStoreReadableHandle | null {
    return this.getCurrentMessageHandle() ?? null;
  }

  addPartToCurrentMessage(part: ChatPart): number {
    return this.store.addPartToHandle(this.currentMessageHandle(), part);
  }

  addTerminalPartForToolCall(toolCallId: string, part: TerminalPart): number {
    return this.store.addPartToHandle(this.findToolCallHandle(toolCallId), part);
  }

  appendMarkdownToCurrentMessage(text: string): number {
    return this.store.appendToMarkdownHandle(this.currentMessageHandle(), text);
  }

  appendThinkingToCurrentMessage(text: string): number {
    return this.store.appendToThinkingHandle(this.currentMessageHandle(), text);
  }

  completeThinkingOnCurrentMessage(): void {
    this.store.completeThinkingHandle(this.currentMessageHandle());
  }

  updateToolCall(
    toolCallId: string,
    state: ToolCallPart['state'],
    text: string,
  ): void {
    this.store.updateToolCallForHandle(this.findToolCallHandle(toolCallId), toolCallId, state, text);
  }

  patchToolCall(
    toolCallId: string,
    patch: Parameters<ChatPartStore['patchToolCallForHandle']>[2],
  ): boolean {
    return this.store.patchToolCallForHandle(this.findToolCallHandle(toolCallId), toolCallId, patch);
  }

  getToolCall(toolCallId: string): ToolCallPart | null {
    const handle = this.findToolCallHandle(toolCallId);
    const parts = this.store.getPartsForHandle(handle);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (part.type === 'tool_call' && part.toolCallId === toolCallId) {
        return part;
      }
    }
    return null;
  }

  updateSubagent(
    toolCallId: string,
    state: SubagentToolCallSnapshot['state'],
    resultText: string,
  ): void {
    this.store.updateSubagentForHandle(this.findToolCallHandle(toolCallId), toolCallId, state, resultText);
  }

  updateState(
    stateId: string,
    next: ChatPartMutationStateUpdate,
  ): void {
    this.store.updateStateForHandle(this.currentMessageHandle(), stateId, next);
  }

  upsertStateOnCurrentMessage(
    stateId: string,
    next: ChatPartMutationStateUpdate,
  ): void {
    this.store.upsertStateForHandle(this.currentMessageHandle(), stateId, next);
  }

  postProcessMarkdownOnCurrentMessage(): void {
    this.store.postProcessMarkdownForHandle(this.currentMessageHandle());
  }

  updateLatestRunningSubagentOnCurrentMessage(
    update: (part: MutableSubagentPart) => MutableSubagentPart,
  ): MutableSubagentPart | null {
    return this.store.updateLatestRunningSubagentForHandle(this.currentMessageHandle(), update);
  }

  private findToolCallHandle(toolCallId: string): ChatPartStoreReadableHandle | null {
    return this.store.findToolCallOpaqueHandle(toolCallId) ?? this.currentMessageHandle();
  }
}