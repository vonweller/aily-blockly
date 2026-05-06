import type { AgentHandle, SessionSnapshot } from 'aily-lex/browser';

interface SessionPersistenceAgentLike {
  getSessionSnapshot?(): SessionSnapshot | null;
  saveSession?(): SessionSnapshot | null;
  drainPendingEvents?(): readonly any[];
  restoreSession?(snapshot: SessionSnapshot): void;
}

export class LexSessionPersistenceBridge {
  constructor(
    private readonly deps: {
      getHandle?: () => AgentHandle | null;
      getAgent: () => SessionPersistenceAgentLike | null;
      flushPendingEvents: (events: readonly any[]) => void;
    },
  ) {}

  saveSession(): SessionSnapshot | null {
    const snapshot = this.deps.getHandle?.()?.saveSession?.()
      ?? this.deps.getAgent()?.saveSession?.()
      ?? null;
    this.flushPendingEvents();
    return snapshot;
  }

  getSessionSnapshot(): SessionSnapshot | null {
    const handle = this.deps.getHandle?.() ?? null;
    return handle?.getSessionSnapshot()
      ?? this.deps.getAgent()?.getSessionSnapshot?.()
      ?? null;
  }

  drainPendingEvents(): readonly any[] {
    return this.deps.getHandle?.()?.drainPendingEvents?.()
      ?? this.deps.getAgent()?.drainPendingEvents?.()
      ?? [];
  }

  restoreSession(snapshot: SessionSnapshot): boolean {
    const handle = this.deps.getHandle?.() ?? null;
    if (handle?.restoreSession) {
      handle.restoreSession(snapshot);
      this.flushPendingEvents();
      return true;
    }

    const agent = this.deps.getAgent();
    if (agent?.restoreSession) {
      agent.restoreSession(snapshot);
      this.flushPendingEvents();
      return true;
    }

    return false;
  }

  private flushPendingEvents(): void {
    this.deps.flushPendingEvents(this.drainPendingEvents());
  }
}