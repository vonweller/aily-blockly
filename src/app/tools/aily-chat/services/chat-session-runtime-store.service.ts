import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import type { TurnResponseTurn } from 'aily-lex/browser';
import {
  DEFAULT_CHAT_SESSION_TYPE,
  LOCAL_CHAT_SESSION_TYPE,
  normalizeChatSessionType,
  type ChatSelectedMode,
} from '../core/chat-mode';
import type { ChatSessionTitleSource } from '../core/chat-session-title';
import type { HostTurnResponseState } from '../helpers/host-turn-response-state';
import type { PendingFollowupRequest } from '../helpers/chat-pending-request';
import type { HostSessionProviderOptions } from '../helpers/host-session-input-state';
import type { AuthQuotaInfo } from './auth-quota-state.service';
import type { ChatInputNotice } from './chat-input-notice';
import type { ContextBudgetSnapshot } from './context-budget-snapshot';
import type { RequestQuotaSnapshot } from './request-quota-snapshot';
import type { RequestQuotaServiceState } from './request-quota-state.service';

export type ChatSessionRuntimeStatus = 'in_progress' | 'needs_input' | 'completed' | 'cancelled' | 'failed';

type ChatSessionRuntimeTracePhase = 'idle' | 'running' | 'needs_input' | 'completed' | 'cancelled' | 'failed';

const REQUEST_STATE_TRACE_PREFIX = '[AilyChat][RequestStateTrace]';

export type ChatSessionRuntimeChangeReason =
  | 'transcript'
  | 'status'
  | 'description'
  | 'view'
  | 'quota'
  | 'debug'
  | 'handle'
  | 'state'
  | 'clear'
  | 'clearAll';

export interface ChatSessionRuntimeChangedEvent {
  readonly sessionId: string | null;
  readonly reason: ChatSessionRuntimeChangeReason;
  readonly listAffecting: boolean;
  readonly highFrequency?: boolean;
}

export interface ChatSessionRuntimeCapabilities {
  readonly canRunConcurrently: boolean;
  readonly canContinueInPlace: boolean;
  readonly supportsBackgroundPersistence: boolean;
}

export interface ChatSessionRuntimeDebugSummary {
  readonly durableHostRecordPresent?: boolean;
  readonly liveRuntimeOverlayPresent: boolean;
  readonly pendingRequest: boolean;
  readonly needsInput: boolean;
  readonly attachedView: boolean;
  readonly title?: string;
  readonly titleSource?: ChatSessionTitleSource;
  readonly titleRevision?: number;
  readonly quotaOverlayPresent?: boolean;
  readonly requestQuotaNotice?: boolean;
  readonly authQuotaProjected?: boolean;
  readonly contextBudgetOverlayPresent?: boolean;
  readonly inputNoticeOverlayPresent?: boolean;
  readonly providerOptionsPresent?: boolean;
  readonly selectedModePresent?: boolean;
  readonly lastExplicitInterruptAt?: number;
  readonly lastExplicitDisposeAt?: number;
  readonly lastViewDetachAt?: number;
}

export interface ChatSessionRuntimeQuotaOverlay {
  readonly requestQuotaState?: RequestQuotaServiceState | null;
  readonly requestQuotaSnapshot?: RequestQuotaSnapshot | null;
  readonly requestInputNotice?: ChatInputNotice | null;
  readonly authQuotaInfo?: AuthQuotaInfo | null;
  readonly updatedAt: number;
}

export interface ChatSessionRuntimeViewOverlay {
  readonly contextBudgetSnapshot?: ContextBudgetSnapshot | null;
  readonly chatInputNotice?: ChatInputNotice | null;
  readonly updatedAt: number;
}

export interface ChatSessionRuntimeState {
  readonly turnResponses: readonly TurnResponseTurn[];
  readonly hostProjectionState: HostTurnResponseState | null;
  readonly pendingFollowupRequests?: readonly PendingFollowupRequest[];
  readonly yieldRequested?: boolean;
  readonly status?: ChatSessionRuntimeStatus;
  readonly description?: string;
  readonly requestInProgress: boolean;
  readonly attachedView: boolean;
  readonly supportsInterruption: boolean;
  readonly activeResponseHandle?: unknown;
  readonly stopSession?: () => void;
  readonly disposeSession?: () => void;
  readonly capabilities?: ChatSessionRuntimeCapabilities;
  readonly debugSummary?: ChatSessionRuntimeDebugSummary;
  readonly quotaOverlay?: ChatSessionRuntimeQuotaOverlay;
  readonly viewOverlay?: ChatSessionRuntimeViewOverlay;
  readonly providerOptions?: HostSessionProviderOptions;
  readonly selectedMode?: ChatSelectedMode;
}

function resolveRuntimeTracePhase(
  state: ChatSessionRuntimeState | undefined,
): ChatSessionRuntimeTracePhase {
  if (state?.requestInProgress === true) {
    return 'running';
  }

  switch (state?.status) {
    case 'needs_input':
      return 'needs_input';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    default:
      return 'idle';
  }
}

function isTerminalRuntimeStatus(
  status: ChatSessionRuntimeStatus | undefined,
): status is Extract<ChatSessionRuntimeStatus, 'completed' | 'cancelled' | 'failed'> {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

export const DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES: ChatSessionRuntimeCapabilities = {
  canRunConcurrently: true,
  canContinueInPlace: false,
  supportsBackgroundPersistence: true,
};

export interface ChatSessionRuntimeCapabilityOwner {
  readonly sessionType?: unknown;
  readonly providerTarget?: unknown;
  readonly customAgentTarget?: unknown;
  readonly remoteProviderHandle?: unknown;
  readonly customModeSource?: unknown;
  readonly sessionCustomizationProviderLabel?: unknown;
  readonly sessionCustomizationProviderIconId?: unknown;
}

export function resolveChatSessionRuntimeCapabilities(
  owner?: ChatSessionRuntimeCapabilityOwner | null,
): ChatSessionRuntimeCapabilities {
  const sessionType = normalizeChatSessionType(owner?.sessionType, DEFAULT_CHAT_SESSION_TYPE);
  if (sessionType === LOCAL_CHAT_SESSION_TYPE) {
    return { ...DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES };
  }

  return {
    canRunConcurrently: false,
    canContinueInPlace: false,
    supportsBackgroundPersistence: true,
  };
}

export function resolveChatSessionRuntimeConcurrencyScope(
  owner?: ChatSessionRuntimeCapabilityOwner | null,
): string | undefined {
  const capabilities = resolveChatSessionRuntimeCapabilities(owner);
  if (capabilities.canRunConcurrently) {
    return undefined;
  }

  const sessionType = normalizeChatSessionType(owner?.sessionType, DEFAULT_CHAT_SESSION_TYPE);
  const remoteProviderHandle = normalizeRuntimeConcurrencyScopeSegment(owner?.remoteProviderHandle);
  const providerTarget = normalizeRuntimeConcurrencyScopeSegment(owner?.providerTarget);
  const customAgentTarget = normalizeRuntimeConcurrencyScopeSegment(owner?.customAgentTarget);
  const customModeSource = normalizeRuntimeConcurrencyScopeSegment(owner?.customModeSource);
  const sessionCustomizationProviderLabel = normalizeRuntimeConcurrencyScopeSegment(owner?.sessionCustomizationProviderLabel);
  const sessionCustomizationProviderIconId = normalizeRuntimeConcurrencyScopeSegment(owner?.sessionCustomizationProviderIconId);
  return [
    `session-type:${sessionType}`,
    ...(remoteProviderHandle ? [`remote:${remoteProviderHandle}`] : []),
    ...(!remoteProviderHandle && providerTarget ? [`target:${providerTarget}`] : []),
    ...(customAgentTarget ? [`agent:${customAgentTarget}`] : []),
    ...(customModeSource ? [`mode-source:${customModeSource}`] : []),
    ...(sessionCustomizationProviderLabel ? [`customization:${sessionCustomizationProviderLabel}`] : []),
    ...(sessionCustomizationProviderIconId ? [`customization-icon:${sessionCustomizationProviderIconId}`] : []),
  ].join('|');
}

function normalizeRuntimeConcurrencyScopeSegment(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().replace(/[\\]+/g, '/').replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized.toLowerCase() : undefined;
}

export type ChatSessionRuntimeStatePatch = Omit<
  Partial<ChatSessionRuntimeState>,
  | 'turnResponses'
  | 'hostProjectionState'
  | 'status'
  | 'description'
  | 'activeResponseHandle'
  | 'stopSession'
  | 'disposeSession'
  | 'capabilities'
  | 'debugSummary'
  | 'quotaOverlay'
  | 'viewOverlay'
  | 'providerOptions'
  | 'selectedMode'
> & {
  readonly turnResponses?: readonly TurnResponseTurn[] | null | undefined;
  readonly hostProjectionState?: HostTurnResponseState | null | undefined;
  readonly pendingFollowupRequests?: readonly PendingFollowupRequest[] | null | undefined;
  readonly yieldRequested?: boolean | null | undefined;
  readonly status?: ChatSessionRuntimeStatus | null | undefined;
  readonly description?: string | null | undefined;
  readonly activeResponseHandle?: unknown | null | undefined;
  readonly stopSession?: (() => void) | null;
  readonly disposeSession?: (() => void) | null;
  readonly capabilities?: Partial<ChatSessionRuntimeCapabilities> | null | undefined;
  readonly debugSummary?: Partial<ChatSessionRuntimeDebugSummary> | null | undefined;
  readonly quotaOverlay?: ChatSessionRuntimeQuotaOverlay | null | undefined;
  readonly viewOverlay?: ChatSessionRuntimeViewOverlay | null | undefined;
  readonly providerOptions?: HostSessionProviderOptions | null | undefined;
  readonly selectedMode?: ChatSelectedMode | null | undefined;
};

export interface ChatSessionRuntimeChangeOptions {
  readonly reason?: ChatSessionRuntimeChangeReason;
  readonly listAffecting?: boolean;
  readonly highFrequency?: boolean;
}

interface ChatSessionListFingerprint {
  readonly requestInProgress: boolean;
  readonly status?: ChatSessionRuntimeStatus;
  readonly description?: string;
  readonly attachedView: boolean;
  readonly supportsInterruption: boolean;
  readonly hasActiveResponseHandle: boolean;
  readonly derivedTurnStatus?: ChatSessionRuntimeStatus;
  readonly derivedTurnDescription?: string;
}

@Injectable()
export class ChatSessionRuntimeStoreService {
  private readonly runtimeStates = new Map<string, ChatSessionRuntimeState>();
  private readonly runtimeChangedSubject = new Subject<ChatSessionRuntimeChangedEvent>();

  readonly runtimeChanged$ = this.runtimeChangedSubject.asObservable();

  read(sessionId: string | null | undefined): ChatSessionRuntimeState | undefined {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    return normalizedSessionId
      ? this.runtimeStates.get(normalizedSessionId)
      : undefined;
  }

  readTurnResponses(sessionId: string | null | undefined): readonly TurnResponseTurn[] | undefined {
    return this.read(sessionId)?.turnResponses;
  }

  readHostProjectionState(sessionId: string | null | undefined): HostTurnResponseState | null | undefined {
    return this.read(sessionId)?.hostProjectionState;
  }

  getSessionIds(): readonly string[] {
    return [...this.runtimeStates.keys()];
  }

  replaceRuntimeState(
    sessionId: string | null | undefined,
    state: ChatSessionRuntimeStatePatch,
    options?: ChatSessionRuntimeChangeOptions,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const previousState = this.runtimeStates.get(normalizedSessionId);
    const nextTurnResponses = Array.isArray(state.turnResponses)
      ? [...state.turnResponses]
      : previousState?.turnResponses ?? [];
    const nextHostProjectionState = state.hostProjectionState !== undefined
      ? state.hostProjectionState ?? null
      : previousState?.hostProjectionState ?? null;
    const nextPendingFollowupRequests = state.pendingFollowupRequests !== undefined
      ? this.clonePendingFollowupRequests(state.pendingFollowupRequests ?? undefined)
      : previousState?.pendingFollowupRequests;
    const nextYieldRequested = state.yieldRequested !== undefined
      ? state.yieldRequested === true
      : previousState?.yieldRequested === true;
    const resolvedNextStatus = this.resolveNextStatus(state.status, previousState, nextTurnResponses);
    const nextRequestInProgress = typeof state.requestInProgress === 'boolean'
      ? state.requestInProgress
      : isTerminalRuntimeStatus(resolvedNextStatus)
        ? false
        : previousState?.requestInProgress ?? false;
    const nextStatus = !nextRequestInProgress && resolvedNextStatus === 'in_progress'
      ? undefined
      : resolvedNextStatus;
    const nextDescription = this.resolveNextDescription(state.description, previousState);
    const nextActiveResponseHandle = state.activeResponseHandle !== undefined
      ? state.activeResponseHandle ?? undefined
      : nextRequestInProgress
        ? previousState?.activeResponseHandle
        : undefined;
    const nextSupportsInterruption = typeof state.supportsInterruption === 'boolean'
      ? state.supportsInterruption
      : nextRequestInProgress
        ? previousState?.supportsInterruption ?? false
        : false;
    const nextCapabilities = this.resolveNextCapabilities(state.capabilities, previousState);
    const nextQuotaOverlay = state.quotaOverlay !== undefined
      ? state.quotaOverlay ?? undefined
      : previousState?.quotaOverlay;
    const nextViewOverlay = state.viewOverlay !== undefined
      ? state.viewOverlay ?? undefined
      : previousState?.viewOverlay;
    const nextProviderOptions = state.providerOptions !== undefined
      ? state.providerOptions ?? undefined
      : previousState?.providerOptions;
    const nextSelectedMode = state.selectedMode !== undefined
      ? state.selectedMode ?? undefined
      : previousState?.selectedMode;
    const nextState: ChatSessionRuntimeState = {
      turnResponses: nextTurnResponses,
      hostProjectionState: nextHostProjectionState,
      ...(nextPendingFollowupRequests?.length ? { pendingFollowupRequests: nextPendingFollowupRequests } : {}),
      ...(nextYieldRequested ? { yieldRequested: true } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(nextDescription ? { description: nextDescription } : {}),
      requestInProgress: nextRequestInProgress,
      attachedView: typeof state.attachedView === 'boolean'
        ? state.attachedView
        : previousState?.attachedView ?? false,
      supportsInterruption: nextSupportsInterruption,
      ...(nextActiveResponseHandle !== undefined ? { activeResponseHandle: nextActiveResponseHandle } : {}),
      ...(nextQuotaOverlay ? { quotaOverlay: this.cloneQuotaOverlay(nextQuotaOverlay) } : {}),
      ...(nextViewOverlay ? { viewOverlay: this.cloneViewOverlay(nextViewOverlay) } : {}),
      ...(nextProviderOptions ? { providerOptions: this.cloneProviderOptions(nextProviderOptions) } : {}),
      ...(nextSelectedMode ? { selectedMode: this.cloneSelectedMode(nextSelectedMode) } : {}),
      ...(typeof state.stopSession === 'function'
        ? { stopSession: state.stopSession }
        : state.stopSession === null
          ? {}
        : nextSupportsInterruption && previousState?.stopSession
          ? { stopSession: previousState.stopSession }
          : {}),
      ...(typeof state.disposeSession === 'function'
        ? { disposeSession: state.disposeSession }
        : state.disposeSession === null
          ? {}
        : previousState?.disposeSession
          ? { disposeSession: previousState.disposeSession }
          : {}),
      capabilities: nextCapabilities,
      debugSummary: this.resolveNextDebugSummary(state.debugSummary, previousState, {
        requestInProgress: nextRequestInProgress,
        attachedView: typeof state.attachedView === 'boolean'
          ? state.attachedView
          : previousState?.attachedView ?? false,
        status: nextStatus,
        hasLiveOverlay: nextRequestInProgress
          || nextTurnResponses.length > 0
          || !!nextHostProjectionState
          || !!nextStatus
          || !!nextDescription
          || !!nextQuotaOverlay
          || !!nextViewOverlay
          || !!nextProviderOptions
          || !!nextSelectedMode,
        quotaOverlayPresent: !!nextQuotaOverlay,
        requestQuotaNotice: !!nextQuotaOverlay?.requestInputNotice,
        authQuotaProjected: !!nextQuotaOverlay?.authQuotaInfo,
        contextBudgetOverlayPresent: !!nextViewOverlay?.contextBudgetSnapshot,
        inputNoticeOverlayPresent: !!nextViewOverlay?.chatInputNotice,
        providerOptionsPresent: !!nextProviderOptions,
        selectedModePresent: !!nextSelectedMode,
      }),
    };

    if (!nextState.requestInProgress
      && nextState.turnResponses.length === 0
      && !nextState.hostProjectionState
      && (!nextState.pendingFollowupRequests || nextState.pendingFollowupRequests.length === 0)
      && !nextState.attachedView
      && !nextState.status
      && !nextState.description
      && nextState.activeResponseHandle === undefined
      && !nextState.quotaOverlay
      && !nextState.viewOverlay
      && !nextState.providerOptions
      && !nextState.selectedMode) {
      this.clearSession(normalizedSessionId, {
        reason: options?.reason ?? 'clear',
        listAffecting: options?.listAffecting,
        highFrequency: options?.highFrequency,
      });
      return;
    }

    this.runtimeStates.set(normalizedSessionId, nextState);
    this.emitRuntimeChanged(normalizedSessionId, previousState, nextState, options);
  }

  replaceTurnResponses(
    sessionId: string | null | undefined,
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
  ): void {
    this.replaceRuntimeState(sessionId, { turnResponses }, {
      reason: 'transcript',
      highFrequency: true,
    });
  }

  stopSession(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const runtimeState = this.runtimeStates.get(normalizedSessionId);
    if (!runtimeState?.supportsInterruption || typeof runtimeState.stopSession !== 'function') {
      return false;
    }

    runtimeState.stopSession();
    return true;
  }

  disposeSession(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const runtimeState = this.runtimeStates.get(normalizedSessionId);
    if (typeof runtimeState?.disposeSession !== 'function') {
      return false;
    }

    runtimeState.disposeSession();
    return true;
  }

  clearSession(
    sessionId: string | null | undefined,
    options?: ChatSessionRuntimeChangeOptions,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const previousState = this.runtimeStates.get(normalizedSessionId);
    if (!this.runtimeStates.delete(normalizedSessionId)) {
      return;
    }

    this.emitRuntimeChanged(normalizedSessionId, previousState, undefined, {
      reason: options?.reason ?? 'clear',
      listAffecting: options?.listAffecting,
      highFrequency: options?.highFrequency,
    });
  }

  clearAll(): void {
    if (this.runtimeStates.size === 0) {
      return;
    }

    this.runtimeStates.clear();
    this.runtimeChangedSubject.next({
      sessionId: null,
      reason: 'clearAll',
      listAffecting: true,
    });
  }

  private emitRuntimeChanged(
    sessionId: string,
    previousState: ChatSessionRuntimeState | undefined,
    nextState: ChatSessionRuntimeState | undefined,
    options?: ChatSessionRuntimeChangeOptions,
  ): void {
    const reason = this.resolveChangeReason(options?.reason, previousState, nextState);
    const listAffecting = options?.listAffecting ?? this.didListFingerprintChange(previousState, nextState);
    const highFrequency = options?.highFrequency === true || reason === 'transcript';
    this.runtimeChangedSubject.next({
      sessionId,
      reason,
      listAffecting,
      ...(highFrequency ? { highFrequency: true } : {}),
    });
    this.traceRequestStateTransition(sessionId, previousState, nextState, reason);
  }

  private traceRequestStateTransition(
    sessionId: string,
    previousState: ChatSessionRuntimeState | undefined,
    nextState: ChatSessionRuntimeState | undefined,
    reason: ChatSessionRuntimeChangeReason,
  ): void {
    const from = resolveRuntimeTracePhase(previousState);
    const to = resolveRuntimeTracePhase(nextState);
    const previousStatus = previousState?.status ?? null;
    const nextStatus = nextState?.status ?? null;
    const previousRequestInProgress = previousState?.requestInProgress === true;
    const nextRequestInProgress = nextState?.requestInProgress === true;

    if (from === to
      && previousStatus === nextStatus
      && previousRequestInProgress === nextRequestInProgress) {
      return;
    }

    console.info(REQUEST_STATE_TRACE_PREFIX, {
      sessionId,
      from,
      to,
      reason,
      previousStatus,
      nextStatus,
      previousRequestInProgress,
      nextRequestInProgress,
      pendingCount: nextState?.pendingFollowupRequests?.length ?? 0,
      attachedView: nextState?.attachedView === true,
    });
  }

  private resolveChangeReason(
    explicitReason: ChatSessionRuntimeChangeReason | undefined,
    previousState: ChatSessionRuntimeState | undefined,
    nextState: ChatSessionRuntimeState | undefined,
  ): ChatSessionRuntimeChangeReason {
    if (explicitReason) {
      return explicitReason;
    }

    if (!nextState) {
      return 'clear';
    }

    const previousStatus = previousState?.status;
    const nextStatus = nextState.status;
    if (previousStatus !== nextStatus) {
      return 'status';
    }

    const previousDescription = this.normalizeDescription(previousState?.description);
    const nextDescription = this.normalizeDescription(nextState.description);
    if (previousDescription !== nextDescription) {
      return 'description';
    }

    if (previousState?.attachedView !== nextState.attachedView) {
      return 'view';
    }

    if (previousState?.requestInProgress !== nextState.requestInProgress
      || previousState?.supportsInterruption !== nextState.supportsInterruption
      || !!previousState?.activeResponseHandle !== !!nextState.activeResponseHandle) {
      return 'handle';
    }

    if (!!previousState?.quotaOverlay !== !!nextState.quotaOverlay) {
      return 'quota';
    }

    if (!!previousState?.viewOverlay !== !!nextState.viewOverlay) {
      return 'view';
    }

    if (!!previousState?.debugSummary !== !!nextState.debugSummary) {
      return 'debug';
    }

    return 'state';
  }

  private didListFingerprintChange(
    previousState: ChatSessionRuntimeState | undefined,
    nextState: ChatSessionRuntimeState | undefined,
  ): boolean {
    const previous = this.buildListFingerprint(previousState);
    const next = this.buildListFingerprint(nextState);

    return previous.requestInProgress !== next.requestInProgress
      || previous.status !== next.status
      || previous.description !== next.description
      || previous.attachedView !== next.attachedView
      || previous.supportsInterruption !== next.supportsInterruption
      || previous.hasActiveResponseHandle !== next.hasActiveResponseHandle
      || previous.derivedTurnStatus !== next.derivedTurnStatus
      || previous.derivedTurnDescription !== next.derivedTurnDescription;
  }

  private buildListFingerprint(state: ChatSessionRuntimeState | undefined): ChatSessionListFingerprint {
    return {
      requestInProgress: state?.requestInProgress === true,
      status: state?.status,
      description: this.normalizeDescription(state?.description),
      attachedView: state?.attachedView === true,
      supportsInterruption: state?.supportsInterruption === true,
      hasActiveResponseHandle: state?.activeResponseHandle !== undefined,
      derivedTurnStatus: this.resolveStatusFromTurnResponses(state?.turnResponses),
      derivedTurnDescription: this.resolveDescriptionFromTurnResponses(state?.turnResponses),
    };
  }

  private resolveStatusFromTurnResponses(
    turnResponses: readonly TurnResponseTurn[] | undefined,
  ): ChatSessionRuntimeStatus | undefined {
    if (!Array.isArray(turnResponses) || turnResponses.length === 0) {
      return undefined;
    }

    const latest = turnResponses[turnResponses.length - 1];
    const continuationStatus = this.readNonEmptyString(latest?.response?.continuation?.status);
    const responseStatus = this.readNonEmptyString(latest?.response?.status);
    const candidate = continuationStatus ?? responseStatus;

    switch (candidate) {
      case 'running':
      case 'streaming':
      case 'in_progress':
        return 'in_progress';
      case 'waiting_question':
      case 'waiting_confirmation':
      case 'waiting_tool_results':
      case 'waiting_plan_review':
      case 'plan_review':
      case 'continue':
      case 'needs_input':
        return 'needs_input';
      case 'hard_stopped':
      case 'failed':
      case 'error':
        return 'failed';
      case 'cancelled':
      case 'canceled':
        return 'cancelled';
      case 'completed':
        return 'completed';
      default:
        return undefined;
    }
  }

  private resolveDescriptionFromTurnResponses(
    turnResponses: readonly TurnResponseTurn[] | undefined,
  ): string | undefined {
    if (!Array.isArray(turnResponses) || turnResponses.length === 0) {
      return undefined;
    }

    const latest = turnResponses[turnResponses.length - 1];
    const continuationStatus = this.readNonEmptyString(latest?.response?.continuation?.status);
    if (continuationStatus === 'waiting_confirmation') {
      const title = this.readWaitingPartTitle(latest, 'confirmation');
      return title ? `Waiting for confirmation: ${title}` : 'Waiting for confirmation';
    }
    if (continuationStatus === 'waiting_question') {
      const title = this.readWaitingPartTitle(latest, 'question');
      return title ? `Waiting for answer: ${title}` : 'Waiting for answer';
    }

    return undefined;
  }

  private readWaitingPartTitle(
    turn: TurnResponseTurn | undefined,
    expectedType: 'confirmation' | 'question',
  ): string | undefined {
    const parts = Array.isArray(turn?.response?.parts)
      ? turn.response.parts
      : [];
    for (let index = parts.length - 1; index >= 0; index--) {
      const part = parts[index] as { type?: unknown; title?: unknown; message?: unknown };
      if (part?.type !== expectedType) {
        continue;
      }

      const title = this.readNonEmptyString(part.title) ?? this.readNonEmptyString(part.message);
      if (title) {
        return title;
      }
    }

    return undefined;
  }

  private normalizeDescription(description: string | undefined): string | undefined {
    return typeof description === 'string'
      ? description.replace(/\s+/g, ' ').trim() || undefined
      : undefined;
  }

  private readNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeSessionId(sessionId: string | null | undefined): string {
    return typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
  }

  private resolveNextStatus(
    status: ChatSessionRuntimeStatus | null | undefined,
    previousState: ChatSessionRuntimeState | undefined,
    turnResponses?: readonly TurnResponseTurn[] | undefined,
  ): ChatSessionRuntimeStatus | undefined {
    const derivedStatus = this.resolveStatusFromTurnResponses(turnResponses ?? previousState?.turnResponses);

    if (status === null) {
      return derivedStatus;
    }

    if (status) {
      return status;
    }

    return derivedStatus ?? previousState?.status;
  }

  private resolveNextDescription(
    description: string | null | undefined,
    previousState: ChatSessionRuntimeState | undefined,
  ): string | undefined {
    if (description === null) {
      return undefined;
    }

    if (typeof description === 'string') {
      const normalized = description.replace(/\s+/g, ' ').trim();
      return normalized || undefined;
    }

    return previousState?.description;
  }

  private resolveNextCapabilities(
    capabilities: Partial<ChatSessionRuntimeCapabilities> | null | undefined,
    previousState: ChatSessionRuntimeState | undefined,
  ): ChatSessionRuntimeCapabilities {
    if (capabilities === null) {
      return { ...DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES };
    }

    return {
      ...DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
      ...(previousState?.capabilities ?? {}),
      ...(capabilities ?? {}),
    };
  }

  private resolveNextDebugSummary(
    debugSummary: Partial<ChatSessionRuntimeDebugSummary> | null | undefined,
    previousState: ChatSessionRuntimeState | undefined,
    liveState: {
      readonly requestInProgress: boolean;
      readonly attachedView: boolean;
      readonly status?: ChatSessionRuntimeStatus;
      readonly hasLiveOverlay: boolean;
      readonly quotaOverlayPresent: boolean;
      readonly requestQuotaNotice: boolean;
      readonly authQuotaProjected: boolean;
      readonly contextBudgetOverlayPresent: boolean;
      readonly inputNoticeOverlayPresent: boolean;
      readonly providerOptionsPresent: boolean;
      readonly selectedModePresent: boolean;
    },
  ): ChatSessionRuntimeDebugSummary {
    const previousSummary = previousState?.debugSummary;
    return {
      ...(previousSummary ?? {}),
      ...(debugSummary ?? {}),
      liveRuntimeOverlayPresent: liveState.hasLiveOverlay,
      pendingRequest: liveState.requestInProgress,
      needsInput: liveState.status === 'needs_input',
      attachedView: liveState.attachedView,
      quotaOverlayPresent: liveState.quotaOverlayPresent,
      requestQuotaNotice: liveState.requestQuotaNotice,
      authQuotaProjected: liveState.authQuotaProjected,
      contextBudgetOverlayPresent: liveState.contextBudgetOverlayPresent,
      inputNoticeOverlayPresent: liveState.inputNoticeOverlayPresent,
      providerOptionsPresent: liveState.providerOptionsPresent,
      selectedModePresent: liveState.selectedModePresent,
    };
  }

  private cloneQuotaOverlay(overlay: ChatSessionRuntimeQuotaOverlay): ChatSessionRuntimeQuotaOverlay {
    return {
      ...(overlay.requestQuotaState ? { requestQuotaState: clonePlainObject(overlay.requestQuotaState) } : {}),
      ...(overlay.requestQuotaSnapshot ? { requestQuotaSnapshot: clonePlainObject(overlay.requestQuotaSnapshot) } : {}),
      ...(overlay.requestInputNotice ? { requestInputNotice: clonePlainObject(overlay.requestInputNotice) } : {}),
      ...(overlay.authQuotaInfo ? { authQuotaInfo: clonePlainObject(overlay.authQuotaInfo) } : {}),
      updatedAt: overlay.updatedAt,
    };
  }

  private cloneViewOverlay(overlay: ChatSessionRuntimeViewOverlay): ChatSessionRuntimeViewOverlay {
    return {
      ...(overlay.contextBudgetSnapshot ? { contextBudgetSnapshot: clonePlainObject(overlay.contextBudgetSnapshot) } : {}),
      ...(overlay.chatInputNotice ? { chatInputNotice: clonePlainObject(overlay.chatInputNotice) } : {}),
      updatedAt: overlay.updatedAt,
    };
  }

  private cloneProviderOptions(providerOptions: HostSessionProviderOptions): HostSessionProviderOptions {
    return { ...providerOptions };
  }

  private cloneSelectedMode(selectedMode: ChatSelectedMode): ChatSelectedMode {
    return { ...selectedMode };
  }

  private clonePendingFollowupRequests(
    requests: readonly PendingFollowupRequest[] | undefined,
  ): readonly PendingFollowupRequest[] | undefined {
    if (!Array.isArray(requests) || requests.length === 0) {
      return undefined;
    }

    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(requests) as readonly PendingFollowupRequest[];
    }

    return JSON.parse(JSON.stringify(requests)) as readonly PendingFollowupRequest[];
  }
}

function clonePlainObject<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}
