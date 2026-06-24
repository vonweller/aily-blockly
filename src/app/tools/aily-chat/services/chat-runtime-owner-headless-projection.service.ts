import { Injectable, OnDestroy } from '@angular/core';

import { ChatPartStore } from '../core/chat-part-store';
import { ChatMessage, ToolCallInfo, ToolCallState } from '../core/chat-types';
import { makeJsonSafe } from './content-sanitizer.service';
import type { ChatRuntimeOwnerHeadlessProjectionPort } from './chat-runtime-owner-ports';

type HeadlessToolCallStates = { [key: string]: string };

@Injectable()
export class ChatRuntimeOwnerHeadlessProjectionService implements ChatRuntimeOwnerHeadlessProjectionPort, OnDestroy {
  readonly partStore = new ChatPartStore();
  private listValue: ChatMessage[] = [];
  private readonly toolCallStateMessage = new Map<string, ChatMessage>();

  readonly viewAdapter = {
    appendStreaming: (role: string, text: string, source?: string) => {
      this.appendMessage(role, text, source);
    },
    appendImmediate: (role: string, text: string, source?: string) => {
      this.appendMessage(role, text, source);
    },
    displayToolCallState: (
      toolCallInfo: ToolCallInfo,
      source?: string,
      toolCallStates?: HeadlessToolCallStates,
    ) => {
      this.displayToolCallState(toolCallInfo, source, toolCallStates);
    },
    markLastMessageDone: () => {
      const last = this.listValue[this.listValue.length - 1];
      if (last?.role === 'aily') {
        last.state = 'done';
      }
    },
    checkAndTruncateAilyButtonBlock: () => false,
    getClosingTagsForOpenBlocks: (getClosingTags: (content: string) => string) => {
      const last = this.listValue[this.listValue.length - 1];
      return last?.role === 'aily' ? getClosingTags(last.content || '') : '';
    },
    reset: () => {
      this.toolCallStateMessage.clear();
      this.listValue = [];
    },
    requestChangeDetection: () => {},
  };

  readonly scrollManager = {
    scrollLock: false,
    setScrollLock: (value: boolean) => {
      this.scrollManager.scrollLock = value;
    },
    startNewExchange: () => {},
    scrollToBottom: () => {},
    scrollToBottomIfNeeded: () => {},
    resumeFollowBottom: () => {},
    captureAutoScrollState: () => false,
  };

  get list(): ChatMessage[] {
    return this.listValue;
  }

  set list(value: ChatMessage[]) {
    this.listValue = Array.isArray(value) ? value : [];
  }

  setList(value: ChatMessage[]): void {
    this.list = value;
  }

  invalidateHostRequestGraph(): void {}

  triggerSyncDetectChanges(): void {}

  ngOnDestroy(): void {
    this.partStore.destroy();
    this.listValue = [];
    this.toolCallStateMessage.clear();
  }

  private appendMessage(role: string, text: string, source?: string): void {
    const last = this.listValue[this.listValue.length - 1];
    if (last && last.role === role && last.state === 'doing') {
      last.content = `${last.content || ''}${text || ''}`;
      return;
    }

    this.listValue.push({
      role: role as ChatMessage['role'],
      content: text || '',
      state: 'doing',
      source,
    } as ChatMessage);
  }

  private displayToolCallState(
    toolCallInfo: ToolCallInfo,
    source?: string,
    toolCallStates?: HeadlessToolCallStates,
  ): void {
    const stateMessage =
      '\n```aily-state\n{\n'
      + `  "state": "${toolCallInfo.state}",\n`
      + `  "text": "${makeJsonSafe(toolCallInfo.text)}",\n`
      + `  "id": "${toolCallInfo.id}"\n`
      + '}\n```\n\n\n';

    const existing = this.toolCallStateMessage.get(toolCallInfo.id);
    if (existing) {
      existing.content = stateMessage;
    } else {
      const message = {
        role: 'aily',
        content: stateMessage,
        state: toolCallInfo.state === ToolCallState.DOING ? 'doing' : 'done',
        source,
      } as ChatMessage;
      this.listValue.push(message);
      this.toolCallStateMessage.set(toolCallInfo.id, message);
    }

    if (toolCallInfo.state === ToolCallState.DOING && toolCallStates) {
      toolCallStates[toolCallInfo.id] = toolCallInfo.text;
    }
  }
}
