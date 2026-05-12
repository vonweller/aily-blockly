import type { IAgentLifecycle, IChatCoordination, ISessionAccess } from '../core/chat-context';
import { buildUserTurnPayload, type UserTurnPayload } from './chat-user-turn-payload';
import { buildExplicitAgentInvocationPayload } from './explicit-agent-invocation';
import type { RequestUserSelectedTools } from './lex-agent-bootstrap';

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
    private readonly getUserSelectedTools?: (requestAgentId?: string) => RequestUserSelectedTools | undefined,
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
          .getHandle?.()
          .resolveRequestCommand(name, kind, agentId)
          ?? this.ctx.lexStream
            ?.agent
          .getAgent()
          ?.resolveRequestCommand(name, kind, agentId),
      },
    );
    const explicitAgentInvocation = payload.requestMetadata?.explicitAgentInvocation;
    const requestMetadata = explicitAgentInvocation && typeof explicitAgentInvocation === 'object'
      ? {
          ...Object.fromEntries(
            Object.entries(payload.requestMetadata ?? {}).filter(([key]) => key !== 'agentId'),
          ),
          explicitAgentInvocation: buildExplicitAgentInvocationPayload({
            targetAgent: typeof explicitAgentInvocation['targetAgent'] === 'string' ? explicitAgentInvocation['targetAgent'] : '',
            strippedPrompt: typeof explicitAgentInvocation['strippedPrompt'] === 'string' ? explicitAgentInvocation['strippedPrompt'] : '',
            originalText: typeof explicitAgentInvocation['originalText'] === 'string' ? explicitAgentInvocation['originalText'] : text,
            resourcesText: this.getResourcesText(),
            editFeedback: this.ctx.pendingEditFeedback,
            childRequest: explicitAgentInvocation.childRequest,
          }),
        }
      : payload.requestMetadata;
    const requestAgentId = explicitAgentInvocation && typeof explicitAgentInvocation === 'object'
      ? (typeof explicitAgentInvocation['targetAgent'] === 'string' ? explicitAgentInvocation['targetAgent'] : undefined)
      : (typeof requestMetadata?.agentId === 'string' ? requestMetadata.agentId : undefined);
    const userSelectedTools = this.getUserSelectedTools?.(
      requestAgentId,
    );
    const finalRequestMetadata = userSelectedTools
      ? {
          ...(requestMetadata ?? {}),
          userSelectedTools,
        }
      : requestMetadata;
    this.ctx.pendingEditFeedback = null;
    this.ctx.msg.appendMessage('user', payload.displayText);

    return {
      text,
      ...payload,
      ...(finalRequestMetadata ? { requestMetadata: finalRequestMetadata } : {}),
    };
  }
}