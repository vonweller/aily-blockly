import type {
  IAgentLifecycle,
  IChatCoordination,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import type { ChatTitleRequestProvider } from './chat-title-request.service';

type ChatTitleCoordinatorContext = Pick<ISessionAccess, 'sessionId' | 'sessionTitle' | 'chatService' | 'chatHistoryService'>
  & Pick<IChatCoordination, 'session' | 'lexStream'>
  & Pick<IAgentLifecycle, never>;

/**
 * Coordinates session title generation and persistence refresh.
 */
export class ChatTitleCoordinator {
  constructor(
    private readonly ctx: ChatTitleCoordinatorContext,
    private readonly titleRequestService: ChatTitleRequestProvider,
    private readonly syncManagedSessionTitle?: (sessionId: string, title: string) => void,
  ) {}

  generate(content: string): void {
    if (this.ctx.sessionTitle) {
      return;
    }

    const sessionId = this.ctx.sessionId;
    this.titleRequestService.generate(content).then(title => {
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
