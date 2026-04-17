import type { IChatContext } from '../core/chat-context';
import { buildUserTurnPayload, type UserTurnPayload } from './chat-user-turn-payload';

export interface PreparedUserSend extends UserTurnPayload {
  text: string;
}

/**
 * Coordinates host-side preflight for a new user send.
 *
 * This keeps ChatEngineService.send focused on shell orchestration while the
 * mutable host state resets and payload shaping stay in one place.
 */
export class ChatSendCoordinator {
  constructor(
    private readonly ctx: IChatContext,
    private readonly generateTitle: (content: string) => void,
    private readonly getResourcesText: () => string,
  ) {}

  prepareSend(sender: string, content: string): PreparedUserSend | null {
    if (this.ctx.isCancelled && sender === 'tool') {
      return null;
    }

    if (this.ctx.isCompleted) {
      this.ctx.isCancelled = false;
      this.ctx.isCompleted = false;
    }

    const text = content.trim();
    if (!this.ctx.sessionId || !text) {
      return null;
    }

    if (sender !== 'user') {
      return null;
    }

    if (this.ctx.isWaiting) {
      return null;
    }

    if (this.ctx.isCancelled) {
      this.ctx.isCancelled = false;
      this.ctx.pendingUserInput = false;
      this.ctx.activeToolExecutions = 0;
    }

    this.generateTitle(text);

    const payload = buildUserTurnPayload(
      text,
      this.getResourcesText(),
      this.ctx.pendingEditFeedback,
    );
    this.ctx.pendingEditFeedback = null;
    this.ctx.msg.appendMessage('user', payload.displayText);

    return {
      text,
      ...payload,
    };
  }
}