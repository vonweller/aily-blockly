import { resolvePersistedLexSessionSnapshot } from './lex-agent-bootstrap';

import type { AilyLexModule } from './lex-agent-bootstrap';
import type { HostSessionRecord } from '../services/chat-history.service';

type LexSessionSnapshot = import('aily-lex/browser').SessionSnapshot;

export class LexSessionRestoreBridge {
  constructor(
    private readonly deps: {
      ensureAgent: (sessionId?: string) => Promise<boolean>;
      getLex: () => AilyLexModule | null;
      getCwd: () => string;
      restoreSnapshot: (snapshot: LexSessionSnapshot) => boolean;
      resolveSnapshot?: typeof resolvePersistedLexSessionSnapshot;
    },
  ) {}

  async restorePersistedSession(
    sessionId: string,
    turnResponses?: readonly import('aily-lex/browser').TurnResponseTurn[],
    hostRecord?: HostSessionRecord | null,
  ): Promise<boolean> {
    if (!await this.deps.ensureAgent(sessionId)) {
      return false;
    }

    const lex = this.deps.getLex();
    if (!lex) {
      return false;
    }

    const resolveSnapshot = this.deps.resolveSnapshot ?? resolvePersistedLexSessionSnapshot;
    const snapshot = await resolveSnapshot({
      lex,
      sessionId,
      cwd: this.deps.getCwd(),
      turnResponses,
      hostRecord: hostRecord ?? undefined,
    });

    return snapshot ? this.deps.restoreSnapshot(snapshot) : false;
  }
}