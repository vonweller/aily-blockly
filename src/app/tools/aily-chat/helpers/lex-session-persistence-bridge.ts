import type { SessionSnapshot } from 'aily-lex/browser';

interface SessionPersistenceAgentLike {
  getSessionSnapshot?(): SessionSnapshot | null;
  saveSession?(): SessionSnapshot | null;
  drainPendingEvents?(): readonly any[];
  restoreSession?(snapshot: SessionSnapshot): void;
}

export class LexSessionPersistenceBridge {
  constructor(
    private readonly deps: {
      getAgent: () => SessionPersistenceAgentLike | null;
      flushPendingEvents: (events: readonly any[]) => void;
    },
  ) {}

  saveSession(): SessionSnapshot | null {
    const snapshot = this.deps.getAgent()?.saveSession?.() ?? null;
    this.flushPendingEvents();
    return snapshot;
  }

  getSessionSnapshot(): SessionSnapshot | null {
    return this.deps.getAgent()?.getSessionSnapshot?.() ?? null;
  }

  drainPendingEvents(): readonly any[] {
    return this.deps.getAgent()?.drainPendingEvents?.() ?? [];
  }

  restoreSession(snapshot: SessionSnapshot): boolean {
    const agent = this.deps.getAgent();
    if (!agent?.restoreSession) {
      return false;
    }

    agent.restoreSession(snapshot);
    this.flushPendingEvents();
    return true;
  }

  private flushPendingEvents(): void {
    this.deps.flushPendingEvents(this.drainPendingEvents());
  }
}