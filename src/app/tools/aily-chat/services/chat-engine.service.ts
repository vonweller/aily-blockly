/**
 * ChatEngineService — aily-chat 核心业务逻辑引擎
 *
 * 从 AilyChatComponent 中提取的全部业务逻辑、副作用和共享状态。
 * Component 仅保留 Angular 生命周期、模板绑定和 UI 事件处理器。
 *
 * 职责：
 * - 会话生命周期管理（start / stop / close / new / history）
 * - 消息发送与工具调用循环（stateless turn loop）
 * - SSE 流处理与事件分发
 * - 订阅管理（项目路径、登录状态、配置变更等）
 */

import { Injectable, ElementRef, NgZone, inject } from '@angular/core';
import { Subscription, skip, distinctUntilChanged, combineLatest } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

import { ChatService, ChatTextOptions, ModelConfig } from './chat.service';
import { McpService } from './mcp.service';
import { AilyChatConfigService } from './aily-chat-config.service';
import { AilyChatLanguageModelsService } from './aily-chat-language-models.service';
import { ChatHistoryService } from './chat-history.service';
import { MAIN_AGENT_TYPE } from '../core/agent-identifiers';
import {
  createChatAgentRuntimeModeConfigKey,
  normalizeChatAgentRuntimeMode,
  normalizeChatAgentRuntimeModeSource,
  type ChatAgentRuntimeMode,
  type ChatAgentRuntimeModeSource,
} from '../core/chat-agent-runtime-mode';
import { RepetitionDetectionService } from './repetition-detection.service';
import { ContextBudgetService } from './context-budget.service';
import { ContextBudgetViewService } from './context-budget-view.service';
import { ChatViewService } from './chat-view.service';
import { ChatSetupSuggestionService } from './chat-setup-suggestion.service';
import {
  ChatRuntimeInteractionHostService,
  type RuntimePlanReviewAction,
  type RuntimePlanReviewDecision,
} from './chat-runtime-interaction-host.service';
import { AuthQuotaStateService, readAuthQuotaStateSnapshot, type AuthQuotaInfo } from './auth-quota-state.service';
import { ChatInputNoticeStateService } from './chat-input-notice-state.service';
import type { ChatInputNotice } from './chat-input-notice';
import { createLexContextBudgetSnapshot, type LexContextBudgetSnapshotExtra } from './context-budget-lex-event';
import type { ContextBudgetSnapshot } from './context-budget-snapshot';
import { createChatContextUsageSnapshot, findLatestUsageTurn, type ChatContextUsageSnapshot } from './context-usage-snapshot';
import { createInteractionBudgetSnapshot, type InteractionBudgetSnapshot } from './interaction-budget-snapshot';
import {
  createRequestQuotaInputNotice,
  createRequestQuotaSnapshot,
  createRequestQuotaSnapshotFromServiceState,
  createRequestRateLimitInputNotice,
  type RequestQuotaSnapshot,
} from './request-quota-snapshot';
import {
  RequestQuotaStateService,
  readRequestQuotaStateTurnSidecar,
  type RequestQuotaServiceState,
  type RequestQuotaUsageSnapshot,
} from './request-quota-state.service';
import { ChatSessionEntryStateService } from './chat-session-entry-state.service';
import { ConfigService } from '../../../services/config.service';
import { formatCompactBillingLabel, isDefaultAutoPresetSelected } from '../helpers/model-billing-label';
import {
  normalizeChatSelectedMode,
  resolveChatCurrentMode,
  resolveChatSurfaceModeId,
  type ChatResolvedMode,
  type ChatResolvedModeHandoff,
  type ChatSelectedMode,
  type ChatSessionPermissionMode,
  type ChatSurfaceModeId,
} from '../core/chat-mode';
import {
  normalizeChatSessionTitleCandidate,
  normalizeChatSessionTitleText,
} from '../core/chat-session-title';

import { AbsAutoSyncService } from './abs-auto-sync.service';
import type { EditsSummary } from './edit-checkpoint.service';
import { EditCheckpointService } from './edit-checkpoint.service';
import { AiCoderDiffBridgeService } from '../../../services/ai-coder-diff-bridge.service';
import { GitWorkspaceCheckpointProviderService } from './git-workspace-checkpoint-provider.service';
import { ScrollManagerService } from './scroll-manager.service';
import { ResourceManagerService } from './resource-manager.service';
import { ChatSessionItemsService } from './chat-session-items.service';
import { ChatSessionModelStoreService, type ChatSessionModel, type ChatSessionModelMetadataPatch } from './chat-session-model-store.service';
import {
  ChatSessionRuntimeStoreService,
  resolveChatSessionRuntimeCapabilities,
  resolveChatSessionRuntimeConcurrencyScope,
  type ChatSessionRuntimeQuotaOverlay,
  type ChatSessionRuntimeState,
  type ChatSessionRuntimeViewOverlay,
} from './chat-session-runtime-store.service';
import { ChatSessionRuntimeRegistryService } from './chat-session-runtime-registry.service';
import { ChatSessionViewModelStoreService } from './chat-session-view-model-store.service';
import { MenuManagerService } from './menu-manager.service';

import { ChatMessage, ToolCallState, ResourceItem } from '../core/chat-types';
import { AilyHost } from '../core/host';
import { registerAskUserCallback, unregisterAskUserCallback } from '../core/ask-user';
import type { MetricsSnapshot, TurnRequest, TurnResponseTurn } from 'aily-lex/browser';

import { ChatTitleCoordinator } from '../helpers/chat-title-coordinator';
import { ChatTitleRequestService } from '../helpers/chat-title-request.service';
import { MessageDisplayHelper } from '../helpers/message-display.helper';
import { SessionLifecycleHelper } from '../helpers/session-lifecycle.helper';
import { getUserSelectedToolsForRequest } from '../helpers/lex-agent-bootstrap';
import { LexOwnerFacade } from '../helpers/lex-stream.helper';
import { ChatSendCoordinator } from '../helpers/chat-send-coordinator';
import { ChatStopCoordinator } from '../helpers/chat-stop-coordinator';
import { ChatConversationActionCoordinator } from '../helpers/chat-conversation-action-coordinator';
import { ChatAiNoticeCoordinator } from '../helpers/chat-ai-notice-coordinator';
import { ChatExternalInputCoordinator } from '../helpers/chat-external-input-coordinator';
import type {
  ChatPendingRequestKind,
  PendingFollowupUserSelectedTools,
  PendingFollowupRequest,
  PreparedPendingFollowupRequest,
} from '../helpers/chat-pending-request';
import { createChatSessionActionState, type ChatSessionActionState } from '../helpers/chat-request-controller';
import { ChatSwitchCoordinator } from '../helpers/chat-switch-coordinator';

type VisibleSessionProjectionResetOptions = {
  readonly clearResolvedActiveModel?: boolean;
  readonly clearTurns?: boolean;
  readonly resetContextBudget?: boolean;
  readonly clearEditSummary?: boolean;
  readonly resetToolCallingIteration?: boolean;
  readonly detectChanges?: boolean;
};

function clonePendingFollowupRequestMetadata(
  requestMetadata?: TurnRequest['metadata'],
): TurnRequest['metadata'] | undefined {
  if (!requestMetadata) {
    return undefined;
  }

  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(requestMetadata);
  }

  return JSON.parse(JSON.stringify(requestMetadata)) as TurnRequest['metadata'];
}

function readRequestMetadataRequestId(
  requestMetadata?: Record<string, unknown> | null,
): string | null {
  const requestId = typeof requestMetadata?.['requestId'] === 'string'
    ? requestMetadata['requestId'].trim()
    : '';
  return requestId || null;
}

function readPreparedPendingFollowupRequestId(
  prepared?: PreparedPendingFollowupRequest | null,
): string | null {
  return readRequestMetadataRequestId((prepared?.requestMetadata ?? null) as Record<string, unknown> | null);
}

function clonePreparedPendingFollowupRequest(
  prepared: PreparedPendingFollowupRequest,
): PreparedPendingFollowupRequest {
  const resourceItems = Array.isArray(prepared.resourceItems) && prepared.resourceItems.length > 0
    ? prepared.resourceItems.map((item) => ({ ...item }))
    : undefined;
  const sessionAllowedPaths = Array.isArray(prepared.sessionAllowedPaths) && prepared.sessionAllowedPaths.length > 0
    ? [...prepared.sessionAllowedPaths]
    : undefined;
  const userSelectedTools = prepared.userSelectedTools
    ? { ...prepared.userSelectedTools }
    : undefined;

  return {
    ...prepared,
    ...(prepared.requestMetadata
      ? { requestMetadata: clonePendingFollowupRequestMetadata(prepared.requestMetadata) }
      : {}),
    ...(resourceItems ? { resourceItems } : {}),
    ...(sessionAllowedPaths ? { sessionAllowedPaths } : {}),
    ...(userSelectedTools ? { userSelectedTools } : {}),
  };
}

function clonePendingFollowupRequest(request: PendingFollowupRequest): PendingFollowupRequest {
  return {
    ...request,
    prepared: clonePreparedPendingFollowupRequest(request.prepared),
  };
}

function mergePreparedPendingFollowupRequests(
  requests: readonly PendingFollowupRequest[],
): PreparedPendingFollowupRequest {
  if (requests.length === 1) {
    return clonePreparedPendingFollowupRequest(requests[0].prepared);
  }

  const [firstRequest] = requests;
  const mergedPrepared = firstRequest
    ? clonePreparedPendingFollowupRequest(firstRequest.prepared)
    : undefined;
  const resourceItems = dedupePendingResourceItems(requests.flatMap((request) => request.prepared.resourceItems ?? []));
  const sessionAllowedPaths = dedupePendingAllowedPaths(requests.flatMap((request) => request.prepared.sessionAllowedPaths ?? []));
  const userSelectedTools = mergePendingUserSelectedTools(requests.map((request) => request.prepared.userSelectedTools));

  return {
    ...mergedPrepared,
    text: requests.map((request) => request.prepared.text).join('\n\n'),
    llmText: requests.map((request) => request.prepared.llmText).join('\n\n'),
    displayText: requests.map((request) => request.prepared.displayText).join('\n\n'),
    ...(resourceItems ? { resourceItems } : {}),
    ...(sessionAllowedPaths ? { sessionAllowedPaths } : {}),
    ...(userSelectedTools ? { userSelectedTools } : {}),
  };
}

function dedupePendingResourceItems(resourceItems: readonly ResourceItem[]): ResourceItem[] | undefined {
  if (resourceItems.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const deduped: ResourceItem[] = [];
  for (const item of resourceItems) {
    const key = [
      item.type,
      item.path ?? '',
      item.url ?? '',
      item.name,
      item.blockId ?? '',
      item.blockContext ?? '',
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ ...item });
  }

  return deduped.length > 0 ? deduped : undefined;
}

function dedupePendingAllowedPaths(paths: readonly string[]): string[] | undefined {
  if (paths.length === 0) {
    return undefined;
  }

  const deduped = Array.from(new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0)));
  return deduped.length > 0 ? deduped : undefined;
}

function mergePendingUserSelectedTools(
  selectedToolsSnapshots: readonly (PendingFollowupUserSelectedTools | undefined)[],
): PendingFollowupUserSelectedTools | undefined {
  const merged: Record<string, boolean> = {};

  for (const snapshot of selectedToolsSnapshots) {
    if (!snapshot) {
      continue;
    }

    for (const [toolName, selected] of Object.entries(snapshot)) {
      merged[toolName] = merged[toolName] === true || selected === true;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

import { ChatSubscriptionCoordinator } from '../helpers/chat-subscription-coordinator';
import { ChatTaskActionCoordinator, type ChatTaskActionEvent } from '../helpers/chat-task-action-coordinator';
import { HostSessionRestoreBridge } from '../helpers/host-session-restore-bridge';
import type { HostSessionSaveTarget } from '../helpers/host-session-save-bridge';
import {
  buildHostSessionCurrentPickerInputState,
  createHostSessionProviderOptionsKey,
  normalizeHostSessionProviderOptions,
  resolveHostSessionSelectedModeFromMetadata,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import { buildHostSessionCurrentPickerRoutingSummary } from '../helpers/host-session-request-routing';
import { ChatViewAdapter } from './chat-view-adapter';
import { ChatPartStore } from '../core/chat-part-store';
import type { IChatContext } from '../core/chat-context';
import type { DialogTurnContext } from '../core/user-turn-action-target';
import { EditActionsHelper, type RestoreCheckpointConfirmation } from '../helpers/edit-actions.helper';
import { applyCheckpointRestoreVisibility } from '../helpers/checkpoint-restore-visibility';
import {
  buildPlanReviewInteractionAction,
  buildPlanReviewResumeContent,
  readPendingPlanReview,
} from '../helpers/host-session-restore-bridge';
import { UserInteractionHelper } from '../helpers/user-interaction.helper';
import { buildChatDialogViewItems, type ChatDialogViewItem } from '../helpers/chat-dialog-view-items';
import { getTurnResponseResolvedModelName } from '../helpers/turn-response-response-model';
import { UnsaveDialogComponent, type UnsaveDialogData } from '../../../main-window/components/unsave-dialog/unsave-dialog.component';
import {
  applyHostResponseVoteToState,
  buildHostRequestModel,
  buildHostResponseStateFromCanonical,
  buildHostProjectionStateFromPersistedRecord,
  LiveHostRequestGraphCache,
  type HostRequestModel,
  type HostResponseProjection,
  type HostResponseVoteDirection,
  type HostTurnResponseState,
} from '../helpers/host-turn-response-state';

const INTERACTIVE_PLAN_REVIEW_ACTION_ID = 'interactive';
const EXIT_ONLY_PLAN_REVIEW_ACTION_ID = 'exit_only';
const START_IMPLEMENTATION_LABEL = 'start implementation';
const START_IMPLEMENTATION_PROMPT = 'start implementation';
const AUTO_PLAN_REVIEW_PERMISSION_LEVEL = 'autopilot';
const AUTO_PLAN_REVIEW_ACTION_ORDER = ['autopilot', 'autopilot_fleet', 'interactive', 'exit_only'] as const;
const TEST_SETUP_CONFIRMATION_PRIMARY_LABEL = '先设置测试';
const TEST_SETUP_CONFIRMATION_PRIMARY_TOOLTIP = '先补齐当前项目的最小测试环境，再继续后续测试工作';
const TEST_SETUP_CONFIRMATION_REJECT_LABEL = '继续当前请求';
const TEST_SETUP_CONFIRMATION_REJECT_TOOLTIP = '跳过这一步，直接继续当前测试生成请求';
const REQUEST_QUOTA_INPUT_NOTICE_THRESHOLDS = [50, 75, 90, 95];
const BACKGROUND_SESSION_TRACE_FLAG = 'aily.chat.traceBackgroundSession';
const BACKGROUND_SESSION_TRACE_GLOBAL_KEYS = [
  '__AILY_CHAT_TRACE_BACKGROUND_SESSION__',
  'AILY_CHAT_TRACE_BACKGROUND_SESSION',
] as const;

function createAgentProviderOptionsKeyWithRuntime(providerOptionsKey: string, runtimeMode: unknown): string {
  return providerOptionsKey.includes('::agent-runtime:')
    ? providerOptionsKey
    : `${providerOptionsKey}::${createChatAgentRuntimeModeConfigKey(normalizeChatAgentRuntimeMode(runtimeMode, 'unbound'))}`;
}

function parseBackgroundSessionTraceFlag(value: unknown): boolean {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
  }
  return false;
}

function isBackgroundSessionTraceEnabled(): boolean {
  try {
    const runtime = globalThis as Record<string, unknown>;
    for (const key of BACKGROUND_SESSION_TRACE_GLOBAL_KEYS) {
      if (parseBackgroundSessionTraceFlag(runtime[key])) {
        return true;
      }
    }
    const localStorageValue = globalThis.localStorage?.getItem?.(BACKGROUND_SESSION_TRACE_FLAG);
    return parseBackgroundSessionTraceFlag(localStorageValue);
  } catch {
    return false;
  }
}

function traceBackgroundSessionExecution(event: string, details: Record<string, unknown>): void {
  if (!isBackgroundSessionTraceEnabled()) {
    return;
  }
  // console.info('[AilyChat][bg-session][execution]', event, details);
}

type PendingPlanReview = NonNullable<ReturnType<typeof readPendingPlanReview>>;

function buildRuntimeQuotaOverlayFromTurnResponses(
  turnResponses: readonly TurnResponseTurn[] | null | undefined,
): ChatSessionRuntimeQuotaOverlay | null {
  const requestQuotaState = readRequestQuotaStateTurnSidecar(turnResponses);
  const requestQuotaSnapshot = (requestQuotaState
    ? createRequestQuotaSnapshotFromServiceState(requestQuotaState)
    : null) ?? createRequestQuotaSnapshot(turnResponses);
  const requestInputNotice = createRuntimeRequestQuotaNotice(requestQuotaState, requestQuotaSnapshot);
  const authQuotaInfo = createAuthQuotaInfoFromRequestQuotaState(requestQuotaState);
  if (!requestQuotaState && !requestQuotaSnapshot && !requestInputNotice && !authQuotaInfo) {
    return null;
  }

  return {
    ...(requestQuotaState ? { requestQuotaState } : {}),
    ...(requestQuotaSnapshot ? { requestQuotaSnapshot } : {}),
    ...(requestInputNotice ? { requestInputNotice } : {}),
    ...(authQuotaInfo ? { authQuotaInfo } : {}),
    updatedAt: Date.now(),
  };
}

function createRuntimeRequestQuotaNotice(
  requestQuotaState: RequestQuotaServiceState | null,
  requestQuotaSnapshot: RequestQuotaSnapshot | null,
) {
  const activeFailureNotice = createRequestQuotaInputNotice(requestQuotaSnapshot);
  if (activeFailureNotice) {
    return activeFailureNotice;
  }

  return createRuntimeRateLimitThresholdNotice(
    requestQuotaState?.rateLimitSnapshots?.['session'],
    'session',
  ) ?? createRuntimeRateLimitThresholdNotice(
    requestQuotaState?.rateLimitSnapshots?.['weekly'],
    'weekly',
  );
}

function createRuntimeRateLimitThresholdNotice(
  snapshot: RequestQuotaUsageSnapshot | undefined,
  type: 'session' | 'weekly',
) {
  if (!snapshot || snapshot.unlimited) {
    return null;
  }

  const percentUsed = 100 - snapshot.percentRemaining;
  if (percentUsed < REQUEST_QUOTA_INPUT_NOTICE_THRESHOLDS[0]) {
    return null;
  }

  return createRequestRateLimitInputNotice(type, Math.round(percentUsed), snapshot.resetAt);
}

function createAuthQuotaInfoFromRequestQuotaState(
  requestQuotaState: RequestQuotaServiceState | null | undefined,
): AuthQuotaInfo | null {
  const premiumInteractions = requestQuotaState?.quotaSnapshots?.['premium_interactions'];
  if (!premiumInteractions) {
    return null;
  }

  return {
    source: 'token',
    usageUnit: 'interactions',
    quota: premiumInteractions.entitlement,
    used: premiumInteractions.entitlement >= 0
      ? Math.max(0, premiumInteractions.entitlement - premiumInteractions.remaining)
      : 0,
    remaining: premiumInteractions.remaining,
    percentRemaining: Math.max(0, Math.min(100, premiumInteractions.percentRemaining)),
    ...(premiumInteractions.unlimited === true || premiumInteractions.entitlement < 0
      ? { unlimited: true }
      : {}),
    ...(typeof premiumInteractions.overageCount === 'number'
      ? { overageCount: premiumInteractions.overageCount }
      : {}),
    ...(typeof premiumInteractions.overagePermitted === 'boolean'
      ? { overagePermitted: premiumInteractions.overagePermitted }
      : {}),
    ...(typeof premiumInteractions.resetAt === 'string'
      ? { resetTime: premiumInteractions.resetAt }
      : {}),
  };
}

function findRuntimePlanReviewAction(
  actions: readonly RuntimePlanReviewAction[],
  actionId: string | undefined,
): RuntimePlanReviewAction | undefined {
  const normalizedActionId = typeof actionId === 'string' ? actionId.trim() : '';
  if (!normalizedActionId) {
    return undefined;
  }

  return actions.find((action) => action.id === normalizedActionId);
}

function resolveOptionalUiSessionOwner(
  owner: unknown,
  sessionId?: string | null,
): string {
  const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (explicitSessionId) {
    return explicitSessionId;
  }

  const viewResource = (owner as {
    chatSessionViewModelStore?: Pick<ChatSessionViewModelStoreService, 'currentSessionResource'>;
  } | null | undefined)?.chatSessionViewModelStore?.currentSessionResource;
  return typeof viewResource === 'string'
    ? viewResource.trim()
    : '';
}

function resolvePlanReviewPermissionMode(
  pendingReview: PendingPlanReview,
  result: RuntimePlanReviewDecision,
): ChatSessionPermissionMode | undefined {
  if (!result.approved) {
    return undefined;
  }

  const selectedAction = findRuntimePlanReviewAction(pendingReview.actions, result.actionId);
  if (selectedAction?.permissionLevel === 'autopilot') {
    return 'default';
  }

  return result.actionId === INTERACTIVE_PLAN_REVIEW_ACTION_ID
    ? 'default'
    : undefined;
}

interface SharedHostProjectionStateOptions {
  readonly sessionId: string | null;
  readonly attachedView?: boolean;
}

function buildRuntimeHostProjectionState(
  turnResponses: readonly TurnResponseTurn[] | null | undefined,
): HostTurnResponseState | null {
  if (!Array.isArray(turnResponses)) {
    return null;
  }

  return buildHostProjectionStateFromPersistedRecord({ turnResponses });
}

function readRuntimeProjectionStateFromEngine(
  engine: object,
  turnResponses: readonly TurnResponseTurn[] | null | undefined,
): HostTurnResponseState | null {
  const getHostResponseState = (engine as Record<string, unknown>)['getHostResponseState'];
  if (typeof getHostResponseState === 'function') {
    return getHostResponseState.call(engine) as HostTurnResponseState | null;
  }

  return buildRuntimeHostProjectionState(turnResponses);
}

function resolveEngineRuntimeSessionType(
  engine: Record<string, unknown>,
  sessionId: string,
): string {
  const normalizedSessionId = typeof sessionId === 'string'
    ? sessionId.trim()
    : '';
  const model = readEngineRuntimeSessionModel(engine, normalizedSessionId);
  if (typeof model?.sessionType === 'string' && model.sessionType.trim()) {
    return model.sessionType;
  }

  const chatService = (engine['chatService'] ?? {}) as {
    readonly currentSessionId?: unknown;
    readonly currentSessionType?: unknown;
  };
  const currentSessionId = typeof chatService.currentSessionId === 'string'
    ? chatService.currentSessionId.trim()
    : '';
  if (!normalizedSessionId) {
    return typeof chatService.currentSessionType === 'string'
      ? chatService.currentSessionType
      : '';
  }

  const getCurrentProjectPath = engine['getCurrentProjectPath'];
  const projectPathHint = typeof getCurrentProjectPath === 'function'
    ? getCurrentProjectPath.call(engine)
    : undefined;
  const sessionItemController = (engine['chatSessionItemsService'] as {
    readonly sessionItemController?: {
      getChatSessionType?: (sessionId?: string, projectPathHint?: string | null) => string;
    };
  } | undefined)?.sessionItemController;

  const durableSessionType = sessionItemController?.getChatSessionType?.(normalizedSessionId, projectPathHint) ?? '';
  if (durableSessionType) {
    return durableSessionType;
  }

  return normalizedSessionId === currentSessionId && typeof chatService.currentSessionType === 'string'
    ? chatService.currentSessionType
    : '';
}

function resolveEngineRuntimeSessionCapabilities(
  engine: Record<string, unknown>,
  sessionId: string,
) {
  return resolveChatSessionRuntimeCapabilities(resolveEngineRuntimeCapabilityOwner(engine, sessionId));
}

function resolveEngineRuntimeSessionConcurrencyScope(
  engine: Record<string, unknown>,
  sessionId: string,
): string | undefined {
  return resolveChatSessionRuntimeConcurrencyScope(resolveEngineRuntimeCapabilityOwner(engine, sessionId));
}

function resolveEngineRuntimeCapabilityOwner(
  engine: Record<string, unknown>,
  sessionId: string,
) {
  const sessionType = resolveEngineRuntimeSessionType(engine, sessionId);
  const providerOptions = resolveEngineRuntimeSessionProviderOptions(engine, sessionId);
  const requestRouting = resolveEngineRuntimeSessionRequestRouting(engine, sessionId);
  const customizationProvider = resolveEngineRuntimeSessionCustomizationProvider(engine, sessionId);
  return {
    sessionType,
    providerTarget: providerOptions?.folderPath,
    remoteProviderHandle: providerOptions?.remoteProviderHandle,
    customAgentTarget: requestRouting?.customAgentTarget,
    customModeSource: customizationProvider?.customModeSource,
    sessionCustomizationProviderLabel: customizationProvider?.providerLabel,
    sessionCustomizationProviderIconId: customizationProvider?.providerIconId,
  };
}

function resolveEngineRuntimeSessionProviderOptions(
  engine: Record<string, unknown>,
  sessionId: string,
): { readonly folderPath?: string | null; readonly remoteProviderHandle?: string | null } | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const model = readEngineRuntimeSessionModel(engine, normalizedSessionId);
  if (model) {
    const providerOptions = model.inputState?.providerOptions;
    return {
      folderPath: providerOptions?.folderPath ?? model.projectPath ?? null,
      remoteProviderHandle: null,
    };
  }

  const chatService = engine['chatService'] as {
    readonly currentSessionId?: string;
    readonly currentSessionPath?: string;
    readonly currentRemoteProviderHandle?: string;
  } | undefined;
  const currentSessionId = typeof chatService?.currentSessionId === 'string'
    ? chatService.currentSessionId.trim()
    : '';
  if (!normalizedSessionId) {
    return {
      folderPath: chatService?.currentSessionPath ?? null,
      remoteProviderHandle: chatService?.currentRemoteProviderHandle ?? null,
    };
  }

  const getCurrentProjectPath = engine['getCurrentProjectPath'];
  const projectPathHint = typeof getCurrentProjectPath === 'function'
    ? getCurrentProjectPath.call(engine)
    : undefined;
  const sessionItemController = (engine['chatSessionItemsService'] as {
    readonly sessionItemController?: {
      getChatSessionProviderOptions?: (
        sessionId?: string,
        projectPathHint?: string | null,
      ) => { readonly folderPath?: string | null; readonly remoteProviderHandle?: string | null };
    };
  } | undefined)?.sessionItemController;

  const durableProviderOptions = sessionItemController?.getChatSessionProviderOptions?.(normalizedSessionId, projectPathHint) ?? null;
  if (durableProviderOptions) {
    return durableProviderOptions;
  }

  return normalizedSessionId === currentSessionId
    ? {
        folderPath: chatService?.currentSessionPath ?? null,
        remoteProviderHandle: chatService?.currentRemoteProviderHandle ?? null,
      }
    : null;
}

function resolveEngineRuntimeSessionRequestRouting(
  engine: Record<string, unknown>,
  sessionId: string,
): { readonly customAgentTarget?: string | null } | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const model = readEngineRuntimeSessionModel(engine, normalizedSessionId);
  if (model) {
    return {
      customAgentTarget: model.inputState?.selectedMode?.customAgentTarget ?? null,
    };
  }

  const chatService = engine['chatService'] as {
    readonly currentSessionId?: string;
    readonly currentResolvedMode?: { readonly customAgentTarget?: string | null };
    readonly selectedMode?: { readonly customAgentTarget?: string | null };
  } | undefined;
  const currentSessionId = typeof chatService?.currentSessionId === 'string'
    ? chatService.currentSessionId.trim()
    : '';
  if (!normalizedSessionId) {
    return {
      customAgentTarget: chatService?.selectedMode?.customAgentTarget
        ?? chatService?.currentResolvedMode?.customAgentTarget
        ?? null,
    };
  }

  const getCurrentProjectPath = engine['getCurrentProjectPath'];
  const projectPathHint = typeof getCurrentProjectPath === 'function'
    ? getCurrentProjectPath.call(engine)
    : undefined;
  const sessionItemController = (engine['chatSessionItemsService'] as {
    readonly sessionItemController?: {
      getChatSessionRequestRouting?: (
        sessionId?: string,
        projectPathHint?: string | null,
      ) => { readonly customAgentTarget?: string | null } | undefined;
    };
  } | undefined)?.sessionItemController;

  const durableRequestRouting = sessionItemController?.getChatSessionRequestRouting?.(normalizedSessionId, projectPathHint) ?? null;
  if (durableRequestRouting) {
    return durableRequestRouting;
  }

  return normalizedSessionId === currentSessionId
    ? {
        customAgentTarget: chatService?.selectedMode?.customAgentTarget
          ?? chatService?.currentResolvedMode?.customAgentTarget
          ?? null,
      }
    : null;
}

function resolveEngineRuntimeSessionCustomizationProvider(
  engine: Record<string, unknown>,
  sessionId: string,
): {
  readonly customModeSource?: string | null;
  readonly providerLabel?: string | null;
  readonly providerIconId?: string | null;
} | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const model = readEngineRuntimeSessionModel(engine, normalizedSessionId);
  const chatService = engine['chatService'] as {
    readonly currentSessionId?: string;
    readonly activeCustomModeSource?: string;
    readonly activeSessionCustomizationProviderMetadata?: {
      readonly label?: string;
      readonly iconId?: string;
    };
  } | undefined;
  const currentSessionId = typeof chatService?.currentSessionId === 'string'
    ? chatService.currentSessionId.trim()
    : '';
  if (!normalizedSessionId) {
    return {
      customModeSource: chatService?.activeCustomModeSource ?? null,
      providerLabel: chatService?.activeSessionCustomizationProviderMetadata?.label ?? null,
      providerIconId: chatService?.activeSessionCustomizationProviderMetadata?.iconId ?? null,
    };
  }

  const getCurrentProjectPath = engine['getCurrentProjectPath'];
  const projectPathHint = typeof getCurrentProjectPath === 'function'
    ? getCurrentProjectPath.call(engine)
    : undefined;
  const sessionItemController = (engine['chatSessionItemsService'] as {
    readonly sessionItemController?: {
      getChatSessionCustomizationProviderMetadata?: (
        sessionId?: string,
        projectPathHint?: string | null,
      ) => {
        readonly customModeSource?: string | null;
        readonly providerLabel?: string | null;
        readonly providerIconId?: string | null;
      } | undefined;
    };
  } | undefined)?.sessionItemController;

  const durableCustomizationProvider = sessionItemController?.getChatSessionCustomizationProviderMetadata?.(normalizedSessionId, projectPathHint) ?? null;
  if (durableCustomizationProvider) {
    return durableCustomizationProvider;
  }

  if (model) {
    return null;
  }

  return normalizedSessionId === currentSessionId
    ? {
        customModeSource: chatService?.activeCustomModeSource ?? null,
        providerLabel: chatService?.activeSessionCustomizationProviderMetadata?.label ?? null,
        providerIconId: chatService?.activeSessionCustomizationProviderMetadata?.iconId ?? null,
      }
    : null;
}

function readEngineRuntimeSessionModel(
  engine: Record<string, unknown>,
  sessionId: string,
): ChatSessionModel | undefined {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    return undefined;
  }

  const modelStore = engine['chatSessionModelStore'] as {
    get?: (sessionResource: string) => ChatSessionModel | undefined;
  } | undefined;
  return modelStore?.get?.(normalizedSessionId);
}

function resolvePlanReviewPermissionLevel(
  pendingReview: PendingPlanReview,
  result: RuntimePlanReviewDecision,
  currentRequestPermissionLevel?: string,
): string | undefined {
  if (!result.approved) {
    return undefined;
  }

  if (currentRequestPermissionLevel === AUTO_PLAN_REVIEW_PERMISSION_LEVEL) {
    return AUTO_PLAN_REVIEW_PERMISSION_LEVEL;
  }

  const permissionLevel = findRuntimePlanReviewAction(pendingReview.actions, result.actionId)?.permissionLevel;
  return typeof permissionLevel === 'string' && permissionLevel.trim()
    ? permissionLevel.trim()
    : undefined;
}

function resolvePlanReviewAutopilotDecision(
  pendingReview: PendingPlanReview,
): RuntimePlanReviewDecision {
  const defaultActionId = pendingReview.actions.find((action) => action.default)?.id;
  if (typeof defaultActionId === 'string' && defaultActionId.trim().length > 0) {
    return {
      approved: true,
      actionId: defaultActionId.trim(),
    };
  }

  for (const actionId of AUTO_PLAN_REVIEW_ACTION_ORDER) {
    if (pendingReview.actions.some((action) => action.id === actionId)) {
      return {
        approved: true,
        actionId,
      };
    }
  }

  return { approved: true };
}

function areProjectionTurnResponsesEquivalent(
  left: readonly TurnResponseTurn[] | null | undefined,
  right: readonly TurnResponseTurn[] | null | undefined,
): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftTurn = left[index];
    const rightTurn = right[index];
    if (leftTurn.turnId !== rightTurn.turnId || leftTurn.updatedAt !== rightTurn.updatedAt) {
      return false;
    }

    if (buildProjectionTurnSignature(leftTurn) !== buildProjectionTurnSignature(rightTurn)) {
      return false;
    }
  }

  return true;
}

function buildProjectionTurnSignature(turn: TurnResponseTurn): string {
  try {
    return JSON.stringify({
      turnId: turn.turnId,
      updatedAt: turn.updatedAt,
      request: turn.request,
      response: turn.response,
      rounds: turn.rounds,
      responseModel: turn.responseModel,
      usage: turn.usage,
    });
  } catch {
    return `${turn.turnId}|${turn.updatedAt ?? ''}`;
  }
}

function readLatestPlanReviewRequestPermissionLevel(
  turnResponses: readonly TurnResponseTurn[] | undefined,
): string | undefined {
  if (!Array.isArray(turnResponses) || turnResponses.length === 0) {
    return undefined;
  }

  for (let index = turnResponses.length - 1; index >= 0; index -= 1) {
    const metadata = asRecord(turnResponses[index]?.request?.metadata);
    if (!metadata) {
      continue;
    }

    const modeInfo = asRecord(metadata['modeInfo']);
    const requestRouting = asRecord(metadata['requestRouting']);
    const permissionLevel = normalizePlanReviewPermissionLevel(modeInfo?.['permissionLevel'])
      ?? normalizePlanReviewPermissionLevel(requestRouting?.['permissionLevel']);
    if (permissionLevel) {
      return permissionLevel;
    }
  }

  return undefined;
}

function normalizePlanReviewPermissionLevel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function shouldStartImplementationAfterPlanReview(
  pendingReview: PendingPlanReview,
  result: RuntimePlanReviewDecision,
): boolean {
  if (!result.approved) {
    return false;
  }

  if (result.actionId === EXIT_ONLY_PLAN_REVIEW_ACTION_ID) {
    return false;
  }

  if (result.actionId === INTERACTIVE_PLAN_REVIEW_ACTION_ID) {
    return true;
  }

  return findRuntimePlanReviewAction(pendingReview.actions, result.actionId)?.permissionLevel === 'autopilot';
}

function resolveStartImplementationHandoff(
  mode: Pick<ChatResolvedMode, 'handOffs'> | null | undefined,
): ChatResolvedModeHandoff | undefined {
  const handOffs = mode?.handOffs ?? [];
  return handOffs.find((handoff) => handoff.prompt.trim().toLowerCase() === START_IMPLEMENTATION_PROMPT)
    ?? handOffs.find((handoff) => handoff.label.trim().toLowerCase() === START_IMPLEMENTATION_LABEL);
}

export interface ChatPaneSessionCommandHandlers {
  readonly requestNewChat?: () => Promise<void> | void;
}

@Injectable()
export class ChatEngineService implements IChatContext {
  private readonly chatViewState = inject(ChatViewService);
  private readonly modal = inject(NzModalService);
  private readonly chatSessionEntryStateService = inject(ChatSessionEntryStateService);
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly chatSessionModelStore = inject(ChatSessionModelStoreService);
  private readonly chatSessionRuntimeStore = inject(ChatSessionRuntimeStoreService);
  private readonly chatSessionRuntimeRegistry = inject(ChatSessionRuntimeRegistryService);
  private readonly chatSessionViewModelStore = inject(ChatSessionViewModelStoreService);

  private readonly entryPartStore = new ChatPartStore();
  // ==================== Part-based 消息模型（Phase 1） ====================
  /** Part 存储 facade：实际读写按当前 ChatViewModel.sessionResource 路由到 ChatSessionModel.partStore。 */
  readonly partStore: ChatPartStore = this.createSessionRoutedPartStore();
  private readonly liveHostRequestGraphCache = new LiveHostRequestGraphCache();
  private restoreCheckpointDialogOpen = false;
  private readonly messageDisplayContext = this.createMessageDisplayContext();
  private readonly userInteractionContext = this.createUserInteractionContext();
  private readonly editActionsContext = this.createEditActionsContext();
  private readonly hostSessionRestoreContext = this.createHostSessionRestoreContext();
  private readonly hostSessionRestoreBridge = new HostSessionRestoreBridge(this.hostSessionRestoreContext);
  private readonly sessionLifecycleContext = this.createSessionLifecycleContext();
  private readonly lexOwnerContext = this.createLexOwnerContext();
  private readonly titleCoordinatorContext = this.createTitleCoordinatorContext();
  private readonly stopCoordinatorContext = this.createStopCoordinatorContext();
  private readonly switchCoordinatorContext = this.createSwitchCoordinatorContext();
  private readonly conversationActionCoordinatorContext = this.createConversationActionCoordinatorContext();
  private readonly externalInputCoordinatorContext = this.createExternalInputCoordinatorContext();
  private paneSessionCommandHandlers: ChatPaneSessionCommandHandlers = {};

  // ==================== 辅助类 ====================
  readonly msg = new MessageDisplayHelper(this.messageDisplayContext);
  readonly session = new SessionLifecycleHelper(this.sessionLifecycleContext);
  readonly lexStream = new LexOwnerFacade(this.lexOwnerContext);
  readonly editActions = new EditActionsHelper(this.editActionsContext);
  readonly interaction = new UserInteractionHelper(this.userInteractionContext);
  private readonly titleRequestService = new ChatTitleRequestService(() => {
    const currentModel = this.chatService.currentModel as { isCustom?: boolean; apiKey?: string; baseUrl?: string } | null;
    if (!currentModel?.isCustom) {
      return null;
    }

    const apiKey = typeof currentModel.apiKey === 'string' ? currentModel.apiKey.trim() : '';
    const baseUrl = typeof currentModel.baseUrl === 'string' ? currentModel.baseUrl.trim() : '';
    if (!apiKey || !baseUrl) {
      return null;
    }

    return { apiKey, baseUrl };
  });
  private readonly titleCoordinator = new ChatTitleCoordinator(
    this.titleCoordinatorContext,
    this.titleRequestService,
    (sessionId, title) => this.chatSessionItemsService.sessionItemController.updateManagedChatSessionItemTitle(sessionId, title),
  );
  private readonly sendCoordinator = new ChatSendCoordinator(
    this,
    () => this.resourceManager.getResourcesText(),
    (requestAgentId) => getUserSelectedToolsForRequest(
      {
        ailyChatConfigService: this.ailyChatConfigService,
        mcpService: this.mcpService,
      },
      requestAgentId,
      this.prjPath || this.prjRootPath || '',
    ),
    () => this.resourceManager.items,
    () => this.sessionAllowedPaths,
    (sessionId) => {
      const resolveRuntimeSessionIdForOwner = (
        this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
      ).resolveRuntimeSessionIdForOwner
        ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
      const resolveRuntimeSessionProviderOptions = (
        this as unknown as { resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions }
      ).resolveRuntimeSessionProviderOptions
        ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
      const runtimeOwnerSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
      if (!runtimeOwnerSessionId) {
        return {};
      }

      return {
        runtimeOwnerSessionId,
        providerOptionsKey: createAgentProviderOptionsKeyWithRuntime(createHostSessionProviderOptionsKey(
          resolveRuntimeSessionProviderOptions.call(this, runtimeOwnerSessionId),
        ), this.currentAgentRuntimeMode ?? this.chatService?.currentAgentRuntimeMode),
      };
    },
  );
  private readonly stopCoordinator = new ChatStopCoordinator(this.stopCoordinatorContext);
  private readonly conversationActionCoordinator = new ChatConversationActionCoordinator(this.conversationActionCoordinatorContext, {
    submitText: (text) => this.submitUserText(text, { clearInput: false }),
  });
  private readonly aiNoticeCoordinator = new ChatAiNoticeCoordinator({
    stop: (sessionId) => this.stop(sessionId),
    updateNotice: (config) => {
      AilyHost.get().notice?.update(config);
    },
    clearNotice: () => {
      AilyHost.get().notice?.clear();
    },
  });
  private readonly switchCoordinator = new ChatSwitchCoordinator(this.switchCoordinatorContext);
  private readonly subscriptionCoordinator = new ChatSubscriptionCoordinator(this, {
    receiveTextFromExternal: (text, options) => this.receiveTextFromExternal(text, options),
    showAiWritingNotice: (isWaiting) => this.showAiWritingNotice(isWaiting),
    handleTaskAction: (event) => this.handleTaskAction(event),
    flushPendingAutoSend: () => this.flushPendingAutoSend(),
    syncAuthQuotaState: () => this.authQuotaStateService.syncAuthSnapshotFromHost(),
    refreshRequestQuotaState: () => this.refreshRequestQuotaState(),
    refreshSessionProviderOptionsSources: () => this.refreshSessionProviderOptionsSources(),
    clearAuthQuotaState: () => this.authQuotaStateService.clear(),
    clearRequestQuotaState: () => this.requestQuotaStateService.clear(),
  });
  private readonly externalInputCoordinator = new ChatExternalInputCoordinator(this.externalInputCoordinatorContext, {
    retryLastAction: () => this.retryLastAction(),
    regenerateTurn: () => this.editActions.regenerateTurn(),
    undoLastEdits: () => this.editActions.undoLastEdits(),
    newChat: () => this.requestNewChatFromPane(),
    ensureSessionReadyForSubmit: () => this.ensureSessionReadyForSubmit(),
    submitText: (text, clearInput, sessionId) => this.submitUserText(text, { clearInput, sessionId }),
    focusInput: () => {
      if (this.chatTextareaRef?.nativeElement) {
        const textarea = this.chatTextareaRef.nativeElement;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    },
    schedulePostInputWork: (work) => {
      setTimeout(work, 100);
    },
  });
  private readonly taskActionCoordinator = new ChatTaskActionCoordinator(this.editActions, {
    continueConversation: () => this.continueConversation(),
    retryLastAction: () => this.retryLastAction(),
    newChat: () => this.requestNewChatFromPane(),
    voteResponse: (target, vote) => this.voteResponse(target, vote),
    warnUnknownAction: (action) => {
      console.warn('未知的任务操作:', action);
    },
  });

  // ==================== rAF 批处理 UI 适配器 ====================
  /** 流式文本走 rAF 合并，每帧只触发一次 Angular CD（参考 Copilot FetchStreamSource pause/unpause） */
  readonly viewAdapter: ChatViewAdapter = null!; // 由 constructor 初始化

  // ==================== 公共状态（模板绑定） ====================
  list: ChatMessage[] = [];
  private legacyInputValue = '';
  get inputValue(): string {
    return this.readSessionInputValue(this.resolveCurrentViewSessionResource()) ?? this.legacyInputValue;
  }
  set inputValue(value: string) {
    this.setSessionInputValue(this.resolveCurrentViewSessionResource(), value);
  }
  prjRootPath = '';
  prjPath = '';
  currentUserGroup: string[] = [];
  isCompleted = false;
  isLoggedIn = false;
  debug = false;

  // ==================== 半公共状态 ====================
  sessionAllowedPaths: string[] = [];
  currentMessageSource: string = MAIN_AGENT_TYPE;
  toolCallStates: { [key: string]: string } = {};

  // ==================== 内部状态（helper 可访问） ====================
  isSessionStarting = false;
  hasInitializedForThisLogin = false;
  isCancelled = false;
  /**
   * @deprecated Visible projection owner stamp for the current view adapter only.
   * Model truth must live on ChatSessionModel.hostProjectionState/turnResponses,
   * keyed by ChatSessionViewModel.sessionResource.
   */
  private visibleProjectionSessionId: string | null = null;
  /** 只读视图：从 lex TurnManager 派生的消息数组（lex 为唯一 source of truth） */
  get conversationMessages(): any[] {
      return this.lexStream.conversation.messages();
  }

  get dialogItems(): ChatDialogViewItem[] {
    const hostResponseProjection = this.hostResponseProjection;
    const dialogItems = hostResponseProjection
      ? [...hostResponseProjection.dialogItems]
      : [];
    const canShowCheckpointRestore = this.editCheckpointService.hasRecoverableCheckpointRestoreRedoTurnResponses?.()
      ?? (this.editCheckpointService.getCheckpointRestoreRedoTurnResponses?.() ?? []).length > 0;
    return applyCheckpointRestoreVisibility(dialogItems, canShowCheckpointRestore);
  }

  get workspaceCheckpointPresentationMode() {
    return this.workspaceCheckpointProvider.getPresentationMode?.() ?? 'compatibility';
  }

  get hostResponseProjection(): HostResponseProjection | null {
    return this.getHostResponseState();
  }

  private getHostResponseState(): HostTurnResponseState | null {
    if (!this.hasVisibleSessionProjectionTarget()) {
      return null;
    }

    const getCurrentViewHostProjectionState = (
      (this as unknown as { getCurrentViewHostProjectionState?: ChatEngineService['getCurrentViewHostProjectionState'] })
        .getCurrentViewHostProjectionState
      ?? ChatEngineService.prototype['getCurrentViewHostProjectionState']
    );
    const modelProjectionState = getCurrentViewHostProjectionState.call(this);
    if (modelProjectionState) {
      return modelProjectionState;
    }

    return null;
  }

  get hostRequestModel(): HostRequestModel | null {
    if (!this.hasVisibleSessionProjectionTarget()) {
      return null;
    }

    const getCurrentViewHostProjectionState = (
      (this as unknown as { getCurrentViewHostProjectionState?: ChatEngineService['getCurrentViewHostProjectionState'] })
        .getCurrentViewHostProjectionState
      ?? ChatEngineService.prototype['getCurrentViewHostProjectionState']
    );
    const modelProjectionState = getCurrentViewHostProjectionState.call(this);
    if (modelProjectionState) {
      return buildHostRequestModel(modelProjectionState.turnResponses);
    }

    return null;
  }

  private resolveCurrentViewSessionResource(): string {
    const viewModelStore = (this as unknown as {
      chatSessionViewModelStore?: Pick<ChatSessionViewModelStoreService, 'currentSessionResource'>;
    }).chatSessionViewModelStore;
    if (viewModelStore) {
      const viewResource = typeof viewModelStore.currentSessionResource === 'string'
        ? viewModelStore.currentSessionResource.trim()
        : '';
      return viewResource;
    }

    const currentSessionId = typeof this.chatService?.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    return currentSessionId;
  }

  private getCurrentViewSessionModel(): Pick<ChatSessionModel, 'hostProjectionState' | 'turnResponses' | 'applyProjection' | 'partStore'> | undefined {
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentViewSessionResource = resolveCurrentViewSessionResource.call(this);
    if (!currentViewSessionResource) {
      return undefined;
    }

    const modelStore = (this as unknown as {
      chatSessionModelStore?: Pick<ChatSessionModelStoreService, 'get'>;
    }).chatSessionModelStore;
    return modelStore?.get?.(currentViewSessionResource);
  }

  private getCurrentViewPartStore(): ChatPartStore {
    const getCurrentViewSessionModel = (
      (this as unknown as { getCurrentViewSessionModel?: ChatEngineService['getCurrentViewSessionModel'] })
        .getCurrentViewSessionModel
      ?? ChatEngineService.prototype['getCurrentViewSessionModel']
    );
    return getCurrentViewSessionModel.call(this)?.partStore ?? this.entryPartStore;
  }

  private createSessionRoutedPartStore(): ChatPartStore {
    const resolveStore = () => {
      const getCurrentViewPartStore = (
        (this as unknown as { getCurrentViewPartStore?: ChatEngineService['getCurrentViewPartStore'] })
          .getCurrentViewPartStore
        ?? ChatEngineService.prototype['getCurrentViewPartStore']
      );
      return getCurrentViewPartStore.call(this);
    };

    return new Proxy(this.entryPartStore, {
      get(_target, property) {
        const store = resolveStore();
        const value = Reflect.get(store, property, store);
        return typeof value === 'function' ? value.bind(store) : value;
      },
      set(_target, property, value) {
        const store = resolveStore();
        return Reflect.set(store, property, value, store);
      },
      has(_target, property) {
        return property in resolveStore();
      },
    });
  }

  private getCurrentViewHostProjectionState(): HostTurnResponseState | null {
    const getCurrentViewSessionModel = (
      (this as unknown as { getCurrentViewSessionModel?: ChatEngineService['getCurrentViewSessionModel'] })
        .getCurrentViewSessionModel
      ?? ChatEngineService.prototype['getCurrentViewSessionModel']
    );
    const model = getCurrentViewSessionModel.call(this);
    if (!model) {
      return null;
    }

    if (model.hostProjectionState) {
      return model.hostProjectionState;
    }

    const turnResponses = Array.isArray(model.turnResponses) ? model.turnResponses : [];
    if (turnResponses.length === 0) {
      return null;
    }

    const projectionState = buildHostResponseStateFromCanonical(null, turnResponses);
    if (projectionState) {
      model.applyProjection(projectionState, {
        reason: 'transcript',
      });
    }
    return projectionState;
  }

  private readSessionInputValue(sessionId?: string | null): string | null {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return null;
    }

    const modelStore = (this as unknown as {
      chatSessionModelStore?: Pick<ChatSessionModelStoreService, 'get'>;
    }).chatSessionModelStore;
    const model = modelStore?.get?.(targetSessionId);
    if (model) {
      const draftText = model.inputState?.draftText;
      return typeof draftText === 'string' ? draftText : '';
    }

    const legacyDraftText = Object.prototype.hasOwnProperty.call(this, 'inputValue')
      ? (this as unknown as { inputValue?: unknown }).inputValue
      : (this as unknown as { legacyInputValue?: unknown }).legacyInputValue;
    return typeof legacyDraftText === 'string' ? legacyDraftText : '';
  }

  private setSessionInputValue(sessionId: string | null | undefined, value: unknown): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const draftText = typeof value === 'string' ? value : '';
    const modelStore = (this as unknown as {
      chatSessionModelStore?: Pick<ChatSessionModelStoreService, 'get' | 'updateMetadata'>;
    }).chatSessionModelStore;
    const model = targetSessionId ? modelStore?.get?.(targetSessionId) : undefined;
    if (targetSessionId && model) {
      if (typeof modelStore?.updateMetadata === 'function') {
        modelStore.updateMetadata(targetSessionId, {
          inputState: {
            ...model.inputState,
            draftText,
          },
        });
        return true;
      }

      if (typeof (model as unknown as { updateMetadata?: unknown }).updateMetadata === 'function') {
        (model as unknown as { updateMetadata: (patch: ChatSessionModelMetadataPatch) => void }).updateMetadata({
          inputState: {
            ...model.inputState,
            draftText,
          },
        });
        return true;
      } else {
        // Prototype-style test doubles may expose read-only model slices. Treat
        // them as no-model legacy seams rather than writing a parallel truth.
      }
    }

    if (Object.prototype.hasOwnProperty.call(this, 'inputValue')) {
      (this as unknown as { inputValue: string }).inputValue = draftText;
    } else {
      (this as unknown as { legacyInputValue?: string }).legacyInputValue = draftText;
    }
    return false;
  }

  private hasVisibleSessionProjectionTarget(): boolean {
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentSessionId = resolveCurrentViewSessionResource.call(this);
    const visibleProjectionSessionId = (this as unknown as { visibleProjectionSessionId?: string | null }).visibleProjectionSessionId;
    return currentSessionId.length > 0
      && typeof visibleProjectionSessionId === 'string'
      && visibleProjectionSessionId.trim() === currentSessionId;
  }

  private markVisibleSessionProjectionOwner(sessionId?: string | null): void {
    const targetSessionId = typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
    this.visibleProjectionSessionId = targetSessionId || null;
  }

  markCurrentViewVisibleProjectionOwner(): void {
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    this.markVisibleSessionProjectionOwner(resolveCurrentViewSessionResource.call(this));
  }

  private setCurrentViewVisibleProjectionList(list: ChatMessage[]): void {
    this.markCurrentViewVisibleProjectionOwner();
    this.list = list;
    this.syncCurrentVisibleProjectionListToSessionModel(list);
  }

  private syncCurrentVisibleProjectionListToSessionModel(list: readonly ChatMessage[]): void {
    const getCurrentViewSessionModel = (
      (this as unknown as { getCurrentViewSessionModel?: ChatEngineService['getCurrentViewSessionModel'] })
        .getCurrentViewSessionModel
      ?? ChatEngineService.prototype['getCurrentViewSessionModel']
    );
    const model = getCurrentViewSessionModel.call(this);
    if (!model) {
      return;
    }

    const currentProjection = model.hostProjectionState
      ?? (model.turnResponses.length > 0 ? buildRuntimeHostProjectionState(model.turnResponses) : null);
    if (!currentProjection) {
      return;
    }

    const visibleChatList = list.map(message => ({ ...message })) as HostTurnResponseState['chatList'];
    const collectDisabledRequestTurnIds = (
      (this as unknown as { collectDisabledRequestTurnIds?: ChatEngineService['collectDisabledRequestTurnIds'] })
        .collectDisabledRequestTurnIds
      ?? ChatEngineService.prototype['collectDisabledRequestTurnIds']
    );
    const dialogItems = buildChatDialogViewItems(
      visibleChatList as readonly ChatMessage[],
      currentProjection.turnResponses,
      {
        disabledRequestTurnIds: collectDisabledRequestTurnIds.call(this, currentProjection.dialogItems),
      },
    );
    model.applyProjection({
      ...currentProjection,
      chatList: visibleChatList,
      dialogItems,
    }, {
      reason: 'view',
    });
  }

  private collectDisabledRequestTurnIds(dialogItems: readonly ChatDialogViewItem[] | null | undefined): string[] {
    const disabledTurnIds = new Set<string>();
    for (const item of dialogItems ?? []) {
      const turnContext = item.turnContext;
      const turnId = turnContext?.turnId ?? turnContext?.turnResponse?.turnId;
      if (turnContext?.requestDisabled === true && turnId) {
        disabledTurnIds.add(turnId);
      }
    }
    return [...disabledTurnIds];
  }

  private hasVisibleChatViewProjectionForSession(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
    if (!targetSessionId) {
      return false;
    }

    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentViewSessionResource = resolveCurrentViewSessionResource.call(this);
    const visibleProjectionSessionId = (this as unknown as { visibleProjectionSessionId?: string | null }).visibleProjectionSessionId;
    const visibleProjectionOwner = typeof visibleProjectionSessionId === 'string'
      ? visibleProjectionSessionId.trim()
      : '';
    if (currentViewSessionResource !== targetSessionId || visibleProjectionOwner !== targetSessionId) {
      return false;
    }

    return this.chatService?.hasBlankSessionShell === true
      || (Array.isArray(this.list) && this.list.length > 0);
  }

  clearSharedHostRequestGraph(): void {
    this.liveHostRequestGraphCache.clear();
  }

  replaceSharedHostProjectionState(state: HostTurnResponseState | null, options: SharedHostProjectionStateOptions): void {
    const resolveRuntimeSessionIdForOwner = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    );
    const shouldProjectRuntimeViewStateToVisibleOwner = (
      (this as unknown as { shouldProjectRuntimeViewStateToVisibleOwner?: (sessionId?: string | null) => boolean })
        .shouldProjectRuntimeViewStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectRuntimeViewStateToVisibleOwner']
    );
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, options.sessionId);
    if (targetSessionId && !shouldProjectRuntimeViewStateToVisibleOwner.call(this, targetSessionId)) {
      const projectSharedHostProjectionStateToRuntimeOwner = (
        (this as unknown as {
          projectSharedHostProjectionStateToRuntimeOwner?: (
            sessionId: string | null | undefined,
            hostProjectionState: HostTurnResponseState | null,
            options: { readonly attachedView: boolean },
          ) => void;
        }).projectSharedHostProjectionStateToRuntimeOwner
        ?? ChatEngineService.prototype['projectSharedHostProjectionStateToRuntimeOwner']
      );
      projectSharedHostProjectionStateToRuntimeOwner.call(this, targetSessionId, state, {
        attachedView: options.attachedView === true,
      });
      return;
    }

    this.visibleProjectionSessionId = targetSessionId || null;
    if (targetSessionId) {
      this.projectRuntimeProjectionToSessionModel(targetSessionId, state, {
        attachedView: options.attachedView !== false,
      });
    }
    this.liveHostRequestGraphCache.replaceState(state);
    this.captureVisibleAttachedSessionRuntimeState();
    this.acceptLiveRequestQuotaState(targetSessionId || undefined);
  }

  restoreSharedHostProjectionState(state: HostTurnResponseState | null, options: SharedHostProjectionStateOptions): void {
    const resolveRuntimeSessionIdForOwner = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    );
    const shouldProjectRuntimeViewStateToVisibleOwner = (
      (this as unknown as { shouldProjectRuntimeViewStateToVisibleOwner?: (sessionId?: string | null) => boolean })
        .shouldProjectRuntimeViewStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectRuntimeViewStateToVisibleOwner']
    );
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, options.sessionId);
    if (targetSessionId && !shouldProjectRuntimeViewStateToVisibleOwner.call(this, targetSessionId)) {
      const projectSharedHostProjectionStateToRuntimeOwner = (
        (this as unknown as {
          projectSharedHostProjectionStateToRuntimeOwner?: (
            sessionId: string | null | undefined,
            hostProjectionState: HostTurnResponseState | null,
            options: { readonly attachedView: boolean },
          ) => void;
        }).projectSharedHostProjectionStateToRuntimeOwner
        ?? ChatEngineService.prototype['projectSharedHostProjectionStateToRuntimeOwner']
      );
      projectSharedHostProjectionStateToRuntimeOwner.call(this, targetSessionId, state, {
        attachedView: options.attachedView === true,
      });
      return;
    }

    this.visibleProjectionSessionId = targetSessionId || null;
    if (targetSessionId) {
      this.projectRuntimeProjectionToSessionModel(targetSessionId, state, {
        attachedView: options.attachedView !== false,
      });
    }
    this.liveHostRequestGraphCache.replaceState(state);
    this.captureVisibleAttachedSessionRuntimeState();
  }

  private voteResponse(target: DialogTurnContext | null | undefined, vote: HostResponseVoteDirection): void {
    const turnId = target?.turnId;
    if (!turnId) {
      return;
    }

    const currentState = this.getHostResponseState();
    const nextState = applyHostResponseVoteToState(currentState, turnId, vote);
    if (nextState === currentState) {
      return;
    }

    const currentViewSessionResource = this.resolveCurrentViewSessionResource();
    this.replaceSharedHostProjectionState(nextState, { sessionId: currentViewSessionResource || null });
    if (currentViewSessionResource) {
      this.chatHistoryService.markDirty(currentViewSessionResource);
    }
    this.triggerSyncDetectChanges();
  }

  toolCallingIteration = 0;
  activeToolExecutions = 0;
  currentStatelessMode = false;

  /** 缓存的编辑反馈（用户保留/撤销变更后，在下次发送时注入上下文） */
  pendingEditFeedback: string | null = null;

  pendingUserInput = false;
  private _isWaiting = false;
  private _waitingSessionId: string | null = null;
  private runtimeSessionOwnerOverride: string | null = null;
  mcpInitialized = false;
  lastStopReason = '';
  /** 旧聊天链路会话级：已激活的 deferred 工具名称集合（通过 search_available_tools 加载） */
  legacyActivatedDeferredTools = new Set<string>();

  /** 延迟切换：活跃请求期间暂存待切换的模型/模式，完成后自动应用 */
  _pendingModelSwitch: ModelConfig | null = null;
  _pendingModeSwitch: ChatSurfaceModeId | null = null;
  _pendingSwitchSessionId: string | null = null;

  /** autoSend 消息在 sessionId 未就绪时的暂存区，startSession 完成后自动冲刷 */
  private _pendingAutoSendText: string | null = null;
  private readonly queuedFollowupMessagesBySession = new Map<string, PendingFollowupRequest[]>();

  // ==================== 订阅 ====================
  messageSubscription: any;
  private requestQuotaStateSubscription: Subscription | null = null;
  private contextBudgetStateSubscription: Subscription | null = null;
  private runtimeModeCollectionSubscription: Subscription | null = null;

  // ==================== 外部引用 ====================
  private chatTextareaRef: ElementRef | null = null;

  // ==================== Getters / Setters ====================

  /**
   * @deprecated Adapter for the currently attached chat view selection.
   * Do not use this as session/model truth; resolve the current
   * ChatSessionViewModel.sessionResource or pass an explicit sessionId.
   */
  get sessionId() { return this.chatService.currentSessionId; }
  set sessionId(value: string) { this.chatService.currentSessionId = value; }

  get sessionTitle() { return this.chatService.currentSessionTitle; }

  get currentMode() { return this.chatService.currentMode; }

  get currentAgentRuntimeMode() { return this.chatService.currentAgentRuntimeMode; }

  get currentAgentRuntimeModeSource() { return this.chatService.currentAgentRuntimeModeSource; }

  selectAgentRuntimeMode(
    mode: ChatAgentRuntimeMode | string | null | undefined,
    source: ChatAgentRuntimeModeSource | string | null | undefined = 'user_selected',
    reason?: string | null,
  ): ChatAgentRuntimeMode {
    const normalizedMode = normalizeChatAgentRuntimeMode(mode, this.currentAgentRuntimeMode);
    const normalizedSource = normalizeChatAgentRuntimeModeSource(source, 'user_selected');
    const previousMode = this.chatService.currentAgentRuntimeMode;
    const previousSource = this.chatService.currentAgentRuntimeModeSource;
    this.chatService.setCurrentAgentRuntimeMode(normalizedMode, normalizedSource);
    const syncCurrentSessionEntryTargetRuntimeMode = (
      this as unknown as { syncCurrentSessionEntryTargetRuntimeMode?: (sessionId?: string | null) => void }
    ).syncCurrentSessionEntryTargetRuntimeMode
      ?? ChatEngineService.prototype['syncCurrentSessionEntryTargetRuntimeMode'];
    const currentViewSessionResource = resolveOptionalUiSessionOwner(this, null);
    if (typeof syncCurrentSessionEntryTargetRuntimeMode === 'function') {
      syncCurrentSessionEntryTargetRuntimeMode.call(this, currentViewSessionResource || null);
    }
    console.info('[AilyChat] agent runtime mode selected', {
      previousMode,
      previousSource,
      mode: normalizedMode,
      source: normalizedSource,
      reason: typeof reason === 'string' ? reason : undefined,
      sessionId: currentViewSessionResource || null,
    });
    return normalizedMode;
  }

  private syncCurrentSessionEntryTargetRuntimeMode(sessionId?: string | null): void {
    const currentSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    if (!currentSessionId) {
      return;
    }

    const resolveRuntimeSessionProviderOptions = (
      this as unknown as { resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions }
    ).resolveRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
    const resolveRuntimeSelectedMode = (
      this as unknown as { resolveRuntimeSelectedMode?: (sessionId?: string | null) => ChatSelectedMode }
    ).resolveRuntimeSelectedMode
      ?? ChatEngineService.prototype['resolveRuntimeSelectedMode'];
    const providerOptions = resolveRuntimeSessionProviderOptions.call(this, currentSessionId);
    const selectedMode = resolveRuntimeSelectedMode.call(this, currentSessionId);
    const projectPath = providerOptions.folderPath ?? null;

    this.chatSessionEntryStateService?.setSessionEntryTarget({
      sessionId: currentSessionId,
      projectPath,
      providerOptions,
      inputState: buildHostSessionCurrentPickerInputState(selectedMode, providerOptions),
      mode: selectedMode.modeId,
      agentRuntimeMode: this.chatService.currentAgentRuntimeMode,
      agentRuntimeModeSource: this.chatService.currentAgentRuntimeModeSource,
      requestRouting: buildHostSessionCurrentPickerRoutingSummary(
        selectedMode,
        undefined,
        providerOptions.permissionLevel,
        providerOptions.approvalsReviewer,
        providerOptions.approvalPolicy,
      ),
    }, projectPath);
  }

  get currentSessionPermissionMode() {
    return this.resolveRuntimeSessionProviderOptions()?.permissionMode
      ?? this.chatService.currentSessionPermissionMode;
  }

  get currentSessionPermissionLevel() {
    return this.resolveRuntimeSessionProviderOptions()?.permissionLevel
      ?? this.chatService.currentSessionPermissionLevel;
  }

  get currentSessionApprovalsReviewer() {
    return this.resolveRuntimeSessionProviderOptions()?.approvalsReviewer
      ?? this.chatService.currentSessionApprovalsReviewer;
  }

  get currentSessionApprovalPolicy() {
    return this.resolveRuntimeSessionProviderOptions()?.approvalPolicy
      ?? this.chatService.currentSessionApprovalPolicy;
  }

  applyComposerPermissionPreset(action: string, sessionId?: string | null): void {
    const normalizedAction = typeof action === 'string' ? action.trim() : '';
    if (!normalizedAction) {
      return;
    }

    const targetSessionId = this.resolveRuntimeSessionIdForOwner(sessionId);
    const currentProviderOptions = this.resolveRuntimeSessionProviderOptions(targetSessionId);
    let nextProviderOptions: HostSessionProviderOptions | null = null;

    if (normalizedAction === 'permission-default') {
      nextProviderOptions = normalizeHostSessionProviderOptions({
        ...currentProviderOptions,
        permissionMode: 'default',
        permissionLevel: undefined,
        approvalsReviewer: 'user',
        approvalPolicy: 'on_request',
      });
    } else if (normalizedAction === 'permission-auto-review') {
      nextProviderOptions = normalizeHostSessionProviderOptions({
        ...currentProviderOptions,
        permissionMode: 'default',
        permissionLevel: undefined,
        approvalsReviewer: 'auto_review',
        approvalPolicy: 'on_request',
      });
    } else if (normalizedAction === 'permission-full-access') {
      nextProviderOptions = normalizeHostSessionProviderOptions({
        ...currentProviderOptions,
        permissionMode: 'bypassPermissions',
        permissionLevel: undefined,
        approvalsReviewer: 'user',
        approvalPolicy: 'on_request',
      });
    }

    if (!nextProviderOptions) {
      return;
    }

    this.rememberRuntimeSessionProviderOptions(targetSessionId, nextProviderOptions);
    this.chatService.setCurrentSessionPermissionMode(nextProviderOptions.permissionMode);
    this.chatService.setCurrentSessionPermissionLevel(nextProviderOptions.permissionLevel);
    this.chatService.setCurrentSessionApprovalsReviewer?.(nextProviderOptions.approvalsReviewer);
    this.chatService.setCurrentSessionApprovalPolicy?.(nextProviderOptions.approvalPolicy);
    this.syncExecutionModeGuidanceNotice(
      nextProviderOptions.permissionLevel,
      nextProviderOptions.approvalsReviewer,
      nextProviderOptions.approvalPolicy,
    );
  }

  get currentCustomAgentTarget() { return this.chatService.currentCustomAgentTarget; }

  get selectedMode(): ChatSelectedMode {
    return this.resolveRuntimeSelectedMode();
  }

  get currentResolvedMode(): ChatResolvedMode {
    return this.resolveRuntimeResolvedMode();
  }

  get currentModel() { return this.chatService.currentModel; }

  get currentModelName() { return this.getSelectedDisplayModel()?.name; }

  get currentReasoningEffort() { return this.chatService.currentModel?.reasoningEffort; }

  get currentReasoningEffortLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortLabel(this.currentReasoningEffort);
  }

  get currentReasoningEffortDisplayLabel(): string {
    return this.ailyChatConfigService.getReasoningEffortDisplayLabel(
      this.ailyChatConfigService.resolveModelReasoningEffort(this.chatService.currentModel, this.currentReasoningEffort),
    );
  }

  get currentModelReasoningEfforts() {
    return this.ailyChatConfigService.getSupportedReasoningEfforts(this.chatService.currentModel);
  }

  get currentModelChipLabel(): string {
    const modelName = this.getCurrentModelChipBaseLabel();
    if (!modelName) {
      return '';
    }

    const navigationConfigurationSummary = this.getNavigationConfigurationSummary(this.chatService.currentModel);
    if (navigationConfigurationSummary) {
      return `${modelName} · ${navigationConfigurationSummary}`;
    }

    return modelName;
  }

  private getCurrentModelChipBaseLabel(): string {
    return this.currentModelName ?? '';
  }

  private getNavigationConfigurationSummary(model: { presetId?: string; model?: string } | null | undefined): string | undefined {
    const modelId = this.getModelConfigurationId(model);
    if (!modelId) {
      return undefined;
    }

    const labels = this.languageModelsService.getModelConfigurationActions(modelId, { group: 'navigation' })
      .map((group) => group.actions.find((action) => action.checked)?.label?.trim())
      .filter((label): label is string => typeof label === 'string' && label.length > 0)
      .map((label) => this.normalizeModelConfigurationLabel(label));

    return labels.length > 0 ? labels.join(', ') : undefined;
  }

  private getModelConfigurationId(model: { presetId?: string; model?: string } | null | undefined): string {
    return typeof model?.presetId === 'string' && model.presetId.trim()
      ? model.presetId.trim()
      : typeof model?.model === 'string'
        ? model.model.trim()
        : '';
  }

  private normalizeModelConfigurationLabel(label: string): string {
    return label.replace(/\s*\(default\)$/i, '');
  }

  get currentModelTooltip(): string {
    return this.ailyChatConfigService.buildModelTooltip(this.getSelectedDisplayModel(), {
      maxContextTokens: this.contextBudgetSnapshot?.maxContextTokens,
    });
  }

  get currentModelBillingLabel(): string | undefined {
    const resolvedBillingLabel = this.chatService.resolvedActiveModelBillingLabel;
    if (resolvedBillingLabel) {
      return isDefaultAutoPresetSelected(this.chatService.currentModel)
        ? formatCompactBillingLabel(resolvedBillingLabel)
        : resolvedBillingLabel;
    }

    return this.ailyChatConfigService.getModelBillingLabel(this.getSelectedDisplayModel());
  }

  private getSelectedDisplayModel(): ModelConfig | null {
    const activeDisplayModel = this.chatService.getActiveDisplayModel() ?? null;
    if (!activeDisplayModel) {
      return null;
    }

    if (!isDefaultAutoPresetSelected(this.chatService.currentModel)) {
      return activeDisplayModel;
    }

    return {
      ...activeDisplayModel,
      presetId: this.ailyChatConfigService.getDefaultModelPresetId(),
    };
  }

  syncRegisteredAgentNames(agentNames: readonly string[]): void {
    this.chatViewState.setAvailableAgents(agentNames);
  }

  syncCustomAgentProviderSource(agentModeSource: unknown): void {
    void this.chatService.bindCustomAgentProviderSource(agentModeSource as any);
  }

  syncSessionCustomizationProvider(providerBinding: unknown): void {
    void this.chatService.bindSessionCustomizationProvider(providerBinding as any);
  }

  syncSessionCustomizationProviders(providerBindings: readonly unknown[]): void {
    void this.chatService.bindSessionCustomizationProviders(providerBindings as any);
  }

  syncSessionCustomizationContentProvider(contentProvider: unknown): void {
    void this.chatService.bindSessionCustomizationContentProvider(contentProvider as any);
  }

  syncSessionProviderOptionsSource(sourceBinding: unknown): void {
    void this.chatService.bindSessionProviderOptionsSource(sourceBinding as any);
  }

  syncSessionProviderOptionsSources(sourceBindings: readonly unknown[]): void {
    void this.chatService.bindSessionProviderOptionsSources(sourceBindings as any);
  }

  refreshSessionProviderOptionsSources(): void {
    void this.chatService.refreshSessionProviderOptionsSources();
  }

  syncCustomAgentProviderModes(agentModes: readonly unknown[]): void {
    void this.chatService.setCustomAgentProviderModes(agentModes);
  }

  get isWaiting() {
    return this.readVisibleSessionRequestInProgress();
  }
  set isWaiting(value: boolean) {
    const waitingOwnerSessionId = value
      ? this.resolveActiveRuntimeSessionId() || this._waitingSessionId || null
      : this._waitingSessionId;

    this._isWaiting = value;
    this._waitingSessionId = value ? waitingOwnerSessionId : null;
    this.chatService.isWaiting = value;
    AilyHost.get().blockly.aiWaiting = value;
    if (value) {
      this.captureVisibleAttachedSessionRuntimeState();
    }
    if (!value) {
      this.aiWriting = false;
      AilyHost.get().blockly.aiWaitWriting = false;
      void this.refreshRequestQuotaState();
    }
  }

  set aiWriting(value: boolean) {
    AilyHost.get().blockly.aiWriting = value;
  }

  get contextBudget$() { return this.contextBudgetViewService?.budget$; }

  get authQuotaSnapshot$() { return this.authQuotaStateService.authQuotaSnapshot$; }

  get chatInputNotice$() { return this.chatInputNoticeStateService.inputNotice$; }

  get authQuotaExhausted() { return this.authQuotaStateService.quotaExhausted; }

  get requestQuotaSnapshot$() { return this.requestQuotaStateService.requestQuotaSnapshot$; }

  get contextBudgetSnapshot(): ContextBudgetSnapshot | null {
    return this.contextBudgetViewService?.getSnapshot() ?? null;
  }

  get contextUsageSnapshot(): ChatContextUsageSnapshot | null {
    const targetSessionId = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    ).call(this);
    const turnResponses = (
      (this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] })
        .readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses']
    ).call(this, targetSessionId);
    const usageTurn = findLatestUsageTurn(turnResponses);
    const requestScopedModel = this.ailyChatConfigService.resolveRuntimeModelFromServerModelName(
      getTurnResponseResolvedModelName(usageTurn),
    );

    return createChatContextUsageSnapshot({
      turnResponses,
      maxContextTokens: requestScopedModel?.contextWindowTokens
        ?? this.currentModel?.contextWindowTokens
        ?? this.contextBudgetSnapshot?.maxContextTokens,
      contextBudgetSnapshot: this.contextBudgetSnapshot,
    });
  }

  get interactionBudgetSnapshot(): InteractionBudgetSnapshot | null {
    const targetSessionId = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    ).call(this);
    const turnResponses = (
      (this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] })
        .readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses']
    ).call(this, targetSessionId);
    return createInteractionBudgetSnapshot(turnResponses);
  }

  get contextCompactionMetricsSnapshot(): MetricsSnapshot | null {
    return this.lexStream.compactionMetricsSnapshot;
  }

  async continueCurrentExecution(sessionId?: string | null): Promise<void> {
    const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const targetSessionId = explicitSessionId || (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    ).call(this);
    if (!targetSessionId) {
      throw new Error('continueCurrentExecution requires a current view sessionResource.');
    }
    const continuation = this.readLatestInteractionContinuation(targetSessionId);
    const pendingState = continuation?.pendingState && typeof continuation.pendingState === 'object'
      ? continuation.pendingState as Record<string, unknown>
      : null;
    if ((typeof pendingState?.['kind'] === 'string' ? pendingState['kind'] : undefined) !== 'continue') {
      return;
    }

    const submitSessionInteractionActionRequest = (
      this as unknown as {
        submitSessionInteractionActionRequest?: (
          sessionId: string | null | undefined,
          content: string,
          interactionAction: NonNullable<TurnRequest['metadata']>['interactionAction'],
        ) => Promise<void>;
      }
    ).submitSessionInteractionActionRequest
      ?? ChatEngineService.prototype['submitSessionInteractionActionRequest'];
    await submitSessionInteractionActionRequest.call(this, targetSessionId, '继续', { kind: 'continue' });
  }

  async submitInteractionActionRequest(
    content: string,
    interactionAction: NonNullable<TurnRequest['metadata']>['interactionAction'],
    requestMetadata?: TurnRequest['metadata'],
    sessionId?: string | null,
  ): Promise<void> {
    await this.submitSessionInteractionActionRequest(sessionId, content, interactionAction, requestMetadata);
  }

  get requestQuotaSnapshot(): RequestQuotaSnapshot | null {
    return this.requestQuotaStateService.getRequestQuotaSnapshot();
  }

  private createMessageDisplayContext(): ConstructorParameters<typeof MessageDisplayHelper>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.setCurrentViewVisibleProjectionList(value); },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      markCurrentViewVisibleProjectionOwner: () => thisEngine.markCurrentViewVisibleProjectionOwner(),
      get sessionId() { return thisEngine.sessionId; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get ngZone() { return thisEngine.ngZone; },
      get toolCallStates() { return thisEngine.toolCallStates; },
    };
  }

  private createUserInteractionContext(): ConstructorParameters<typeof UserInteractionHelper>[0] {
    const thisEngine = this;

    return {
      get lexStream() { return thisEngine.lexStream; },
      get isLoggedIn() { return thisEngine.isLoggedIn; },
      getCurrentProjectPath: () => thisEngine.getCurrentProjectPath(),
      get sessionId() { return thisEngine.sessionId; },
      resolveActiveRuntimeSessionId: () => thisEngine.resolveActiveRuntimeSessionId(),
      readCurrentViewSessionResource: () => thisEngine.chatSessionViewModelStore.currentSessionResource,
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
    };
  }

  private createEditActionsContext(): ConstructorParameters<typeof EditActionsHelper>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.setCurrentViewVisibleProjectionList(value); },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      markCurrentViewVisibleProjectionOwner: () => thisEngine.markCurrentViewVisibleProjectionOwner(),
      get sessionId() { return thisEngine.sessionId; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get ngZone() { return thisEngine.ngZone; },
      get isWaiting() { return thisEngine.isWaiting; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get pendingEditFeedback() { return thisEngine.pendingEditFeedback; },
      set pendingEditFeedback(value) { thisEngine.pendingEditFeedback = value; },
      get sessionAllowedPaths() { return thisEngine.sessionAllowedPaths; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      getCurrentProjectPath: () => this.getCurrentProjectPath(),
      get absAutoSyncService() { return thisEngine.absAutoSyncService; },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get workspaceCheckpointProvider() { return thisEngine.workspaceCheckpointProvider; },
      get resourceManager() { return thisEngine.resourceManager; },
      get message() { return thisEngine.message; },
      get lexStream() { return thisEngine.lexStream; },
      get session() { return thisEngine.session; },
      buildExecutionSaveTarget: (sessionId) => thisEngine.buildExecutionSaveTarget(sessionId),
      readCurrentViewSessionResource: () => thisEngine.chatSessionViewModelStore.currentSessionResource,
      confirmRestoreCheckpoint: (confirmation) => thisEngine.confirmRestoreCheckpoint(confirmation),
      get hostResponseProjection() { return thisEngine.hostResponseProjection; },
      restoreSharedHostProjectionState: (state, options) => thisEngine.restoreSharedHostProjectionState(state, options),
      replaceSharedHostProjectionState: (state, options) => thisEngine.replaceSharedHostProjectionState(state, options),
      send: (sender, content, clear) => thisEngine.sendFromCoordinationContext(sender, content, clear),
    };
  }

  private async confirmRestoreCheckpoint(confirmation: RestoreCheckpointConfirmation): Promise<boolean> {
    if (this.restoreCheckpointDialogOpen) {
      return false;
    }

    const dialogData = this.buildRestoreCheckpointConfirmationDialogData(confirmation);

    return new Promise<boolean>((resolve) => {
      this.restoreCheckpointDialogOpen = true;

      const modalRef = this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzBodyStyle: {
          padding: '0',
        },
        nzWidth: '350px',
        nzContent: UnsaveDialogComponent,
        nzData: dialogData,
      });

      modalRef.afterClose.subscribe(result => {
        this.restoreCheckpointDialogOpen = false;
        resolve(result?.result === 'confirm');
      });
    });
  }

  private buildRestoreCheckpointConfirmationDialogData(
    confirmation: RestoreCheckpointConfirmation,
  ): UnsaveDialogData {
    return {
      title: confirmation.requestCount === 1
        ? this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.TITLE_SINGLE',
          'Do you want to undo your last edit?',
        )
        : this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.TITLE_MULTIPLE',
          'Do you want to undo {{count}} edits?',
          { count: confirmation.requestCount },
        ),
      text: this.buildRestoreCheckpointConfirmationMessage(confirmation),
      buttons: [
        {
          text: this.translateRestoreCheckpointDialogText('UNSAVE_DIALOG.CANCEL', 'Cancel'),
          type: 'default',
          action: 'cancel',
        },
        {
          text: this.translateRestoreCheckpointDialogText('CHECKPOINT_RESTORE_DIALOG.CONFIRM', 'Yes'),
          type: 'primary',
          danger: true,
          action: 'confirm',
        },
      ],
    };
  }

  private buildRestoreCheckpointConfirmationMessage(
    confirmation: RestoreCheckpointConfirmation,
  ): string {
    const isLastRequest = confirmation.requestCount === 1;

    if (confirmation.fileCount === 1 && confirmation.fileLabel) {
      return isLastRequest
        ? this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_LAST_SINGLE_FILE',
          'This will remove your last request and undo the edits made to {{file}}. Do you want to proceed?',
          { file: confirmation.fileLabel },
        )
        : this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_MULTI_SINGLE_FILE',
          'This will remove all subsequent requests and undo edits made to {{file}}. Do you want to proceed?',
          { file: confirmation.fileLabel },
        );
    }

    if (confirmation.fileCount > 0) {
      return isLastRequest
        ? this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_LAST_MULTI_FILE',
          'This will remove your last request and undo edits made to {{count}} files in your working set. Do you want to proceed?',
          { count: confirmation.fileCount },
        )
        : this.translateRestoreCheckpointDialogText(
          'CHECKPOINT_RESTORE_DIALOG.MESSAGE_MULTI_FILE',
          'This will remove all subsequent requests and undo edits made to {{count}} files in your working set. Do you want to proceed?',
          { count: confirmation.fileCount },
        );
    }

    return isLastRequest
      ? this.translateRestoreCheckpointDialogText(
        'CHECKPOINT_RESTORE_DIALOG.MESSAGE_LAST_NO_FILE',
        'This will remove your last request and restore the chat to that point. Do you want to proceed?',
      )
      : this.translateRestoreCheckpointDialogText(
        'CHECKPOINT_RESTORE_DIALOG.MESSAGE_MULTI_NO_FILE',
        'This will remove all subsequent requests and restore the chat to that point. Do you want to proceed?',
      );
  }

  private translateRestoreCheckpointDialogText(
    key: string,
    fallback: string,
    params?: Record<string, string | number>,
  ): string {
    const translated = this.translate?.instant?.(key, params);
    if (typeof translated === 'string' && translated !== key) {
      return translated;
    }

    return this.interpolateRestoreCheckpointDialogText(fallback, params);
  }

  private interpolateRestoreCheckpointDialogText(
    template: string,
    params?: Record<string, string | number>,
  ): string {
    if (!params) {
      return template;
    }

    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, token: string) => {
      const value = params[token];
      return typeof value === 'undefined' ? '' : String(value);
    });
  }

  private createSessionLifecycleContext(): ConstructorParameters<typeof SessionLifecycleHelper>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.setCurrentViewVisibleProjectionList(value); },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      markCurrentViewVisibleProjectionOwner: () => thisEngine.markCurrentViewVisibleProjectionOwner(),
      get chatSessionItemsService() { return thisEngine.chatSessionItemsService; },
      captureVisibleAttachedSessionRuntimeState: () => thisEngine.captureVisibleAttachedSessionRuntimeState(),
      clearSessionRuntimeState: (sessionId) => thisEngine.clearSessionRuntimeState(sessionId),
      readSessionRuntimeState: (sessionId) => thisEngine.chatSessionRuntimeStore.read(sessionId),
      acquireExistingSessionModel: (sessionId) => thisEngine.chatSessionModelStore.acquireExisting(sessionId),
      acquireSessionModel: (props) => thisEngine.chatSessionModelStore.acquireOrCreate(props),
      attachSessionViewModel: (sessionId) => thisEngine.chatSessionViewModelStore.attach(sessionId),
      detachSessionViewModel: (sessionId) => thisEngine.chatSessionViewModelStore.detach(sessionId),
      readCurrentViewSessionResource: () => thisEngine.chatSessionViewModelStore.currentSessionResource,
      buildExecutionSaveTarget: (sessionId) => thisEngine.buildExecutionSaveTarget(sessionId),
      hasSessionRuntimeHandle: (sessionId) => !!thisEngine.lexStream.agent.getHandle?.(sessionId),
      projectRestoredRuntimeAuxiliary: (sessionId, auxiliary) => thisEngine.projectRestoredRuntimeAuxiliary(sessionId, auxiliary),
      detachSessionRuntimeView: (sessionId) => thisEngine.detachSessionRuntimeView(sessionId),
      attachSessionView: (sessionId) => thisEngine.attachSessionView(sessionId),
      attachCurrentSessionView: () => thisEngine.attachCurrentSessionView(),
      markVisibleSessionProjectionOwner: (sessionId) => thisEngine.markVisibleSessionProjectionOwner(sessionId),
      ensureBackgroundSessionCanRerun: (sessionId) => thisEngine.ensureBackgroundSessionCanRerun(sessionId),
      resetVisibleSessionProjection: (options) => thisEngine.resetVisibleSessionProjection(options),
      stopSessionAction: (sessionId) => thisEngine.stopSessionAction(sessionId),
      disposeSessionAction: (sessionId) => thisEngine.disposeSessionAction(sessionId),
      buildRuntimeRestoreHostRecord: (request) => thisEngine.hostSessionRestoreBridge.buildRuntimeRestoreHostRecord(request),
      restoreSessionHostRecord: (hostRecord, options) => thisEngine.hostSessionRestoreBridge.restore(hostRecord, options),
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      get sessionId() { return thisEngine.sessionId; },
      set sessionId(value) { thisEngine.sessionId = value; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get chatSessionEntryStateService() { return thisEngine.chatSessionEntryStateService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get ngZone() { return thisEngine.ngZone; },
      get isWaiting() { return thisEngine.isWaiting; },
      set isWaiting(value) { thisEngine.isWaiting = value; },
      get isSessionStarting() { return thisEngine.isSessionStarting; },
      set isSessionStarting(value) { thisEngine.isSessionStarting = value; },
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get toolCallingIteration() { return thisEngine.toolCallingIteration; },
      set toolCallingIteration(value) { thisEngine.toolCallingIteration = value; },
      get mcpInitialized() { return thisEngine.mcpInitialized; },
      set mcpInitialized(value) { thisEngine.mcpInitialized = value; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get messageSubscription() { return thisEngine.messageSubscription; },
      set messageSubscription(value) { thisEngine.messageSubscription = value; },
      get activeToolExecutions() { return thisEngine.activeToolExecutions; },
      set activeToolExecutions(value) { thisEngine.activeToolExecutions = value; },
      get hasInitializedForThisLogin() { return thisEngine.hasInitializedForThisLogin; },
      set hasInitializedForThisLogin(value) { thisEngine.hasInitializedForThisLogin = value; },
      get legacyActivatedDeferredTools() { return thisEngine.legacyActivatedDeferredTools; },
      get sessionTitle() { return thisEngine.sessionTitle; },
      get sessionAllowedPaths() { return thisEngine.sessionAllowedPaths; },
      set sessionAllowedPaths(value) { thisEngine.sessionAllowedPaths = value; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get chatService() { return thisEngine.chatService; },
      get currentMode() { return thisEngine.currentMode; },
      get currentAgentRuntimeMode() { return thisEngine.currentAgentRuntimeMode; },
      get currentAgentRuntimeModeSource() { return thisEngine.currentAgentRuntimeModeSource; },
      get currentModel() { return thisEngine.currentModel; },
      get isLoggedIn() { return thisEngine.isLoggedIn; },
      get prjPath() { return thisEngine.prjPath; },
      get prjRootPath() { return thisEngine.prjRootPath; },
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get repetitionDetectionService() { return thisEngine.repetitionDetectionService; },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get mcpService() { return thisEngine.mcpService; },
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      getDevelopmentModePreferenceRuntimeMode: () => thisEngine.configService?.getPreferredChatAgentRuntimeMode?.(),
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
      get resourceManager() { return thisEngine.resourceManager; },
      get message() { return thisEngine.message; },
      get translate() { return thisEngine.translate; },
      get interaction() { return thisEngine.interaction; },
      get lexStream() { return thisEngine.lexStream; },
      resumeRestoredInteraction: (content, interactionAction, options) => (
        thisEngine.submitInteractionActionRequest(
          content,
          interactionAction,
          options?.requestMetadata,
          options?.sessionId,
        )
      ),
      send: (sender, content, clear) => thisEngine.sendFromCoordinationContext(sender, content, clear),
      get session() { return thisEngine.session; },
      get hostRequestModel() { return thisEngine.hostRequestModel; },
      get hostResponseProjection() { return thisEngine.hostResponseProjection; },
      restoreSharedHostProjectionState: (state, options) => this.restoreSharedHostProjectionState(state, options),
      replaceSharedHostProjectionState: (state, options) => this.replaceSharedHostProjectionState(state, options),
    };
  }

  private createHostSessionRestoreContext(): ConstructorParameters<typeof HostSessionRestoreBridge>[0] {
    const thisEngine = this;

    return {
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.setCurrentViewVisibleProjectionList(value); },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      markCurrentViewVisibleProjectionOwner: () => thisEngine.markCurrentViewVisibleProjectionOwner(),
      get sessionId() { return thisEngine.sessionId; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      get currentMode() { return thisEngine.currentMode; },
      get ngZone() { return thisEngine.ngZone; },
      readSessionRuntimeState: (sessionId) => thisEngine.chatSessionRuntimeStore.read(sessionId),
      get toolCallingIteration() { return thisEngine.toolCallingIteration; },
      set toolCallingIteration(value) { thisEngine.toolCallingIteration = value; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get chatService() { return thisEngine.chatService; },
      get contextBudgetService() { return thisEngine.createRuntimeScopedContextBudgetService(); },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
      get lexStream() { return thisEngine.lexStream; },
      projectRestoredHostProjection: (sessionId, turnResponses, hostProjectionState, options) => {
        thisEngine.projectRestoredHostProjection(sessionId, turnResponses, hostProjectionState, options);
      },
      resumeRestoredInteraction: (content, interactionAction, options) => (
        thisEngine.submitInteractionActionRequest(
          content,
          interactionAction,
          options?.requestMetadata,
          options?.sessionId,
        )
      ),
      restoreSharedHostProjectionState: (state, options) => thisEngine.restoreSharedHostProjectionState(state, options),
      replaceSharedHostProjectionState: (state, options) => thisEngine.replaceSharedHostProjectionState(state, options),
    };
  }

  private projectRuntimeProjectionToSessionModel(
    sessionId: string | null | undefined,
    hostProjectionState: HostTurnResponseState | null,
    options: {
      readonly attachedView: boolean;
      readonly turnResponses?: readonly TurnResponseTurn[];
    },
  ): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    const hasCanonicalTurnResponses = Array.isArray(options.turnResponses);
    const capabilities = resolveEngineRuntimeSessionCapabilities(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    );
    const modelStore = (this as unknown as {
      chatSessionModelStore?: Pick<ChatSessionModelStoreService, 'get' | 'acquireOrCreate'>;
    }).chatSessionModelStore;
    if (!modelStore) {
      return false;
    }

    const existingModel = modelStore.get?.(targetSessionId);
    const modelReference = existingModel
      ? undefined
      : modelStore.acquireOrCreate?.({ sessionResource: targetSessionId });
    const model = existingModel ?? modelReference?.object;
    if (!model) {
      modelReference?.dispose();
      return false;
    }

    model.applyRuntimeState({
      hostProjectionState,
      attachedView: options.attachedView,
      capabilities,
      ...(hasCanonicalTurnResponses ? { turnResponses: options.turnResponses } : {}),
    }, {
      reason: 'transcript',
    });
    modelReference?.dispose();
    return true;
  }

  private projectSharedHostProjectionStateToRuntimeOwner(
    sessionId: string | null | undefined,
    hostProjectionState: HostTurnResponseState | null,
    options: { readonly attachedView: boolean },
  ): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return;
    }

    const projectRuntimeProjectionToSessionModel = (
      (this as unknown as {
        projectRuntimeProjectionToSessionModel?: ChatEngineService['projectRuntimeProjectionToSessionModel'];
      }).projectRuntimeProjectionToSessionModel
      ?? ChatEngineService.prototype['projectRuntimeProjectionToSessionModel']
    );
    if (projectRuntimeProjectionToSessionModel.call(this, targetSessionId, hostProjectionState, options)) {
      return;
    }

    const capabilities = resolveEngineRuntimeSessionCapabilities(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    );
    const concurrencyScope = resolveEngineRuntimeSessionConcurrencyScope(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    ) ?? null;

    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, {
        hostProjectionState,
        attachedView: options.attachedView,
        capabilities,
        concurrencyScope,
      });
      return;
    }

    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
      hostProjectionState,
      attachedView: options.attachedView,
      capabilities,
    }, {
      reason: 'transcript',
    });
  }

  private projectRestoredHostProjection(
    sessionId: string | null | undefined,
    turnResponses: readonly TurnResponseTurn[],
    hostProjectionState: HostTurnResponseState,
    options: { readonly attachedView: boolean },
  ): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return;
    }

    const capabilities = resolveEngineRuntimeSessionCapabilities(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    );
    const concurrencyScope = resolveEngineRuntimeSessionConcurrencyScope(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    ) ?? null;
    const projectRuntimeProjectionToSessionModel = (
      (this as unknown as {
        projectRuntimeProjectionToSessionModel?: ChatEngineService['projectRuntimeProjectionToSessionModel'];
      }).projectRuntimeProjectionToSessionModel
      ?? ChatEngineService.prototype['projectRuntimeProjectionToSessionModel']
    );
    if (projectRuntimeProjectionToSessionModel.call(this, targetSessionId, hostProjectionState, {
      attachedView: options.attachedView,
      turnResponses,
    })) {
      return;
    }

    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, {
        turnResponses,
        hostProjectionState,
        attachedView: options.attachedView,
        capabilities,
        concurrencyScope,
      });
      return;
    }

    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
      turnResponses,
      hostProjectionState,
      attachedView: options.attachedView,
      capabilities,
    }, {
      reason: 'transcript',
    });
  }

  private createLexOwnerContext(): ConstructorParameters<typeof LexOwnerFacade>[0] {
    const thisEngine = this;

    return {
      get prjPath() { return thisEngine.prjPath; },
      get prjRootPath() { return thisEngine.prjRootPath; },
      get currentModel() { return thisEngine.currentModel; },
      get currentAgentRuntimeMode() { return thisEngine.currentAgentRuntimeMode; },
      get currentAgentRuntimeModeSource() { return thisEngine.currentAgentRuntimeModeSource; },
      selectAgentRuntimeMode: (mode, source, reason) => {
        thisEngine.selectAgentRuntimeMode(mode, source, reason);
      },
      get sessionId() { return thisEngine.sessionId; },
      get chatSessionRuntimeRegistry() { return thisEngine.chatSessionRuntimeRegistry; },
      get sessionTitle() { return thisEngine.sessionTitle; },
      get chatService() { return thisEngine.chatService; },
      get currentSessionPath() { return thisEngine.resolveRuntimeSessionProviderOptions()?.folderPath ?? thisEngine.chatService.currentSessionPath; },
      get currentSessionPermissionMode() { return thisEngine.resolveRuntimeSessionProviderOptions()?.permissionMode ?? thisEngine.chatService.currentSessionPermissionMode; },
      get currentSessionApprovalsReviewer() { return thisEngine.resolveRuntimeSessionProviderOptions()?.approvalsReviewer ?? thisEngine.chatService.currentSessionApprovalsReviewer; },
      get currentSessionApprovalPolicy() { return thisEngine.resolveRuntimeSessionProviderOptions()?.approvalPolicy ?? thisEngine.chatService.currentSessionApprovalPolicy; },
      get ailyChatConfigService() { return thisEngine.ailyChatConfigService; },
      get mcpService() { return thisEngine.mcpService; },
      buildExecutionSaveTarget: (sessionId) => thisEngine.buildExecutionSaveTarget(sessionId),
      resolveActiveRuntimeSessionId: () => thisEngine.resolveActiveRuntimeSessionId(),
      get runtimeInteractionHost() { return thisEngine.runtimeInteractionHost; },
      handleToolApproval: request => this.handleToolApproval(request),
      get lexStream() { return thisEngine.lexStream; },
      openSettings: () => this.openSettings(),
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      triggerAiEditDiffPreview: (summary) => thisEngine.triggerAiEditDiffPreview(summary),
      get ngZone() { return thisEngine.ngZone; },
      get message() { return thisEngine.message; },
      get list() { return thisEngine.list; },
      set list(value) { thisEngine.setCurrentViewVisibleProjectionList(value); },
      get partStore() { return thisEngine.partStore; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      get scrollManager() { return thisEngine.scrollManager; },
      invalidateHostRequestGraph: () => this.invalidateHostRequestGraph(),
      markCurrentViewVisibleProjectionOwner: () => thisEngine.markCurrentViewVisibleProjectionOwner(),
      get inputValue() { return thisEngine.inputValue; },
      set inputValue(value) { thisEngine.inputValue = value; },
      switchToMode: (mode) => this.switchToMode(mode),
      triggerSyncDetectChanges: () => this.triggerSyncDetectChanges(),
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get currentModelName() { return thisEngine.currentModelName; },
      get currentMessageSource() { return thisEngine.currentMessageSource; },
      set currentMessageSource(value) { thisEngine.currentMessageSource = value; },
      get toolCallingIteration() { return thisEngine.toolCallingIteration; },
      set toolCallingIteration(value) { thisEngine.toolCallingIteration = value; },
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get isWaiting() { return thisEngine.isWaiting; },
      set isWaiting(value) { thisEngine.isWaiting = value; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get session() { return thisEngine.session; },
      readSessionRuntimeState: (sessionId) => thisEngine.chatSessionRuntimeStore.read(sessionId),
      readCurrentViewSessionResource: () => thisEngine.chatSessionViewModelStore.currentSessionResource,
      syncExecutionRuntimeState: (saveTarget) => thisEngine.syncExecutionRuntimeState(saveTarget),
      syncExecutionRuntimeTurnResponses: (sessionId, turnResponses) => thisEngine.syncExecutionRuntimeTurnResponses(sessionId, turnResponses),
      applyPendingSwitch: (sessionId) => this.applyPendingSwitch(sessionId),
      processPendingFollowupRequests: (sessionId) => thisEngine.processPendingFollowupRequests(sessionId),
      get repetitionDetectionService() { return thisEngine.repetitionDetectionService; },
      get editActions() { return thisEngine.editActions; },
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get activeToolExecutions() { return thisEngine.activeToolExecutions; },
      set activeToolExecutions(value) { thisEngine.activeToolExecutions = value; },
      get currentStatelessMode() { return thisEngine.currentStatelessMode; },
      set currentStatelessMode(value) { thisEngine.currentStatelessMode = value; },
    };
  }

  private createTitleCoordinatorContext(): ConstructorParameters<typeof ChatTitleCoordinator>[0] {
    const thisEngine = this;

    return {
      get sessionId() { return thisEngine.sessionId; },
      get sessionTitle() { return thisEngine.sessionTitle; },
      get chatService() { return thisEngine.chatService; },
      get chatHistoryService() { return thisEngine.chatHistoryService; },
      get session() { return thisEngine.session; },
      get lexStream() { return thisEngine.lexStream; },
      readCurrentViewSessionResource: () => thisEngine.resolveCurrentViewSessionResource(),
      updateSessionModelTitle: (sessionId, title) => thisEngine.chatSessionModelStore.updateMetadata(sessionId, {
        title,
      }),
    };
  }

  private createStopCoordinatorContext(): ConstructorParameters<typeof ChatStopCoordinator>[0] {
    const thisEngine = this;

    return {
      get isCancelled() { return thisEngine.isCancelled; },
      set isCancelled(value) { thisEngine.isCancelled = value; },
      get messageSubscription() { return thisEngine.messageSubscription; },
      set messageSubscription(value) { thisEngine.messageSubscription = value; },
      get pendingUserInput() { return thisEngine.pendingUserInput; },
      set pendingUserInput(value) { thisEngine.pendingUserInput = value; },
      get activeToolExecutions() { return thisEngine.activeToolExecutions; },
      set activeToolExecutions(value) { thisEngine.activeToolExecutions = value; },
      get currentStatelessMode() { return thisEngine.currentStatelessMode; },
      set currentStatelessMode(value) { thisEngine.currentStatelessMode = value; },
      get isWaiting() { return thisEngine.isWaiting; },
      set isWaiting(value) { thisEngine.isWaiting = value; },
      get isCompleted() { return thisEngine.isCompleted; },
      set isCompleted(value) { thisEngine.isCompleted = value; },
      get lexStream() { return thisEngine.lexStream; },
      get session() { return thisEngine.session; },
      applyPendingSwitch: (sessionId) => this.applyPendingSwitch(sessionId),
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get editCheckpointService() { return thisEngine.editCheckpointService; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get viewAdapter() { return thisEngine.viewAdapter; },
      dismissPendingInteractions: (sessionId) => {
        const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
          ? sessionId.trim()
          : thisEngine.resolveActiveRuntimeSessionId();
        if (!targetSessionId) {
          return;
        }

        thisEngine.interaction.resetApprovalState();
        thisEngine.runtimeInteractionHost.clearQuestion(targetSessionId);
        thisEngine.runtimeInteractionHost.clearConfirmations(targetSessionId);
      },
      markExplicitInterrupt: (sessionId) => {
        const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
          ? sessionId.trim()
          : thisEngine.resolveActiveRuntimeSessionId();
        if (!targetSessionId) {
          return;
        }

        const runtimeStatePatch = {
          status: null,
          requestInProgress: false,
          yieldRequested: false,
          supportsInterruption: false,
          activeResponseHandle: null,
          stopSession: null,
          debugSummary: {
            lastExplicitInterruptAt: Date.now(),
          },
        };
        if (thisEngine.chatSessionRuntimeRegistry) {
          thisEngine.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, runtimeStatePatch);
          return;
        }

        thisEngine.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, runtimeStatePatch, {
          reason: 'status',
        });
      },
      awaitPendingLexRequestCompleted: async (sessionId) => {
        const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
          ? sessionId.trim()
          : thisEngine.resolveActiveRuntimeSessionId();
        if (!targetSessionId) {
          return;
        }

        await thisEngine.chatSessionRuntimeRegistry?.awaitPendingLexRequestCompleted(targetSessionId);
      },
      stopSettleTimeoutMs: 1000,
      processPendingFollowupRequests: (sessionId) => thisEngine.processPendingFollowupRequests(sessionId),
      requestStop: (sessionId) => thisEngine.interruptSessionRuntime(sessionId),
    };
  }

  private createSwitchCoordinatorContext(): ConstructorParameters<typeof ChatSwitchCoordinator>[0] {
    const thisEngine = this;

    return {
      get isWaiting() { return thisEngine.isWaiting; },
      get _pendingModelSwitch() { return thisEngine._pendingModelSwitch; },
      set _pendingModelSwitch(value) { thisEngine._pendingModelSwitch = value; },
      get _pendingModeSwitch() { return thisEngine._pendingModeSwitch; },
      set _pendingModeSwitch(value) { thisEngine._pendingModeSwitch = value; },
      get _pendingSwitchSessionId() { return thisEngine._pendingSwitchSessionId; },
      set _pendingSwitchSessionId(value) { thisEngine._pendingSwitchSessionId = value; },
      get currentModel() { return thisEngine.currentModel; },
      get currentMode() { return thisEngine.currentMode; },
      get sessionId() { return thisEngine.sessionId; },
      get chatService() { return thisEngine.chatService; },
      get conversationMessages() { return thisEngine.conversationMessages; },
      get contextBudgetService() { return thisEngine.contextBudgetService; },
      get languageModelsService() { return thisEngine.languageModelsService; },
      get message() { return thisEngine.message; },
      get lexStream() { return thisEngine.lexStream; },
    };
  }

  private createConversationActionCoordinatorContext(): ConstructorParameters<typeof ChatConversationActionCoordinator>[0] {
    const thisEngine = this;

    return {
      get isWaiting() { return thisEngine.isWaiting; },
      get sessionId() { return thisEngine.sessionId; },
      get message() { return thisEngine.message; },
      get scrollManager() { return thisEngine.scrollManager; },
    };
  }

  private createExternalInputCoordinatorContext(): ConstructorParameters<typeof ChatExternalInputCoordinator>[0] {
    const thisEngine = this;

    return {
      get inputValue() { return thisEngine.inputValue; },
      set inputValue(value) { thisEngine.inputValue = value; },
      get isWaiting() { return thisEngine.isWaiting; },
      get sessionId() { return thisEngine.sessionId; },
      get message() { return thisEngine.message; },
      get scrollManager() { return thisEngine.scrollManager; },
      triggerSyncDetectChanges: () => thisEngine.triggerSyncDetectChanges(),
    };
  }

  // ==================== 构造函数 ====================

  constructor(
    public chatService: ChatService,
    public mcpService: McpService,
    public ailyChatConfigService: AilyChatConfigService,
    public languageModelsService: AilyChatLanguageModelsService,
    public chatHistoryService: ChatHistoryService,
    public repetitionDetectionService: RepetitionDetectionService,
    public contextBudgetService: ContextBudgetService,
    public configService: ConfigService,
    private contextBudgetViewService: ContextBudgetViewService,
    public authQuotaStateService: AuthQuotaStateService,
    public chatInputNoticeStateService: ChatInputNoticeStateService,
    private chatSetupSuggestionService: ChatSetupSuggestionService,
    public ngZone: NgZone,
    public absAutoSyncService: AbsAutoSyncService,
    public editCheckpointService: EditCheckpointService,
    private aiCoderDiffBridge: AiCoderDiffBridgeService,
    public workspaceCheckpointProvider: GitWorkspaceCheckpointProviderService,
    public translate: TranslateService,
    public message: NzMessageService,
    public scrollManager: ScrollManagerService,
    public resourceManager: ResourceManagerService,
    public menuManager: MenuManagerService,
    public runtimeInteractionHost: ChatRuntimeInteractionHostService,
    public requestQuotaStateService: RequestQuotaStateService,
  ) {
    this.editCheckpointService.setWorkspaceCheckpointProvider(this.workspaceCheckpointProvider);

    // 初始化 viewAdapter（需要 ngZone 已注入）
    (this as any).viewAdapter = new ChatViewAdapter(
      () => this.list,
      (msg) => {
        this.markCurrentViewVisibleProjectionOwner();
        this.list.push(msg);
      },
      () => this.currentMessageSource,
      () => this.currentModelName || undefined,
      () => this.currentModelBillingLabel || undefined,
      () => this.isWaiting,
      () => {
        const currentViewSessionResource = this.resolveCurrentViewSessionResource();
        if (currentViewSessionResource) {
          this.chatHistoryService.markDirty(currentViewSessionResource);
        }
      },
      this.ngZone,
      undefined, // cdCallback — 由 component 通过 setCdCallback 注入
      () => this.scrollManager.captureAutoScrollState(),
      (shouldFollow) => this.scrollManager.scrollToBottomIfNeeded(shouldFollow, 'auto'),
    );

    this.chatHistoryService.setLiveSessionProvider(() => this.session.buildLiveHostSessionRecord());

    // H1: wire the cache as the host stream listener for incremental turn events.
    this.lexStream.setHostStreamListener(this.liveHostRequestGraphCache);

    this.syncExecutionModeGuidanceNotice(
      this.chatService.currentSessionPermissionLevel,
      this.chatService.currentSessionApprovalsReviewer,
      this.chatService.currentSessionApprovalPolicy,
    );
  }

  /** 注册 OnPush CD 回调（由 component 调用 cdr.markForCheck） */
  setCdCallback(cb: () => void): void {
    this.viewAdapter.setCdCallback(cb);
  }

  /** AI 编辑完成后在内嵌 Coder 打开 DiffEditor 预览（与 autoSaveEdits / 摘要 UI 解耦） */
  triggerAiEditDiffPreview(summary: EditsSummary | null): void {
    const workspaceRoot = this.prjPath || this.prjRootPath;
    if (workspaceRoot) {
      this.aiCoderDiffBridge.setWorkspaceRoot(workspaceRoot);
    }
    if (!summary?.files?.length) {
      return;
    }
    this.aiCoderDiffBridge.openFromSummary(
      summary,
      (filePath) => this.editCheckpointService.getInitialContent(filePath),
    );
  }

  /**
   * 同步 detectChanges 回调 — 在 runOutsideAngular 场景中使用。
   * markForCheck 在 zone 外不会触发实际 CD，此回调直接同步执行 detectChanges。
   */
  private _syncDetectChanges: (() => void) | null = null;

  setSyncDetectChanges(cb: () => void): void {
    this._syncDetectChanges = cb;
  }

  /**
   * 仅解绑当前 view 关联的引用，不销毁 session runtime。
   * 真正的 runtime dispose 仍由显式 owner 调用 `destroy()`。
   */
  detachView(): void {
    this.chatTextareaRef = null;
    this.viewAdapter.setCdCallback(undefined);
    this._syncDetectChanges = null;
    this.paneSessionCommandHandlers = {};
    this.captureVisibleAttachedSessionRuntimeState();
  }

  resetVisibleSessionProjection(options: VisibleSessionProjectionResetOptions = {}): void {
    this.interaction.resetApprovalState();
    if (options.clearResolvedActiveModel === true) {
      this.chatService.clearResolvedActiveModel?.();
    }

    this.lexStream.resetSessionState();
    this.clearVisibleChatView({ detectChanges: options.detectChanges });

    if (options.clearTurns === true) {
      this.lexStream.turns.clear();
    }
    if (options.resetToolCallingIteration === true) {
      this.toolCallingIteration = 0;
    }
    if (options.resetContextBudget === true) {
      this.contextBudgetService?.reset();
    }

    this.scrollManager.setScrollLock(true);
    this.isCompleted = false;
    this.isCancelled = true;

    if (options.clearEditSummary === true) {
      this.editCheckpointService.clear();
      this.editCheckpointService.dismissSummary();
    }

    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe();
      this.messageSubscription = null;
    }

    this.activeToolExecutions = 0;
  }

  invalidateHostRequestGraph(): void {
    this.liveHostRequestGraphCache.markDirty();
    this.captureVisibleAttachedSessionRuntimeState();
  }

  private clearVisibleChatView(options: { detectChanges?: boolean } = {}): void {
    this.invalidateHostRequestGraph();
    this.visibleProjectionSessionId = null;
    this.viewAdapter.reset?.();
    this.list = [];
    this.partStore.reset();

    if (options.detectChanges !== false) {
      this.triggerSyncDetectChanges();
    }
  }

  private readVisibleAttachedSessionTurnResponses(): readonly TurnResponseTurn[] {
    const hasVisibleSessionProjectionTarget = (
      this as unknown as { hasVisibleSessionProjectionTarget?: () => boolean }
    ).hasVisibleSessionProjectionTarget
      ?? ChatEngineService.prototype['hasVisibleSessionProjectionTarget'];
    if (!hasVisibleSessionProjectionTarget.call(this)) {
      return [];
    }

    const getCurrentViewHostProjectionState = (
      (this as unknown as { getCurrentViewHostProjectionState?: ChatEngineService['getCurrentViewHostProjectionState'] })
        .getCurrentViewHostProjectionState
      ?? ChatEngineService.prototype['getCurrentViewHostProjectionState']
    );
    return getCurrentViewHostProjectionState.call(this)?.turnResponses ?? [];
  }

  private canFallbackToVisibleTurnResponses(sessionId: string): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentSessionId = resolveCurrentViewSessionResource.call(this);
    return !!currentSessionId && currentSessionId === targetSessionId;
  }

  private resolveRuntimeSessionIdForOwner(sessionId?: string | null): string {
    const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (explicitSessionId) {
      return explicitSessionId;
    }

    const resolveActiveRuntimeSessionId = (
      this as unknown as { resolveActiveRuntimeSessionId?: () => string }
    ).resolveActiveRuntimeSessionId;
    if (typeof resolveActiveRuntimeSessionId === 'function') {
      return resolveActiveRuntimeSessionId.call(this);
    }

    const currentSessionId = typeof this.chatService?.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : typeof this.sessionId === 'string'
        ? this.sessionId.trim()
        : '';
    if (currentSessionId) {
      return currentSessionId;
    }

    return typeof this.sessionId === 'string'
      ? this.sessionId.trim()
      : '';
  }

  private resolveRuntimeSessionProviderOptions(sessionId?: string | null): HostSessionProviderOptions {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    const runtimeProviderOptions = targetSessionId
      ? this.chatSessionRuntimeStore?.read?.(targetSessionId)?.providerOptions
      : undefined;
    if (runtimeProviderOptions) {
      return normalizeHostSessionProviderOptions(runtimeProviderOptions);
    }

    const currentSessionId = typeof this.chatService?.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    const canUseCurrentVisibleFallback = !targetSessionId || !currentSessionId || targetSessionId === currentSessionId;
    const fallback = canUseCurrentVisibleFallback
      ? this.chatService.getCurrentSessionProviderOptions?.()
        ?? {
          folderPath: this.chatService.currentSessionPath || null,
          permissionMode: this.chatService.currentSessionPermissionMode,
          ...(this.chatService.currentSessionPermissionLevel
            ? { permissionLevel: this.chatService.currentSessionPermissionLevel }
            : {}),
          ...(this.chatService.currentSessionApprovalsReviewer
            ? { approvalsReviewer: this.chatService.currentSessionApprovalsReviewer }
            : {}),
          ...(this.chatService.currentSessionApprovalPolicy
            ? { approvalPolicy: this.chatService.currentSessionApprovalPolicy }
            : {}),
        }
      : null;
    const rawProviderOptions = targetSessionId
      ? this.chatSessionItemsService?.sessionItemController?.getChatSessionProviderOptions?.(targetSessionId)
      : this.chatSessionItemsService?.sessionItemController?.getChatSessionProviderOptions?.();
    return normalizeHostSessionProviderOptions(rawProviderOptions, fallback);
  }

  private rememberRuntimeSessionProviderOptions(
    sessionId: string | null | undefined,
    providerOptions: Partial<HostSessionProviderOptions> | null | undefined,
  ): HostSessionProviderOptions | null {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (!targetSessionId) {
      return null;
    }

    const resolveRuntimeSessionProviderOptions = (
      this as unknown as { resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions }
    ).resolveRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
    const normalized = normalizeHostSessionProviderOptions(
      providerOptions,
      resolveRuntimeSessionProviderOptions.call(this, targetSessionId),
    );
    const patch = {
      providerOptions: normalized,
      debugSummary: {
        providerOptionsPresent: true,
      },
    };
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, patch);
    } else {
      this.chatSessionRuntimeStore?.replaceRuntimeState?.(targetSessionId, patch);
    }
    return normalized;
  }

  private resolveRuntimeSelectedMode(sessionId?: string | null): ChatSelectedMode {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    const runtimeSelectedMode = targetSessionId
      ? this.chatSessionRuntimeStore?.read?.(targetSessionId)?.selectedMode
      : undefined;
    if (runtimeSelectedMode) {
      return normalizeChatSelectedMode(runtimeSelectedMode);
    }

    const currentSessionId = typeof this.chatService?.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    if (!targetSessionId || targetSessionId === currentSessionId) {
      return normalizeChatSelectedMode(this.chatService.selectedMode ?? { modeId: this.chatService.currentMode });
    }

    const inputState = this.chatSessionItemsService?.sessionItemController?.getChatSessionInputState?.(targetSessionId);
    if (inputState) {
      return resolveHostSessionSelectedModeFromMetadata({
        inputState,
      }, {
        resolveModeById: (modeId) => this.chatService.findResolvedModeById?.(modeId),
      });
    }

    return normalizeChatSelectedMode(undefined);
  }

  private rememberRuntimeSelectedMode(
    sessionId: string | null | undefined,
    selectedMode: ChatSelectedMode | null | undefined,
  ): ChatSelectedMode | null {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (!targetSessionId || !selectedMode) {
      return null;
    }

    const normalized = normalizeChatSelectedMode(selectedMode);
    const patch = {
      selectedMode: normalized,
      debugSummary: {
        selectedModePresent: true,
      },
    };
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, patch);
    } else {
      this.chatSessionRuntimeStore?.replaceRuntimeState?.(targetSessionId, patch);
    }
    return normalized;
  }

  private resolveRuntimeResolvedMode(sessionId?: string | null): ChatResolvedMode {
    const resolveRuntimeSelectedMode = (
      this as unknown as { resolveRuntimeSelectedMode?: (sessionId?: string | null) => ChatSelectedMode }
    ).resolveRuntimeSelectedMode
      ?? ChatEngineService.prototype['resolveRuntimeSelectedMode'];
    const selectedMode = resolveRuntimeSelectedMode.call(this, sessionId);
    const currentResolvedMode = this.chatService.currentResolvedMode;
    if (selectedMode.modeId === currentResolvedMode.kind
      && selectedMode.customAgentTarget === currentResolvedMode.customAgentTarget) {
      return currentResolvedMode;
    }

    return (selectedMode.customAgentTarget
      ? this.chatService.findResolvedModeById?.(selectedMode.customAgentTarget)
      : undefined)
      ?? this.chatService.findResolvedModeById?.(selectedMode.modeId)
      ?? resolveChatCurrentMode(selectedMode);
  }

  private buildExecutionSaveTarget(sessionId?: string | null): HostSessionSaveTarget | null {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return null;
    }

    const providerOptions = this.resolveRuntimeSessionProviderOptions(targetSessionId);
    const selectedMode = this.resolveRuntimeSelectedMode(targetSessionId);
    const resolvedMode = this.resolveRuntimeResolvedMode(targetSessionId);
    const projectPathHint = providerOptions.folderPath ?? null;
    const sessionEntry = (this.chatHistoryService as unknown as {
      findEntry?: (sessionId: string, projectPathHint?: string | null) => { title?: string } | null | undefined;
    }).findEntry?.(targetSessionId, projectPathHint)
      ?? (this.chatHistoryService as unknown as {
        findEntry?: (sessionId: string, projectPathHint?: string | null) => { title?: string } | null | undefined;
      }).findEntry?.(targetSessionId);

    const persistedTitle = normalizeChatSessionTitleText(sessionEntry?.title);
    const isCurrentSession = targetSessionId === (this.chatService.currentSessionId ?? '').trim();
    const fallbackTitle = isCurrentSession
      ? normalizeChatSessionTitleText(this.sessionTitle || this.chatService.currentSessionTitle || '')
      : '';
    const currentTitleCandidate = isCurrentSession
      ? (typeof this.chatService.readCurrentSessionTitleCandidate === 'function'
        ? this.chatService.readCurrentSessionTitleCandidate()
        : normalizeChatSessionTitleCandidate({
          text: this.chatService.currentSessionTitle,
          source: this.chatService.currentSessionTitleSource,
          revision: this.chatService.currentSessionTitleRevision,
        }))
      : normalizeChatSessionTitleCandidate(undefined);
    const sessionTitleCandidate = normalizeChatSessionTitleCandidate({
      text: persistedTitle || fallbackTitle,
      source: persistedTitle ? 'restored-custom' : currentTitleCandidate.source,
      revision: currentTitleCandidate.revision,
    });
    const sessionType = this.chatSessionItemsService.sessionItemController.getChatSessionType?.(targetSessionId, projectPathHint)
      ?? this.chatService.currentSessionType;

    return {
      sessionId: targetSessionId,
      sessionTitleCandidate,
      sessionType,
      providerOptions,
      selectedMode,
      resolvedMode,
      model: this.currentModel ? { ...this.currentModel } : null,
    };
  }

  private readSessionTurnResponses(
    sessionId: string,
    _options: { readonly source?: 'runtime' | 'visibleAttach' | 'runtimeOrVisibleAttach' } = {},
  ): readonly TurnResponseTurn[] {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return [];
    }

    const modelStore = (this as unknown as {
      chatSessionModelStore?: Pick<ChatSessionModelStoreService, 'get'>;
    }).chatSessionModelStore;
    const model = modelStore?.get?.(targetSessionId);
    const turnResponses = model?.turnResponses;
    return Array.isArray(turnResponses) ? turnResponses : [];
  }

  private resolveActiveRuntimeSessionId(): string {
    if (this.runtimeSessionOwnerOverride) {
      return this.runtimeSessionOwnerOverride;
    }

    const currentSessionId = typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    if (currentSessionId) {
      return currentSessionId;
    }

    return typeof this.sessionId === 'string'
      ? this.sessionId.trim()
      : '';
  }

  private createRuntimeScopedContextBudgetService(): ContextBudgetService {
    const engine = this;
    const scoped = {
      getSnapshot(): ContextBudgetSnapshot {
        const sessionId = engine.resolveActiveRuntimeSessionId();
        return engine.chatSessionRuntimeStore.read(sessionId)?.viewOverlay?.contextBudgetSnapshot
          ?? engine.contextBudgetService.getSnapshot();
      },
      get budget$() {
        return engine.contextBudgetService.budget$;
      },
      get maxContextTokens() {
        return engine.contextBudgetService.maxContextTokens;
      },
      set maxContextTokens(value: number) {
        engine.contextBudgetService.maxContextTokens = value;
      },
      get compressionThreshold() {
        return engine.contextBudgetService.compressionThreshold;
      },
      get summarizationThreshold() {
        return engine.contextBudgetService.summarizationThreshold;
      },
      updateModelContextSize(model: Parameters<ContextBudgetService['updateModelContextSize']>[0]): void {
        const sessionId = engine.resolveActiveRuntimeSessionId();
        if (engine.shouldProjectRuntimeViewStateToVisibleOwner(sessionId)) {
          engine.contextBudgetService.updateModelContextSize(model);
          engine.syncRuntimeViewOverlayFromVisibleServices(sessionId);
        }
      },
      refreshLocalEstimate(
        messages: Parameters<ContextBudgetService['refreshLocalEstimate']>[0],
        tools?: Parameters<ContextBudgetService['refreshLocalEstimate']>[1],
      ): void {
        const sessionId = engine.resolveActiveRuntimeSessionId();
        if (engine.shouldProjectRuntimeViewStateToVisibleOwner(sessionId)) {
          engine.contextBudgetService.refreshLocalEstimate(messages, tools);
          engine.syncRuntimeViewOverlayFromVisibleServices(sessionId);
        }
      },
      applyLexBudgetEvent(
        maxTokens: number,
        usedTokens: number,
        extra?: LexContextBudgetSnapshotExtra,
      ): void {
        const sessionId = engine.resolveActiveRuntimeSessionId();
        const snapshot = createLexContextBudgetSnapshot({
          maxTokens,
          usedTokens,
          fallbackCompressionThreshold: engine.contextBudgetService.compressionThreshold,
          fallbackSummarizationThreshold: engine.contextBudgetService.summarizationThreshold,
          extra,
        });
        engine.syncRuntimeViewOverlay(sessionId, {
          contextBudgetSnapshot: snapshot,
          chatInputNotice: engine.chatInputNoticeStateService.getInputNotice(),
          updatedAt: Date.now(),
        });

        if (engine.shouldProjectRuntimeViewStateToVisibleOwner(sessionId)) {
          engine.contextBudgetService.applyLexBudgetEvent(maxTokens, usedTokens, extra);
          engine.syncRuntimeViewOverlayFromVisibleServices(sessionId);
        }
      },
      reset(): void {
        const sessionId = engine.resolveActiveRuntimeSessionId();
        if (engine.shouldProjectRuntimeViewStateToVisibleOwner(sessionId)) {
          engine.contextBudgetService.reset();
          engine.syncRuntimeViewOverlayFromVisibleServices(sessionId);
          return;
        }

        engine.syncRuntimeViewOverlay(sessionId, null);
      },
    };

    return scoped as unknown as ContextBudgetService;
  }

  private readVisibleSessionRequestInProgress(sessionId?: string | null): boolean {
    const explicitSessionId = typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
    const currentSessionId = typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    const targetSessionId = explicitSessionId || currentSessionId;
    if (!targetSessionId) {
      return false;
    }

    if (this.chatSessionRuntimeRegistry && typeof this.chatSessionRuntimeRegistry.readHandle === 'function') {
      const activeHandle = this.chatSessionRuntimeRegistry.readHandle(targetSessionId);
      return activeHandle?.requestInProgress === true;
    }

    const runtimeRequestInProgress = this.chatSessionRuntimeStore?.read?.(targetSessionId)?.requestInProgress;
    return runtimeRequestInProgress === true;
  }

  private readPendingFollowupYieldRequested(sessionId?: string | null): boolean {
    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    if (!targetSessionId) {
      return false;
    }

    const getPendingFollowupRequests = (
      this as unknown as { getPendingFollowupRequests?: (sessionId?: string | null) => readonly PendingFollowupRequest[] }
    ).getPendingFollowupRequests
      ?? ChatEngineService.prototype['getPendingFollowupRequests'];
    if (typeof getPendingFollowupRequests !== 'function') {
      return false;
    }

    const hasSteeringPending = getPendingFollowupRequests.call(this, targetSessionId)
      .some(request => request.kind === 'steering');
    if (!hasSteeringPending) {
      return false;
    }

    const readVisibleSessionRequestInProgress = (
      this as unknown as { readVisibleSessionRequestInProgress?: (currentSessionId?: string | null) => boolean }
    ).readVisibleSessionRequestInProgress
      ?? ChatEngineService.prototype['readVisibleSessionRequestInProgress'];
    return typeof readVisibleSessionRequestInProgress === 'function'
      ? readVisibleSessionRequestInProgress.call(this, targetSessionId)
      : false;
  }

  getPendingFollowupRequests(sessionId?: string | null): readonly PendingFollowupRequest[] {
    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    if (!targetSessionId) {
      return [];
    }

    const readPendingFollowupQueue = (
      this as unknown as { readPendingFollowupQueue?: (sessionId: string) => readonly PendingFollowupRequest[] }
    ).readPendingFollowupQueue
      ?? ChatEngineService.prototype['readPendingFollowupQueue'];
    return readPendingFollowupQueue.call(this, targetSessionId);
  }

  private readPendingFollowupQueue(sessionId: string): readonly PendingFollowupRequest[] {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return [];
    }

    const model = this.chatSessionModelStore?.get?.(targetSessionId);
    if (model) {
      const readModelQueue = (model as unknown as {
        getPendingFollowupRequests?: () => readonly PendingFollowupRequest[];
      }).getPendingFollowupRequests;
      if (typeof readModelQueue !== 'function') {
        const readLegacyPendingFollowupQueue = (
          this as unknown as { readLegacyPendingFollowupQueue?: (sessionId: string) => readonly PendingFollowupRequest[] }
        ).readLegacyPendingFollowupQueue
          ?? ChatEngineService.prototype['readLegacyPendingFollowupQueue'];
        return readLegacyPendingFollowupQueue.call(this, targetSessionId);
      }

      const modelQueue = readModelQueue.call(model);
      if (modelQueue.length > 0) {
        return modelQueue;
      }

      const legacyQueue = this.queuedFollowupMessagesBySession?.get?.(targetSessionId);
      if (legacyQueue?.length) {
        const migratedQueue = model.replacePendingFollowupRequests(legacyQueue);
        this.queuedFollowupMessagesBySession.delete(targetSessionId);
        return migratedQueue;
      }

      return [];
    }

    const readLegacyPendingFollowupQueue = (
      this as unknown as { readLegacyPendingFollowupQueue?: (sessionId: string) => readonly PendingFollowupRequest[] }
    ).readLegacyPendingFollowupQueue
      ?? ChatEngineService.prototype['readLegacyPendingFollowupQueue'];
    return readLegacyPendingFollowupQueue.call(this, targetSessionId);
  }

  private readLegacyPendingFollowupQueue(sessionId: string): readonly PendingFollowupRequest[] {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return [];
    }

    const queuedFollowupMessages = this.queuedFollowupMessagesBySession?.get?.(targetSessionId);
    if (queuedFollowupMessages?.length) {
      return queuedFollowupMessages.map(request => clonePendingFollowupRequest(request));
    }

    const runtimePendingFollowupRequests = this.chatSessionRuntimeStore?.read?.(targetSessionId)?.pendingFollowupRequests;
    return Array.isArray(runtimePendingFollowupRequests)
      ? runtimePendingFollowupRequests.map(request => clonePendingFollowupRequest(request))
      : [];
  }

  private replacePendingFollowupQueue(
    sessionId: string,
    requests: readonly PendingFollowupRequest[] | null | undefined,
  ): readonly PendingFollowupRequest[] {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return [];
    }

    const model = this.chatSessionModelStore?.get?.(targetSessionId);
    if (model && typeof (model as unknown as {
      replacePendingFollowupRequests?: unknown;
    }).replacePendingFollowupRequests === 'function') {
      this.queuedFollowupMessagesBySession.delete(targetSessionId);
      return model.replacePendingFollowupRequests(requests);
    }

    const nextQueue = Array.isArray(requests)
      ? requests.map(request => clonePendingFollowupRequest(request))
      : [];
    if (nextQueue.length > 0) {
      this.queuedFollowupMessagesBySession.set(targetSessionId, nextQueue);
    } else {
      this.queuedFollowupMessagesBySession.delete(targetSessionId);
    }
    return nextQueue.map(request => clonePendingFollowupRequest(request));
  }

  private enqueuePendingFollowupQueue(
    sessionId: string,
    request: PendingFollowupRequest,
  ): readonly PendingFollowupRequest[] {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return [];
    }

    const model = this.chatSessionModelStore?.get?.(targetSessionId);
    if (model && typeof (model as unknown as {
      enqueuePendingFollowupRequest?: unknown;
    }).enqueuePendingFollowupRequest === 'function') {
      this.queuedFollowupMessagesBySession.delete(targetSessionId);
      return model.enqueuePendingFollowupRequest(request);
    }

    const queue = this.queuedFollowupMessagesBySession.get(targetSessionId) ?? [];
    if (request.kind === 'steering') {
      let insertIndex = 0;
      for (let index = 0; index < queue.length; index += 1) {
        if (queue[index].kind === 'steering') {
          insertIndex = index + 1;
        } else {
          break;
        }
      }
      queue.splice(insertIndex, 0, clonePendingFollowupRequest(request));
    } else {
      queue.push(clonePendingFollowupRequest(request));
    }
    this.queuedFollowupMessagesBySession.set(targetSessionId, queue);
    return queue.map(item => clonePendingFollowupRequest(item));
  }

  private removePendingFollowupQueueRequest(sessionId: string, requestId: string): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!targetSessionId || !normalizedRequestId) {
      return false;
    }

    const model = this.chatSessionModelStore?.get?.(targetSessionId);
    if (model && typeof (model as unknown as {
      removePendingFollowupRequest?: unknown;
    }).removePendingFollowupRequest === 'function') {
      this.queuedFollowupMessagesBySession.delete(targetSessionId);
      return model.removePendingFollowupRequest(normalizedRequestId);
    }

    const queue = this.queuedFollowupMessagesBySession.get(targetSessionId);
    if (!queue?.length) {
      return false;
    }

    const nextQueue = queue.filter(request => request.id !== normalizedRequestId);
    if (nextQueue.length === queue.length) {
      return false;
    }

    const replacePendingFollowupQueue = (
      this as unknown as {
        replacePendingFollowupQueue?: (
          sessionId: string,
          requests: readonly PendingFollowupRequest[] | null | undefined,
        ) => readonly PendingFollowupRequest[];
      }
    ).replacePendingFollowupQueue
      ?? ChatEngineService.prototype['replacePendingFollowupQueue'];
    replacePendingFollowupQueue.call(this, targetSessionId, nextQueue);
    return true;
  }

  private getPendingFollowupQueueSessionIds(): readonly string[] {
    const sessionIds = new Set<string>();
    for (const model of this.chatSessionModelStore?.values?.() ?? []) {
      const getPendingFollowupRequests = (model as unknown as {
        getPendingFollowupRequests?: () => readonly PendingFollowupRequest[];
      }).getPendingFollowupRequests;
      if (typeof getPendingFollowupRequests === 'function'
        && getPendingFollowupRequests.call(model).length > 0) {
        sessionIds.add(model.sessionResource);
      }
    }

    for (const sessionId of this.queuedFollowupMessagesBySession?.keys?.() ?? []) {
      if (typeof sessionId === 'string' && sessionId.trim()) {
        sessionIds.add(sessionId.trim());
      }
    }

    for (const sessionId of this.chatSessionRuntimeStore?.getSessionIds?.() ?? []) {
      if (this.chatSessionModelStore?.has?.(sessionId)) {
        continue;
      }
      const pendingRequests = this.chatSessionRuntimeStore.read(sessionId)?.pendingFollowupRequests;
      if (Array.isArray(pendingRequests) && pendingRequests.length > 0) {
        sessionIds.add(sessionId);
      }
    }

    return [...sessionIds];
  }

  hasPendingFollowupRequests(sessionId?: string | null): boolean {
    return this.getPendingFollowupRequests(sessionId).length > 0;
  }

  getSessionActionState(sessionId?: string | null): ChatSessionActionState {
    const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const targetSessionId = explicitSessionId || resolveCurrentViewSessionResource.call(this);
    const readSessionInputValue = (
      this as unknown as { readSessionInputValue?: (sessionId?: string | null) => string | null }
    ).readSessionInputValue
      ?? ChatEngineService.prototype['readSessionInputValue'];
    const draftTextValue = targetSessionId
      ? readSessionInputValue.call(this, targetSessionId)
      : this.legacyInputValue;
    const draftText = (draftTextValue ?? '').trim();
    const draftState = draftText.length > 0 ? 'hasDraft' as const : 'empty' as const;
    const pendingRequests = targetSessionId ? this.getPendingFollowupRequests(targetSessionId) : [];
    const steeringCount = pendingRequests.filter(request => request.kind === 'steering').length;
    const runtimeState = targetSessionId ? this.chatSessionRuntimeStore?.read?.(targetSessionId) : undefined;
    const hasActiveRequest = targetSessionId ? this.readVisibleSessionRequestInProgress(targetSessionId) : false;

    let activeState: ChatSessionActionState['activeState'] = 'idle';
    if (runtimeState?.status === 'needs_input') {
      activeState = 'needsInput';
    } else if (hasActiveRequest) {
      activeState = this.isCancelled && targetSessionId === this.resolveActiveRuntimeSessionId()
        ? 'stopping'
        : 'running';
    }

    const canStop = activeState === 'running' || activeState === 'stopping';
    const canSend = draftState === 'hasDraft' && activeState === 'idle';
    const canQueue = draftState === 'hasDraft' && (activeState === 'running' || activeState === 'stopping');
    const primaryIcon = canStop ? 'stop' : 'send';

    return createChatSessionActionState({
      activeState,
      draftState,
      pendingCount: pendingRequests.length,
      steeringCount,
      canSend,
      canQueue,
      canStop,
      canSteer: canQueue,
      primaryIcon,
      secondaryIcon: null,
      tooltip: canStop
        ? 'Stop session'
        : canSend
          ? 'Send message'
          : 'Type a message to send',
    });
  }

  setPendingFollowupRequests(
    sessionId: string | null | undefined,
    requests: readonly { requestId: string; kind: ChatPendingRequestKind }[],
  ): readonly PendingFollowupRequest[] {
    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    if (!targetSessionId) {
      return [];
    }

    const readPendingFollowupQueue = (
      this as unknown as { readPendingFollowupQueue?: (sessionId: string) => readonly PendingFollowupRequest[] }
    ).readPendingFollowupQueue
      ?? ChatEngineService.prototype['readPendingFollowupQueue'];
    const replacePendingFollowupQueue = (
      this as unknown as {
        replacePendingFollowupQueue?: (
          sessionId: string,
          requests: readonly PendingFollowupRequest[] | null | undefined,
        ) => readonly PendingFollowupRequest[];
      }
    ).replacePendingFollowupQueue
      ?? ChatEngineService.prototype['replacePendingFollowupQueue'];
    const existingQueue = readPendingFollowupQueue.call(this, targetSessionId);
    const existingMap = new Map<string, PendingFollowupRequest>(
      existingQueue.map(request => [request.id, request]),
    );
    const nextQueue: PendingFollowupRequest[] = [];

    for (const request of requests) {
      const requestId = typeof request?.requestId === 'string' ? request.requestId.trim() : '';
      if (!requestId) {
        continue;
      }

      const existing = existingMap.get(requestId);
      if (!existing) {
        continue;
      }

      const nextRequest = existing.kind === request.kind
        ? existing
        : { ...existing, kind: request.kind };
      nextQueue.push(clonePendingFollowupRequest(nextRequest));
    }

    const replacedQueue = replacePendingFollowupQueue.call(this, targetSessionId, nextQueue);

    const syncPendingFollowupRuntimeState = (
      this as unknown as { syncPendingFollowupRuntimeState?: (sessionId?: string | null) => void }
    ).syncPendingFollowupRuntimeState
      ?? ChatEngineService.prototype['syncPendingFollowupRuntimeState'];
    syncPendingFollowupRuntimeState.call(this, targetSessionId);

    return replacedQueue.map(request => clonePendingFollowupRequest(request));
  }

  removePendingFollowupRequest(sessionId: string | null | undefined, requestId: string): boolean {
    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!targetSessionId || !normalizedRequestId) {
      return false;
    }

    const removePendingFollowupQueueRequest = (
      this as unknown as { removePendingFollowupQueueRequest?: (sessionId: string, requestId: string) => boolean }
    ).removePendingFollowupQueueRequest
      ?? ChatEngineService.prototype['removePendingFollowupQueueRequest'];
    const removed = removePendingFollowupQueueRequest.call(this, targetSessionId, normalizedRequestId);
    if (!removed) {
      return false;
    }

    const syncPendingFollowupRuntimeState = (
      this as unknown as { syncPendingFollowupRuntimeState?: (sessionId?: string | null) => void }
    ).syncPendingFollowupRuntimeState
      ?? ChatEngineService.prototype['syncPendingFollowupRuntimeState'];
    syncPendingFollowupRuntimeState.call(this, targetSessionId);

    return true;
  }

  clearPendingFollowupRequests(sessionId?: string | null): void {
    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    if (!targetSessionId) {
      return;
    }

    const replacePendingFollowupQueue = (
      this as unknown as {
        replacePendingFollowupQueue?: (
          sessionId: string,
          requests: readonly PendingFollowupRequest[] | null | undefined,
        ) => readonly PendingFollowupRequest[];
      }
    ).replacePendingFollowupQueue
      ?? ChatEngineService.prototype['replacePendingFollowupQueue'];
    replacePendingFollowupQueue.call(this, targetSessionId, []);
    const syncPendingFollowupRuntimeState = (
      this as unknown as { syncPendingFollowupRuntimeState?: (sessionId?: string | null) => void }
    ).syncPendingFollowupRuntimeState
      ?? ChatEngineService.prototype['syncPendingFollowupRuntimeState'];
    syncPendingFollowupRuntimeState.call(this, targetSessionId);
  }

  async sendPendingFollowupImmediately(sessionId: string | null | undefined, requestId: string): Promise<boolean> {
    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!targetSessionId || !normalizedRequestId) {
      return false;
    }

    const getPendingFollowupRequests = (
      this as unknown as { getPendingFollowupRequests?: (sessionId?: string | null) => readonly PendingFollowupRequest[] }
    ).getPendingFollowupRequests
      ?? ChatEngineService.prototype['getPendingFollowupRequests'];
    const setPendingFollowupRequests = (
      this as unknown as {
        setPendingFollowupRequests?: (
          sessionId: string | null | undefined,
          requests: readonly { requestId: string; kind: ChatPendingRequestKind }[],
        ) => readonly PendingFollowupRequest[];
      }
    ).setPendingFollowupRequests
      ?? ChatEngineService.prototype['setPendingFollowupRequests'];
    const readVisibleSessionRequestInProgress = (
      this as unknown as { readVisibleSessionRequestInProgress?: (sessionId?: string | null) => boolean }
    ).readVisibleSessionRequestInProgress
      ?? ChatEngineService.prototype['readVisibleSessionRequestInProgress'];
    const stopSessionAction = (
      this as unknown as { stopSessionAction?: (sessionId?: string | null) => boolean }
    ).stopSessionAction
      ?? ChatEngineService.prototype['stopSessionAction'];
    const processPendingFollowupRequests = (
      this as unknown as { processPendingFollowupRequests?: (sessionId?: string | null) => Promise<boolean> }
    ).processPendingFollowupRequests
      ?? ChatEngineService.prototype['processPendingFollowupRequests'];
    const runtimeState = this.chatSessionRuntimeStore?.read?.(targetSessionId);

    if (typeof getPendingFollowupRequests !== 'function' || typeof setPendingFollowupRequests !== 'function') {
      return false;
    }

    const pendingRequests = getPendingFollowupRequests.call(this, targetSessionId);
    const targetIndex = pendingRequests.findIndex(request => request.id === normalizedRequestId);
    if (targetIndex === -1) {
      return false;
    }

    const targetRequest = pendingRequests[targetIndex];
    setPendingFollowupRequests.call(this, targetSessionId, [
      { requestId: targetRequest.id, kind: targetRequest.kind },
      ...pendingRequests.filter((_, index) => index !== targetIndex).map(request => ({
        requestId: request.id,
        kind: request.kind,
      })),
    ]);

    const requestInProgress = typeof readVisibleSessionRequestInProgress === 'function'
      && readVisibleSessionRequestInProgress.call(this, targetSessionId);
    console.info('[AilyChat][RequestStateTrace]', {
      phase: 'runNext',
      action: 'run-next',
      sessionId: targetSessionId,
      requestId: targetRequest.id,
      state: runtimeState?.status ?? (requestInProgress ? 'running' : 'idle'),
      pendingCount: pendingRequests.length,
      queueKind: targetRequest.kind,
      interruptingActiveRequest: requestInProgress,
    });

    if (requestInProgress) {
      return typeof stopSessionAction === 'function'
        ? stopSessionAction.call(this, targetSessionId)
        : false;
    }

    return typeof processPendingFollowupRequests === 'function'
      ? processPendingFollowupRequests.call(this, targetSessionId)
      : false;
  }

  queueFollowupMessage(
    content: string,
    sessionId?: string | null,
    options?: { kind?: ChatPendingRequestKind },
  ): boolean {
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    if (!normalizedContent) {
      return false;
    }

    const targetSessionId = resolveOptionalUiSessionOwner(this, sessionId);
    if (!targetSessionId) {
      return false;
    }

    const kind: ChatPendingRequestKind = options?.kind === 'steering' ? 'steering' : 'queued';
    const prepared = this.sendCoordinator.capturePendingSend(normalizedContent, targetSessionId);
    if (!prepared) {
      return false;
    }

    const pendingRequest: PendingFollowupRequest = {
      id: `pending-followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: normalizedContent,
      kind,
      prepared: clonePreparedPendingFollowupRequest(prepared),
    };
    const enqueuePendingFollowupQueue = (
      this as unknown as {
        enqueuePendingFollowupQueue?: (
          sessionId: string,
          request: PendingFollowupRequest,
        ) => readonly PendingFollowupRequest[];
      }
    ).enqueuePendingFollowupQueue
      ?? ChatEngineService.prototype['enqueuePendingFollowupQueue'];
    const queue = enqueuePendingFollowupQueue.call(this, targetSessionId, pendingRequest);
    const readVisibleSessionRequestInProgress = (
      this as unknown as { readVisibleSessionRequestInProgress?: (sessionId?: string | null) => boolean }
    ).readVisibleSessionRequestInProgress
      ?? ChatEngineService.prototype['readVisibleSessionRequestInProgress'];
    const runtimeState = this.chatSessionRuntimeStore?.read?.(targetSessionId);
    console.info('[AilyChat][RequestStateTrace]', {
      phase: 'queue',
      action: 'queue',
      sessionId: targetSessionId,
      requestId: readPreparedPendingFollowupRequestId(prepared),
      state: runtimeState?.status
        ?? (typeof readVisibleSessionRequestInProgress === 'function'
          && readVisibleSessionRequestInProgress.call(this, targetSessionId)
            ? 'running'
            : 'idle'),
      queueKind: kind,
      pendingCount: queue.length,
      textLength: normalizedContent.length,
    });
    const syncPendingFollowupRuntimeState = (
      this as unknown as { syncPendingFollowupRuntimeState?: (sessionId?: string | null) => void }
    ).syncPendingFollowupRuntimeState
      ?? ChatEngineService.prototype['syncPendingFollowupRuntimeState'];
    syncPendingFollowupRuntimeState.call(this, targetSessionId);
    this.pendingEditFeedback = null;

    const currentViewSessionId = resolveOptionalUiSessionOwner(this, null);
    if (currentViewSessionId === targetSessionId) {
      const setSessionInputValue = (
        this as unknown as { setSessionInputValue?: (sessionId: string | null | undefined, value: unknown) => boolean }
      ).setSessionInputValue
        ?? ChatEngineService.prototype['setSessionInputValue'];
      setSessionInputValue.call(this, targetSessionId, '');
      this.triggerSyncDetectChanges();
    }

    return true;
  }

  private async processPendingFollowupRequests(sessionId?: string | null): Promise<boolean> {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const readVisibleSessionRequestInProgress = (
      this as unknown as { readVisibleSessionRequestInProgress?: (sessionId?: string | null) => boolean }
    ).readVisibleSessionRequestInProgress
      ?? ChatEngineService.prototype['readVisibleSessionRequestInProgress'];
    const sendPendingFollowupRequest = (
      this as unknown as {
        sendPendingFollowupRequest?: (sessionId: string, requests: readonly PendingFollowupRequest[]) => Promise<void>;
      }
    ).sendPendingFollowupRequest
      ?? ChatEngineService.prototype['sendPendingFollowupRequest'];
    const runtimeState = this.chatSessionRuntimeStore?.read?.(targetSessionId);
    const syncRuntimeRequestHandleMetadata = (
      this as unknown as { syncRuntimeRequestHandleMetadata?: (sessionId?: string | null) => void }
    ).syncRuntimeRequestHandleMetadata
      ?? ChatEngineService.prototype['syncRuntimeRequestHandleMetadata'];
    if (!targetSessionId) {
      return false;
    }

    if (typeof readVisibleSessionRequestInProgress === 'function'
      && readVisibleSessionRequestInProgress.call(this, targetSessionId)) {
      return false;
    }

    if (runtimeState?.status === 'needs_input') {
      return false;
    }

    if (this.chatSessionRuntimeRegistry) {
      syncRuntimeRequestHandleMetadata.call(this, targetSessionId);
      if (!this.chatSessionRuntimeRegistry.canStartRequest(targetSessionId)) {
        return false;
      }
    }

    const readPendingFollowupQueue = (
      this as unknown as { readPendingFollowupQueue?: (sessionId: string) => readonly PendingFollowupRequest[] }
    ).readPendingFollowupQueue
      ?? ChatEngineService.prototype['readPendingFollowupQueue'];
    const replacePendingFollowupQueue = (
      this as unknown as {
        replacePendingFollowupQueue?: (
          sessionId: string,
          requests: readonly PendingFollowupRequest[] | null | undefined,
        ) => readonly PendingFollowupRequest[];
      }
    ).replacePendingFollowupQueue
      ?? ChatEngineService.prototype['replacePendingFollowupQueue'];
    const queue = [...readPendingFollowupQueue.call(this, targetSessionId)];
    if (!queue?.length) {
      return false;
    }

    const pendingCountBeforeDequeue = queue.length;
    const nextRequests: PendingFollowupRequest[] = [];
    if (queue[0].kind === 'steering') {
      for (const request of queue) {
        if (request.kind !== 'steering') {
          break;
        }
        nextRequests.push(request);
      }
    } else {
      nextRequests.push(queue[0]);
    }
    if (!nextRequests.length) {
      return false;
    }

    console.info('[AilyChat][RequestStateTrace]', {
      phase: 'processingQueued',
      action: 'flush',
      sessionId: targetSessionId,
      requestId: nextRequests.length === 1 ? readPreparedPendingFollowupRequestId(nextRequests[0].prepared) : null,
      state: runtimeState?.status ?? 'idle',
      pendingCount: pendingCountBeforeDequeue,
      nextRequestCount: nextRequests.length,
      nextRequestKinds: nextRequests.map(request => request.kind),
      nextRequestIds: nextRequests.map(request => readPreparedPendingFollowupRequestId(request.prepared)),
    });

    queue.splice(0, nextRequests.length);
    replacePendingFollowupQueue.call(this, targetSessionId, queue);

    const syncPendingFollowupRuntimeState = (
      this as unknown as { syncPendingFollowupRuntimeState?: (sessionId?: string | null) => void }
    ).syncPendingFollowupRuntimeState
      ?? ChatEngineService.prototype['syncPendingFollowupRuntimeState'];
    syncPendingFollowupRuntimeState.call(this, targetSessionId);

    try {
      await sendPendingFollowupRequest.call(this, targetSessionId, nextRequests);
    } catch (error) {
      console.warn('[AilyChat][Queue] follow-up flush failed:', error);
      return false;
    }

    return true;
  }

  private async processRunnablePendingFollowupRequests(excludeSessionId?: string | null): Promise<boolean> {
    const getPendingFollowupQueueSessionIds = (
      this as unknown as { getPendingFollowupQueueSessionIds?: () => readonly string[] }
    ).getPendingFollowupQueueSessionIds
      ?? ChatEngineService.prototype['getPendingFollowupQueueSessionIds'];
    const syncRuntimeRequestHandleMetadata = (
      this as unknown as { syncRuntimeRequestHandleMetadata?: (sessionId?: string | null) => void }
    ).syncRuntimeRequestHandleMetadata
      ?? ChatEngineService.prototype['syncRuntimeRequestHandleMetadata'];
    const queuedSessionIds = getPendingFollowupQueueSessionIds.call(this);
    if (queuedSessionIds.length === 0) {
      return false;
    }

    const excludedSessionId = typeof excludeSessionId === 'string' ? excludeSessionId.trim() : '';
    let processed = false;
    for (const sessionId of queuedSessionIds) {
      const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
      if (!targetSessionId || targetSessionId === excludedSessionId) {
        continue;
      }

      if (this.readVisibleSessionRequestInProgress(targetSessionId)) {
        continue;
      }

      if (this.chatSessionRuntimeRegistry) {
        syncRuntimeRequestHandleMetadata.call(this, targetSessionId);
        if (!this.chatSessionRuntimeRegistry.canStartRequest(targetSessionId)) {
          continue;
        }
      }

      processed = (await this.processPendingFollowupRequests(targetSessionId)) || processed;
    }

    return processed;
  }

  private syncPendingFollowupRuntimeState(sessionId?: string | null): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return;
    }

    const readPendingFollowupQueue = (
      this as unknown as { readPendingFollowupQueue?: (sessionId: string) => readonly PendingFollowupRequest[] }
    ).readPendingFollowupQueue
      ?? ChatEngineService.prototype['readPendingFollowupQueue'];
    const pendingFollowupRequests = readPendingFollowupQueue.call(this, targetSessionId)
      .map(request => clonePendingFollowupRequest(request));
    const readPendingFollowupYieldRequested = (
      this as unknown as { readPendingFollowupYieldRequested?: (sessionId?: string | null) => boolean }
    ).readPendingFollowupYieldRequested
      ?? ChatEngineService.prototype['readPendingFollowupYieldRequested'];
    const runtimeStatePatch = {
      pendingFollowupRequests: pendingFollowupRequests.length > 0 ? pendingFollowupRequests : null,
      yieldRequested: typeof readPendingFollowupYieldRequested === 'function'
        ? readPendingFollowupYieldRequested.call(this, targetSessionId)
        : false,
    };

    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, runtimeStatePatch);
    } else if (typeof this.chatSessionRuntimeStore?.replaceRuntimeState === 'function') {
      this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, runtimeStatePatch);
    }
  }

  private projectRestoredRuntimeAuxiliary(
    sessionId: string,
    auxiliary: {
      pendingFollowupRequests?: readonly PendingFollowupRequest[];
      yieldRequested?: boolean;
    } | null | undefined,
  ): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return;
    }

    const pendingFollowupRequests = Array.isArray(auxiliary?.pendingFollowupRequests)
      && auxiliary.pendingFollowupRequests.length > 0
      ? (globalThis.structuredClone
        ? globalThis.structuredClone(auxiliary.pendingFollowupRequests)
        : JSON.parse(JSON.stringify(auxiliary.pendingFollowupRequests))) as readonly PendingFollowupRequest[]
      : null;
    const replacePendingFollowupQueue = (
      this as unknown as {
        replacePendingFollowupQueue?: (
          sessionId: string,
          requests: readonly PendingFollowupRequest[] | null | undefined,
        ) => readonly PendingFollowupRequest[];
      }
    ).replacePendingFollowupQueue
      ?? ChatEngineService.prototype['replacePendingFollowupQueue'];
    replacePendingFollowupQueue.call(this, targetSessionId, pendingFollowupRequests ?? []);
    const runtimeStatePatch = {
      pendingFollowupRequests,
      yieldRequested: auxiliary?.yieldRequested === true,
    };

    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, runtimeStatePatch);
      return;
    }

    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, runtimeStatePatch);
  }

  private async sendPendingFollowupRequest(
    sessionId: string,
    requests: readonly PendingFollowupRequest[],
  ): Promise<void> {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalizedSessionId || requests.length === 0) {
      return;
    }

    const prepared = mergePreparedPendingFollowupRequests(requests);
    const runtimeOwnerSessionId = typeof prepared.runtimeOwnerSessionId === 'string' && prepared.runtimeOwnerSessionId.trim().length > 0
      ? prepared.runtimeOwnerSessionId.trim()
      : normalizedSessionId;
    const providerOptionsKey = typeof prepared.providerOptionsKey === 'string' && prepared.providerOptionsKey.trim().length > 0
      ? prepared.providerOptionsKey.trim()
      : null;

    await this.runWithRuntimeSessionOwner(runtimeOwnerSessionId, async () => {
      if (providerOptionsKey) {
        const agentProviderOptionsKey = createAgentProviderOptionsKeyWithRuntime(
          providerOptionsKey,
          this.currentAgentRuntimeMode ?? this.chatService?.currentAgentRuntimeMode,
        );
        if (this.lexStream.agent.isConfiguredFor?.(runtimeOwnerSessionId, agentProviderOptionsKey)) {
          await this.lexStream.agent.ensureAgent(runtimeOwnerSessionId, agentProviderOptionsKey);
        } else {
          await this.lexStream.agent.ensureAgent(runtimeOwnerSessionId, agentProviderOptionsKey);
        }
      } else {
        await this.ensureRuntimeAgentForSession(runtimeOwnerSessionId);
      }
      const executePreparedUserSend = (
        this as unknown as {
          executePreparedUserSend?: (
            runtimeOwnerSessionId: string | null | undefined,
            preparedRequest: PreparedPendingFollowupRequest,
            options?: { clearInput?: boolean; activatePreparedUserTurn?: boolean },
          ) => Promise<void>;
        }
      ).executePreparedUserSend
        ?? ChatEngineService.prototype['executePreparedUserSend'];
      await executePreparedUserSend.call(this, runtimeOwnerSessionId, prepared, {
        clearInput: false,
        activatePreparedUserTurn: true,
      });
    });
  }

  private syncRuntimeViewOverlayFromVisibleServices(sessionId?: string | null): ChatSessionRuntimeViewOverlay | null {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : this.resolveActiveRuntimeSessionId();
    if (!targetSessionId) {
      return null;
    }

    const contextBudgetSnapshot = this.contextBudgetViewService?.getSnapshot() ?? null;
    const chatInputNotice = this.chatInputNoticeStateService?.getInputNotice() ?? null;
    const isMeaningfulContextBudgetSnapshot = (
      this as unknown as { isMeaningfulContextBudgetSnapshot?: (snapshot: ContextBudgetSnapshot | null | undefined) => snapshot is ContextBudgetSnapshot }
    ).isMeaningfulContextBudgetSnapshot
      ?? ChatEngineService.prototype['isMeaningfulContextBudgetSnapshot'];
    const hasContextBudget = isMeaningfulContextBudgetSnapshot.call(this, contextBudgetSnapshot);
    const overlay = hasContextBudget || !!chatInputNotice
      ? {
          ...(hasContextBudget ? { contextBudgetSnapshot } : {}),
          ...(chatInputNotice ? { chatInputNotice } : {}),
          updatedAt: Date.now(),
        } satisfies ChatSessionRuntimeViewOverlay
      : null;
    const syncRuntimeViewOverlay = (
      this as unknown as {
        syncRuntimeViewOverlay?: (
          sessionId: string | null | undefined,
          overlay: ChatSessionRuntimeViewOverlay | null,
        ) => ChatSessionRuntimeViewOverlay | null;
      }
    ).syncRuntimeViewOverlay
      ?? ChatEngineService.prototype['syncRuntimeViewOverlay'];
    return syncRuntimeViewOverlay.call(this, targetSessionId, overlay);
  }

  private syncRuntimeViewOverlay(
    sessionId: string | null | undefined,
    overlay: ChatSessionRuntimeViewOverlay | null,
  ): ChatSessionRuntimeViewOverlay | null {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : '';
    if (!targetSessionId) {
      return null;
    }

    const patch = {
      viewOverlay: overlay,
      debugSummary: {
        contextBudgetOverlayPresent: !!overlay?.contextBudgetSnapshot,
        inputNoticeOverlayPresent: !!overlay?.chatInputNotice,
      },
    };
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, patch);
    } else {
      this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, patch);
    }
    return overlay;
  }

  private projectRuntimeViewOverlayToVisibleServices(
    runtimeState: ChatSessionRuntimeState | null | undefined,
  ): void {
    if (!runtimeState?.viewOverlay) {
      this.chatInputNoticeStateService.acceptProjectedRuntimeNotice(null);
      return;
    }

    const contextBudgetSnapshot = runtimeState.viewOverlay.contextBudgetSnapshot;
    if (contextBudgetSnapshot) {
      this.contextBudgetViewService.applySnapshot(contextBudgetSnapshot);
    }

    this.chatInputNoticeStateService.acceptProjectedRuntimeNotice(
      runtimeState.viewOverlay.chatInputNotice ?? null,
    );
  }

  private shouldProjectRuntimeViewStateToVisibleOwner(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return true;
    }

    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentViewSessionResource = resolveCurrentViewSessionResource.call(this);
    if (!currentViewSessionResource || currentViewSessionResource !== targetSessionId) {
      return false;
    }

    const currentSessionId = typeof this.chatService?.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    if (!currentSessionId || currentSessionId !== targetSessionId) {
      return false;
    }

    const visibleProjectionSessionId = (this as unknown as { visibleProjectionSessionId?: string | null }).visibleProjectionSessionId;
    if (typeof visibleProjectionSessionId === 'string' && visibleProjectionSessionId.trim() !== targetSessionId) {
      return false;
    }

    const runtimeState = this.chatSessionRuntimeStore?.read?.(targetSessionId);
    return runtimeState?.attachedView !== false;
  }

  private syncRuntimeRequestHandleMetadata(sessionId?: string | null): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId || typeof this.chatSessionRuntimeRegistry?.syncHandleState !== 'function') {
      return;
    }

    this.chatSessionRuntimeRegistry.syncHandleState(targetSessionId, {
      capabilities: resolveEngineRuntimeSessionCapabilities(
        this as unknown as Record<string, unknown>,
        targetSessionId,
      ),
      concurrencyScope: resolveEngineRuntimeSessionConcurrencyScope(
        this as unknown as Record<string, unknown>,
        targetSessionId,
      ) ?? null,
    });
  }

  private isMeaningfulContextBudgetSnapshot(snapshot: ContextBudgetSnapshot | null | undefined): snapshot is ContextBudgetSnapshot {
    return !!snapshot
      && (
        snapshot.currentTokens > 0
        || snapshot.messageCount > 0
        || snapshot.systemTokens > 0
        || snapshot.toolsTokens > 0
        || snapshot.messagesTokens > 0
        || snapshot.toolResultsTokens > 0
      );
  }

  private captureVisibleAttachedSessionRuntimeState(): void {
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const sessionId = resolveCurrentViewSessionResource.call(this);
    if (!sessionId) {
      return;
    }

    const existingRuntimeState = this.chatSessionRuntimeStore.read(sessionId);
    const existingRuntimeHandle = this.chatSessionRuntimeRegistry?.readHandle?.(sessionId);
    const hasRegistryRequestOwner = !!this.chatSessionRuntimeRegistry;
    const hasActiveRegistryRequest = existingRuntimeHandle?.requestInProgress === true;
    const requestInProgress = hasActiveRegistryRequest
      || (!hasRegistryRequestOwner && !!this.messageSubscription);
    const supportsInterruption = requestInProgress && (
      hasActiveRegistryRequest
      || (!hasRegistryRequestOwner && !!this.messageSubscription)
      || typeof existingRuntimeState?.stopSession === 'function'
    );
    const capturedTurnResponses = this.readVisibleAttachedSessionTurnResponses();
    // VS Code keeps ChatModel history as the sessionResource-owned truth and
    // does not let a transient empty widget projection erase it. Our visible
    // capture is a view synchronization hook, so an empty capture preserves an
    // existing canonical transcript; explicit edit/checkpoint/restore paths
    // must use owner-bound transcript APIs when they really replace history.
    const turnResponses = capturedTurnResponses.length === 0
      && Array.isArray(existingRuntimeState?.turnResponses)
      && existingRuntimeState.turnResponses.length > 0
      ? existingRuntimeState.turnResponses
      : capturedTurnResponses;
    const syncRuntimeViewOverlayFromVisibleServices = (
      this as unknown as {
        syncRuntimeViewOverlayFromVisibleServices?: (sessionId?: string | null) => ChatSessionRuntimeViewOverlay | null;
      }
    ).syncRuntimeViewOverlayFromVisibleServices
      ?? ChatEngineService.prototype['syncRuntimeViewOverlayFromVisibleServices'];
    const viewOverlay = syncRuntimeViewOverlayFromVisibleServices.call(this, sessionId);
    const runtimeCapabilities = resolveEngineRuntimeSessionCapabilities(this as unknown as Record<string, unknown>, sessionId);
    const runtimeConcurrencyScope = resolveEngineRuntimeSessionConcurrencyScope(
      this as unknown as Record<string, unknown>,
      sessionId,
    );
    const readPendingFollowupYieldRequested = (
      this as unknown as { readPendingFollowupYieldRequested?: (currentSessionId?: string | null) => boolean }
    ).readPendingFollowupYieldRequested
      ?? ChatEngineService.prototype['readPendingFollowupYieldRequested'];

    const runtimeProjectionState = Array.isArray(turnResponses) && turnResponses.length > 0
      ? buildRuntimeHostProjectionState(turnResponses)
      : (existingRuntimeState?.hostProjectionState ?? null);
    const runtimeStatePatch = {
      turnResponses,
      hostProjectionState: runtimeProjectionState,
      status: supportsInterruption ? 'in_progress' as const : null,
      requestInProgress,
      yieldRequested: typeof readPendingFollowupYieldRequested === 'function'
        ? readPendingFollowupYieldRequested.call(this, sessionId)
        : false,
      attachedView: !!this.chatTextareaRef,
      supportsInterruption,
      activeResponseHandle: supportsInterruption
        ? existingRuntimeHandle?.activeResponseHandle ?? existingRuntimeState?.activeResponseHandle ?? sessionId
        : null,
      stopSession: supportsInterruption
        ? (existingRuntimeHandle?.stopSession
            ?? existingRuntimeState?.stopSession
            ?? (this.chatSessionRuntimeRegistry
              ? () => this.lexStream.agent.stop(sessionId)
              : () => this.stopSessionAction(sessionId)))
        : null,
      disposeSession: this.chatSessionRuntimeRegistry
        ? (existingRuntimeHandle?.disposeSession ?? (() => this.lexStream.agent.dispose(sessionId)))
        : () => this.disposeSessionAction(sessionId),
      capabilities: runtimeCapabilities,
      viewOverlay,
      ...(runtimeConcurrencyScope ? { concurrencyScope: runtimeConcurrencyScope } : {}),
      debugSummary: {
        liveRuntimeOverlayPresent: requestInProgress || turnResponses.length > 0,
        pendingRequest: requestInProgress,
        needsInput: false,
        attachedView: !!this.chatTextareaRef,
        ...(typeof this.chatService?.currentSessionTitle === 'string'
          ? { title: this.chatService.currentSessionTitle }
          : {}),
        ...(typeof this.chatService?.currentSessionTitleSource === 'string'
          ? { titleSource: this.chatService.currentSessionTitleSource }
          : {}),
        ...(typeof this.chatService?.currentSessionTitleRevision === 'number' && Number.isFinite(this.chatService.currentSessionTitleRevision)
          ? { titleRevision: Math.floor(this.chatService.currentSessionTitleRevision) }
          : {}),
        contextBudgetOverlayPresent: !!viewOverlay?.contextBudgetSnapshot,
        inputNoticeOverlayPresent: !!viewOverlay?.chatInputNotice,
      },
    };
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(sessionId, runtimeStatePatch);
    } else {
      this.chatSessionRuntimeStore.replaceRuntimeState(sessionId, runtimeStatePatch);
    }
  }

  private syncExecutionRuntimeState(saveTarget?: HostSessionSaveTarget | null): void {
    const sessionId = typeof saveTarget?.sessionId === 'string'
      ? saveTarget.sessionId.trim()
      : '';
    if (!sessionId) {
      return;
    }

    const runtimeCapabilities = resolveEngineRuntimeSessionCapabilities(this as unknown as Record<string, unknown>, sessionId);
    const runtimeConcurrencyScope = resolveEngineRuntimeSessionConcurrencyScope(
      this as unknown as Record<string, unknown>,
      sessionId,
    );
    const titleCandidate = normalizeChatSessionTitleCandidate(
      saveTarget?.sessionTitleCandidate ?? {
        text: saveTarget?.sessionTitle,
        source: saveTarget?.sessionTitleSource,
        revision: saveTarget?.sessionTitleRevision,
      },
    );

    const runtimeStatePatch = {
      turnResponses: Array.isArray(saveTarget?.turnResponses)
        ? saveTarget.turnResponses
        : undefined,
      hostProjectionState: buildRuntimeHostProjectionState(saveTarget?.turnResponses),
      status: null,
      requestInProgress: false,
      yieldRequested: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      capabilities: runtimeCapabilities,
      ...(runtimeConcurrencyScope ? { concurrencyScope: runtimeConcurrencyScope } : {}),
      debugSummary: {
        liveRuntimeOverlayPresent: Array.isArray(saveTarget?.turnResponses) && saveTarget.turnResponses.length > 0,
        pendingRequest: false,
        needsInput: false,
        attachedView: false,
        ...(titleCandidate.text ? { title: titleCandidate.text } : {}),
        ...(titleCandidate.text && titleCandidate.source !== 'empty' ? { titleSource: titleCandidate.source } : {}),
        ...(titleCandidate.text ? { titleRevision: titleCandidate.revision } : {}),
      },
    };
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(sessionId, runtimeStatePatch);
    } else {
      this.chatSessionRuntimeStore.replaceRuntimeState(sessionId, runtimeStatePatch);
    }
  }

  private syncExecutionRuntimeTurnResponses(
    sessionId?: string | null,
    turnResponses?: readonly TurnResponseTurn[] | null,
  ): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId || !Array.isArray(turnResponses)) {
      return;
    }

    const hostProjectionState = buildRuntimeHostProjectionState(turnResponses);
    const runtimeCapabilities = resolveEngineRuntimeSessionCapabilities(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    );
    const runtimeConcurrencyScope = resolveEngineRuntimeSessionConcurrencyScope(
      this as unknown as Record<string, unknown>,
      targetSessionId,
    );
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const projectRuntimeProjectionToSessionModel = (
      (this as unknown as { projectRuntimeProjectionToSessionModel?: ChatEngineService['projectRuntimeProjectionToSessionModel'] })
        .projectRuntimeProjectionToSessionModel
      ?? ChatEngineService.prototype['projectRuntimeProjectionToSessionModel']
    );
    const currentViewSessionResource = resolveCurrentViewSessionResource.call(this);
    projectRuntimeProjectionToSessionModel.call(this, targetSessionId, hostProjectionState, {
      attachedView: currentViewSessionResource === targetSessionId,
      turnResponses,
    });

    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.syncHandleState(targetSessionId, {
        capabilities: runtimeCapabilities,
        concurrencyScope: runtimeConcurrencyScope ?? null,
      });
      this.chatSessionRuntimeRegistry.syncTurnResponses(
        targetSessionId,
        turnResponses,
        hostProjectionState,
      );
      return;
    }

    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
      turnResponses,
      hostProjectionState,
      capabilities: runtimeCapabilities,
    });
  }

  private buildRuntimeProjectionForVisibleAttach(
    runtimeState: Readonly<ChatSessionRuntimeState> | null | undefined,
  ): HostTurnResponseState | null {
    if (Array.isArray(runtimeState?.turnResponses) && runtimeState.turnResponses.length > 0) {
      try {
        return buildRuntimeHostProjectionState(runtimeState.turnResponses);
      } catch {
        return runtimeState.hostProjectionState ?? null;
      }
    }

    return runtimeState?.hostProjectionState ?? null;
  }

  private projectSessionModelToVisibleAttach(
    sessionId: string | null | undefined,
    runtimeState?: Readonly<ChatSessionRuntimeState> | null,
  ): boolean {
    const targetSessionId = typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
    if (!targetSessionId) {
      return false;
    }

    const model = this.chatSessionModelStore?.get?.(targetSessionId);
    if (!model) {
      return false;
    }

    const buildRuntimeProjectionForVisibleAttach = (
      (this as unknown as { buildRuntimeProjectionForVisibleAttach?: ChatEngineService['buildRuntimeProjectionForVisibleAttach'] })
        .buildRuntimeProjectionForVisibleAttach
      ?? ChatEngineService.prototype['buildRuntimeProjectionForVisibleAttach']
    );
    const runtimeTurnResponses = Array.isArray(runtimeState?.turnResponses) && runtimeState.turnResponses.length > 0
      ? runtimeState.turnResponses
      : [];
    const modelTurnResponses = model.turnResponses.length > 0
      ? model.turnResponses
      : [];
    const canonicalTurnResponses = runtimeTurnResponses.length > 0
      ? runtimeTurnResponses
      : modelTurnResponses;
    const canonicalProjectionState = canonicalTurnResponses.length > 0
      ? buildRuntimeHostProjectionState(canonicalTurnResponses)
      : null;
    const runtimeProjectionState = buildRuntimeProjectionForVisibleAttach.call(this, runtimeState);
    const modelProjectionState = model.hostProjectionState ?? null;
    const projectionState = canonicalProjectionState ?? runtimeProjectionState ?? modelProjectionState;
    if (!projectionState) {
      return false;
    }

    const turnResponses = canonicalTurnResponses.length > 0
      ? canonicalTurnResponses
      : projectionState.turnResponses;
    if (turnResponses.length > 0) {
      this.lexStream.hydrateTurnResponses(targetSessionId, turnResponses, {
        visibility: 'visibleAttach',
      });
    }
    this.visibleProjectionSessionId = targetSessionId;
    this.liveHostRequestGraphCache.replaceState(projectionState);
    this.triggerSyncDetectChanges();
    return true;
  }

  private clearSessionRuntimeState(sessionId?: string | null): void {
    const targetSessionId = sessionId ?? this.resolveActiveRuntimeSessionId();
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.clearSession(targetSessionId);
      return;
    }

    this.chatSessionRuntimeStore.clearSession(targetSessionId);
  }

  private detachSessionRuntimeView(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : this.resolveActiveRuntimeSessionId();
    if (!targetSessionId || !this.chatSessionRuntimeStore.read(targetSessionId)) {
      return false;
    }

    if (this.chatSessionRuntimeRegistry) {
      return this.chatSessionRuntimeRegistry.detachView(targetSessionId);
    }

    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
      attachedView: false,
      debugSummary: {
        lastViewDetachAt: Date.now(),
      },
    });
    return true;
  }

  private interruptSessionRuntime(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : this.resolveActiveRuntimeSessionId();
    if (!targetSessionId) {
      return false;
    }

    if (this.chatSessionRuntimeRegistry) {
      return this.chatSessionRuntimeRegistry.stopSession(targetSessionId);
    }

    const runtimeState = this.chatSessionRuntimeStore.read(targetSessionId);
    if (!runtimeState?.supportsInterruption) {
      return false;
    }

    this.lexStream.agent.stop(targetSessionId);
    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
      status: null,
      requestInProgress: false,
      yieldRequested: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      debugSummary: {
        lastExplicitInterruptAt: Date.now(),
      },
    });

    return true;
  }

  private stopSessionAction(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : '';
    if (!targetSessionId) {
      return false;
    }

    const runtimeState = this.chatSessionRuntimeStore.read(targetSessionId);
    const isVisibleCurrentSession = targetSessionId === this.resolveActiveRuntimeSessionId()
      && this.isWaiting
      && (runtimeState?.attachedView === true || !!this.chatTextareaRef);

    if (isVisibleCurrentSession) {
      void this.stopCoordinator.stopVisibleSession(targetSessionId);
      this.captureVisibleAttachedSessionRuntimeState();
      return true;
    }

    return this.interruptSessionRuntime(targetSessionId);
  }

  private teardownSessionRuntime(sessionId: string): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    const replacePendingFollowupQueue = (
      this as unknown as {
        replacePendingFollowupQueue?: (
          sessionId: string,
          requests: readonly PendingFollowupRequest[] | null | undefined,
        ) => readonly PendingFollowupRequest[];
      }
    ).replacePendingFollowupQueue
      ?? ChatEngineService.prototype['replacePendingFollowupQueue'];
    replacePendingFollowupQueue.call(this, targetSessionId, []);
    const syncPendingFollowupRuntimeState = (
      this as unknown as { syncPendingFollowupRuntimeState?: (sessionId?: string | null) => void }
    ).syncPendingFollowupRuntimeState
      ?? ChatEngineService.prototype['syncPendingFollowupRuntimeState'];
    syncPendingFollowupRuntimeState.call(this, targetSessionId);

    if (this.chatSessionRuntimeRegistry) {
      return this.chatSessionRuntimeRegistry.disposeSession(targetSessionId);
    }

    this.lexStream.agent.dispose(targetSessionId);
    const runtimeState = this.chatSessionRuntimeStore.read(targetSessionId);
    if (runtimeState) {
      this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
        requestInProgress: false,
        yieldRequested: false,
        supportsInterruption: false,
        stopSession: null,
        disposeSession: null,
        activeResponseHandle: null,
        debugSummary: {
          lastExplicitDisposeAt: Date.now(),
        },
      });
    }
    this.clearSessionRuntimeState(targetSessionId);
    return true;
  }

  disposeSessionAction(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    return this.teardownSessionRuntime(targetSessionId);
  }

  deleteSessionAction(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    this.disposeSessionAction(targetSessionId);
    this.session.releaseSessionModelReference(targetSessionId);
    this.chatSessionViewModelStore.detach(targetSessionId);
    this.chatSessionModelStore.disposeSession(targetSessionId);
    this.chatSessionItemsService.sessionItemController.deleteChatSessionItem(targetSessionId);
    return true;
  }

  private async attachCurrentSessionView(): Promise<void> {
    const attachSessionView = (
      (this as unknown as { attachSessionView?: ChatEngineService['attachSessionView'] }).attachSessionView
      ?? ChatEngineService.prototype['attachSessionView']
    );
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    await attachSessionView.call(this, resolveCurrentViewSessionResource.call(this));
  }

  private async attachSessionView(sessionId?: string | null): Promise<void> {
    const targetSessionId = typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
    if (!targetSessionId) {
      return;
    }

    this.chatSessionViewModelStore?.attach?.(targetSessionId);
    const runtimeState = this.chatSessionRuntimeStore.read(targetSessionId);
    this.projectRuntimeViewOverlayToVisibleServices(runtimeState);
    this.projectRuntimeQuotaOverlayToVisibleServices(runtimeState, targetSessionId);
    const syncResolvedActiveModelForSession = (
      (this as unknown as { syncResolvedActiveModelForSession?: ChatEngineService['syncResolvedActiveModelForSession'] })
        .syncResolvedActiveModelForSession
      ?? ChatEngineService.prototype['syncResolvedActiveModelForSession']
    );
    await syncResolvedActiveModelForSession.call(this, targetSessionId);
    const persistedEntry = this.chatHistoryService.findEntry(targetSessionId);
    const projectSessionModelToVisibleAttach = (
      (this as unknown as { projectSessionModelToVisibleAttach?: ChatEngineService['projectSessionModelToVisibleAttach'] })
        .projectSessionModelToVisibleAttach
      ?? ChatEngineService.prototype['projectSessionModelToVisibleAttach']
    );
    const projectedSessionModelToVisibleAttach = projectSessionModelToVisibleAttach.call(this, targetSessionId, runtimeState);
    const hasVisibleChatViewProjectionForSession = (
      this as unknown as { hasVisibleChatViewProjectionForSession?: (sessionId?: string | null) => boolean }
    ).hasVisibleChatViewProjectionForSession
      ?? ChatEngineService.prototype['hasVisibleChatViewProjectionForSession'];
    const hasVisibleProjection = projectedSessionModelToVisibleAttach
      || hasVisibleChatViewProjectionForSession.call(this, targetSessionId);
    const runtimeHasLiveProjection = (Array.isArray(runtimeState?.turnResponses)
      && runtimeState.turnResponses.length > 0)
      || ((runtimeState?.hostProjectionState?.turnResponses?.length ?? 0) > 0);
    const readVisibleSessionRequestInProgress = (
      this as unknown as { readVisibleSessionRequestInProgress?: (sessionId?: string | null) => boolean }
    ).readVisibleSessionRequestInProgress
      ?? ChatEngineService.prototype['readVisibleSessionRequestInProgress'];
    const hasActiveRequest = typeof readVisibleSessionRequestInProgress === 'function'
      ? readVisibleSessionRequestInProgress.call(this, targetSessionId)
      : runtimeState?.requestInProgress === true;
    const shouldAttachDetachedRuntimeView = !!runtimeState
      && runtimeState.attachedView === false
      && hasActiveRequest;
    const runtimeProjectionMismatch = !!runtimeState?.hostProjectionState
      && !areProjectionTurnResponsesEquivalent(
        this.hostResponseProjection?.turnResponses,
        runtimeState.hostProjectionState.turnResponses,
      );
    const canRestoreProjection = !!runtimeState || !!persistedEntry;
    const shouldRestoreProjection = !this.chatService.hasBlankSessionShell
      && !projectedSessionModelToVisibleAttach
      && canRestoreProjection
      && !shouldAttachDetachedRuntimeView
      && (!runtimeState
        || runtimeState.attachedView === false
        || !hasVisibleProjection
        || runtimeProjectionMismatch);

    traceBackgroundSessionExecution('attach-current-session-view', {
      sessionId: targetSessionId,
      hasRuntimeState: !!runtimeState,
      runtimeAttachedView: runtimeState?.attachedView ?? null,
      runtimeRequestInProgress: runtimeState?.requestInProgress ?? false,
      activeRequestInProgress: hasActiveRequest,
      hasPersistedEntry: !!persistedEntry,
      hasVisibleProjection,
      runtimeProjectionMismatch,
      shouldAttachDetachedRuntimeView,
      shouldRestoreProjection,
      projectedSessionModelToVisibleAttach,
    });

    if (shouldAttachDetachedRuntimeView) {
      const buildRuntimeProjectionForVisibleAttach = (
        this as unknown as {
          buildRuntimeProjectionForVisibleAttach?: (runtimeState: Readonly<ChatSessionRuntimeState> | null | undefined) => HostTurnResponseState | null;
        }
      ).buildRuntimeProjectionForVisibleAttach
        ?? ChatEngineService.prototype['buildRuntimeProjectionForVisibleAttach'];
      const runtimeProjectionState = buildRuntimeProjectionForVisibleAttach.call(this, runtimeState);
      const runtimeTurnResponses = Array.isArray(runtimeState?.turnResponses) && runtimeState.turnResponses.length > 0
        ? runtimeState.turnResponses
        : (runtimeProjectionState?.turnResponses ?? []);
      traceBackgroundSessionExecution('attach-current-session-view-reattach-running-runtime', {
        sessionId: targetSessionId,
        requestInProgress: hasActiveRequest,
        runtimeRequestInProgress: runtimeState?.requestInProgress ?? false,
        hasRuntimeProjection: runtimeHasLiveProjection,
      });
      if (runtimeProjectionState
        && (!hasVisibleProjection || runtimeProjectionMismatch)
        && this.liveHostRequestGraphCache
        && typeof this.triggerSyncDetectChanges === 'function') {
        // goback 时已通过 resetVisibleSessionProjection 清空可见 lexStream。
        // hostResponseProjection（即 dialogItems 数据源）依赖 lexStream.turnResponses 作为 live source：
        // 若仅 replaceState 而不回灌 lexStream，下一次变更检测会因 live source 为空而把缓存判定为
        // 「无会话内容」并清空，导致重新进入后流式输出不显示（mac 上时序更易触发）。
        // 这里把后台 runtime 的 turnResponses 水合回可见 lexStream（与「下一次渲染事件合并」恢复路径一致），
        // 保证 live source 与缓存一致、内容在后续变更检测中稳定保留。
        if (runtimeTurnResponses.length > 0) {
          this.lexStream.hydrateTurnResponses(targetSessionId, runtimeTurnResponses, {
            visibility: 'visibleAttach',
          });
        }
        this.visibleProjectionSessionId = targetSessionId;
        this.liveHostRequestGraphCache.replaceState(runtimeProjectionState);
        this.triggerSyncDetectChanges();
      }
      if (this.chatSessionRuntimeRegistry) {
        this.chatSessionRuntimeRegistry.attachView(targetSessionId);
      } else {
        this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
          attachedView: true,
        });
      }
      this.ensureBackgroundSessionCanRerun(targetSessionId);
      this.chatSessionItemsService.scheduleSessionItemRefresh(targetSessionId, 'attach-running-runtime');
      return;
    }

    if (shouldRestoreProjection) {
      traceBackgroundSessionExecution('attach-current-session-view-restore-start', {
        sessionId: targetSessionId,
        reason: {
          runtimeMissing: !runtimeState,
          detachedView: runtimeState?.attachedView === false,
          visibleProjectionMissing: !hasVisibleProjection,
          runtimeProjectionMismatch,
        },
      });
      const restored = await this.hostSessionRestoreBridge.restoreSessionProjection(
        targetSessionId,
        this.getCurrentProjectPath(),
      );
      traceBackgroundSessionExecution('attach-current-session-view-restore-finished', {
        sessionId: targetSessionId,
        restored,
      });
      if (restored) {
        this.chatSessionItemsService.scheduleSessionItemRefresh(targetSessionId, 'attach-restore');
      }
      return;
    }

    if (hasVisibleProjection) {
      if (runtimeState && !runtimeState.attachedView) {
        traceBackgroundSessionExecution('attach-current-session-view-reattach-runtime-view', {
          sessionId: targetSessionId,
          requestInProgress: runtimeState.requestInProgress,
        });
        if (this.chatSessionRuntimeRegistry) {
          this.chatSessionRuntimeRegistry.attachView(targetSessionId);
        } else {
          this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
            attachedView: true,
          });
        }
        this.ensureBackgroundSessionCanRerun(targetSessionId);
        this.chatSessionItemsService.scheduleSessionItemRefresh(targetSessionId, 'attach-runtime-view');
      }
      return;
    }

    if (!runtimeState && !persistedEntry) {
      return;
    }

    const restored = await this.hostSessionRestoreBridge.restoreSessionProjection(
      targetSessionId,
      this.getCurrentProjectPath(),
    );
    traceBackgroundSessionExecution('attach-current-session-view-fallback-restore-finished', {
      sessionId: targetSessionId,
      restored,
    });
    if (restored) {
      this.chatSessionItemsService.scheduleSessionItemRefresh(targetSessionId, 'attach-fallback-restore');
    }
  }

  private ensureBackgroundSessionCanRerun(sessionId?: string | null): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return;
    }

    const runtimeState = this.chatSessionRuntimeStore.read(targetSessionId);
    const activeRuntimeHandle = this.chatSessionRuntimeRegistry?.readHandle?.(targetSessionId);
    if (activeRuntimeHandle?.requestInProgress) {
      traceBackgroundSessionExecution('reattach-rerun-check-active', {
        sessionId: targetSessionId,
        supportsInterruption: activeRuntimeHandle.supportsInterruption,
        hasStopSession: typeof activeRuntimeHandle.stopSession === 'function',
        hasActiveResponseHandle: activeRuntimeHandle.activeResponseHandle !== undefined
          && activeRuntimeHandle.activeResponseHandle !== null,
      });
      return;
    }

    if (this.chatSessionRuntimeRegistry) {
      const cleared = this.chatSessionRuntimeRegistry.clearStaleRequestGate(targetSessionId);
      traceBackgroundSessionExecution(cleared
        ? 'reattach-rerun-check-clear-stale-request-flag'
        : 'reattach-rerun-check-skip-idle', {
        sessionId: targetSessionId,
        requestInProgress: runtimeState?.requestInProgress ?? false,
        status: runtimeState?.status ?? null,
        detail: cleared
          ? 'requestInProgress without active runtime handle; clear stale gate so session can rerun'
          : 'registry has no active request handle for this session',
      });
      return;
    }

    const hasStaleRuntimeGate = runtimeState?.requestInProgress === true
      || runtimeState?.supportsInterruption === true
      || runtimeState?.status === 'in_progress'
      || typeof runtimeState?.stopSession === 'function'
      || (runtimeState?.activeResponseHandle !== undefined && runtimeState.activeResponseHandle !== null);
    if (!hasStaleRuntimeGate) {
      traceBackgroundSessionExecution('reattach-rerun-check-skip-idle', {
        sessionId: targetSessionId,
      });
      return;
    }

    const hasActiveResponseHandle = runtimeState.activeResponseHandle !== undefined
      && runtimeState.activeResponseHandle !== null;
    const hasActiveExecutionHandle = runtimeState.supportsInterruption === true
      || typeof runtimeState.stopSession === 'function'
      || hasActiveResponseHandle;
    if (!this.chatSessionRuntimeRegistry && hasActiveExecutionHandle) {
      traceBackgroundSessionExecution('reattach-rerun-check-active', {
        sessionId: targetSessionId,
        supportsInterruption: runtimeState.supportsInterruption,
        hasStopSession: typeof runtimeState.stopSession === 'function',
        hasActiveResponseHandle,
      });
      return;
    }

    traceBackgroundSessionExecution('reattach-rerun-check-clear-stale-request-flag', {
      sessionId: targetSessionId,
      requestInProgress: runtimeState.requestInProgress,
      status: runtimeState.status ?? null,
      detail: 'requestInProgress without active runtime handle; clear stale gate so session can rerun',
    });

    this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, {
      requestInProgress: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
    });
  }

  /** 同步触发变更检测（zone 安全） */
  triggerSyncDetectChanges(): void {
    if (this._syncDetectChanges) {
      this.ngZone.run(() => this._syncDetectChanges!());
    }
  }

  openSettings(): void {
    this.chatViewState.openSettings();
    this.triggerSyncDetectChanges();
  }

  // ==================== 初始化 / 销毁 ====================

  /**
   * 引擎初始化 — 由 Component 的 ngOnInit 调用
   * @param chatTextareaRef 输入框 ElementRef（用于自动聚焦）
   */
  init(chatTextareaRef: ElementRef | null): void {
    this.chatTextareaRef = chatTextareaRef;
    const readVisibleSessionRequestInProgress = (
      this as unknown as { readVisibleSessionRequestInProgress?: (sessionId?: string | null) => boolean }
    ).readVisibleSessionRequestInProgress
      ?? ChatEngineService.prototype['readVisibleSessionRequestInProgress'];
    const currentSessionId = typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '';
    const currentRuntimeState = currentSessionId
      ? this.chatSessionRuntimeStore?.read?.(currentSessionId)
      : undefined;
    const shouldSkipInitialVisibleCapture = currentRuntimeState?.attachedView === false;
    this.chatService.isWaiting = readVisibleSessionRequestInProgress.call(this);
    if (!shouldSkipInitialVisibleCapture) {
      this.captureVisibleAttachedSessionRuntimeState();
    }
    void this.refreshRequestQuotaState();
    void this.attachCurrentSessionView().catch((error) => {
      console.warn('[ChatEngine] Failed to attach current session view on init:', error);
    });

    this.prjPath = AilyHost.get().project.currentProjectPath === AilyHost.get().project.projectRootPath
      ? '' : AilyHost.get().project.currentProjectPath;
    this.prjRootPath = AilyHost.get().project.projectRootPath;
    this.refreshSessionProviderOptionsSources();

    // 注册 ask_user 回调：在聊天界面显示全部问题并等待用户回答
    registerAskUserCallback((questions) => this.interaction.handleAskUser(questions));

    // 预加载 aily-lex 模块
    this.lexStream.agent.loadModule().then(ok => {
      if (ok) { console.log('[ChatEngine] aily-lex 模块预加载成功'); }
      else { console.error('[ChatEngine] aily-lex 模块加载失败，聊天功能不可用'); }
    });

    this.cleanupSubscriptions();
    this.setupSubscriptions();
  }

  /**
    * 引擎销毁 — 由显式 runtime owner 调用
   */
  destroy(): void {
    this.disposeAllSessionRuntimes();
    this.disposeVisibleProjection();
    this.disposeOwnerLifecycle();
  }

  disposeVisibleProjection(): void {
    this.liveHostRequestGraphCache.clear();
    this.viewAdapter.destroy();
    this.entryPartStore.destroy();
    for (const model of this.chatSessionModelStore.values()) {
      model.partStore.destroy();
    }
    this.chatService.isWaiting = false;
  }

  private disposeAllSessionRuntimes(): void {
    const sessionIds = new Set<string>([
      ...(this.chatSessionRuntimeRegistry?.getSessionIds() ?? this.chatSessionRuntimeStore.getSessionIds()),
      ...this.lexStream.agent.getSessionIds(),
    ]);

    for (const sessionId of sessionIds) {
      this.teardownSessionRuntime(sessionId);
    }
  }

  private disposeOwnerLifecycle(): void {
    this.session.saveCurrentSession();
    this.session.enterEntryState({ resetInitialization: true });
    this.chatHistoryService.flushAll();
    this.chatHistoryService.setLiveSessionProvider(null);
    this.editCheckpointService.clear();

    unregisterAskUserCallback();
    this.interaction.destroy();

    this.cleanupSubscriptions();
    this.session.dispose();

    this.viewAdapter.markLastMessageDone();
  }

  // ==================== 订阅管理 ====================

  private setupSubscriptions(): void {
    this.subscriptionCoordinator.setup();
    this.chatViewState.setAvailableAgentModes(this.chatService.availableResolvedCustomModes);
    this.runtimeModeCollectionSubscription = this.chatService.runtimeModeCollection.onDidChange
      .subscribe(() => {
        this.chatViewState.setAvailableAgentModes(this.chatService.availableResolvedCustomModes);
        this.triggerSyncDetectChanges();
      });
    this.contextBudgetStateSubscription = this.contextBudgetViewService.budget$
      .pipe(distinctUntilChanged())
      .subscribe(() => this.triggerSyncDetectChanges());
    this.requestQuotaStateSubscription = this.requestQuotaStateService.requestQuotaSnapshot$
      .pipe(distinctUntilChanged())
      .subscribe(() => this.triggerSyncDetectChanges());
  }

  private cleanupSubscriptions(): void {
    this.runtimeModeCollectionSubscription?.unsubscribe();
    this.runtimeModeCollectionSubscription = null;
    this.contextBudgetStateSubscription?.unsubscribe();
    this.contextBudgetStateSubscription = null;
    this.requestQuotaStateSubscription?.unsubscribe();
    this.requestQuotaStateSubscription = null;
    this.subscriptionCoordinator.cleanup();
  }

  private flushPendingAutoSend(): void {
    if (!this._pendingAutoSendText) {
      return;
    }

    const text = this._pendingAutoSendText;
    this._pendingAutoSendText = null;
    this.inputValue = text;
    setTimeout(() => {
      void this.submitUserText(text, { clearInput: true });
    }, 50);
  }

  async submitUserText(content: string, options?: { clearInput?: boolean; sessionId?: string | null }): Promise<void> {
    await this.send('user', content, options?.clearInput ?? true, options?.sessionId);
  }

  private sendFromCoordinationContext(sender: string, content: string, clear: boolean = true): Promise<void> {
    if (sender === 'user') {
      return this.submitUserText(content, { clearInput: clear });
    }

    return this.send(sender, content, clear);
  }

  // ==================== 辅助方法 ====================

  getCurrentProjectPath(): string {
    return AilyHost.get().project.currentProjectPath !== AilyHost.get().project.projectRootPath
      ? AilyHost.get().project.currentProjectPath : '';
  }

  getKeyInfo = async () => {
    const shell = await AilyHost.get().terminal.getShell();
    return `
<keyinfo>
项目存放根路径(**rootFolder**): ${AilyHost.get().project.projectRootPath || '无'}
当前项目路径(**path**): ${this.getCurrentProjectPath() || '无'}
当前项目库存放路径(**librariesPath**): ${this.getCurrentProjectPath() ? this.getCurrentProjectPath() + '/node_modules/@aily-project' : '无'}
appDataPath(**appDataPath**): ${AilyHost.get().path.getAppDataPath() || '无'}
 - 包含SDK文件、编译器工具等，boards.json-开发板列表 libraries.json-库列表 等缓存到此路径
转换库存放路径(**libraryConversionPath**): ${this.getCurrentProjectPath() ? this.getCurrentProjectPath() : (AilyHost.get().path.join(AilyHost.get().path.getAppDataPath(), 'libraries') || '无')}
当前使用的语言(**lang**)： ${AilyHost.get().config.data?.lang || 'zh-cn'}
操作系统(**os**): ${AilyHost.get().platform.type || 'unknown'}
当前命令行终端(**terminal**): ${shell || 'unknown'}
</keyinfo>
<keyinfo>
uses get_hardware_categories tool to get hardware categories before searching boards and libraries.
uses search_boards_libraries tool to search for boards and libraries based on user needs.
Do not create non-existent boards and libraries.
</keyinfo>
`;
  }

  generateTitle(content: string): void {
    const sessionId = this.resolveCurrentViewSessionResource() || this.resolveActiveRuntimeSessionId();
    void this.titleCoordinator.generate(content, sessionId);
  }

  showAiWritingNotice(isWaiting: boolean): void {
    const currentSessionId = typeof this.chatService.currentSessionId === 'string' && this.chatService.currentSessionId.trim().length > 0
      ? this.chatService.currentSessionId.trim()
      : this.resolveActiveRuntimeSessionId();
    this.aiNoticeCoordinator.update(isWaiting, currentSessionId);
  }

  setPaneSessionCommandHandlers(handlers: ChatPaneSessionCommandHandlers | null | undefined): void {
    this.paneSessionCommandHandlers = handlers ? { ...handlers } : {};
  }

  receiveTextFromExternal(text: string, options?: ChatTextOptions): void {
    this.externalInputCoordinator.receiveText(text, options);
  }

  // ==================== 外观方法（转发到 helper） ====================

  saveCurrentSession(): void { this.session.saveCurrentSession(); }
  refreshHistoryList(): void { this.session.refreshHistoryList(); }
  requestSessionListRefresh(input: {
    reason: 'open' | 'entry' | 'reopen' | 'filter' | 'state' | 'runtime' | 'manual' | 'project' | 'service-created' | 'shell';
    scope: 'summary' | 'visible-details' | 'full';
    priority: 'after-paint' | 'normal' | 'idle';
  }): void { this.session.requestSessionListRefresh(input); }
  switchToSession(
    sessionId: string,
    options?: {
      readonly fallbackProjectPath?: string | null;
    },
  ): Promise<boolean> {
    return this.session.switchToSession(sessionId, options);
  }
  newChat(): Promise<void> { return this.session.newChat(); }
  initializeEntryInventory(): Promise<boolean> { return this.session.initializeEntryInventory(); }
  returnToEntryInventory(options?: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean }): Promise<void> {
    return this.session.returnToEntryInventory(options);
  }

  ensureSessionReadyForSubmit(): Promise<string | null> { return this.session.ensureSessionReadyForSubmit(); }
  enterEntryState(options?: { resetInitialization?: boolean; sessionId?: string | null; disposeRuntime?: boolean }): void {
    this.session.enterEntryState(options);
  }
  getHistory(): Promise<void> { return this.session.getHistory(); }
  getCurrentTools(): any[] { return this.lexStream.runtime.tools(); }
  getCurrentLLMConfig(): any { return this.lexStream.runtime.llmConfig(); }

  async compactConversation(): Promise<boolean> {
    const changed = await this.lexStream.compactConversation();
    if (changed) {
      this.invalidateHostRequestGraph();
      this.triggerSyncDetectChanges();
    }
    return changed;
  }

  // ==================== 消息发送 ====================

  private async ensureBlankSessionRuntimeProviderOptions(sessionId?: string | null): Promise<void> {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (!targetSessionId) {
      return;
    }

    const readSessionTurnResponses = (
      this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] }
    ).readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses'];
    if (readSessionTurnResponses.call(this, targetSessionId).length > 0) {
      return;
    }

    const rememberRuntimeSessionProviderOptions = (
      this as unknown as {
        rememberRuntimeSessionProviderOptions?: (
          sessionId: string | null | undefined,
          providerOptions: Partial<HostSessionProviderOptions> | null | undefined,
        ) => HostSessionProviderOptions | null;
      }
    ).rememberRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['rememberRuntimeSessionProviderOptions'];
    const resolveRuntimeSessionProviderOptions = (
      this as unknown as {
        resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions;
      }
    ).resolveRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
    const normalizedProviderOptions = rememberRuntimeSessionProviderOptions.call(
      this,
      targetSessionId,
      resolveRuntimeSessionProviderOptions.call(this, targetSessionId),
    ) ?? resolveRuntimeSessionProviderOptions.call(this, targetSessionId);
    const providerOptionsKey = createAgentProviderOptionsKeyWithRuntime(
      createHostSessionProviderOptionsKey(normalizedProviderOptions),
      this.currentAgentRuntimeMode ?? this.chatService?.currentAgentRuntimeMode,
    );
    if (this.lexStream.agent.isConfiguredFor?.(targetSessionId, providerOptionsKey)) {
      return;
    }

    await this.lexStream.agent.ensureAgent(targetSessionId, providerOptionsKey);
  }

  private async ensureRuntimeAgentForSession(sessionId: string): Promise<void> {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (!targetSessionId) {
      return;
    }

    const rememberRuntimeSessionProviderOptions = (
      this as unknown as {
        rememberRuntimeSessionProviderOptions?: (
          sessionId: string | null | undefined,
          providerOptions: Partial<HostSessionProviderOptions> | null | undefined,
        ) => HostSessionProviderOptions | null;
      }
    ).rememberRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['rememberRuntimeSessionProviderOptions'];
    const resolveRuntimeSessionProviderOptions = (
      this as unknown as {
        resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions;
      }
    ).resolveRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
    const normalizedProviderOptions = rememberRuntimeSessionProviderOptions.call(
      this,
      targetSessionId,
      resolveRuntimeSessionProviderOptions.call(this, targetSessionId),
    ) ?? resolveRuntimeSessionProviderOptions.call(this, targetSessionId);
    const providerOptionsKey = createAgentProviderOptionsKeyWithRuntime(
      createHostSessionProviderOptionsKey(normalizedProviderOptions),
      this.currentAgentRuntimeMode ?? this.chatService?.currentAgentRuntimeMode,
    );
    if (this.lexStream.agent.isConfiguredFor?.(targetSessionId, providerOptionsKey)) {
      await this.lexStream.agent.ensureAgent(targetSessionId, providerOptionsKey);
      return;
    }

    await this.lexStream.agent.ensureAgent(targetSessionId, providerOptionsKey);
  }

  private async runWithRuntimeSessionOwner<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const previousOwner = this.runtimeSessionOwnerOverride;
    this.runtimeSessionOwnerOverride = sessionId;
    try {
      return await action();
    } finally {
      this.runtimeSessionOwnerOverride = previousOwner;
    }
  }

  private activatePreparedUserTurn(
    runtimeSessionId: string | null | undefined,
    prepared: PreparedPendingFollowupRequest,
  ): void {
    if (this.isCompleted) {
      this.isCancelled = false;
      this.isCompleted = false;
    }

    if (this.isCancelled) {
      this.isCancelled = false;
      this.pendingUserInput = false;
      this.activeToolExecutions = 0;
    }

    const targetSessionId = typeof runtimeSessionId === 'string' && runtimeSessionId.trim().length > 0
      ? runtimeSessionId.trim()
      : this.resolveActiveRuntimeSessionId();
    if (!this.shouldProjectRuntimeViewStateToVisibleOwner(targetSessionId)) {
      return;
    }

    this.msg.appendMessage('user', prepared.displayText);
  }

  private async executePreparedUserSend(
    runtimeSessionId: string | null | undefined,
    prepared: PreparedPendingFollowupRequest,
    options?: {
      clearInput?: boolean;
      activatePreparedUserTurn?: boolean;
    },
  ): Promise<void> {
    const clearInput = options?.clearInput !== false;
    if (options?.activatePreparedUserTurn) {
      const activatePreparedUserTurn = (
        this as unknown as {
          activatePreparedUserTurn?: (
            runtimeOwnerSessionId: string | null | undefined,
            preparedRequest: PreparedPendingFollowupRequest,
          ) => void;
        }
      ).activatePreparedUserTurn
        ?? ChatEngineService.prototype['activatePreparedUserTurn'];
      activatePreparedUserTurn.call(this, runtimeSessionId, prepared);
    }

    const currentModel = this.chatService.currentModel as { model?: string; presetId?: string; name?: string } | null;
    const requestModelRouting = prepared.requestMetadata?.['modelRouting'] as Record<string, unknown> | undefined;
    console.info('[AilyChat][Send] request model routing:', {
      currentModel: currentModel
        ? {
            model: currentModel.model,
            presetId: currentModel.presetId,
            name: currentModel.name,
          }
        : null,
      modelRouting: requestModelRouting
        ? { ...requestModelRouting }
        : undefined,
    });
    console.info(
      `[AilyChat][Send] request model routing scalar currentModel=${currentModel?.model ?? ''}/${currentModel?.presetId ?? ''}/${currentModel?.name ?? ''} requestedModel=${typeof requestModelRouting?.['requestedModel'] === 'string' ? requestModelRouting['requestedModel'] : ''} requestedPresetId=${typeof requestModelRouting?.['requestedPresetId'] === 'string' ? requestModelRouting['requestedPresetId'] : ''}`,
    );

    const currentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    ).call(this);
    const targetSessionId = runtimeSessionId || currentViewSessionResource || (typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '');
    const currentVisibleSessionId = currentViewSessionResource || (typeof this.chatService.currentSessionId === 'string'
      ? this.chatService.currentSessionId.trim()
      : '');
    const activeResponseHandle = (readPreparedPendingFollowupRequestId(prepared) ?? targetSessionId) || null;
    if (targetSessionId) {
      const capabilities = resolveEngineRuntimeSessionCapabilities(
        this as unknown as Record<string, unknown>,
        targetSessionId,
      );
      const concurrencyScope = resolveEngineRuntimeSessionConcurrencyScope(
        this as unknown as Record<string, unknown>,
        targetSessionId,
      ) ?? null;
      if (typeof this.chatSessionRuntimeRegistry?.beginRequest === 'function') {
        this.chatSessionRuntimeRegistry.beginRequest(targetSessionId, {
          requestInProgress: true,
          supportsInterruption: true,
          activeResponseHandle,
          stopSession: () => this.lexStream.agent.stop(targetSessionId),
          disposeSession: () => this.lexStream.agent.dispose(targetSessionId),
          capabilities,
          concurrencyScope,
        }, {
          status: 'in_progress',
          attachedView: currentVisibleSessionId === targetSessionId,
        });
      } else {
        this.chatSessionRuntimeStore?.replaceRuntimeState(targetSessionId, {
          requestInProgress: true,
          status: 'in_progress',
          supportsInterruption: true,
          activeResponseHandle,
          attachedView: currentVisibleSessionId === targetSessionId,
          capabilities,
        }, {
          reason: 'state',
        });
      }
      this.triggerSyncDetectChanges();
    }

    try {
      this.lexStream.turn.begin(prepared.llmText, prepared.displayText, prepared.requestMetadata);
      if (targetSessionId) {
        const seededTurnResponses = (typeof this.lexStream.getTurnResponses === 'function'
          ? this.lexStream.getTurnResponses(targetSessionId)
          : this.lexStream.turnResponses) ?? [];
        if (seededTurnResponses.length > 0) {
          const syncExecutionRuntimeTurnResponses = (
            (this as unknown as { syncExecutionRuntimeTurnResponses?: ChatEngineService['syncExecutionRuntimeTurnResponses'] })
              .syncExecutionRuntimeTurnResponses
            ?? ChatEngineService.prototype['syncExecutionRuntimeTurnResponses']
          );
          syncExecutionRuntimeTurnResponses.call(this, targetSessionId, seededTurnResponses);
        }
      }
      const titleModel = this.chatService.currentModel as { model?: string; isCustom?: boolean; apiKey?: string; baseUrl?: string } | null;
      const hasCustomCredentials = !!(
        titleModel?.isCustom
        && typeof titleModel.apiKey === 'string'
        && titleModel.apiKey.trim().length > 0
        && typeof titleModel.baseUrl === 'string'
        && titleModel.baseUrl.trim().length > 0
      );
      console.info('[AilyChat][SendTitle]', {
        event: 'before-title-flow',
        sessionId: runtimeSessionId || this.chatService.currentSessionId,
        displayTextLength: (prepared.displayText || prepared.text).trim().length,
        requestTextLength: prepared.text.trim().length,
        requestTextPreview: prepared.text.trim().slice(0, 120),
        currentTitleBeforeSend: this.chatService.currentSessionTitle,
        currentModelId: titleModel?.model ?? '',
        currentModelIsCustom: titleModel?.isCustom === true,
        titleRequestUsesCustomLlmPath: hasCustomCredentials,
      });
      console.info('[AilyChat][RequestStateTrace]', {
        phase: 'sending',
        action: 'send',
        sessionId: runtimeSessionId || this.chatService.currentSessionId || null,
        requestId: readPreparedPendingFollowupRequestId(prepared),
        state: this.chatSessionRuntimeStore?.read?.(runtimeSessionId || this.chatService.currentSessionId || null)?.status
          ?? 'idle',
        sender: 'user',
        displayTextLength: (prepared.displayText || prepared.text).trim().length,
        requestTextLength: prepared.text.trim().length,
      });
      this.applyDefaultSessionTitleIfNeeded(prepared.displayText || prepared.text, runtimeSessionId);
      void this.titleCoordinator.generate(prepared.text, runtimeSessionId);
      traceBackgroundSessionExecution('send-turn-begin', {
        runtimeSessionId,
        sender: 'user',
      });
      if (clearInput) {
        const setSessionInputValue = (
          this as unknown as { setSessionInputValue?: (sessionId: string | null | undefined, value: unknown) => boolean }
        ).setSessionInputValue
          ?? ChatEngineService.prototype['setSessionInputValue'];
        setSessionInputValue.call(this, targetSessionId, '');
        this.triggerSyncDetectChanges();
      }

      traceBackgroundSessionExecution('send-turn-run-start', {
        runtimeSessionId,
      });
      const turnRunStartedAt = Date.now();
      console.info('[AilyChat][SendDebug] before turn.run', {
        runtimeSessionId: runtimeSessionId || null,
        requestTextLength: prepared.text.trim().length,
        displayTextLength: (prepared.displayText || prepared.text).trim().length,
      });
      await this.lexStream.turn.run(prepared.llmText, prepared.displayText);
      console.info('[AilyChat][SendDebug] after turn.run', {
        runtimeSessionId: runtimeSessionId || null,
        durationMs: Date.now() - turnRunStartedAt,
      });
    } finally {
      if (targetSessionId && typeof this.chatSessionRuntimeRegistry?.completeRequest === 'function') {
        this.chatSessionRuntimeRegistry.completeRequest(targetSessionId, activeResponseHandle, {
          pendingRequest: false,
        });
      }
    }
    traceBackgroundSessionExecution('send-turn-run-finished', {
      runtimeSessionId,
    });
    const postTurnStartedAt = Date.now();
    console.info('[AilyChat][SendDebug] after turn.run before finalize side-effects', {
      runtimeSessionId: runtimeSessionId || null,
    });
    this.acceptLiveRequestQuotaState(runtimeSessionId);
    this.refreshAuthQuotaStateAfterSuccessfulTurn(runtimeSessionId);
    console.info('[AilyChat][SendDebug] after quota side-effects', {
      runtimeSessionId: runtimeSessionId || null,
      durationMs: Date.now() - postTurnStartedAt,
    });

    const syncSessionId = runtimeSessionId
      || (typeof this.chatService.currentSessionId === 'string' ? this.chatService.currentSessionId.trim() : '');
    if (syncSessionId) {
      const syncResolvedActiveModelForSession = (
        (this as unknown as { syncResolvedActiveModelForSession?: ChatEngineService['syncResolvedActiveModelForSession'] })
          .syncResolvedActiveModelForSession
        ?? ChatEngineService.prototype['syncResolvedActiveModelForSession']
      );
      const resolvedModelProjected = await syncResolvedActiveModelForSession.call(this, syncSessionId);
      console.info('[AilyChat][SendDebug] after resolved model sync', {
        runtimeSessionId: runtimeSessionId || null,
        projected: resolvedModelProjected,
        durationMs: Date.now() - postTurnStartedAt,
      });
      if (resolvedModelProjected) {
        this.triggerSyncDetectChanges();
      }
    }

    const presentPendingPlanReviewFromLatestContinuation = (
      this as unknown as { presentPendingPlanReviewFromLatestContinuation?: (sessionId?: string | null) => Promise<void> }
    ).presentPendingPlanReviewFromLatestContinuation;
    void presentPendingPlanReviewFromLatestContinuation?.call(this, runtimeSessionId);

    if (syncSessionId) {
      const processPendingFollowupRequests = (
        this as unknown as { processPendingFollowupRequests?: (sessionId?: string | null) => Promise<boolean> }
      ).processPendingFollowupRequests
        ?? ChatEngineService.prototype['processPendingFollowupRequests'];
      await processPendingFollowupRequests.call(this, syncSessionId);
      await this.chatSessionRuntimeRegistry?.awaitPendingLexRequestCompleted(syncSessionId);
    }
  }

  async send(sender: string, content: string, clear: boolean = true, sessionId?: string | null): Promise<void> {
    await maybeAutoSwitchToDefaultModelAfterRateLimit(this);

    const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const runtimeOwnerOverride = typeof this.runtimeSessionOwnerOverride === 'string'
      ? this.runtimeSessionOwnerOverride.trim()
      : '';
    const currentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    ).call(this);
    const runtimeSessionId = explicitSessionId || runtimeOwnerOverride || currentViewSessionResource || (typeof this.resolveActiveRuntimeSessionId === 'function'
      ? this.resolveActiveRuntimeSessionId()
      : (typeof this.chatService?.currentSessionId === 'string' && this.chatService.currentSessionId.trim().length > 0
          ? this.chatService.currentSessionId.trim()
          : (typeof this.sessionId === 'string' ? this.sessionId.trim() : '')));
    if (runtimeSessionId && this.chatSessionRuntimeRegistry) {
      const syncRuntimeRequestHandleMetadata = (
        this as unknown as { syncRuntimeRequestHandleMetadata?: (sessionId?: string | null) => void }
      ).syncRuntimeRequestHandleMetadata
        ?? ChatEngineService.prototype['syncRuntimeRequestHandleMetadata'];
      syncRuntimeRequestHandleMetadata.call(this, runtimeSessionId);
      const activeHandle = this.chatSessionRuntimeRegistry.readHandle(runtimeSessionId);
      const canStartRequest = this.chatSessionRuntimeRegistry.canStartRequest(runtimeSessionId);
      traceBackgroundSessionExecution('send-gate-check', {
        runtimeSessionId,
        canStartRequest,
      });
      if (!canStartRequest) {
        this.queueFollowupMessage(content, runtimeSessionId, { kind: 'queued' });
        traceBackgroundSessionExecution('send-gated-before-run', {
          runtimeSessionId,
          activeRequestInProgress: activeHandle?.requestInProgress === true,
        });
        return;
      }
    }

    const executeSend = async () => {
      const sendExecutionStartedAt = Date.now();
      const setupSuggestionService = (this as unknown as {
        chatSetupSuggestionService?: Pick<ChatSetupSuggestionService, 'inspectRequest' | 'markSuggestionPresented'>;
      }).chatSetupSuggestionService;
      const runtimeInteractionHost = (this as unknown as {
        runtimeInteractionHost?: Pick<ChatRuntimeInteractionHostService, 'presentConfirmation'>;
      }).runtimeInteractionHost;
      const maybeRewriteContentForTestSetup = (
        this as unknown as { maybeRewriteContentForTestSetup?: (sender: string, content: string, sessionId?: string | null) => Promise<string> }
      ).maybeRewriteContentForTestSetup
        ?? ChatEngineService.prototype['maybeRewriteContentForTestSetup'];
      const shouldCheckTestSetup = sender === 'user'
        && !!runtimeSessionId
        && !this.isWaiting
        && !!setupSuggestionService?.inspectRequest
        && !!setupSuggestionService?.markSuggestionPresented
        && !!runtimeInteractionHost?.presentConfirmation;
      const effectiveContent = shouldCheckTestSetup && typeof maybeRewriteContentForTestSetup === 'function'
        ? await maybeRewriteContentForTestSetup.call(this, sender, content, runtimeSessionId)
        : content;

      const prepared = this.sendCoordinator.prepareSend(sender, effectiveContent);
      if (!prepared) return;

      if (sender === 'user') {
        this.configService?.scheduleHardwareIndexRefreshForAI?.('chat-send-latest');
      }

      const ensureBlankSessionRuntimeProviderOptions = (
        this as unknown as { ensureBlankSessionRuntimeProviderOptions?: (sessionId?: string | null) => Promise<void> }
      ).ensureBlankSessionRuntimeProviderOptions;
      if (typeof ensureBlankSessionRuntimeProviderOptions === 'function') {
        const ensureRuntimeStartedAt = Date.now();
        console.info('[AilyChat][SendDebug] before ensure runtime agent', {
          runtimeSessionId: runtimeSessionId || null,
          elapsedMs: ensureRuntimeStartedAt - sendExecutionStartedAt,
        });
        await ensureBlankSessionRuntimeProviderOptions.call(this, runtimeSessionId);
        console.info('[AilyChat][SendDebug] after ensure runtime agent', {
          runtimeSessionId: runtimeSessionId || null,
          durationMs: Date.now() - ensureRuntimeStartedAt,
          elapsedMs: Date.now() - sendExecutionStartedAt,
        });
      }

      const executePreparedUserSend = (
        this as unknown as {
          executePreparedUserSend?: (
            runtimeOwnerSessionId: string | null | undefined,
            preparedRequest: PreparedPendingFollowupRequest,
            options?: { clearInput?: boolean; activatePreparedUserTurn?: boolean },
          ) => Promise<void>;
        }
      ).executePreparedUserSend
        ?? ChatEngineService.prototype['executePreparedUserSend'];
      await executePreparedUserSend.call(this, runtimeSessionId, prepared, {
        clearInput: clear,
      });
    };

    const runWithRuntimeSessionOwner = (
      this as unknown as { runWithRuntimeSessionOwner?: <T>(sessionId: string, action: () => Promise<T>) => Promise<T> }
    ).runWithRuntimeSessionOwner;
    if (runtimeSessionId && typeof runWithRuntimeSessionOwner === 'function') {
      await runWithRuntimeSessionOwner.call(this, runtimeSessionId, executeSend);
      return;
    }

    await executeSend();
  }

  private applyDefaultSessionTitleIfNeeded(content: string, sessionId?: string | null): void {
    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentViewSessionResource = typeof resolveCurrentViewSessionResource === 'function'
      ? resolveCurrentViewSessionResource.call(this)
      : '';
    const modelStore = (this as unknown as {
      chatSessionModelStore?: Pick<ChatSessionModelStoreService, 'get' | 'updateMetadata'>;
    }).chatSessionModelStore;
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : currentViewSessionResource
        || (typeof this.chatService.currentSessionId === 'string' ? this.chatService.currentSessionId.trim() : '');
    const targetModel = targetSessionId ? modelStore?.get?.(targetSessionId) : undefined;
    const modelTitle = targetModel?.title;
    const currentTitle = modelTitle
      ? modelTitle.text
      : typeof this.chatService.currentSessionTitle === 'string'
        ? this.chatService.currentSessionTitle
        : '';
    const currentTitleSource = modelTitle?.source ?? this.chatService.currentSessionTitleSource;
    if (isMeaningfulRuntimeSessionTitle(currentTitle)
      && currentTitleSource !== 'default-first-request') {
      console.info('[AilyChat][SendTitle]', {
        event: 'skip-default-title-existing-meaningful',
        sessionId: targetSessionId || null,
        currentTitle,
        currentSource: currentTitleSource,
      });
      return;
    }

    const firstUserMessageContent = readFirstUserMessageContentFromTurnResponses(targetModel?.turnResponses)
      ?? (targetSessionId === currentViewSessionResource
        ? readFirstUserMessageContent(this.conversationMessages)
        : undefined);
    const defaultTitle = deriveDefaultSessionTitle(firstUserMessageContent ?? content);
    if (!defaultTitle) {
      console.info('[AilyChat][SendTitle]', {
        event: 'skip-default-title-empty',
        sessionId: targetSessionId || null,
        contentLength: typeof content === 'string' ? content.trim().length : 0,
      });
      return;
    }

    if (targetSessionId) {
      modelStore?.updateMetadata?.(targetSessionId, {
        title: {
          text: defaultTitle,
          source: 'default-first-request',
        },
      });
    }

    if (!targetSessionId || targetSessionId === currentViewSessionResource) {
      if (typeof this.chatService.setCurrentSessionTitle === 'function') {
        this.chatService.setCurrentSessionTitle({
          text: defaultTitle,
          source: 'default-first-request',
        });
      } else {
        this.chatService.currentSessionTitle = defaultTitle;
      }
    }
    if (targetSessionId) {
      this.chatSessionItemsService?.sessionItemController?.updateManagedChatSessionItemTitle?.(targetSessionId, {
        text: defaultTitle,
        source: 'default-first-request',
        revision: (!targetSessionId || targetSessionId === currentViewSessionResource) && typeof this.chatService.currentSessionTitleRevision === 'number'
          ? this.chatService.currentSessionTitleRevision
          : undefined,
      });
    }
    console.info('[AilyChat][SendTitle]', {
      event: 'apply-default-title',
      sessionId: targetSessionId || null,
      title: defaultTitle,
      source: firstUserMessageContent ? 'first-user-message' : 'current-content',
    });
  }

  private async maybeRewriteContentForTestSetup(
    sender: string,
    content: string,
    sessionId?: string | null,
  ): Promise<string> {
    const setupSuggestionService = (this as unknown as {
      chatSetupSuggestionService?: Pick<ChatSetupSuggestionService, 'inspectRequest' | 'markSuggestionPresented'>;
    }).chatSetupSuggestionService;
    const runtimeInteractionHost = (this as unknown as {
      runtimeInteractionHost?: Pick<ChatRuntimeInteractionHostService, 'presentConfirmation'>;
    }).runtimeInteractionHost;

    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (sender !== 'user'
      || !targetSessionId
      || this.isWaiting
      || !setupSuggestionService?.inspectRequest
      || !setupSuggestionService?.markSuggestionPresented
      || !runtimeInteractionHost?.presentConfirmation) {
      return content;
    }

    const suggestion = setupSuggestionService.inspectRequest(content);
    if (!suggestion) {
      return content;
    }

    setupSuggestionService.markSuggestionPresented(suggestion.projectKey);
    const decision = await runtimeInteractionHost.presentConfirmation(targetSessionId, {
      askId: `setup-tests:${suggestion.projectKey}`,
      partId: `setup-tests:${suggestion.projectKey}`,
      toolName: 'setup_tests',
      title: suggestion.title,
      subtitle: suggestion.subtitle,
      message: suggestion.message,
      actions: [],
      primaryScope: 'once',
      primaryLabel: TEST_SETUP_CONFIRMATION_PRIMARY_LABEL,
      primaryTooltip: TEST_SETUP_CONFIRMATION_PRIMARY_TOOLTIP,
      rejectLabel: TEST_SETUP_CONFIRMATION_REJECT_LABEL,
      rejectTooltip: TEST_SETUP_CONFIRMATION_REJECT_TOOLTIP,
    });

    return decision.approved ? suggestion.prompt : content;
  }

  private async resumeRestoredInteraction(
    content: string,
    interactionAction: NonNullable<TurnRequest['metadata']>['interactionAction'],
    requestMetadata?: TurnRequest['metadata'],
    sessionId?: string | null,
  ): Promise<void> {
    const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const runtimeSessionId = explicitSessionId
      || (typeof (this as unknown as { resolveActiveRuntimeSessionId?: () => string }).resolveActiveRuntimeSessionId === 'function'
      ? this.resolveActiveRuntimeSessionId()
      : (typeof this.sessionId === 'string' ? this.sessionId.trim() : ''));
    const requestInProgress = typeof (this as unknown as { readVisibleSessionRequestInProgress?: (sessionId?: string | null) => boolean }).readVisibleSessionRequestInProgress === 'function'
      ? this.readVisibleSessionRequestInProgress(runtimeSessionId)
      : this.isWaiting;
    if (!runtimeSessionId || requestInProgress) {
      return;
    }

    const resumeRequestMetadata = {
      ...(requestMetadata ?? {}),
      interactionAction,
    };
    this.lexStream.turn.begin(
      content,
      content,
      this.sendCoordinator?.applyRuntimeRequestMetadata?.(resumeRequestMetadata)
        ?? this.sendCoordinator?.applyRuntimePromptContext?.(resumeRequestMetadata)
        ?? resumeRequestMetadata,
    );
    await this.lexStream.turn.run(content, content);
    this.acceptLiveRequestQuotaState(runtimeSessionId);
    this.refreshAuthQuotaStateAfterSuccessfulTurn(runtimeSessionId);

    if (runtimeSessionId) {
      const syncResolvedActiveModelForSession = (
        (this as unknown as { syncResolvedActiveModelForSession?: ChatEngineService['syncResolvedActiveModelForSession'] })
          .syncResolvedActiveModelForSession
        ?? ChatEngineService.prototype['syncResolvedActiveModelForSession']
      );
      const resolvedModelProjected = await syncResolvedActiveModelForSession.call(this, runtimeSessionId);
      if (resolvedModelProjected) {
        this.triggerSyncDetectChanges();
      }
    }

    const presentPendingPlanReviewFromLatestContinuation = (
      this as unknown as { presentPendingPlanReviewFromLatestContinuation?: (sessionId?: string | null) => Promise<void> }
    ).presentPendingPlanReviewFromLatestContinuation;
    void presentPendingPlanReviewFromLatestContinuation?.call(this, runtimeSessionId);
  }

  private async submitSessionInteractionActionRequest(
    sessionId: string | null | undefined,
    content: string,
    interactionAction: NonNullable<TurnRequest['metadata']>['interactionAction'],
    requestMetadata?: TurnRequest['metadata'],
  ): Promise<void> {
    const explicitSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const targetSessionId = explicitSessionId || (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    ).call(this);
    if (!targetSessionId) {
      throw new Error('submitSessionInteractionActionRequest requires a sessionResource owner.');
    }

    await this.runWithRuntimeSessionOwner(targetSessionId, async () => {
      await this.ensureRuntimeAgentForSession(targetSessionId);
      await this.resumeRestoredInteraction(content, interactionAction, requestMetadata, targetSessionId);
    });
  }

  private readLatestInteractionContinuation(sessionId: string): TurnResponseTurn['response']['continuation'] | undefined {
    const turns = (
      (this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] })
        .readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses']
    ).call(this, sessionId);
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const continuation = turns[index]?.response?.continuation;
      if (continuation) {
        return continuation;
      }
    }

    return undefined;
  }

  private capturePlanReviewTransitionState(sessionId?: string | null): {
    readonly sessionId: string;
    readonly selectedMode: ChatSelectedMode;
    readonly providerOptions: HostSessionProviderOptions;
  } {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const resolveRuntimeSessionProviderOptions = (
      this as unknown as { resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions }
    ).resolveRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
    const resolveRuntimeSelectedMode = (
      this as unknown as { resolveRuntimeSelectedMode?: (sessionId?: string | null) => ChatSelectedMode }
    ).resolveRuntimeSelectedMode
      ?? ChatEngineService.prototype['resolveRuntimeSelectedMode'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    const providerOptions = resolveRuntimeSessionProviderOptions.call(this, targetSessionId);
    return {
      sessionId: targetSessionId,
      selectedMode: resolveRuntimeSelectedMode.call(this, targetSessionId),
      providerOptions,
    };
  }

  private async restorePlanReviewTransitionState(
    state: {
      readonly sessionId: string;
      readonly selectedMode: ChatSelectedMode;
      readonly providerOptions: HostSessionProviderOptions;
    },
  ): Promise<void> {
    const rememberRuntimeSessionProviderOptions = (
      this as unknown as {
        rememberRuntimeSessionProviderOptions?: (
          sessionId: string | null | undefined,
          providerOptions: Partial<HostSessionProviderOptions> | null | undefined,
        ) => HostSessionProviderOptions | null;
      }
    ).rememberRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['rememberRuntimeSessionProviderOptions'];
    const rememberRuntimeSelectedMode = (
      this as unknown as {
        rememberRuntimeSelectedMode?: (
          sessionId: string | null | undefined,
          selectedMode: ChatSelectedMode | null | undefined,
        ) => ChatSelectedMode | null;
      }
    ).rememberRuntimeSelectedMode
      ?? ChatEngineService.prototype['rememberRuntimeSelectedMode'];
    const shouldProjectRuntimeViewStateToVisibleOwner = (
      this as unknown as { shouldProjectRuntimeViewStateToVisibleOwner?: (sessionId?: string | null) => boolean }
    ).shouldProjectRuntimeViewStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectRuntimeViewStateToVisibleOwner'];
    rememberRuntimeSessionProviderOptions.call(this, state.sessionId, state.providerOptions);
    rememberRuntimeSelectedMode.call(this, state.sessionId, state.selectedMode);

    const shouldProjectToVisibleOwner = shouldProjectRuntimeViewStateToVisibleOwner.call(this, state.sessionId)
      || !(this as unknown as { chatSessionRuntimeStore?: unknown }).chatSessionRuntimeStore;
    if (!shouldProjectToVisibleOwner) {
      return;
    }

    const syncExecutionModeGuidanceNotice = (
      this as unknown as {
        syncExecutionModeGuidanceNotice?: (
          permissionLevel: unknown,
          approvalsReviewer: unknown,
          approvalPolicy: unknown,
        ) => void;
      }
    ).syncExecutionModeGuidanceNotice
      ?? ChatEngineService.prototype['syncExecutionModeGuidanceNotice'];

    this.chatService.setCurrentSessionPermissionMode(state.providerOptions.permissionMode);
    this.chatService.setCurrentSessionPermissionLevel(state.providerOptions.permissionLevel);
    this.chatService.setCurrentSessionApprovalsReviewer?.(state.providerOptions.approvalsReviewer);
    this.chatService.setCurrentSessionApprovalPolicy?.(state.providerOptions.approvalPolicy);
    syncExecutionModeGuidanceNotice.call(
      this,
      state.providerOptions.permissionLevel,
      state.providerOptions.approvalsReviewer,
      state.providerOptions.approvalPolicy,
    );

    if (state.selectedMode.customAgentTarget) {
      await this.switchToCustomAgent(state.selectedMode);
      return;
    }

    await this.switchToMode(state.selectedMode.modeId);
  }

  private async applyRuntimeSelectedModeTransition(
    sessionId: string | null | undefined,
    selectedMode: ChatSelectedMode,
  ): Promise<void> {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const rememberRuntimeSelectedMode = (
      this as unknown as {
        rememberRuntimeSelectedMode?: (
          sessionId: string | null | undefined,
          selectedMode: ChatSelectedMode | null | undefined,
        ) => ChatSelectedMode | null;
      }
    ).rememberRuntimeSelectedMode
      ?? ChatEngineService.prototype['rememberRuntimeSelectedMode'];
    const shouldProjectRuntimeViewStateToVisibleOwner = (
      this as unknown as { shouldProjectRuntimeViewStateToVisibleOwner?: (sessionId?: string | null) => boolean }
    ).shouldProjectRuntimeViewStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectRuntimeViewStateToVisibleOwner'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    const normalizedMode = rememberRuntimeSelectedMode.call(this, targetSessionId, selectedMode)
      ?? normalizeChatSelectedMode(selectedMode);

    const shouldProjectToVisibleOwner = shouldProjectRuntimeViewStateToVisibleOwner.call(this, targetSessionId)
      || !(this as unknown as { chatSessionRuntimeStore?: unknown }).chatSessionRuntimeStore;
    if (!shouldProjectToVisibleOwner) {
      return;
    }

    if (normalizedMode.customAgentTarget) {
      await this.switchToCustomAgent(normalizedMode);
      return;
    }

    await this.switchToMode(normalizedMode.modeId);
  }

  private async applyPlanReviewTransitionBeforeResume(
    sessionId: string | null | undefined,
    pendingReview: PendingPlanReview,
    result: RuntimePlanReviewDecision,
    currentRequestPermissionLevel?: string,
  ): Promise<void> {
    const resolveRuntimeSessionIdForOwner = (
      this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string }
    ).resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner'];
    const resolveRuntimeSessionProviderOptions = (
      this as unknown as { resolveRuntimeSessionProviderOptions?: (sessionId?: string | null) => HostSessionProviderOptions }
    ).resolveRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['resolveRuntimeSessionProviderOptions'];
    const rememberRuntimeSessionProviderOptions = (
      this as unknown as {
        rememberRuntimeSessionProviderOptions?: (
          sessionId: string | null | undefined,
          providerOptions: Partial<HostSessionProviderOptions> | null | undefined,
        ) => HostSessionProviderOptions | null;
      }
    ).rememberRuntimeSessionProviderOptions
      ?? ChatEngineService.prototype['rememberRuntimeSessionProviderOptions'];
    const shouldProjectRuntimeViewStateToVisibleOwner = (
      this as unknown as { shouldProjectRuntimeViewStateToVisibleOwner?: (sessionId?: string | null) => boolean }
    ).shouldProjectRuntimeViewStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectRuntimeViewStateToVisibleOwner'];
    const resolveRuntimeResolvedMode = (
      this as unknown as { resolveRuntimeResolvedMode?: (sessionId?: string | null) => ChatResolvedMode }
    ).resolveRuntimeResolvedMode
      ?? ChatEngineService.prototype['resolveRuntimeResolvedMode'];
    const applyRuntimeSelectedModeTransition = (
      this as unknown as {
        applyRuntimeSelectedModeTransition?: (
          sessionId: string | null | undefined,
          selectedMode: ChatSelectedMode,
        ) => Promise<void>;
      }
    ).applyRuntimeSelectedModeTransition
      ?? ChatEngineService.prototype['applyRuntimeSelectedModeTransition'];
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    const permissionMode = resolvePlanReviewPermissionMode(pendingReview, result);
    const permissionLevel = resolvePlanReviewPermissionLevel(pendingReview, result, currentRequestPermissionLevel);
    const baseProviderOptions = resolveRuntimeSessionProviderOptions.call(this, targetSessionId);
    const nextProviderOptions = rememberRuntimeSessionProviderOptions.call(this, targetSessionId, {
      ...baseProviderOptions,
      ...(permissionMode ? { permissionMode } : {}),
      permissionLevel,
    });

    const shouldProjectToVisibleOwner = shouldProjectRuntimeViewStateToVisibleOwner.call(this, targetSessionId)
      || !(this as unknown as { chatSessionRuntimeStore?: unknown }).chatSessionRuntimeStore;
    const syncExecutionModeGuidanceNotice = (
      this as unknown as {
        syncExecutionModeGuidanceNotice?: (
          permissionLevel: unknown,
          approvalsReviewer: unknown,
          approvalPolicy: unknown,
        ) => void;
      }
    ).syncExecutionModeGuidanceNotice
      ?? ChatEngineService.prototype['syncExecutionModeGuidanceNotice'];
    if (shouldProjectToVisibleOwner && permissionMode) {
      this.chatService.setCurrentSessionPermissionMode(permissionMode);
    }
    if (shouldProjectToVisibleOwner) {
      this.chatService.setCurrentSessionPermissionLevel(permissionLevel);
      this.chatService.setCurrentSessionApprovalsReviewer?.(nextProviderOptions?.approvalsReviewer);
      this.chatService.setCurrentSessionApprovalPolicy?.(nextProviderOptions?.approvalPolicy);
      syncExecutionModeGuidanceNotice.call(
        this,
        permissionLevel,
        nextProviderOptions?.approvalsReviewer,
        nextProviderOptions?.approvalPolicy,
      );
    }

    if (!shouldStartImplementationAfterPlanReview(pendingReview, result)) {
      return;
    }

    const handoff = resolveStartImplementationHandoff(resolveRuntimeResolvedMode.call(this, targetSessionId));
    if (!handoff) {
      await applyRuntimeSelectedModeTransition.call(this, targetSessionId, { modeId: 'agent' });
      return;
    }

    const targetMode = resolveChatSurfaceModeId(handoff.agent);
    if (targetMode) {
      await applyRuntimeSelectedModeTransition.call(this, targetSessionId, { modeId: targetMode });
      return;
    }

    await applyRuntimeSelectedModeTransition.call(this, targetSessionId, {
      modeId: 'agent',
      customAgentTarget: handoff.agent,
    });
    if (nextProviderOptions) {
      rememberRuntimeSessionProviderOptions.call(this, targetSessionId, nextProviderOptions);
    }
  }

  private async presentPendingPlanReviewFromLatestContinuation(sessionId?: string | null): Promise<void> {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : typeof (this as unknown as { resolveActiveRuntimeSessionId?: () => string }).resolveActiveRuntimeSessionId === 'function'
      ? this.resolveActiveRuntimeSessionId()
      : (typeof this.sessionId === 'string' ? this.sessionId.trim() : '');
    if (!targetSessionId) {
      return;
    }

    const turnResponses = (
      (this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] })
        .readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses']
    ).call(this, targetSessionId);
    const continuation = this.readLatestInteractionContinuation(targetSessionId);
    const pendingReview = readPendingPlanReview(continuation);
    const currentRequestPermissionLevel = readLatestPlanReviewRequestPermissionLevel(turnResponses);
    if (!continuation || !pendingReview) {
      return;
    }

    const activeReview = this.runtimeInteractionHost.getActivePlanReview(targetSessionId);
    if (activeReview?.id === pendingReview.id) {
      return;
    }

    try {
      const result = currentRequestPermissionLevel === AUTO_PLAN_REVIEW_PERMISSION_LEVEL
        ? resolvePlanReviewAutopilotDecision(pendingReview)
        : await this.runtimeInteractionHost.presentPlanReview(targetSessionId, pendingReview);
      const previousState = this.capturePlanReviewTransitionState(targetSessionId);

      try {
        await this.applyPlanReviewTransitionBeforeResume(targetSessionId, pendingReview, result, currentRequestPermissionLevel);
        await this.submitInteractionActionRequest(
          buildPlanReviewResumeContent(pendingReview, result),
          buildPlanReviewInteractionAction(continuation, result),
          resolvePlanReviewPermissionLevel(pendingReview, result, currentRequestPermissionLevel)
            ? {
                modeInfo: {
                  permissionLevel: resolvePlanReviewPermissionLevel(pendingReview, result, currentRequestPermissionLevel),
                },
              }
            : undefined,
          targetSessionId,
        );
      } catch (error) {
        try {
          await this.restorePlanReviewTransitionState(previousState);
        } catch {
          // Best effort: preserve the original interaction failure as the surfaced error.
        }
        throw error;
      }
    } catch {
      return;
    }
  }

  private syncExecutionModeGuidanceNotice(
    permissionLevel: unknown,
    approvalsReviewer: unknown,
    approvalPolicy: unknown,
  ): void {
    this.chatInputNoticeStateService?.syncExecutionModeNotice?.({
      permissionLevel: typeof permissionLevel === 'string' ? permissionLevel : null,
      approvalsReviewer: typeof approvalsReviewer === 'string' ? approvalsReviewer : null,
      approvalPolicy: typeof approvalPolicy === 'string' ? approvalPolicy : null,
    });
  }

  private refreshAuthQuotaStateAfterSuccessfulTurn(sessionId?: string | null): void {
    const shouldProjectQuotaStateToVisibleOwner = (
      this as unknown as { shouldProjectQuotaStateToVisibleOwner?: (sessionId?: string | null) => boolean }
    ).shouldProjectQuotaStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectQuotaStateToVisibleOwner'];
    if (!shouldProjectQuotaStateToVisibleOwner.call(this, sessionId)) {
      return;
    }
    // Successful turn responses already carry premium_interactions quota data.
    // Avoid a second auth/me quota fetch on every send; user center refreshes on demand.
  }

  private refreshAuthQuotaStateFromHost(): void {
    this.authQuotaStateService.syncAuthSnapshotFromHost();
  }

  private async refreshRequestQuotaState(): Promise<void> {
    await this.requestQuotaStateService.refresh();
  }

  private async syncResolvedActiveModelForSession(sessionId?: string | null): Promise<boolean> {
    const resolveRuntimeSessionIdForOwner = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    );
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (!targetSessionId) {
      return false;
    }

    const shouldProjectResolvedActiveModelToVisibleOwner = (
      this as unknown as { shouldProjectResolvedActiveModelToVisibleOwner?: (sessionId?: string | null) => boolean }
    ).shouldProjectResolvedActiveModelToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectResolvedActiveModelToVisibleOwner'];
    if (!shouldProjectResolvedActiveModelToVisibleOwner.call(this, targetSessionId)) {
      return false;
    }

    const runtimeTurnResponses = (
      (this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] })
        .readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses']
    ).call(this, targetSessionId);
    if (typeof this.chatService.syncResolvedActiveModelAfterSuccessfulTurn !== 'function') {
      return false;
    }
    await this.chatService.syncResolvedActiveModelAfterSuccessfulTurn(
      targetSessionId,
      runtimeTurnResponses,
    );
    return true;
  }

  private shouldProjectResolvedActiveModelToVisibleOwner(sessionId?: string | null): boolean {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!targetSessionId) {
      return false;
    }

    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentViewSessionResource = resolveCurrentViewSessionResource.call(this);
    return !!currentViewSessionResource && currentViewSessionResource === targetSessionId;
  }

  private acceptLiveRequestQuotaState(sessionId?: string | null): void {
    const resolveRuntimeSessionIdForOwner = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    );
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    const runtimeTurnResponses = (
      (this as unknown as { readSessionTurnResponses?: (sessionId: string) => readonly TurnResponseTurn[] })
        .readSessionTurnResponses
      ?? ChatEngineService.prototype['readSessionTurnResponses']
    ).call(this, targetSessionId);
    const syncRuntimeQuotaOverlayFromTurnResponses = (
      this as unknown as {
        syncRuntimeQuotaOverlayFromTurnResponses?: (
          sessionId: string | null | undefined,
          turnResponses: readonly TurnResponseTurn[] | null | undefined,
        ) => ChatSessionRuntimeQuotaOverlay | null;
      }
    ).syncRuntimeQuotaOverlayFromTurnResponses
      ?? ChatEngineService.prototype['syncRuntimeQuotaOverlayFromTurnResponses'];
    syncRuntimeQuotaOverlayFromTurnResponses.call(this, targetSessionId || undefined, runtimeTurnResponses);

    const shouldProjectQuotaStateToVisibleOwner = (
      this as unknown as { shouldProjectQuotaStateToVisibleOwner?: (sessionId?: string | null) => boolean }
    ).shouldProjectQuotaStateToVisibleOwner
      ?? ChatEngineService.prototype['shouldProjectQuotaStateToVisibleOwner'];
    if (!shouldProjectQuotaStateToVisibleOwner.call(this, targetSessionId || undefined)) {
      return;
    }

    this.requestQuotaStateService.acceptTurnResponseQuotaSnapshot(runtimeTurnResponses);
    this.projectAuthQuotaStateFromRequestQuota();
  }

  private shouldProjectQuotaStateToVisibleOwner(sessionId?: string | null): boolean {
    const resolveRuntimeSessionIdForOwner = (
      (this as unknown as { resolveRuntimeSessionIdForOwner?: (sessionId?: string | null) => string })
        .resolveRuntimeSessionIdForOwner
      ?? ChatEngineService.prototype['resolveRuntimeSessionIdForOwner']
    );
    const targetSessionId = resolveRuntimeSessionIdForOwner.call(this, sessionId);
    if (!targetSessionId) {
      return false;
    }

    const resolveCurrentViewSessionResource = (
      (this as unknown as { resolveCurrentViewSessionResource?: ChatEngineService['resolveCurrentViewSessionResource'] })
        .resolveCurrentViewSessionResource
      ?? ChatEngineService.prototype['resolveCurrentViewSessionResource']
    );
    const currentSessionId = resolveCurrentViewSessionResource.call(this);
    return !!currentSessionId && currentSessionId === targetSessionId;
  }

  private syncRuntimeQuotaOverlayFromTurnResponses(
    sessionId: string | null | undefined,
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
  ): ChatSessionRuntimeQuotaOverlay | null {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0
      ? sessionId.trim()
      : (typeof (this as unknown as { resolveActiveRuntimeSessionId?: () => string }).resolveActiveRuntimeSessionId === 'function'
          ? this.resolveActiveRuntimeSessionId()
          : '');
    if (!targetSessionId) {
      return null;
    }

    const quotaOverlay = buildRuntimeQuotaOverlayFromTurnResponses(turnResponses);
    if (!quotaOverlay) {
      return null;
    }

    const runtimeStatePatch = {
      quotaOverlay,
      debugSummary: {
        quotaOverlayPresent: true,
        requestQuotaNotice: !!quotaOverlay.requestInputNotice,
        authQuotaProjected: !!quotaOverlay.authQuotaInfo,
      },
    };
    if (this.chatSessionRuntimeRegistry) {
      this.chatSessionRuntimeRegistry.projectRuntimeState(targetSessionId, runtimeStatePatch);
    } else if (this.chatSessionRuntimeStore) {
      this.chatSessionRuntimeStore.replaceRuntimeState(targetSessionId, runtimeStatePatch);
    }
    return quotaOverlay;
  }

  private projectRuntimeQuotaOverlayToVisibleServices(
    runtimeState: ChatSessionRuntimeState | null | undefined,
    sessionId?: string | null,
  ): void {
    const targetSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (targetSessionId) {
      const shouldProjectQuotaStateToVisibleOwner = (
        this as unknown as { shouldProjectQuotaStateToVisibleOwner?: (sessionId?: string | null) => boolean }
      ).shouldProjectQuotaStateToVisibleOwner
        ?? ChatEngineService.prototype['shouldProjectQuotaStateToVisibleOwner'];
      if (!shouldProjectQuotaStateToVisibleOwner.call(this, targetSessionId)) {
        return;
      }
    }

    const turnResponses = runtimeState?.turnResponses ?? [];
    const quotaOverlay = runtimeState?.quotaOverlay ?? buildRuntimeQuotaOverlayFromTurnResponses(turnResponses);
    if (!quotaOverlay) {
      this.requestQuotaStateService.clear();
      this.chatInputNoticeStateService.acceptProjectedRuntimeNotice(null);
      return;
    }

    if (turnResponses.length > 0) {
      this.requestQuotaStateService.acceptTurnResponseQuotaSnapshot(turnResponses);
    } else if (quotaOverlay.requestQuotaState) {
      this.requestQuotaStateService.replaceProjectedState(quotaOverlay.requestQuotaState);
    } else {
      this.requestQuotaStateService.clear();
    }
    this.chatInputNoticeStateService.acceptProjectedRuntimeNotice(
      quotaOverlay.requestInputNotice ?? null,
    );
    this.projectAuthQuotaStateFromRequestQuota(
      quotaOverlay.requestQuotaState ?? this.requestQuotaStateService.getSnapshot(),
    );
  }

  private projectAuthQuotaStateFromRequestQuota(
    requestQuotaState: RequestQuotaServiceState | null | undefined = this.requestQuotaStateService.getSnapshot(),
  ): void {
    const quotaInfo = createAuthQuotaInfoFromRequestQuotaState(requestQuotaState);
    if (!quotaInfo) {
      return;
    }

    const hostMetadata = readAuthQuotaStateSnapshot(AilyHost.get().auth.getSnapshot?.() ?? null);
    this.authQuotaStateService.acceptProjectedQuotaInfo(quotaInfo, {
      ...(typeof hostMetadata.plan === 'string' ? { plan: hostMetadata.plan } : {}),
      ...(typeof hostMetadata.serviceTier === 'string' ? { serviceTier: hostMetadata.serviceTier } : {}),
      ...(typeof hostMetadata.subscriptionStatus === 'string'
        ? { subscriptionStatus: hostMetadata.subscriptionStatus }
        : {}),
      ...(typeof hostMetadata.subscriptionEndDate === 'string'
        ? { subscriptionEndDate: hostMetadata.subscriptionEndDate }
        : {}),
    });
  }

  resetChat(): Promise<void> { return this.session.newChat(); }

  private async requestNewChatFromPane(): Promise<void> {
    const requestNewChat = this.paneSessionCommandHandlers.requestNewChat;
    if (typeof requestNewChat === 'function') {
      await requestNewChat();
      return;
    }

    await this.newChat();
  }

  // ==================== 停止 ====================

  stop(sessionId?: string | null): boolean {
    return this.stopSessionAction(sessionId);
  }

  // ==================== 模式 / 模型切换 ====================

  async switchToModel(model: ModelConfig): Promise<void> {
    await this.switchCoordinator.switchToModel(model);
  }

  async switchToMode(mode: string): Promise<void> {
    await this.switchCoordinator.switchToMode(mode);
  }

  async switchToCustomAgent(selection: { readonly modeId?: string; readonly customAgentTarget?: string }): Promise<void> {
    await this.switchCoordinator.switchToCustomAgent(selection);
  }

  async switchToReasoningEffort(reasoningEffort: NonNullable<ModelConfig['reasoningEffort']>): Promise<void> {
    await this.switchCoordinator.switchToReasoningEffort(reasoningEffort);
  }

  async switchToModelConfiguration(
    model: ModelConfig,
    update: { key: string; value: unknown },
  ): Promise<void> {
    await this.switchCoordinator.switchToModelConfiguration(model, update);
  }

  /**
   * 应用延迟的模型/模式切换。
   * 在 turn 完成（finalizeStatelessTurn / stream complete / stop）后调用。
   */
  async applyPendingSwitch(sessionId?: string | null): Promise<void> {
    await this.switchCoordinator.applyPendingSwitch(sessionId);
  }

  // ==================== 任务操作 ====================

  private handleTaskAction(event: ChatTaskActionEvent): void {
    this.taskActionCoordinator.handle(event.detail);
  }

  async continueConversation(): Promise<void> {
    await this.conversationActionCoordinator.continueConversation();
  }

  async retryLastAction(): Promise<void> {
    await this.conversationActionCoordinator.retryLastAction();
  }

  // ==================== 委托到 EditActionsHelper ====================

  editAndResendFromTurn(target: DialogTurnContext, newText: string, resources: ResourceItem[]): Promise<void> {
    return this.editActions.editAndResendFromTurn(target, newText, resources);
  }

  // ==================== 委托到 UserInteractionHelper ====================

  handleToolApproval(
    request: import('../helpers/tool-approval-ui').ToolApprovalRequest,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    return this.interaction.handleToolApproval(request);
  }

  resolveAskUserResponse(answer: string, wasFreeform: boolean, sessionId?: string | null): void {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : this.resolveCurrentViewSessionResource();
    this.interaction.resolveAskUserResponse(answer, wasFreeform, targetSessionId);
  }

  skipAskUserResponse(sessionId?: string | null): void {
    const targetSessionId = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : this.resolveCurrentViewSessionResource();
    this.interaction.skipAskUserResponse(targetSessionId);
  }

  approveToolExecution(
    toolCallId: string,
    scope: 'once' | 'session' | 'workspace' | 'session-all-terminal' | 'session-safe' = 'once',
    actionId?: string,
  ): void {
    this.interaction.approveToolExecution(toolCallId, scope, actionId);
  }

  rejectToolExecution(toolCallId: string, reason?: string): void {
    this.interaction.rejectToolExecution(toolCallId, reason);
  }
}

function deriveDefaultSessionTitle(content: unknown): string {
  if (typeof content !== 'string') {
    return '';
  }

  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return '';
  }

  const firstLine = normalizedContent.split('\n')[0]?.trim() ?? '';
  if (!firstLine) {
    return '';
  }

  return firstLine.substring(0, 200);
}

function readFirstUserMessageContent(messages: unknown): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }

  for (const message of messages) {
    const role = typeof (message as { role?: unknown })?.role === 'string'
      ? ((message as { role?: string }).role ?? '').trim().toLowerCase()
      : '';
    if (role !== 'user') {
      continue;
    }

    const content = (message as { content?: unknown })?.content;
    if (typeof content === 'string' && content.trim().length > 0) {
      return content;
    }
  }

  return undefined;
}

function readFirstUserMessageContentFromTurnResponses(turnResponses: readonly unknown[] | null | undefined): string | undefined {
  if (!Array.isArray(turnResponses) || turnResponses.length === 0) {
    return undefined;
  }

  for (const turnResponse of turnResponses) {
    const request = (turnResponse as { request?: unknown })?.request;
    const direct = readRequestTextContent(request);
    if (direct) {
      return direct;
    }
    if (request && typeof request === 'object') {
      const nested = readRequestTextContent((request as { message?: unknown }).message);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function readRequestTextContent(candidate: unknown): string | undefined {
  const text = typeof candidate === 'string'
    ? candidate
    : candidate && typeof candidate === 'object'
      ? ((candidate as { messageText?: unknown }).messageText
        ?? (candidate as { prompt?: unknown }).prompt
        ?? (candidate as { text?: unknown }).text
        ?? (candidate as { content?: unknown }).content)
      : undefined;

  return typeof text === 'string' && text.trim().length > 0
    ? text
    : undefined;
}

function isMeaningfulRuntimeSessionTitle(title: unknown): boolean {
  if (typeof title !== 'string') {
    return false;
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return false;
  }

  const loweredTitle = normalizedTitle.toLowerCase();
  if (loweredTitle === 'new chat'
    || loweredTitle === 'new session'
    || loweredTitle === 'current session'
    || loweredTitle === '新对话'
    || loweredTitle === '新会话') {
    return false;
  }

  if (/^untitled(?:\s+chat)?(?:\s*\d+)?$/i.test(normalizedTitle)) {
    return false;
  }

  return !/^lex-\d{6,}$/i.test(normalizedTitle);
}

async function maybeAutoSwitchToDefaultModelAfterRateLimit(engine: {
  chatService?: {
    currentModel?: ModelConfig | null;
    getRateLimitAutoSwitchToAutoEnabled?: () => boolean;
  };
  hostResponseProjection?: HostResponseProjection | null;
  ailyChatConfigService?: {
    getDefaultModelPresetId: () => string;
    resolveSelectablePresetModel: (presetId: string) => ModelConfig | null;
  };
  switchToModel?: (model: ModelConfig) => Promise<void>;
}): Promise<void> {
  if (!engine.chatService?.getRateLimitAutoSwitchToAutoEnabled?.()) {
    return;
  }

  if (isDefaultAutoPresetSelected(engine.chatService.currentModel)) {
    return;
  }

  const latestErrorCode = readLatestErrorCode(engine.hostResponseProjection);
  if (!latestErrorCode?.startsWith('user_model_rate_limited')) {
    return;
  }

  const configService = engine.ailyChatConfigService;
  if (!configService) {
    return;
  }

  const autoModel = configService.resolveSelectablePresetModel(configService.getDefaultModelPresetId());
  if (!autoModel || typeof engine.switchToModel !== 'function') {
    return;
  }

  await engine.switchToModel(autoModel);
}

function readLatestErrorCode(hostProjection: HostResponseProjection | null | undefined): string | undefined {
  const turns = hostProjection?.turnResponses;
  if (!Array.isArray(turns) || turns.length === 0) {
    return undefined;
  }

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const parts = turns[turnIndex]?.response?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex] as {
        type?: string;
        metadata?: { errorDetails?: { code?: unknown } };
      };
      if (part?.type !== 'error') {
        continue;
      }

      const errorCode = part.metadata?.errorDetails?.code;
      if (typeof errorCode === 'string' && errorCode.trim().length > 0) {
        return errorCode;
      }
    }
  }

  return undefined;
}
