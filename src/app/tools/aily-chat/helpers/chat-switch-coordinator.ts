import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IProjectContext,
  ISessionAccess,
} from '../core/chat-context';
import type { ModelConfig } from '../services/chat.service';

type ChatSwitchCoordinatorContext = Pick<
  IAgentLifecycle,
  'isWaiting' | '_pendingModelSwitch' | '_pendingModeSwitch'
> & Pick<IProjectContext, 'currentModel' | 'currentMode'>
  & Pick<ISessionAccess, 'chatService' | 'conversationMessages'>
  & Pick<IChatServiceAccess, 'contextBudgetService' | 'message'>
  & Pick<IChatCoordination, 'lexStream'>;

/**
 * Coordinates model/mode switching and deferred switch application.
 */
export class ChatSwitchCoordinator {
  constructor(private readonly ctx: ChatSwitchCoordinatorContext) {}

  private isSameModelSelection(model: ModelConfig): boolean {
    return model.model === this.ctx.currentModel?.model
      && model.presetId === this.ctx.currentModel?.presetId
      && model.reasoningEffort === this.ctx.currentModel?.reasoningEffort;
  }

  private shouldRefreshLocalEstimate(): boolean {
    const snapshot = this.ctx.contextBudgetService?.getSnapshot();
    return !snapshot || snapshot.currentTokens <= 0 || snapshot.maxContextTokens <= 0;
  }

  async switchToModel(model: ModelConfig): Promise<void> {
    if (this.isSameModelSelection(model)) {
      return;
    }

    if (this.ctx.isWaiting) {
      this.ctx.chatService.saveChatModel(model);
      this.ctx._pendingModelSwitch = model;
      this.ctx._pendingModeSwitch = null;
      this.ctx.message.info('模型将在当前对话完成后切换');
      return;
    }

    await this.doSwitchModel(model);
  }

  async switchToReasoningEffort(reasoningEffort: NonNullable<ModelConfig['reasoningEffort']>): Promise<void> {
    const currentModel = this.ctx.currentModel;
    if (!currentModel) {
      return;
    }

    const nextModel: ModelConfig = {
      ...currentModel,
      reasoningEffort,
    };

    if (this.isSameModelSelection(nextModel)) {
      return;
    }

    if (this.ctx.isWaiting) {
      this.ctx.chatService.saveChatModel(nextModel);
      this.ctx._pendingModelSwitch = nextModel;
      this.ctx._pendingModeSwitch = null;
      this.ctx.message.info('思考深度将在当前对话完成后切换');
      return;
    }

    await this.doSwitchModel(nextModel);
  }

  async switchToMode(mode: string): Promise<void> {
    if (mode === this.ctx.currentMode) {
      return;
    }

    if (this.ctx.isWaiting) {
      this.ctx.chatService.saveChatMode(mode as 'agent' | 'ask');
      this.ctx._pendingModeSwitch = mode;
      this.ctx._pendingModelSwitch = null;
      this.ctx.message.info('模式将在当前对话完成后切换');
      return;
    }

    await this.doSwitchMode(mode);
  }

  async applyPendingSwitch(): Promise<void> {
    const pendingModel = this.ctx._pendingModelSwitch;
    const pendingMode = this.ctx._pendingModeSwitch;
    this.ctx._pendingModelSwitch = null;
    this.ctx._pendingModeSwitch = null;

    if (pendingModel) {
      await this.doSwitchModel(pendingModel);
      return;
    }

    if (pendingMode) {
      await this.doSwitchMode(pendingMode);
    }
  }

  private async doSwitchModel(model: ModelConfig): Promise<void> {
    this.ctx.chatService.saveChatModel(model);

    try {
      await this.ctx.lexStream.agent.ensureAgent();
    } catch (err) {
      console.error('切换模型失败:', err);
      return;
    }

    this.ctx.contextBudgetService?.updateModelContextSize(model);
    if (this.shouldRefreshLocalEstimate()) {
      this.ctx.contextBudgetService?.refreshLocalEstimate(
        this.ctx.conversationMessages,
        this.ctx.lexStream.runtime.tools(),
      );
    }
  }

  private async doSwitchMode(mode: string): Promise<void> {
    this.ctx.chatService.saveChatMode(mode as 'agent' | 'ask');

    try {
      await this.ctx.lexStream.agent.ensureAgent();
    } catch (err) {
      console.error('切换模式失败:', err);
      this.ctx.chatService.saveChatMode('agent');
      return;
    }

    if (this.shouldRefreshLocalEstimate()) {
      this.ctx.contextBudgetService?.refreshLocalEstimate(
        this.ctx.conversationMessages,
        this.ctx.lexStream.runtime.tools(),
      );
    }
  }
}