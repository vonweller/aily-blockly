import type { IChatContext } from '../core/chat-context';
import type { ApprovalPart, ChatPart, QuestionPart } from '../core/chat-parts';
import { deserializeContentToParts } from '../core/content-deserializer';
import { markContentAsHistory as _markContentAsHistory } from '../services/content-sanitizer.service';

import type { ChatListItem } from '../services/chat-history.service';

export class ChatViewWriteBridge {
  constructor(private readonly ctx: IChatContext) {}

  appendPartToMessage(
    msgIndex: number,
    part: ChatPart,
    options: {
      state?: 'doing' | 'done';
      markDirty?: boolean;
    } = {},
  ): boolean {
    if (msgIndex < 0 || msgIndex >= this.ctx.list.length) {
      return false;
    }

    this.ctx.partStore.addPart(msgIndex, part);
    if (options.state && this.ctx.list[msgIndex]) {
      this.ctx.list[msgIndex].state = options.state;
    }
    this.markHistoryDirty(options.markDirty);
    return true;
  }

  appendMarkdownToMessage(
    msgIndex: number,
    text: string,
    options: { markDirty?: boolean } = {},
  ): boolean {
    if (msgIndex < 0 || msgIndex >= this.ctx.list.length) {
      return false;
    }

    this.ctx.partStore.appendToMarkdown(msgIndex, text);
    this.markHistoryDirty(options.markDirty);
    return true;
  }

  updateQuestionAnswersOnLatestAilyPartsMessage(
    answers: QuestionPart['answers'],
    options: { markDirty?: boolean } = {},
  ): boolean {
    const msgIndex = this.findLatestAilyPartsMessageIndex();
    if (msgIndex < 0) {
      return false;
    }

    const updated = this.ctx.partStore.updateQuestionAnswers(msgIndex, answers);
    if (updated) {
      this.markHistoryDirty(options.markDirty);
    }
    return updated;
  }

  updateApprovalResultOnLatestAilyPartsMessage(
    askId: string,
    next: {
      resolved: boolean;
      result?: ApprovalPart['result'];
      scope?: ApprovalPart['scope'];
    },
    options: { markDirty?: boolean } = {},
  ): boolean {
    const msgIndex = this.findLatestAilyPartsMessageIndex();
    if (msgIndex < 0) {
      return false;
    }

    const updated = this.ctx.partStore.updateApprovalResult(msgIndex, askId, next);
    if (updated) {
      this.markHistoryDirty(options.markDirty);
    }
    return updated;
  }

  ensureTrailingAilyPartsMessage(
    options: {
      source?: string;
      state?: 'doing' | 'done';
      scrollOnCreate?: boolean;
      /** Phase 1.3: force-create a new message even if the last one matches */
      forceNew?: boolean;
      /** Phase 1.3: associate this message with a lex turnId */
      turnId?: string;
    } = {},
  ): number {
    const msgSource = options.source ?? this.ctx.currentMessageSource ?? 'mainAgent';
    const lastMessage = this.ctx.list.length > 0 ? this.ctx.list[this.ctx.list.length - 1] : null;

    if (!options.forceNew
        && lastMessage
        && lastMessage.role === 'aily'
        && (lastMessage.source || 'mainAgent') === msgSource) {
      if (options.turnId && !lastMessage.turnId) {
        lastMessage.turnId = options.turnId;
      }
      return this.ctx.list.length - 1;
    }

    const msgIndex = this.ctx.list.length;
    this.ctx.list.push({
      role: 'aily',
      content: '',
      state: options.state ?? 'doing',
      source: msgSource,
      modelName: this.ctx.currentModelName || undefined,
      turnId: options.turnId,
    } as any);

    this.ctx.triggerSyncDetectChanges();
    if (options.scrollOnCreate !== false) {
      this.ctx.scrollManager?.scrollToBottom?.();
    }

    return msgIndex;
  }

  syncPartsMessagesToContent(): number {
    let updatedCount = 0;
    for (let index = 0; index < this.ctx.list.length; index++) {
      if (!this.ctx.partStore.hasParts(index)) {
        continue;
      }

      this.ctx.list[index].content = this.ctx.partStore.serializeToContent(index);
      updatedCount++;
    }

    return updatedCount;
  }

  clearChatView(options: { detectChanges?: boolean } = {}): void {
    (this.ctx.viewAdapter as any).reset?.();
    this.ctx.list = [];
    this.ctx.partStore.reset();

    if (options.detectChanges !== false) {
      this.ctx.triggerSyncDetectChanges();
    }
  }

  appendMarkdownToLatestPartsMessage(role: string, text: string, source?: string): boolean {
    const msgIndex = this.findLatestMatchingMessageIndex(role, source);
    if (msgIndex < 0 || !this.ctx.partStore.hasParts(msgIndex)) {
      return false;
    }

    return this.appendMarkdownToMessage(msgIndex, text, { markDirty: false });
  }

  appendAilyPartsMessage(
    parts: readonly ChatPart[],
    options: {
      scroll?: boolean;
      source?: string;
      state?: 'doing' | 'done';
      markDirty?: boolean;
    } = {},
  ): number {
    const msgIndex = this.ctx.list.length;
    this.ctx.list.push({
      role: 'aily',
      content: '',
      state: options.state ?? 'done',
      source: options.source ?? 'mainAgent',
      modelName: this.ctx.currentModelName || undefined,
    } as any);

    for (const part of parts) {
      this.ctx.partStore.addPart(msgIndex, part);
    }

    this.ctx.list[msgIndex].content = this.ctx.partStore.serializeToContent(msgIndex);
    this.ctx.triggerSyncDetectChanges();

    if (options.scroll) {
      this.ctx.scrollManager.autoScrollEnabled = true;
      this.ctx.scrollManager.scrollToBottom();
    }

    if (options.markDirty !== false && this.ctx.sessionId) {
      this.ctx.chatHistoryService.markDirty(this.ctx.sessionId);
    }

    return msgIndex;
  }

  replaceHistoryList(chatList: readonly ChatListItem[]): void {
    (this.ctx.viewAdapter as any).reset?.();
    this.ctx.list = chatList.map(item => {
      if (item.content && typeof item.content === 'string') {
        return { ...item, content: _markContentAsHistory(item.content) };
      }
      return item;
    });

    this.ctx.partStore.reset();
    for (let index = 0; index < this.ctx.list.length; index++) {
      const message = this.ctx.list[index];
      if (message.role !== 'aily' || typeof message.content !== 'string' || !message.content) {
        continue;
      }

      const parts = deserializeContentToParts(message.content);
      if (parts.length === 0) {
        // Phase 2 fallback: wrap plain content as a MarkdownPart so all aily
        // messages are Part-based and rendered by ChatMessagePartsComponent.
        this.ctx.partStore.addPart(index, { type: 'markdown', content: message.content });
      } else {
        for (const part of parts) {
          this.ctx.partStore.addPart(index, part);
        }
      }
    }

    this.ctx.ngZone.run(() => {
      (this.ctx.viewAdapter as any).cdCallback?.();
    });
  }

  truncateFrom(fromIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.ctx.list.length) {
      return;
    }

    const previousLength = this.ctx.list.length;
    for (let index = fromIndex; index < previousLength; index++) {
      this.ctx.partStore.clearMessage(index);
    }

    this.ctx.list.splice(fromIndex);
    this.ctx.triggerSyncDetectChanges();
  }

  private findLatestMatchingMessageIndex(role: string, source?: string): number {
    const msgSource = source || this.ctx.currentMessageSource;
    for (let index = this.ctx.list.length - 1; index >= 0; index--) {
      const message = this.ctx.list[index];
      if (message.role === role && (message.source || 'mainAgent') === (msgSource || 'mainAgent')) {
        return index;
      }
    }
    return -1;
  }

  private findLatestAilyPartsMessageIndex(): number {
    for (let index = this.ctx.list.length - 1; index >= 0; index--) {
      if (this.ctx.list[index].role === 'aily' && this.ctx.partStore.hasParts(index)) {
        return index;
      }
    }
    return -1;
  }

  private markHistoryDirty(markDirty: boolean | undefined): void {
    if (markDirty === false || !this.ctx.sessionId) {
      return;
    }

    this.ctx.chatHistoryService.markDirty(this.ctx.sessionId);
  }
}