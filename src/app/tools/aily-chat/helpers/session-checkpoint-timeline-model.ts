import type { TurnResponseTurn } from 'aily-lex/browser';
import type { RequestCheckpointMetadata } from '../services/edit-checkpoint.service';

export interface SessionCheckpointTimelineEntry {
  readonly checkpointId: string;
  readonly requestId: string;
  readonly turnId?: string;
  readonly turnIndex: number;
  readonly metadata?: RequestCheckpointMetadata;
}

export interface SessionCheckpointTimelineState {
  readonly sessionResource: string;
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly checkpoints: readonly SessionCheckpointTimelineEntry[];
  readonly currentCheckpointIndex: number;
}

export interface SessionCheckpointTimelineCreateOptions {
  readonly sessionResource: string;
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly currentCheckpointIndex?: number;
  readonly metadataByCheckpointId?: ReadonlyMap<string, RequestCheckpointMetadata> | null;
}

export function createSessionCheckpointTimelineState(
  options: SessionCheckpointTimelineCreateOptions,
): SessionCheckpointTimelineState {
  const sessionResource = normalizeSessionResource(options.sessionResource);
  const turnResponses = cloneTurnResponses(options.turnResponses);
  const checkpoints = turnResponses.flatMap((turn, turnIndex) => {
    const checkpointId = normalizeSessionResource(turn.request?.metadata?.checkpointId);
    if (!checkpointId) {
      return [];
    }

    const metadata = options.metadataByCheckpointId?.get(checkpointId);
    const requestId = normalizeSessionResource(metadata?.requestId)
      || normalizeSessionResource(turn.turnId)
      || checkpointId;

    return [{
      checkpointId,
      requestId,
      ...(turn.turnId ? { turnId: turn.turnId } : {}),
      turnIndex,
      ...(metadata ? { metadata: cloneRequestCheckpointMetadata(metadata) } : {}),
    }];
  });

  const lastIndex = checkpoints.length - 1;
  const currentCheckpointIndex = normalizeCheckpointIndex(
    options.currentCheckpointIndex,
    lastIndex,
  );

  return {
    sessionResource,
    turnResponses,
    checkpoints,
    currentCheckpointIndex,
  };
}

export function cloneSessionCheckpointTimelineState(
  state: SessionCheckpointTimelineState | null | undefined,
): SessionCheckpointTimelineState | null {
  if (!state) {
    return null;
  }

  return {
    sessionResource: state.sessionResource,
    turnResponses: cloneTurnResponses(state.turnResponses),
    checkpoints: state.checkpoints.map(checkpoint => ({
      ...checkpoint,
      ...(checkpoint.metadata ? { metadata: cloneRequestCheckpointMetadata(checkpoint.metadata) } : {}),
    })),
    currentCheckpointIndex: state.currentCheckpointIndex,
  };
}

export function restoreSessionCheckpointTimelineToCheckpoint(
  state: SessionCheckpointTimelineState,
  checkpointId: string,
): SessionCheckpointTimelineState | null {
  const normalizedCheckpointId = normalizeSessionResource(checkpointId);
  if (!normalizedCheckpointId) {
    return null;
  }

  const checkpointIndex = state.checkpoints.findIndex(checkpoint => checkpoint.checkpointId === normalizedCheckpointId);
  if (checkpointIndex < 0) {
    return null;
  }

  return {
    ...cloneSessionCheckpointTimelineState(state)!,
    currentCheckpointIndex: checkpointIndex - 1,
  };
}

export function redoSessionCheckpointTimeline(
  state: SessionCheckpointTimelineState,
): SessionCheckpointTimelineState {
  const cloned = cloneSessionCheckpointTimelineState(state)!;
  return {
    ...cloned,
    currentCheckpointIndex: Math.min(
      cloned.currentCheckpointIndex + 1,
      cloned.checkpoints.length - 1,
    ),
  };
}

export function spliceSessionCheckpointTimelineForwardBranch(
  state: SessionCheckpointTimelineState,
): SessionCheckpointTimelineState {
  const visibleTurnResponses = getSessionCheckpointVisibleTurnResponses(state);
  return createSessionCheckpointTimelineState({
    sessionResource: state.sessionResource,
    turnResponses: visibleTurnResponses,
  });
}

export function canRedoSessionCheckpointTimeline(
  state: SessionCheckpointTimelineState | null | undefined,
): boolean {
  return !!state && state.currentCheckpointIndex < state.checkpoints.length - 1;
}

export function getSessionCheckpointVisibleTurnResponses(
  state: SessionCheckpointTimelineState | null | undefined,
): readonly TurnResponseTurn[] {
  if (!state || state.currentCheckpointIndex < 0) {
    return [];
  }

  const checkpoint = state.checkpoints[state.currentCheckpointIndex];
  if (!checkpoint) {
    return [];
  }

  return cloneTurnResponses(state.turnResponses.slice(0, checkpoint.turnIndex + 1));
}

export function getSessionCheckpointHiddenTurnResponses(
  state: SessionCheckpointTimelineState | null | undefined,
): readonly TurnResponseTurn[] {
  if (!state) {
    return [];
  }

  if (state.currentCheckpointIndex < 0) {
    return cloneTurnResponses(state.turnResponses);
  }

  const checkpoint = state.checkpoints[state.currentCheckpointIndex];
  const startIndex = checkpoint ? checkpoint.turnIndex + 1 : 0;
  return cloneTurnResponses(state.turnResponses.slice(startIndex));
}

function normalizeCheckpointIndex(value: number | undefined, lastIndex: number): number {
  if (lastIndex < 0) {
    return -1;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return lastIndex;
  }

  return Math.max(-1, Math.min(Math.trunc(value), lastIndex));
}

function normalizeSessionResource(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneRequestCheckpointMetadata(metadata: RequestCheckpointMetadata): RequestCheckpointMetadata {
  return cloneJson(metadata);
}

function cloneTurnResponses(turnResponses: readonly TurnResponseTurn[]): TurnResponseTurn[] {
  return turnResponses.map(turn => cloneJson(turn));
}

function cloneJson<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value) as T;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
