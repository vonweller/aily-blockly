import {
  type DialogTurnContext,
} from '../core/user-turn-action-target';
import type {
  ChatRuntimeHostCheckpointNavigationRequest,
  ChatRuntimeHostCheckpointNavigationState,
} from '../core/chat-runtime-host-contract';
import { AilyHost } from '../core/host';
import type {
  RequestCheckpointMetadata,
  WorkspaceCheckpointAvailabilityDetail,
  WorkspaceCheckpointPresentationMode,
} from '../services/edit-checkpoint.service';
import type { EditActionsHelper } from './edit-actions.helper';

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
  readCheckpointNavigationState?(
    request: ChatRuntimeHostCheckpointNavigationRequest,
  ): Promise<ChatRuntimeHostCheckpointNavigationState | null>;
  getRequestCheckpointMetadataByCheckpointId?(checkpointId: string): RequestCheckpointMetadata | null | undefined;
  getSettledRequestCheckpointMetadataByCheckpointId?(
    checkpointId: string,
  ): Promise<RequestCheckpointMetadata | null | undefined> | RequestCheckpointMetadata | null | undefined;
  getWorkspaceCheckpointPresentationMode?(): WorkspaceCheckpointPresentationMode;
  ensureWorkspaceCheckpointPresentationMode?(): Promise<WorkspaceCheckpointPresentationMode> | WorkspaceCheckpointPresentationMode;
  getWorkspaceCheckpointAvailabilityDetail?(): WorkspaceCheckpointAvailabilityDetail | null | undefined;
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

  async regenerateTurn(target?: DialogTurnContext | null): Promise<void> {
    await this.editActions.regenerateTurn(target);
  }

  async redoEdits(): Promise<void> {
    if (this.isBoundaryRewriteBlocked('redoCheckpoint')) {
      return;
    }
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      this.blockUnavailable({ action: 'redoCheckpoint', reason: 'session-unavailable' });
      return;
    }
    const navigation = await this.canRunRedoCheckpointBoundary();
    if (!navigation) {
      return;
    }
    await this.editActions.redoEdits(navigation.nextCheckpoint!.checkpointId);
  }

  async restoreCheckpoint(target: DialogTurnContext): Promise<boolean | void> {
    if (this.isBoundaryRewriteBlocked('restoreCheckpoint')) {
      return false;
    }
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      return this.blockUnavailable({ action: 'restoreCheckpoint', reason: 'session-unavailable' });
    }
    const resolved = await this.resolveRestoreCheckpointBoundary(target);
    if (!resolved) {
      return false;
    }
    return await this.editActions.restoreToCheckpoint(resolved.target);
  }

  async forkSession(target: DialogTurnContext): Promise<boolean | void> {
    if (this.isBoundaryRewriteBlocked('forkSession')) {
      return false;
    }
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      return this.blockUnavailable({ action: 'forkSession', reason: 'session-unavailable' });
    }
    const resolved = await this.resolveForkBoundary(target);
    if (!resolved) {
      return false;
    }
    return await this.editActions.forkSessionFromTurn(resolved.target);
  }

  private isBoundaryRewriteBlocked(action: ChatSessionBoundaryBlockedAction): boolean {
    if (this.ctx.isBoundaryRewriteInProgress?.() !== true) {
      return false;
    }

    this.ctx.warnBoundaryRewriteBlocked?.(action);
    return true;
  }

  private async canRunRedoCheckpointBoundary(): Promise<ChatRuntimeHostCheckpointNavigationState | null> {
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      this.blockUnavailable({ action: 'redoCheckpoint', reason: 'session-unavailable' });
      return null;
    }

    const navigation = await this.readCheckpointNavigationState({ sessionId: sessionResource });
    if (!navigation?.canRedo || !navigation.nextCheckpoint) {
      this.blockUnavailable({ action: 'redoCheckpoint', reason: 'checkpoint-unavailable' });
      return null;
    }

    if (!await this.isWorkspaceCheckpointAvailable('redoCheckpoint', navigation)) {
      return null;
    }

    if (!await this.hasCheckpointMetadataBoundary(
      'redoCheckpoint',
      sessionResource,
      navigation.nextCheckpoint.checkpointId,
    )) {
      return null;
    }
    return navigation;
  }

  private async resolveRestoreCheckpointBoundary(
    target: DialogTurnContext,
  ): Promise<{ checkpointId: string; target: DialogTurnContext } | null> {
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      this.blockUnavailable({ action: 'restoreCheckpoint', reason: 'session-unavailable' });
      return null;
    }

    const resolved = await this.resolveTargetCheckpoint(sessionResource, target);
    if (!resolved) {
      return null;
    }
    if (!await this.isWorkspaceCheckpointAvailable('restoreCheckpoint', resolved.navigation)) {
      return null;
    }
    if (!await this.hasCheckpointMetadataBoundary('restoreCheckpoint', sessionResource, resolved.checkpointId)) {
      return null;
    }

    return resolved;
  }

  private async resolveForkBoundary(
    target: DialogTurnContext,
  ): Promise<{ checkpointId: string | null; target: DialogTurnContext } | null> {
    const sessionResource = this.resolveCurrentSessionResource();
    if (!sessionResource) {
      this.blockUnavailable({ action: 'forkSession', reason: 'session-unavailable' });
      return null;
    }

    return { checkpointId: readCheckpointIdFromTarget(target), target };
  }

  private async isWorkspaceCheckpointAvailable(
    action: ChatSessionBoundaryUnavailableAction,
    navigation?: ChatRuntimeHostCheckpointNavigationState | null,
  ): Promise<boolean> {
    const mode = await Promise.resolve(
      this.ctx.ensureWorkspaceCheckpointPresentationMode?.()
        ?? this.ctx.getWorkspaceCheckpointPresentationMode?.()
        ?? 'unknown',
    );
    if (mode === 'git' || mode === 'timeline') {
      return true;
    }
    if (this.hasCurrentSessionTimelineCheckpointBoundary(navigation)) {
      return true;
    }
    return this.blockUnavailable({
      action,
      reason: 'workspace-checkpoint-unavailable',
      workspaceCheckpointDetail: this.ctx.getWorkspaceCheckpointAvailabilityDetail?.() ?? undefined,
    });
  }

  private hasCurrentSessionTimelineCheckpointBoundary(
    navigation?: ChatRuntimeHostCheckpointNavigationState | null,
  ): boolean {
    if (this.hasOpenProjectWorkspace()) {
      return false;
    }

    return normalizeString(navigation?.sessionId) === this.resolveCurrentSessionResource()
      && (navigation?.checkpointCount ?? 0) > 0;
  }

  private hasOpenProjectWorkspace(): boolean {
    try {
      const currentProjectPath = AilyHost.get().project?.currentProjectPath;
      return typeof currentProjectPath === 'string' && currentProjectPath.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async hasCheckpointMetadataBoundary(
    action: ChatSessionBoundaryUnavailableAction,
    sessionResource: string,
    checkpointId: string | null | undefined,
  ): Promise<boolean> {
    const normalizedCheckpointId = normalizeString(checkpointId);
    if (!normalizedCheckpointId) {
      return this.blockUnavailable({ action, reason: 'checkpoint-unavailable' });
    }

    const readCurrent = this.ctx.getRequestCheckpointMetadataByCheckpointId;
    const readSettled = this.ctx.getSettledRequestCheckpointMetadataByCheckpointId;
    if (!readCurrent && !readSettled) {
      return true;
    }
    const current = readCurrent?.(normalizedCheckpointId) ?? null;
    const settled = await Promise.resolve(readSettled?.(normalizedCheckpointId) ?? current);
    const metadata = settled ?? current;
    if (metadata && normalizeString(metadata.sessionResource) !== sessionResource) {
      return this.blockUnavailable({
        action,
        reason: 'checkpoint-session-mismatch',
        checkpointId: normalizedCheckpointId,
      });
    }
    if (!settled || !hasCheckpointRef(settled)) {
      return this.blockUnavailable({
        action,
        reason: 'checkpoint-metadata-incomplete',
        checkpointId: normalizedCheckpointId,
      });
    }

    return true;
  }

  private async resolveTargetCheckpoint(
    sessionResource: string,
    target: DialogTurnContext,
  ): Promise<{
    checkpointId: string;
    target: DialogTurnContext;
    navigation: ChatRuntimeHostCheckpointNavigationState;
  } | null> {
    const checkpointIdFromTarget = readCheckpointIdFromTarget(target);
    const targetTurnId = normalizeString(target.turnId);
    if (!checkpointIdFromTarget && !targetTurnId) {
      this.ctx.logBoundaryDiagnostic?.(
        `target-identity-missing; session=${sessionResource}; targetTurnId=none; `
        + 'targetCheckpointId=none',
      );
      return null;
    }
    const navigation = await this.readCheckpointNavigationState({
      sessionId: sessionResource,
      ...(checkpointIdFromTarget
        ? { checkpointId: checkpointIdFromTarget }
        : { turnId: targetTurnId }),
    });
    if (!navigation?.requestedCheckpoint) {
      this.blockUnavailable({
        action: 'restoreCheckpoint',
        reason: 'checkpoint-unavailable',
        checkpointId: checkpointIdFromTarget || undefined,
      });
      return null;
    }
    return {
      checkpointId: navigation.requestedCheckpoint.checkpointId,
      target,
      navigation,
    };
  }

  private async readCheckpointNavigationState(
    request: ChatRuntimeHostCheckpointNavigationRequest,
  ): Promise<ChatRuntimeHostCheckpointNavigationState | null> {
    return await this.ctx.readCheckpointNavigationState?.(request) ?? null;
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

function hasCheckpointRef(metadata: RequestCheckpointMetadata): boolean {
  return !!normalizeString(metadata.checkpointRef)
    || Object.values(metadata.additionalCheckpointRefs ?? {}).some(value => !!normalizeString(value));
}

function readCheckpointIdFromTarget(target: DialogTurnContext | null | undefined): string | null {
  const requestMetadata = target?.request?.metadata ?? target?.turnResponse?.request?.metadata;
  if (!requestMetadata || typeof requestMetadata !== 'object') {
    return null;
  }

  const checkpointId = (requestMetadata as Record<string, unknown>)['checkpointId'];
  return normalizeString(checkpointId);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

