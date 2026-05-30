import {
  resolvePersistedLexSessionRestorePlan,
  resolvePersistedLexSessionSnapshot,
} from './lex-agent-bootstrap';

import type { AilyLexModule } from './lex-agent-bootstrap';
import type { HostSessionRecord } from '../services/chat-history.service';
import type { ResolvedLexSessionRestorePlan } from './host-session-restore-resolver';

type LexSessionSnapshot = import('aily-lex/browser').SessionSnapshot;

export class LexSessionRestoreBridge {
  constructor(
    private readonly deps: {
      ensureAgent: (sessionId?: string) => Promise<boolean>;
      getLex: () => AilyLexModule | null;
      getCwd: () => string;
      restoreSnapshot: (snapshot: LexSessionSnapshot) => boolean;
      resolveSnapshot?: typeof resolvePersistedLexSessionSnapshot;
      resolveRestorePlan?: typeof resolvePersistedLexSessionRestorePlan;
    },
  ) {}

  async resolvePersistedRestorePlan(
    sessionId: string,
    turnResponses?: readonly import('aily-lex/browser').TurnResponseTurn[],
    hostRecord?: HostSessionRecord | null,
  ): Promise<ResolvedLexSessionRestorePlan | null> {
    if (!await this.deps.ensureAgent(sessionId)) {
      return null;
    }

    const lex = this.deps.getLex();
    if (!lex) {
      return null;
    }

    const resolveRestorePlan = this.deps.resolveRestorePlan;
    if (resolveRestorePlan) {
      return await resolveRestorePlan({
        lex,
        sessionId,
        cwd: this.deps.getCwd(),
        turnResponses,
        hostRecord: hostRecord ?? undefined,
      });
    }

    const resolveSnapshot = this.deps.resolveSnapshot ?? resolvePersistedLexSessionSnapshot;
    const snapshot = await resolveSnapshot({
      lex,
      sessionId,
      cwd: this.deps.getCwd(),
      turnResponses,
      hostRecord: hostRecord ?? undefined,
    });

    return {
      snapshot,
      turnResponses: [...(turnResponses ?? [])],
      diagnostics: {
        sessionId,
        storedSnapshotState: snapshot ? 'loaded' : 'missing',
      },
    };
  }

  restoreResolvedSnapshot(snapshot: LexSessionSnapshot): boolean {
    return this.deps.restoreSnapshot(snapshot);
  }

  async restorePersistedSession(
    sessionId: string,
    turnResponses?: readonly import('aily-lex/browser').TurnResponseTurn[],
    hostRecord?: HostSessionRecord | null,
  ): Promise<boolean> {
    const restorePlan = await this.resolvePersistedRestorePlan(sessionId, turnResponses, hostRecord ?? null);
    return restorePlan?.snapshot ? this.restoreResolvedSnapshot(restorePlan.snapshot) : false;
  }
}