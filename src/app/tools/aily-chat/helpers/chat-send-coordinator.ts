import type { IAgentLifecycle, IChatCoordination, ISessionAccess } from '../core/chat-context';
import { buildUserTurnPayload, type UserTurnPayload } from './chat-user-turn-payload';

export interface PreparedUserSend extends UserTurnPayload {
  text: string;
}

type ChatSendCoordinatorContext = Pick<
  IAgentLifecycle,
  'isCancelled' | 'isCompleted' | 'isWaiting' | 'pendingUserInput' | 'activeToolExecutions' | 'pendingEditFeedback'
> & Pick<ISessionAccess, 'sessionId'>
  & Pick<IChatCoordination, 'msg'>
  & Partial<Pick<IChatCoordination, 'lexStream'>>;

/**
 * Coordinates host-side preflight for a new user send.
 *
 * This keeps ChatEngineService.send focused on shell orchestration while the
 * mutable host state resets and payload shaping stay in one place.
 */
export class ChatSendCoordinator {
  constructor(
    private readonly ctx: ChatSendCoordinatorContext,
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
      {
        resolveCommand: ({ agentId, name, kind }) => this.ctx.lexStream
          ?.agent
          .getAgent()
          ?.resolveRequestCommand(name, kind, agentId),
      },
    );
    this.ctx.pendingEditFeedback = null;
    this.ctx.msg.appendMessage('user', payload.displayText);

    return {
      text,
      ...payload,
    };
  }
}