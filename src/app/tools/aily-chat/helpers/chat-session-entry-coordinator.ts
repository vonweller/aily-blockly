interface ChatSessionEntryCoordinatorContext {
  readonly isLoggedIn: boolean;
  readonly hasCurrentSession: boolean;
  enterEntryState(options?: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean }): void;
  enterBlankSessionShell(options?: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean }): void;
  startSession(): Promise<void>;
  restorePersistedSessionTarget(): Promise<boolean>;
  refreshHistoryList(): void;
}

export class ChatSessionEntryCoordinator {
  constructor(private readonly ctx: ChatSessionEntryCoordinatorContext) {}

  async initializeEntryInventory(options?: { readonly restorePersistedTarget?: boolean }): Promise<boolean> {
    this.ctx.enterEntryState();

    const shouldRestorePersistedTarget = options?.restorePersistedTarget !== false;
    const restored = shouldRestorePersistedTarget
      ? await this.ctx.restorePersistedSessionTarget().catch((error: unknown) => {
          console.warn('恢复持久化 session target 失败:', error);
          return false;
        })
      : false;

    if (!restored) {
      this.ctx.refreshHistoryList();
    }

    return restored;
  }

  async returnToEntryInventory(options: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean } = {}): Promise<void> {
    this.ctx.enterEntryState(options);

    if (this.ctx.isLoggedIn) {
      this.ctx.refreshHistoryList();
    }
  }

  async bootstrapNewSession(options: { resetInitialization?: boolean } = {}): Promise<boolean> {
    this.ctx.enterBlankSessionShell(options);
    await this.ctx.startSession();
    return this.ctx.hasCurrentSession;
  }
}
