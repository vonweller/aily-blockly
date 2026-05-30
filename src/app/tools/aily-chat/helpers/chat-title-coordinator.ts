import type {
  IAgentLifecycle,
  IChatCoordination,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import type { LexStatelessStreamOptions } from '../core/lex-endpoint';

type AsyncTitleGenerator = (content: string, options?: LexStatelessStreamOptions) => Promise<string>;
type ChatTitleCoordinatorContext = Pick<ISessionAccess, 'sessionId' | 'sessionTitle' | 'chatService' | 'chatHistoryService'>
  & Pick<IChatCoordination, 'session' | 'lexStream'>
  & Pick<IAgentLifecycle, never>;

/**
 * Coordinates session title generation and persistence refresh.
 */
export class ChatTitleCoordinator {
  constructor(
    private readonly ctx: ChatTitleCoordinatorContext,
    private readonly generateAsyncTitle: AsyncTitleGenerator,
    private readonly syncManagedSessionTitle?: (sessionId: string, title: string) => void,
  ) {}

  generate(content: string): void {
    if (this.ctx.sessionTitle) {
      return;
    }

    const sessionId = this.ctx.sessionId;
    this.generateAsyncTitle(content, {
      requestContext: { requestKind: 'utility' },
      llmConfig: this.ctx.lexStream.runtime.llmConfig(),
    }).then(title => {
      if (title && sessionId === this.ctx.sessionId) {
        this.ctx.chatService.currentSessionTitle = title;
        this.ctx.chatHistoryService.updateTitle(sessionId, title);
        this.syncManagedSessionTitle?.(sessionId, title);
        this.ctx.session.refreshHistoryList();
      }
    }).catch(err => {
      console.error('生成标题失败:', err);
    });
  }
}
