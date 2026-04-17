import type { IChatContext } from '../core/chat-context';
import type { LiveHostSessionRecord } from '../services/chat-history.service';
import { AilyHost } from '../core/host';

/**
 * Host-side save bridge for session lifecycle.
 *
 * Keeps host record building and save flow out of SessionLifecycleHelper.
 */
export class HostSessionSaveBridge {
  constructor(private readonly ctx: IChatContext) {}

  buildHostSessionRecord(): LiveHostSessionRecord | null {
    if (!this.ctx.sessionId || this.ctx.list.length === 0) {
      return null;
    }

    const projectPath = this.resolveProjectPath();
    const budgetSnapshot = this.ctx.contextBudgetService?.getSnapshot();

    return {
      sessionId: this.ctx.sessionId,
      chatList: this.ctx.list,
      metadata: {
        sessionId: this.ctx.sessionId,
        title: this.ctx.sessionTitle || '',
        projectPath,
        mode: this.ctx.currentMode,
        model: this.ctx.currentModel?.model || null,
        contextBudget: budgetSnapshot ? {
          currentTokens: budgetSnapshot.currentTokens,
          maxContextTokens: budgetSnapshot.maxContextTokens,
          usagePercent: budgetSnapshot.usagePercent,
        } : undefined,
        toolCallingIteration: this.ctx.toolCallingIteration || 0,
      },
    };
  }

  saveCurrentSession(): boolean {
    const record = this.buildHostSessionRecord();
    if (!record) {
      return false;
    }

    try {
      if (this.ctx.editCheckpointService?.getTotalEditCount() > 0) {
        try {
          this.ctx.editCheckpointService.commitCurrentTurn();
        } catch (error) {
          console.warn('[SessionLifecycle] checkpoint commit failed:', error);
        }
      }

      this.ctx.lexStream.session.save();
      this.ctx.chatHistoryService.saveHostRecord(
        record.sessionId,
        record.chatList,
        record.metadata,
      );
      return true;
    } catch (error) {
      console.warn('保存会话失败:', error);
      return false;
    }
  }

  private resolveProjectPath(): string | null {
    const currentPath = AilyHost.get().project.currentProjectPath;
    const rootPath = AilyHost.get().project.projectRootPath;
    const cachedPath = this.ctx.chatService.currentSessionPath;

    if (cachedPath && !this.isSameAsRoot(cachedPath, rootPath)) {
      return cachedPath;
    }
    if (currentPath && !this.isSameAsRoot(currentPath, rootPath)) {
      return currentPath;
    }
    return null;
  }

  private isSameAsRoot(path: string | null, rootPath: string | null): boolean {
    if (!path || !rootPath) {
      return false;
    }
    return this.normalizePath(path) === this.normalizePath(rootPath);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }
}