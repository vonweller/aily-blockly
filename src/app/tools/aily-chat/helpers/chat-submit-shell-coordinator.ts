interface ScrollManagerLike {
  startNewExchange(): void;
  scrollToBottom(): void;
}

interface ResourceManagerLike {
  items: unknown[];
  mergePathsTo(sessionAllowedPaths: string[]): void;
}

interface AuthQuotaLike {
  quotaExhausted: boolean;
}

interface InputNoticeLike {
  handleMessageSubmitted?(): void;
}

export class ChatSubmitShellCoordinator {
  constructor(
    private readonly deps: {
      scrollManager: ScrollManagerLike;
      resourceManager: ResourceManagerLike;
      authQuota: AuthQuotaLike;
      inputNotice: InputNoticeLike;
      getSessionAllowedPaths: () => string[];
      getSessionId: () => string;
      getInputValue: () => string;
      isWaiting: () => boolean;
      ensureSession?: () => Promise<boolean>;
      stop: (sessionId?: string | null) => void;
      send: (text: string) => Promise<unknown>;
    },
  ) {}

  async handlePrimaryAction(): Promise<boolean> {
    this.prepareForSubmit();

    if (this.deps.isWaiting()) {
      this.deps.stop(this.deps.getSessionId());
      return false;
    }

    return this.submitPreparedInput();
  }

  async submitCurrentInput(): Promise<boolean> {
    this.prepareForSubmit();
    return this.submitPreparedInput();
  }

  private async submitPreparedInput(): Promise<boolean> {
    const text = this.deps.getInputValue().trim();
    if (!text || this.deps.isWaiting() || this.deps.authQuota.quotaExhausted) {
      return false;
    }

    if (!this.deps.getSessionId()) {
      const ensured = await this.deps.ensureSession?.();
      if (ensured === false || !this.deps.getSessionId()) {
        return false;
      }
    }

    await this.deps.send(text);
    this.deps.inputNotice.handleMessageSubmitted?.();
    this.deps.resourceManager.mergePathsTo(this.deps.getSessionAllowedPaths());
    this.deps.resourceManager.items = [];
    return true;
  }

  private prepareForSubmit(): void {
    this.deps.scrollManager.startNewExchange();
  }
}