import type { IChatContext } from '../core/chat-context';

/**
 * Coordinates canned main-conversation follow-up actions.
 *
 * Keeps continue/retry host-shell behavior out of ChatEngineService while
 * preserving the existing user-visible prompts and scroll semantics.
 */
export class ChatConversationActionCoordinator {
  constructor(private readonly ctx: IChatContext) {}

  async continueConversation(): Promise<void> {
    if (this.ctx.isWaiting) {
      this.ctx.message.warning('正在处理中，请稍候...');
      return;
    }
    if (!this.ctx.sessionId) {
      this.ctx.message.warning('会话不存在，请开始新对话');
      return;
    }

    await this.ctx.send('user', '请继续完成之前的任务。', false);
  }

  async retryLastAction(): Promise<void> {
    if (this.ctx.isWaiting) {
      this.ctx.message.warning('正在处理中，请稍候...');
      return;
    }
    if (!this.ctx.sessionId) {
      this.ctx.message.warning('会话不存在，请开始新对话');
      return;
    }

    await this.ctx.send('user', '请重试上次的操作。', false);
    this.ctx.scrollManager.autoScrollEnabled = true;
    this.ctx.scrollManager.scrollToBottom();
  }
}