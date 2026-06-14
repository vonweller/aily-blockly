import type { DialogTurnContext } from '../core/user-turn-action-target';
import type {
  RequestCheckpointMetadata,
  WorkspaceCheckpointAvailabilityDetail,
  WorkspaceCheckpointPresentationMode,
} from '../services/edit-checkpoint.service';
import type { EditActionsHelper } from './edit-actions.helper';
import {
  canRedoSessionCheckpointTimeline,
  type SessionCheckpointTimelineEntry,
  type SessionCheckpointTimelineState,
} from './session-checkpoint-timeline-model';

export interface ChatSessionBoundaryActionController {
  regenerateTurn(target?: DialogTurnContext | null): Promise<void> | void;
  redoEdits(): Promise<void> | void;
  restoreCheckpoint(target: DialogTurnContext): Promise<boolean | void> | boolean | void;
  forkSession(target: DialogTurnContext): Promise<boolean | void> | boolean | void;
}

export type ChatSessionBoundaryBlockedAction = 'redoCheckpoint' | 'restoreCheckpoint' | 'forkSession';
export type ChatSessionBoundaryUnavailableAction = ChatSessionBoundaryBlockedAction;

export interface ChatSessionBoundaryUnavailableReason {
  readonly action: ChatSessionBoundaryUnavailableAction;
  readonly reason:
    | 'session-unavailable'
    | 'workspace-checkpoint-unavailable'
    | 'checkpoint-unavailable'
    | 'checkpoint-metadata-incomplete'
    | 'checkpoint-session-mismatch';
  readonly checkpointId?: string;
  readonly workspaceCheckpointDetail?: WorkspaceCheckpointAvailabilityDetail;
}

export interface ChatSessionBoundaryControllerContext {
  isBoundaryRewriteInProgress?(): boolean;
  warnBoundaryRewriteBlocked?(action: ChatSessionBoundaryBlockedAction): void;
  readCurrentSessionResource?(): string | null | undefined;
  readSessionCheckpointTimelineState?(sessionResource: string): SessionCheckpointTimelineState | null | undefined;
  getWorkspaceCheckpointPresentationMode?(): WorkspaceCheckpointPresentationMode;
  ensureWorkspaceCheckpointPresentationMode?(): Promise<WorkspaceCheckpointPresentationMode> | WorkspaceCheckpointPresentationMode;
  getWorkspaceCheckpointAvailabilityDetail?(): WorkspaceCheckpointAvailabilityDetail | null | undefined;
  getRequestCheckpointMetadataByCheckpointId?(checkpointId: string): RequestCheckpointMetadata | null | undefined;
  warnBoundaryActionUnavailable?(reason: ChatSessionBoundaryUnavailableReason): void;
  logBoundaryDiagnostic?(message: string): void;
}

/**
 * Single UI-facing owner for actions that rewrite chat/session history.
 *
 * The implementation still delegates to the existing edit helper while the
 * transaction internals are moved under this owner.
 */
export class ChatSessionBoundaryController implements ChatSessionBoundaryActionController {
  constructor(
    private readonly editActions: EditActionsHelper,
    private readonly ctx: ChatSessionBoundaryControllerContext = {},
  ) {}

  regenerateTurn(target?: DialogTurnContext | null): Promise<void> | void {
    return this.editActions.regenerateTurn(target);
  }

  async redoEdits(): Promise<void> {
    if (this.isBoundaryRewriteBlocked('redoCheckpoint')) {
      return;
    }
    if (!await this.canRunRedoCheckpointBoundary()) {
      return;
    }
    await this.editActions.redoEdits();
  }

  async restoreCheckpoint(target: DialogTurnContext): Promise<boolean | void> {
    if (this.isBoundaryRewriteBlocked('restoreCheckpoint')) {
      return false;
    }
    if (!await this.canRunRestoreCheckpointBoundary(target)) {
      return false;
    }
    return await this.editActions.restoreToCheckpoint(target);
  }

  async forkSession(target: DialogTurnContext): Promise<boolean | void> {
    if (this.isBoundaryRewriteBlocked('forkSession')) {
      return false;
    }
    if (!await this.canRunForkBoundary(target)) {
      return false;
    }
    return await this.editActions.forkSessionFromTurn(target);
  }

  private isBoundaryRewriteBlocked(action: ChatSessionBoundaryBlockedAction): boolean {
    if (this.ctx.isBoundaryRewriteInProgress?.() !== true) {
      return false;
    }

    this.ctx.warnBoundaryRewriteBlocked?.(action);
    return true;
  }

  private async canRunRedoCheckpointBoundary(): Promise<boolean> {
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      return this.blockUnavailable({ action: 'redoCheckpoint', reason: 'session-unavailable' });
    }

    const timelineState = this.ctx.readSessionCheckpointTimelineState?.(sessionResource) ?? null;
    if (!canRedoSessionCheckpointTimeline(timelineState)) {
      return this.blockUnavailable({ action: 'redoCheckpoint', reason: 'checkpoint-unavailable' });
    }

    if (!await this.isWorkspaceCheckpointAvailable('redoCheckpoint')) {
      return false;
    }

    const nextCheckpoint = timelineState!.checkpoints[timelineState!.currentCheckpointIndex + 1];
    return this.hasCompleteCheckpointMetadata(
      'redoCheckpoint',
      sessionResource,
      nextCheckpoint?.checkpointId,
    );
  }

  private async canRunRestoreCheckpointBoundary(target: DialogTurnContext): Promise<boolean> {
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      return this.blockUnavailable({ action: 'restoreCheckpoint', reason: 'session-unavailable' });
    }

    if (!await this.isWorkspaceCheckpointAvailable('restoreCheckpoint')) {
      return false;
    }

    const checkpointId = this.resolveTargetCheckpointId(sessionResource, target);
    return this.hasCompleteCheckpointMetadata('restoreCheckpoint', sessionResource, checkpointId);
  }

  private async canRunForkBoundary(target: DialogTurnContext): Promise<boolean> {
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      return this.blockUnavailable({ action: 'forkSession', reason: 'session-unavailable' });
    }

    if (!await this.isWorkspaceCheckpointAvailable('forkSession')) {
      return false;
    }

    const timelineState = this.ctx.readSessionCheckpointTimelineState?.(sessionResource) ?? null;
    const targetTurnId = normalizeString(target.turnId);
    const targetIndex = timelineState?.turnResponses.findIndex(turn => normalizeString(turn.turnId) === targetTurnId) ?? -1;
    if (!timelineState || targetIndex < 0) {
      return true;
    }

    const retainedCheckpointIds = timelineState.checkpoints
      .filter(checkpoint => checkpoint.turnIndex < targetIndex)
      .map(checkpoint => checkpoint.checkpointId);
    for (const checkpointId of retainedCheckpointIds) {
      if (!this.hasCompleteCheckpointMetadata('forkSession', sessionResource, checkpointId)) {
        return false;
      }
    }
    return true;
  }

  private async isWorkspaceCheckpointAvailable(action: ChatSessionBoundaryUnavailableAction): Promise<boolean> {
    const mode = await Promise.resolve(
      this.ctx.ensureWorkspaceCheckpointPresentationMode?.()
        ?? this.ctx.getWorkspaceCheckpointPresentationMode?.()
        ?? 'unknown',
    );
    if (mode === 'git' || mode === 'timeline') {
      return true;
    }
    return this.blockUnavailable({
      action,
      reason: 'workspace-checkpoint-unavailable',
      workspaceCheckpointDetail: this.ctx.getWorkspaceCheckpointAvailabilityDetail?.() ?? undefined,
    });
  }

  private hasCompleteCheckpointMetadata(
    action: ChatSessionBoundaryUnavailableAction,
    sessionResource: string,
    checkpointId: string | null | undefined,
  ): boolean {
    const normalizedCheckpointId = normalizeString(checkpointId);
    if (!normalizedCheckpointId) {
      return this.blockUnavailable({ action, reason: 'checkpoint-unavailable' });
    }

    const metadata = this.ctx.getRequestCheckpointMetadataByCheckpointId?.(normalizedCheckpointId) ?? null;
    if (!metadata) {
      return this.blockUnavailable({
        action,
        reason: 'checkpoint-metadata-incomplete',
        checkpointId: normalizedCheckpointId,
      });
    }

    if (normalizeString(metadata.sessionResource) !== sessionResource) {
      return this.blockUnavailable({
        action,
        reason: 'checkpoint-session-mismatch',
        checkpointId: normalizedCheckpointId,
      });
    }

    if (!normalizeString(metadata.checkpointRef) || !normalizeString(metadata.checkpointNamespace)) {
      return this.blockUnavailable({
        action,
        reason: 'checkpoint-metadata-incomplete',
        checkpointId: normalizedCheckpointId,
      });
    }

    return true;
  }

  private resolveTargetCheckpointId(
    sessionResource: string,
    target: DialogTurnContext,
  ): string | null {
    const checkpointIdFromTarget = readCheckpointIdFromTarget(target);
    if (checkpointIdFromTarget) {
      return checkpointIdFromTarget;
    }

    const timelineState = this.ctx.readSessionCheckpointTimelineState?.(sessionResource) ?? null;
    const targetTurnId = normalizeString(target.turnId);
    const checkpoint = timelineState?.checkpoints.find(entry => isCheckpointForTurn(entry, targetTurnId));
    return checkpoint?.checkpointId ?? null;
  }

  private resolveCurrentSessionResource(): string {
    return normalizeString(this.ctx.readCurrentSessionResource?.());
  }

  private blockUnavailable(reason: ChatSessionBoundaryUnavailableReason): false {
    this.ctx.logBoundaryDiagnostic?.(
      `blocked action=${reason.action}; reason=${reason.reason}; checkpointId=${reason.checkpointId ?? 'none'}; `
      + `workspaceMode=${reason.workspaceCheckpointDetail?.mode ?? 'unknown'}; `
      + `workspaceReason=${reason.workspaceCheckpointDetail?.reason ?? 'none'}; `
      + `workspaceMessage=${reason.workspaceCheckpointDetail?.message ?? ''}`,
    );
    this.ctx.warnBoundaryActionUnavailable?.(reason);
    return false;
  }
}

function readCheckpointIdFromTarget(target: DialogTurnContext | null | undefined): string | null {
  const requestMetadata = target?.request?.metadata ?? target?.turnResponse?.request?.metadata;
  if (!requestMetadata || typeof requestMetadata !== 'object') {
    return null;
  }

  const checkpointId = (requestMetadata as Record<string, unknown>)['checkpointId'];
  return normalizeString(checkpointId);
}

function isCheckpointForTurn(entry: SessionCheckpointTimelineEntry, turnId: string): boolean {
  return !!turnId && normalizeString(entry.turnId) === turnId;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
