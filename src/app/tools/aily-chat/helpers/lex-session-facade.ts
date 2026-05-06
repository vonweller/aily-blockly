import type { SessionSnapshot } from 'aily-lex/browser';

import type { LexSessionPersistenceBridge } from './lex-session-persistence-bridge';
import type { LexSessionRestoreBridge } from './lex-session-restore-bridge';

/**
 * Public session-facing owner that groups persistence and persisted restore
 * behind a single owner surface on the lex facade.
 */
export class LexSessionFacade {
  constructor(
    private readonly persistenceBridge: LexSessionPersistenceBridge,
    private readonly restoreBridge: LexSessionRestoreBridge,
  ) {}

  save(): SessionSnapshot | null {
    return this.persistenceBridge.saveSession();
  }

  snapshot(): SessionSnapshot | null {
    return this.persistenceBridge.getSessionSnapshot();
  }

  restore(
    sessionId: string,
    turnResponses?: readonly import('aily-lex/browser').TurnResponseTurn[],
  ): Promise<boolean> {
    return this.restoreBridge.restorePersistedSession(sessionId, turnResponses);
  }
}