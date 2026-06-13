import type { TurnResponseTurn } from 'aily-lex/browser';
import type { HostSessionRecord } from '../services/chat-history.service';
import {
  buildHostProjectionStateFromPersistedRecord,
  type HostTurnResponseState,
} from './host-turn-response-state';

type LexRestorePlan = {
  readonly snapshot?: unknown | null;
  readonly turnResponses?: readonly TurnResponseTurn[] | null;
} | null;

export interface SessionModelBoundaryTransactionContext {
  readonly lexStream: {
    readonly session?: {
      resolveRestorePlan?(
        sessionId: string,
        turnResponses?: readonly TurnResponseTurn[],
        hostRecord?: HostSessionRecord | null,
      ): Promise<LexRestorePlan> | LexRestorePlan;
      restoreResolvedSnapshot?(snapshot: unknown, sessionId?: string | null): boolean;
    };
    hydrateTurnResponses?(
      sessionId: string,
      turnResponses: readonly TurnResponseTurn[],
      options?: { readonly visibility?: 'visibleAttach' | 'detached' },
    ): void;
  };
  projectRestoredHostProjection?(
    sessionId: string,
    turnResponses: readonly TurnResponseTurn[],
    hostProjectionState: HostTurnResponseState,
    options?: { readonly attachedView?: boolean },
  ): void;
  replaceSessionModelTurnResponses?(
    sessionId: string,
    turnResponses: readonly TurnResponseTurn[],
  ): readonly TurnResponseTurn[] | null | undefined;
  replaceSharedHostProjectionState?(
    state: HostTurnResponseState | null,
    options: { readonly sessionId: string | null; readonly attachedView?: boolean },
  ): void;
  invalidateHostRequestGraph?(): void;
  triggerSyncDetectChanges?(): void;
}

export interface RestoreSessionBoundaryTransactionInput {
  readonly sessionId: string;
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly restorePlan?: LexRestorePlan;
  readonly hostProjectionState?: HostTurnResponseState | null;
  readonly hostRecord?: HostSessionRecord | null;
  readonly attachedView?: boolean;
  readonly hydrateVisibleTurnResponses?: boolean;
  readonly requireLexSnapshotRestore?: boolean;
}

export interface RestoreSessionBoundaryTransactionResult {
  readonly sessionId: string;
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly hostProjectionState: HostTurnResponseState;
  readonly restoredLexSnapshot: boolean;
}

export async function restoreSessionBoundaryTransaction(
  ctx: SessionModelBoundaryTransactionContext,
  input: RestoreSessionBoundaryTransactionInput,
): Promise<RestoreSessionBoundaryTransactionResult> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    throw new Error('Session boundary transaction requires a sessionResource');
  }

  let turnResponses = [...input.turnResponses];
  let restoredLexSnapshot = false;
  const resolveRestorePlan = ctx.lexStream.session?.resolveRestorePlan?.bind(ctx.lexStream.session);
  const restoreResolvedSnapshot = ctx.lexStream.session?.restoreResolvedSnapshot?.bind(ctx.lexStream.session);

  if ((input.restorePlan || resolveRestorePlan) && restoreResolvedSnapshot) {
    const restorePlan = input.restorePlan ?? await resolveRestorePlan?.(sessionId, turnResponses, input.hostRecord ?? null) ?? null;
    if (!restorePlan) {
      if (input.requireLexSnapshotRestore) {
        throw new Error(`Session boundary transaction failed to resolve lex restore plan for ${sessionId}`);
      }
    } else if (restorePlan.snapshot) {
      const restored = restoreResolvedSnapshot(restorePlan.snapshot, sessionId);
      if (!restored) {
        throw new Error(`Session boundary transaction failed to restore lex snapshot for ${sessionId}`);
      }
      restoredLexSnapshot = true;
      turnResponses = [...(restorePlan.turnResponses ?? turnResponses)];
    } else if (input.requireLexSnapshotRestore) {
      throw new Error(`Session boundary transaction resolved no lex snapshot for ${sessionId}`);
    }
  }

  const modelTurnResponses = ctx.replaceSessionModelTurnResponses?.(sessionId, turnResponses);
  if (Array.isArray(modelTurnResponses)) {
    turnResponses = [...modelTurnResponses];
  }

  const hostProjectionState = input.hostProjectionState?.turnResponses?.length === turnResponses.length
    ? input.hostProjectionState
    : buildHostProjectionStateFromPersistedRecord({ turnResponses });

  if (input.hydrateVisibleTurnResponses) {
    ctx.lexStream.hydrateTurnResponses?.(sessionId, turnResponses, { visibility: 'visibleAttach' });
  }

  if (ctx.projectRestoredHostProjection) {
    ctx.projectRestoredHostProjection(sessionId, turnResponses, hostProjectionState, {
      attachedView: input.attachedView !== false,
    });
  } else {
    ctx.replaceSharedHostProjectionState?.(hostProjectionState, {
      sessionId,
      attachedView: input.attachedView !== false,
    });
  }

  ctx.invalidateHostRequestGraph?.();
  ctx.triggerSyncDetectChanges?.();

  return {
    sessionId,
    turnResponses,
    hostProjectionState,
    restoredLexSnapshot,
  };
}
