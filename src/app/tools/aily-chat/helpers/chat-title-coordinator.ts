import type {
  IAgentLifecycle,
  IChatCoordination,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import type { LexStatelessStreamOptions } from '../core/lex-endpoint';

type AsyncTitleGenerator = (content: string, options?: LexStatelessStreamOptions) => Promise<string>;
type ChatTitleCoordinatorContext = Pick<ISessionAccess, 'sessionId' | 'sessionTitle' | 'chatService' | 'chatHistoryService'>
  & Pick<IProjectContext, 'currentModel'>
  & Pick<IChatCoordination, 'session' | 'lexStream'>
  & Pick<IAgentLifecycle, never>;

/**
 * Coordinates session title generation and persistence refresh.
 */
export class ChatTitleCoordinator {
  constructor(
    private readonly ctx: ChatTitleCoordinatorContext,
    private readonly generateAsyncTitle: AsyncTitleGenerator,
  ) {}

  generate(content: string): void {
    if (this.ctx.sessionTitle) {
      return;
    }

    const initialTitle = content.length > 20 ? content.substring(0, 20) + '...' : content;
    this.ctx.chatService.currentSessionTitle = initialTitle;
    this.ctx.chatHistoryService.updateTitle(this.ctx.sessionId, initialTitle);
    this.ctx.session.refreshHistoryList();

    if (content.length <= 20) {
      return;
    }

    const sessionId = this.ctx.sessionId;
    this.generateAsyncTitle(content, {
      modelId: this.ctx.currentModel?.model || 'default',
      llmConfig: this.ctx.lexStream.runtime.llmConfig(),
    }).then(title => {
      if (title && sessionId === this.ctx.sessionId) {
        this.ctx.chatService.currentSessionTitle = title;
        this.ctx.chatHistoryService.updateTitle(sessionId, title);
        this.ctx.session.refreshHistoryList();
      }
    }).catch(err => {
      console.error('生成标题失败:', err);
    });
  }
}