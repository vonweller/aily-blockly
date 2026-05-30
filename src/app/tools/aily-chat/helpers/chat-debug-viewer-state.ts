import {
  normalizeChatSurfaceModeId,
  type ChatSessionModeDescriptor,
  type ChatSurfaceModeId,
} from '../core/chat-mode';
import { buildDialogTurnContext } from '../core/user-turn-action-target';
import type { ChatDialogViewItem } from './chat-dialog-view-items';
import type { HostSessionInteractionActionSummary } from './host-session-interaction-action';
import type { HostSessionRequestRoutingSummary } from './host-session-request-routing';
import { resolveHostSessionInteractionActionSummary } from './host-session-interaction-action';
import {
  resolveHostSessionModeDescriptorFromMetadata,
  resolveHostSessionProviderOptions,
  type HostSessionProviderOptions,
} from './host-session-input-state';
import { readPendingPlanReview } from './host-session-restore-bridge';
import { resolveHostSessionRequestContext } from './host-session-runtime-auxiliary';
import { buildHostProjectionStateFromPersistedRecord } from './host-turn-response-state';
import { resolveHostSessionRequestRoutingSummary } from './host-session-request-routing';
import type { ImportedDebugSessionRecord } from '../services/chat-history.service';
import type {
  HostSessionDebugDualPersistenceSummary,
  HostSessionDebugLiveRuntimeOverlaySummary,
  HostSessionRestoreDiagnosticsSummary,
  HostSessionRestoreFailureSummary,
} from '../services/host-session-debug-export';

export interface ImportedDebugSurfaceModeSummary {
  readonly id: string;
  readonly kind: ChatSurfaceModeId;
  readonly label: string;
  readonly isBuiltin: boolean;
}

export interface ImportedDebugSessionViewModel {
  readonly metadata: ImportedDebugSessionRecord['hostRecord']['metadata'];
  readonly surfaceMode: ImportedDebugSurfaceModeSummary;
  readonly providerOptions: HostSessionProviderOptions;
  readonly requestRouting: HostSessionRequestRoutingSummary;
  readonly interactionActionSummary?: HostSessionInteractionActionSummary;
  readonly pendingPlanReview?: ImportedDebugPendingPlanReviewSummary;
  readonly dualPersistence?: HostSessionDebugDualPersistenceSummary;
  readonly liveRuntimeOverlay?: HostSessionDebugLiveRuntimeOverlaySummary;
  readonly restoreDiagnostics?: HostSessionRestoreDiagnosticsSummary;
  readonly restoreFailure?: HostSessionRestoreFailureSummary;
  readonly turnCount: number;
  readonly messageCount: number;
  readonly dialogItems: readonly ChatDialogViewItem[];
}

export interface ImportedDebugPendingPlanReviewSummary {
  readonly id: string;
  readonly title: string;
  readonly planUri?: string;
  readonly actionIds: readonly string[];
  readonly canProvideFeedback: boolean;
}

export function buildImportedDebugSessionViewModel(
  record: ImportedDebugSessionRecord,
): ImportedDebugSessionViewModel {
  const projection = buildHostProjectionStateFromPersistedRecord(record.hostRecord);

  return {
    metadata: record.hostRecord.metadata,
    surfaceMode: buildImportedDebugSurfaceModeSummary(record.hostRecord.metadata),
    providerOptions: resolveHostSessionProviderOptions(record.hostRecord),
    requestRouting: resolveHostSessionRequestRoutingSummary(record.hostRecord),
    interactionActionSummary: resolveHostSessionInteractionActionSummary(record.hostRecord),
    pendingPlanReview: buildPendingPlanReviewSummary(record),
    ...(record.debugDualPersistence ? { dualPersistence: { ...record.debugDualPersistence } } : {}),
    ...(record.debugLiveRuntimeOverlay ? { liveRuntimeOverlay: { ...record.debugLiveRuntimeOverlay } } : {}),
    ...(record.debugRestoreDiagnostics ? { restoreDiagnostics: { ...record.debugRestoreDiagnostics } } : {}),
    ...(record.debugRestoreFailure ? { restoreFailure: { ...record.debugRestoreFailure } } : {}),
    turnCount: projection.turnResponses.length,
    messageCount: projection.dialogItems.length,
    dialogItems: projection.dialogItems.map(disableDialogItemActions),
  };
}

function buildPendingPlanReviewSummary(
  record: ImportedDebugSessionRecord,
): ImportedDebugPendingPlanReviewSummary | undefined {
  const pendingReview = readPendingPlanReview(resolveHostSessionRequestContext(record.hostRecord)?.interactionContinuation);
  if (!pendingReview) {
    return undefined;
  }

  return {
    id: pendingReview.id,
    title: pendingReview.title,
    ...(pendingReview.planUri ? { planUri: pendingReview.planUri } : {}),
    actionIds: pendingReview.actions.map(action => action.id),
    canProvideFeedback: pendingReview.canProvideFeedback,
  };
}

function buildImportedDebugSurfaceModeSummary(
  metadata: ImportedDebugSessionRecord['hostRecord']['metadata'],
): ImportedDebugSurfaceModeSummary {
  const modeDescriptor = resolveHostSessionModeDescriptorFromMetadata(metadata);
  if (modeDescriptor) {
    return {
      id: modeDescriptor.id,
      kind: modeDescriptor.kind,
      label: resolveImportedDebugSurfaceModeLabel(modeDescriptor),
      isBuiltin: modeDescriptor.isBuiltin,
    };
  }

  const kind = normalizeChatSurfaceModeId(metadata.mode);
  return {
    id: kind,
    kind,
    label: BUILTIN_SURFACE_MODE_LABELS[kind],
    isBuiltin: true,
  };
}

function resolveImportedDebugSurfaceModeLabel(
  modeDescriptor: ChatSessionModeDescriptor,
): string {
  const candidate = !modeDescriptor.isBuiltin
    ? modeDescriptor.modeInstructions?.name?.trim() || modeDescriptor.name?.trim() || modeDescriptor.id.trim()
    : modeDescriptor.name?.trim() || BUILTIN_SURFACE_MODE_LABELS[modeDescriptor.kind];
  return candidate || modeDescriptor.id;
}

const BUILTIN_SURFACE_MODE_LABELS: Record<ChatSurfaceModeId, string> = {
  ask: 'Ask',
  edit: 'Edit',
  agent: 'Agent',
};

function disableDialogItemActions(item: ChatDialogViewItem): ChatDialogViewItem {
  return {
    ...item,
    isLastAily: false,
    showCheckpointRestore: false,
    turnContext: item.turnContext
      ? buildDialogTurnContext({
        turnId: item.turnContext.turnId,
        turnResponse: item.turnContext.turnResponse,
        request: item.turnContext.request,
        response: item.turnContext.response,
        rounds: item.turnContext.rounds,
        requestDisabled: true,
        requestContent: item.turnContext.requestContent,
        displayContent: item.turnContext.displayContent,
      })
      : null,
  };
}
