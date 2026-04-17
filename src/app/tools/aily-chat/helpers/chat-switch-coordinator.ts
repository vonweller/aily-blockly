import type { IChatContext } from '../core/chat-context';
import type { ModelConfig } from '../services/chat.service';

/**
 * Coordinates model/mode switching and deferred switch application.
 */
export class ChatSwitchCoordinator {
  constructor(private readonly ctx: IChatContext) {}

  async switchToModel(model: ModelConfig): Promise<void> {
    if (model.model === this.ctx.currentModel?.model) {
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

    this.ctx.contextBudgetService?.updateModelContextSize(model.model || null);
    this.ctx.contextBudgetService?.refreshLocalEstimate(
      this.ctx.conversationMessages,
      this.ctx.lexStream.runtime.tools(),
    );
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

    this.ctx.contextBudgetService?.refreshLocalEstimate(
      this.ctx.conversationMessages,
      this.ctx.lexStream.runtime.tools(),
    );
  }
}