import type { AgentHandle } from 'aily-lex/browser';

type AilyLexModule = import('./lex-agent-bootstrap').AilyLexModule;
type BlocklyLexAgentInstance = InstanceType<AilyLexModule['AilyLexAgent']>;
type LexAgentCreationResult = BlocklyLexAgentInstance | AgentHandle;
type LexSessionSnapshot = ReturnType<AgentHandle['saveSession']>;

function isAgentHandle(value: LexAgentCreationResult): value is AgentHandle {
  return typeof (value as AgentHandle).chat === 'function'
    && typeof (value as AgentHandle).saveSession === 'function'
    && !!(value as AgentHandle).agent;
}

export class LexAgentLifecycleBridge {
  private _lex: AilyLexModule | null = null;
  private _agent: BlocklyLexAgentInstance | null = null;
  private _handle: AgentHandle | null = null;
  private _abortController: AbortController | null = null;
  private _loadPromise: Promise<boolean> | null = null;
  private _todoUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly deps: {
      getSessionId: () => string;
      createAgent: (
        lex: AilyLexModule,
        sessionId: string,
      ) => LexAgentCreationResult;
      loadModule: () => Promise<AilyLexModule>;
      onAgentReady?: (
        agent: BlocklyLexAgentInstance,
        lex: AilyLexModule,
        currentTodoUnsubscribe: (() => void) | null,
      ) => (() => void) | null;
    },
  ) {}

  getAgent(): BlocklyLexAgentInstance | null {
    return this._agent;
  }

  getHandle(): AgentHandle | null {
    return this._handle;
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
    const targetSessionId = sessionId || this.deps.getSessionId();
    const snapshotToRestore = this.captureLiveSessionSnapshot(targetSessionId);
    this.disposeActiveAgent();
    const created = this.deps.createAgent(lex, targetSessionId);
    if (isAgentHandle(created)) {
      this._handle = created;
      this._agent = created.agent as BlocklyLexAgentInstance;
    } else {
      this._handle = null;
      this._agent = created;
    }

    if (snapshotToRestore) {
      try {
        this.restoreLiveSessionSnapshot(snapshotToRestore);
      } catch (error) {
        console.warn('[LexStream] restore rebuilt agent snapshot failed:', error);
      }
    }

    this._todoUnsubscribe = this.deps.onAgentReady?.(this._agent, lex, this._todoUnsubscribe) ?? this._todoUnsubscribe;
    return true;
  }

  stop(): void {
    this._abortController?.abort();
    this._abortController = null;
    this._handle?.abort?.('用户取消');
    if (!this._handle) {
      this._agent?.abort?.('用户取消');
    }
  }

  dispose(): void {
    this.stop();
    this._todoUnsubscribe?.();
    this._todoUnsubscribe = null;
    this.disposeActiveAgent();
  }

  private disposeActiveAgent(): void {
    if (this._handle) {
      this._handle.dispose();
      this._handle = null;
      this._agent = null;
      return;
    }

    this._agent?.dispose();
    this._agent = null;
  }

  private captureLiveSessionSnapshot(targetSessionId: string): LexSessionSnapshot | null {
    const snapshot = this._handle?.saveSession?.()
      ?? this._agent?.saveSession?.()
      ?? null;
    return snapshot?.sessionId === targetSessionId
      ? snapshot
      : null;
  }

  private restoreLiveSessionSnapshot(snapshot: LexSessionSnapshot): void {
    if (this._handle?.restoreSession) {
      this._handle.restoreSession(snapshot);
      return;
    }

    this._agent?.restoreSession?.(snapshot);
  }
}