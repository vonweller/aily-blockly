import type { AgentHandle } from 'aily-lex/browser';

type AilyLexModule = import('./lex-agent-bootstrap').AilyLexModule;
type BlocklyLexAgentInstance = InstanceType<AilyLexModule['AilyLexAgent']>;
type LexAgentCreationResult = BlocklyLexAgentInstance | AgentHandle;
type LexSessionSnapshot = ReturnType<AgentHandle['saveSession']>;

interface LexSessionRuntimeEntry {
  readonly sessionId: string;
  agent: BlocklyLexAgentInstance;
  handle: AgentHandle | null;
  configKey: string | null;
  todoUnsubscribe: (() => void) | null;
  abortController: AbortController | null;
}

function isAgentHandle(value: LexAgentCreationResult): value is AgentHandle {
  return typeof (value as AgentHandle).chat === 'function'
    && typeof (value as AgentHandle).saveSession === 'function'
    && !!(value as AgentHandle).agent;
}

export class LexAgentLifecycleBridge {
  private _lex: AilyLexModule | null = null;
  private _activeSessionId: string | null = null;
  private _loadPromise: Promise<boolean> | null = null;
  private readonly _sessionEntries = new Map<string, LexSessionRuntimeEntry>();

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

  private get activeEntry(): LexSessionRuntimeEntry | null {
    return this.resolveEntry(this._activeSessionId);
  }

  getAgent(sessionId?: string | null): BlocklyLexAgentInstance | null {
    return this.resolveEntry(sessionId)?.agent ?? null;
  }

  getHandle(sessionId?: string | null): AgentHandle | null {
    return this.resolveEntry(sessionId)?.handle ?? null;
  }

  getLex(): AilyLexModule | null {
    return this._lex;
  }

  getSessionIds(): readonly string[] {
    return [...this._sessionEntries.keys()];
  }

  saveSession(sessionId?: string | null): LexSessionSnapshot | null {
    const entry = this.resolveEntry(sessionId);
    return entry?.handle?.saveSession?.()
      ?? entry?.agent.saveSession?.()
      ?? null;
  }

  getSessionSnapshot(sessionId?: string | null): LexSessionSnapshot | null {
    const entry = this.resolveEntry(sessionId);
    return entry?.handle?.getSessionSnapshot?.()
      ?? entry?.agent.getSessionSnapshot?.()
      ?? null;
  }

  isConfiguredFor(sessionId?: string, configKey?: string): boolean {
    const targetSessionId = sessionId || this.deps.getSessionId();
    const entry = this._sessionEntries.get(targetSessionId);
    if (!entry) {
      return false;
    }

    if (typeof configKey === 'string') {
      return entry.configKey === configKey;
    }

    return true;
  }

  setAbortController(sessionId: string | null | undefined, controller: AbortController | null): void {
    const targetEntry = this.resolveEntry(sessionId);
    if (!targetEntry) {
      return;
    }

    targetEntry.abortController = controller;
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

  async ensureAgent(sessionId?: string, configKey?: string): Promise<boolean> {
    if (!await this.loadModule()) {
      return false;
    }

    const lex = this._lex!;
    const targetSessionId = sessionId || this.deps.getSessionId();
    const normalizedConfigKey = typeof configKey === 'string' ? configKey : null;
    const existingEntry = this._sessionEntries.get(targetSessionId) ?? null;

    if (existingEntry) {
      if (normalizedConfigKey !== null) {
        if (existingEntry.configKey === normalizedConfigKey) {
          this._activeSessionId = targetSessionId;
          return true;
        }
      } else if (this._activeSessionId !== targetSessionId) {
        this._activeSessionId = targetSessionId;
        return true;
      }
    }

    const snapshotToRestore = this.captureLiveSessionSnapshot(existingEntry);
    if (existingEntry) {
      this.disposeSessionEntry(existingEntry);
    }

    const created = this.deps.createAgent(lex, targetSessionId);
    const nextEntry = this.createSessionEntry(targetSessionId, created, normalizedConfigKey);
    this._sessionEntries.set(targetSessionId, nextEntry);
    this._activeSessionId = targetSessionId;

    if (snapshotToRestore) {
      try {
        this.restoreLiveSessionSnapshot(nextEntry, snapshotToRestore);
      } catch (error) {
        console.warn('[LexStream] restore rebuilt agent snapshot failed:', error);
      }
    }

    nextEntry.todoUnsubscribe = this.deps.onAgentReady?.(nextEntry.agent, lex, nextEntry.todoUnsubscribe) ?? nextEntry.todoUnsubscribe;
    return true;
  }

  stop(sessionId?: string): void {
    const targetEntry = this.resolveEntry(sessionId);
    if (!targetEntry) {
      return;
    }

    targetEntry.abortController?.abort();
    targetEntry.abortController = null;

    targetEntry.handle?.abort?.('用户取消');
    if (!targetEntry.handle) {
      targetEntry.agent.abort?.('用户取消');
    }
  }

  dispose(sessionId?: string): void {
    const targetSessionId = this.resolveSessionId(sessionId);
    const targetEntry = this.resolveEntry(sessionId);
    if (!targetEntry) {
      if (!targetSessionId) {
        this._activeSessionId = null;
      }
      return;
    }

    this.stop(targetEntry.sessionId);
    this._sessionEntries.delete(targetEntry.sessionId);
    this.disposeSessionEntry(targetEntry);
    if (targetEntry.sessionId === this._activeSessionId) {
      this._activeSessionId = null;
    }
  }

  disposeAll(): void {
    this.stop();
    for (const entry of this._sessionEntries.values()) {
      this.disposeSessionEntry(entry);
    }
    this._sessionEntries.clear();
    this._activeSessionId = null;
  }

  private createSessionEntry(
    sessionId: string,
    created: LexAgentCreationResult,
    configKey: string | null,
  ): LexSessionRuntimeEntry {
    if (isAgentHandle(created)) {
      return {
        sessionId,
        agent: created.agent as BlocklyLexAgentInstance,
        handle: created,
        configKey,
        todoUnsubscribe: null,
        abortController: null,
      };
    }

    return {
      sessionId,
      agent: created,
      handle: null,
      configKey,
      todoUnsubscribe: null,
      abortController: null,
    };
  }

  private disposeSessionEntry(entry: LexSessionRuntimeEntry): void {
    entry.abortController?.abort();
    entry.abortController = null;
    entry.todoUnsubscribe?.();
    entry.todoUnsubscribe = null;

    if (entry.handle) {
      entry.handle.dispose();
      return;
    }

    entry.agent.dispose();
  }


  private resolveSessionId(sessionId?: string | null): string | null {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : this._activeSessionId;
    return targetSessionId ?? null;
  }

  private resolveEntry(sessionId?: string | null): LexSessionRuntimeEntry | null {
    const targetSessionId = this.resolveSessionId(sessionId);
    return targetSessionId
      ? this._sessionEntries.get(targetSessionId) ?? null
      : null;
  }

  private captureLiveSessionSnapshot(entry: LexSessionRuntimeEntry | null): LexSessionSnapshot | null {
    const snapshot = entry?.handle?.saveSession?.()
      ?? entry?.agent.saveSession?.()
      ?? null;
    return snapshot?.sessionId === entry?.sessionId
      ? snapshot
      : null;
  }

  private restoreLiveSessionSnapshot(entry: LexSessionRuntimeEntry, snapshot: LexSessionSnapshot): void {
    if (entry.handle?.restoreSession) {
      entry.handle.restoreSession(snapshot);
      return;
    }

    entry.agent.restoreSession?.(snapshot);
  }
}