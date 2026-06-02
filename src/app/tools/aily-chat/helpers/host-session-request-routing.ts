import {
  readTurnRequestModeInfo,
  resolveTurnRequestModeCustomAgentTarget,
  resolveTurnRequestModeKind,
} from 'aily-lex/browser';

import {
  isLegacyChatPlanModeValue,
  LEGACY_CHAT_PLAN_AGENT_TARGET,
  normalizeChatModeId,
  normalizeChatSelectedMode,
  resolveChatModeId,
  resolveChatSelectedCustomAgentTarget,
  type ChatModeId,
  type ChatSelectedMode,
} from '../core/chat-mode';
import type { HostSessionRecord, PersistedHostTurnResponse } from '../services/chat-history.service';

export interface HostSessionRequestRoutingSummary {
  readonly selectedModeId: ChatModeId;
  readonly requestModeId?: ChatModeId;
  readonly customAgentTarget?: string;
  readonly permissionLevel?: string;
  readonly approvalsReviewer?: 'user' | 'auto_review';
  readonly approvalPolicy?: 'on_request' | 'never';
}

interface HostSessionRequestRoutingSnapshot {
  readonly modeId?: ChatModeId;
  readonly customAgentTarget?: string;
  readonly requestModeExplicit?: boolean;
  readonly permissionLevel?: string;
  readonly approvalsReviewer?: 'user' | 'auto_review';
  readonly approvalPolicy?: 'on_request' | 'never';
}

export function resolveHostSessionSelectedModeId(
  turnResponses: readonly PersistedHostTurnResponse[] | undefined,
  fallback: unknown,
): ChatModeId {
  const snapshot = resolveLatestTurnRequestRouting(turnResponses);
  return snapshot?.modeId ?? normalizeChatModeId(fallback);
}

export function normalizeHostSessionRequestRoutingSummary(
  value: {
    readonly selectedModeId?: unknown;
    readonly requestModeId?: unknown;
    readonly customAgentTarget?: unknown;
    readonly permissionLevel?: unknown;
    readonly approvalsReviewer?: unknown;
    readonly approvalPolicy?: unknown;
  } | undefined,
  fallback: unknown,
): HostSessionRequestRoutingSummary {
  const fallbackSelectedMode = isSelectedModeSnapshot(fallback)
    ? normalizeChatSelectedMode(fallback)
    : undefined;
  const fallbackModeId = fallbackSelectedMode?.modeId
    ?? resolveRequestRoutingModeId(fallback)
    ?? normalizeChatModeId(fallback);
  const legacyModeValue = value?.requestModeId ?? value?.selectedModeId ?? fallbackSelectedMode?.modeId ?? fallback;
  const customAgentTarget = normalizeCustomAgentTarget(value?.customAgentTarget, legacyModeValue)
    ?? resolveChatSelectedCustomAgentTarget(fallbackSelectedMode);
  const requestModeId = resolveRequestModeIdFromSummaryValue(value?.requestModeId, value?.selectedModeId);
  const selectedModeId = requestModeId ?? fallbackModeId;
  const permissionLevel = normalizePermissionLevel(value?.permissionLevel);
  const approvalsReviewer = normalizeApprovalsReviewer(value?.approvalsReviewer);
  const approvalPolicy = normalizeApprovalPolicy(value?.approvalPolicy);

  return {
    selectedModeId,
    ...(requestModeId ? { requestModeId } : {}),
    ...(customAgentTarget ? { customAgentTarget } : {}),
    ...(permissionLevel ? { permissionLevel } : {}),
    ...(approvalsReviewer ? { approvalsReviewer } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
  };
}

export function buildHostSessionCurrentPickerRoutingSummary(
  selectedModeOrModeId: Pick<ChatSelectedMode, 'modeId' | 'customAgentTarget'> | unknown,
  customAgentTarget?: unknown,
  permissionLevel?: unknown,
  approvalsReviewer?: unknown,
  approvalPolicy?: unknown,
): HostSessionRequestRoutingSummary {
  const selectedMode = isSelectedModeSnapshot(selectedModeOrModeId)
    ? normalizeChatSelectedMode(selectedModeOrModeId)
    : normalizeChatSelectedMode({
        modeId: selectedModeOrModeId,
        customAgentTarget,
      });
  const normalizedModeId = normalizeChatModeId(selectedMode.modeId);
  const effectiveCustomAgentTarget = resolveChatSelectedCustomAgentTarget(selectedMode);

  return normalizeHostSessionRequestRoutingSummary(
    {
      requestModeId: normalizedModeId,
      ...(effectiveCustomAgentTarget ? { customAgentTarget: effectiveCustomAgentTarget } : {}),
      ...(normalizePermissionLevel(permissionLevel) ? { permissionLevel: normalizePermissionLevel(permissionLevel) } : {}),
      ...(normalizeApprovalsReviewer(approvalsReviewer) ? { approvalsReviewer: normalizeApprovalsReviewer(approvalsReviewer) } : {}),
      ...(normalizeApprovalPolicy(approvalPolicy) ? { approvalPolicy: normalizeApprovalPolicy(approvalPolicy) } : {}),
    },
    normalizedModeId,
  );
}

export function resolveHostSessionCustomAgentTarget(
  turnResponses: readonly PersistedHostTurnResponse[] | undefined,
): string | undefined {
  return resolveLatestTurnRequestRouting(turnResponses)?.customAgentTarget;
}

export function hasHostSessionExplicitTurnRequestRouting(
  turnResponses: readonly PersistedHostTurnResponse[] | undefined,
): boolean {
  return !!resolveLatestTurnRequestRouting(turnResponses);
}

export function resolveHostSessionRequestRoutingSummary(
  record: Pick<HostSessionRecord, 'metadata' | 'turnResponses'>,
): HostSessionRequestRoutingSummary {
  const metadataSnapshot = readMetadataRequestRouting(record);
  const snapshot = resolveLatestTurnRequestRouting(record.turnResponses);
  const preferTurnSnapshot = !!snapshot;
  const modeId = preferTurnSnapshot
    ? snapshot.modeId ?? metadataSnapshot?.modeId
    : metadataSnapshot?.modeId ?? snapshot?.modeId;
  const customAgentTarget = preferTurnSnapshot
    ? snapshot.customAgentTarget ?? metadataSnapshot?.customAgentTarget
    : metadataSnapshot?.customAgentTarget ?? snapshot?.customAgentTarget;
  const requestModeExplicit = preferTurnSnapshot
    ? snapshot?.requestModeExplicit ?? false
    : metadataSnapshot?.requestModeExplicit ?? snapshot?.requestModeExplicit ?? false;
  const permissionLevel = preferTurnSnapshot
    ? snapshot?.permissionLevel ?? metadataSnapshot?.permissionLevel
    : metadataSnapshot?.permissionLevel ?? snapshot?.permissionLevel;
  const approvalsReviewer = preferTurnSnapshot
    ? snapshot?.approvalsReviewer ?? metadataSnapshot?.approvalsReviewer
    : metadataSnapshot?.approvalsReviewer ?? snapshot?.approvalsReviewer;
  const approvalPolicy = preferTurnSnapshot
    ? snapshot?.approvalPolicy ?? metadataSnapshot?.approvalPolicy
    : metadataSnapshot?.approvalPolicy ?? snapshot?.approvalPolicy;

  return normalizeHostSessionRequestRoutingSummary(
    {
      ...(modeId
        ? (requestModeExplicit ? { requestModeId: modeId } : { selectedModeId: modeId })
        : {}),
      ...(customAgentTarget ? { customAgentTarget } : {}),
      ...(permissionLevel ? { permissionLevel } : {}),
      ...(approvalsReviewer ? { approvalsReviewer } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {}),
    },
    record.metadata.mode,
  );
}

function resolveLatestTurnRequestRouting(
  turnResponses: readonly PersistedHostTurnResponse[] | undefined,
): HostSessionRequestRoutingSnapshot | undefined {
  if (!Array.isArray(turnResponses) || turnResponses.length === 0) {
    return undefined;
  }

  for (let index = turnResponses.length - 1; index >= 0; index -= 1) {
    const snapshot = readTurnRequestRouting(turnResponses[index]);
    if (snapshot) {
      return snapshot;
    }
  }

  return undefined;
}

function readTurnRequestRouting(
  turnResponse: PersistedHostTurnResponse | undefined,
): HostSessionRequestRoutingSnapshot | undefined {
  const metadata = asRecord(turnResponse?.request?.metadata);
  if (!metadata) {
    return undefined;
  }

  const modeInfo = readTurnRequestModeInfo(metadata);
  const modeInfoRecord = modeInfo as Record<string, unknown> | undefined;
  const modeId = resolveTurnRequestModeKind(modeInfo) ?? resolveRequestRoutingModeId(metadata['modeId']);
  const requestRouting = asRecord(metadata['requestRouting']);
  const customAgentTarget = normalizeCustomAgentTarget(requestRouting?.['customAgentTarget'])
    ?? resolveTurnRequestModeCustomAgentTarget(modeInfo)
    ?? normalizeCustomAgentTarget(undefined, metadata['modeId']);
  const permissionLevel = normalizePermissionLevel(modeInfo?.permissionLevel ?? requestRouting?.['permissionLevel']);
  const approvalsReviewer = normalizeApprovalsReviewer(modeInfoRecord?.['approvalsReviewer'] ?? requestRouting?.['approvalsReviewer']);
  const approvalPolicy = normalizeApprovalPolicy(modeInfoRecord?.['approvalPolicy'] ?? requestRouting?.['approvalPolicy']);

  if (!modeId && !customAgentTarget && !permissionLevel && !approvalsReviewer && !approvalPolicy) {
    return undefined;
  }

  return {
    ...(modeId ? { modeId } : {}),
    ...(customAgentTarget ? { customAgentTarget } : {}),
    ...(modeId ? { requestModeExplicit: true } : {}),
    ...(permissionLevel ? { permissionLevel } : {}),
    ...(approvalsReviewer ? { approvalsReviewer } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
  };
}

function readMetadataRequestRouting(
  record: Pick<HostSessionRecord, 'metadata'>,
): HostSessionRequestRoutingSnapshot | undefined {
  const requestRouting = asRecord(record.metadata.requestRouting);
  if (!requestRouting) {
    return undefined;
  }

  const modeValue = requestRouting['requestModeId'] ?? requestRouting['selectedModeId'];
  const customAgentTarget = normalizeCustomAgentTarget(
    requestRouting['customAgentTarget'],
    modeValue,
  );
  const explicitRequestModeId = resolveRequestRoutingModeId(requestRouting['requestModeId']);
  const modeId = explicitRequestModeId ?? resolveRequestRoutingModeId(requestRouting['selectedModeId']);
  const permissionLevel = normalizePermissionLevel(requestRouting['permissionLevel']);
  const approvalsReviewer = normalizeApprovalsReviewer(requestRouting['approvalsReviewer']);
  const approvalPolicy = normalizeApprovalPolicy(requestRouting['approvalPolicy']);
  if (!modeId && !customAgentTarget && !permissionLevel && !approvalsReviewer && !approvalPolicy) {
    return undefined;
  }

  return {
    ...(modeId ? { modeId } : {}),
    ...(customAgentTarget ? { customAgentTarget } : {}),
    ...(explicitRequestModeId ? { requestModeExplicit: true } : {}),
    ...(permissionLevel ? { permissionLevel } : {}),
    ...(approvalsReviewer ? { approvalsReviewer } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
  };
}

function normalizePermissionLevel(value: unknown): string | undefined {
  const normalizedValue = typeof value === 'string'
    ? value.trim()
    : '';
  return normalizedValue || undefined;
}

function normalizeApprovalsReviewer(value: unknown): 'user' | 'auto_review' | undefined {
  return value === 'auto_review' || value === 'user'
    ? value
    : undefined;
}

function normalizeApprovalPolicy(value: unknown): 'on_request' | 'never' | undefined {
  return value === 'never' || value === 'on_request'
    ? value
    : undefined;
}

function normalizeCustomAgentTarget(value: unknown, modeValue?: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return isLegacyChatPlanModeValue(modeValue)
    ? LEGACY_CHAT_PLAN_AGENT_TARGET
    : undefined;
}

function isSelectedModeSnapshot(
  value: unknown,
): value is Pick<ChatSelectedMode, 'modeId' | 'customAgentTarget'> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'modeId' in value;
}

function resolveRequestModeIdFromSummaryValue(
  requestModeValue: unknown,
  selectedModeValue: unknown,
): ChatModeId | undefined {
  return resolveRequestRoutingModeId(requestModeValue) ?? resolveRequestRoutingModeId(selectedModeValue);
}

function resolveRequestRoutingModeId(value: unknown): ChatModeId | undefined {
  return resolveChatModeId(value) ?? (isLegacyChatPlanModeValue(value) ? 'agent' : undefined);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}