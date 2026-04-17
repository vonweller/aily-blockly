type AilyLexModule = import('./lex-agent-bootstrap').AilyLexModule;

export class LexAgentLifecycleBridge {
  private _lex: AilyLexModule | null = null;
  private _agent: InstanceType<AilyLexModule['AilyLexAgent']> | null = null;
  private _abortController: AbortController | null = null;
  private _loadPromise: Promise<boolean> | null = null;
  private _todoUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly deps: {
      getSessionId: () => string;
      createAgent: (
        lex: AilyLexModule,
        sessionId: string,
      ) => InstanceType<AilyLexModule['AilyLexAgent']>;
      loadModule: () => Promise<AilyLexModule>;
      onAgentReady?: (
        agent: InstanceType<AilyLexModule['AilyLexAgent']>,
        lex: AilyLexModule,
        currentTodoUnsubscribe: (() => void) | null,
      ) => (() => void) | null;
    },
  ) {}

  getAgent(): InstanceType<AilyLexModule['AilyLexAgent']> | null {
    return this._agent;
  }

  getLex(): AilyLexModule | null {
    return this._lex;
  }

  setAbortController(controller: AbortController | null): void {
    this._abortController = controller;
  }

  async loadModule(): Promise<boolean> {
    if (this._lex) {
      return true;
    }

    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        try {
          this._lex = await this.deps.loadModule();
          console.log('[LexStream] aily-lex 模块加载成功');
          return true;
        } catch (err) {
          console.warn('[LexStream] aily-lex 模块不可用:', err);
          this._loadPromise = null;
          return false;
        }
      })();
    }

    return this._loadPromise;
  }

  async ensureAgent(sessionId?: string): Promise<boolean> {
    if (!await this.loadModule()) {
      return false;
    }

    const lex = this._lex!;
    this._agent?.dispose();
    this._agent = this.deps.createAgent(lex, sessionId || this.deps.getSessionId());
    this._todoUnsubscribe = this.deps.onAgentReady?.(this._agent, lex, this._todoUnsubscribe) ?? this._todoUnsubscribe;
    return true;
  }

  stop(): void {
    this._abortController?.abort();
    this._abortController = null;
    this._agent?.abort?.('用户取消');
  }

  dispose(): void {
    this.stop();
    this._todoUnsubscribe?.();
    this._todoUnsubscribe = null;
    this._agent?.dispose();
    this._agent = null;
  }
}