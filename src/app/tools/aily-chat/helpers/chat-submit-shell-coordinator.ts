import type { ChatPendingRequestKind } from './chat-pending-request';

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

interface QueueSendLike {
  (text: string, sessionId?: string | null, options?: { kind?: ChatPendingRequestKind }): Promise<boolean> | boolean;
}

interface SubmitInputOptionsLike {
  queueKind?: ChatPendingRequestKind;
}

type ConfirmPendingRequestsResult = 'keep' | 'remove' | false;

const REQUEST_STATE_TRACE_PREFIX = '[AilyChat][RequestStateTrace]';

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
      hasPendingRequests?: () => boolean;
      confirmPendingRequestsBeforeSend?: () => Promise<ConfirmPendingRequestsResult>;
      clearPendingRequests?: () => void;
      queueSend?: QueueSendLike;
      stop: (sessionId?: string | null) => void;
      send: (text: string) => Promise<unknown>;
    },
  ) {}

  async handlePrimaryAction(): Promise<boolean> {
    return this.sendOrQueueDraft();
  }

  private traceRequestAction(
    action: 'send' | 'queue' | 'stop',
    state: 'idle' | 'running',
    extra?: Record<string, unknown>,
  ): void {
    console.info(REQUEST_STATE_TRACE_PREFIX, {
      phase: 'submit-dispatch',
      action,
      sessionId: this.deps.getSessionId() || null,
      requestId: null,
      state,
      ...(extra ?? {}),
    });
  }

  async sendOrQueueDraft(options?: SubmitInputOptionsLike): Promise<boolean> {
    this.prepareForSubmit();
    return this.submitPreparedInput(options);
  }

  stopActiveRequest(): boolean {
    if (!this.deps.isWaiting()) {
      return false;
    }

    this.traceRequestAction('stop', 'running');
    this.deps.stop(this.deps.getSessionId());
    return true;
  }

  async submitCurrentInput(options?: SubmitInputOptionsLike): Promise<boolean> {
    return this.sendOrQueueDraft(options);
  }

  private async submitPreparedInput(options?: SubmitInputOptionsLike): Promise<boolean> {
    const text = this.deps.getInputValue().trim();
    if (!text || this.deps.authQuota.quotaExhausted) {
      return false;
    }

    if (this.deps.isWaiting()) {
      return this.queuePreparedInput(text, options?.queueKind ?? 'queued', 'running');
    }

    if (options?.queueKind) {
      return this.queuePreparedInput(text, options.queueKind, 'idle');
    }

    if (this.deps.hasPendingRequests?.()) {
      const pendingDecision = await this.deps.confirmPendingRequestsBeforeSend?.() ?? 'keep';
      if (!pendingDecision) {
        return false;
      }

      if (pendingDecision === 'remove') {
        this.deps.clearPendingRequests?.();
      }
    }

    if (!this.deps.getSessionId()) {
      const ensured = await this.deps.ensureSession?.();
      if (ensured === false || !this.deps.getSessionId()) {
        return false;
      }
    }

    this.traceRequestAction('send', 'idle', {
      textLength: text.length,
      hasPendingRequests: this.deps.hasPendingRequests?.() === true,
    });
    await this.deps.send(text);
    this.deps.inputNotice.handleMessageSubmitted?.();
    this.deps.resourceManager.mergePathsTo(this.deps.getSessionAllowedPaths());
    this.deps.resourceManager.items = [];
    return true;
  }

  private async queuePreparedInput(
    text: string,
    kind: ChatPendingRequestKind,
    state: 'idle' | 'running',
  ): Promise<boolean> {
    const sessionId = this.deps.getSessionId();
    if (!sessionId || typeof this.deps.queueSend !== 'function') {
      return false;
    }

    this.traceRequestAction('queue', state, {
      queueKind: kind,
      textLength: text.length,
    });
    const queued = await this.deps.queueSend(text, sessionId, { kind });
    if (!queued) {
      return false;
    }

    this.deps.inputNotice.handleMessageSubmitted?.();
    this.deps.resourceManager.mergePathsTo(this.deps.getSessionAllowedPaths());
    this.deps.resourceManager.items = [];
    return true;
  }

  private prepareForSubmit(): void {
    this.deps.scrollManager.startNewExchange();
  }
}