import type { IAgentLifecycle, IChatServiceAccess, IChatViewAccess } from '../core/chat-context';
import type {
  RenderEvent,
  RenderClearToPreviousToolInvocationReason,
  SessionSnapshot,
  TurnResponseQuestionPart,
  TurnResponseStatus,
  TurnResponseTurn,
} from 'aily-lex/browser';
import { TurnResponseIncrementalBuilder } from '../core/turn-response-stream-builder';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';
import {
  LexRenderHostStreamEmitter,
  type HostItemLifecycleTextDeltaPolicy,
  type HostStreamPartChange,
} from './lex-render-host-stream-emitter';
import { LexRenderProjectionSync } from './lex-render-projection-sync';
import { LexRenderTurnMaterializer } from './lex-render-turn-materializer';
import { LexSideEffectHandler } from './lex-side-effect-handler';
import {
  RenderEventItemLifecycleNormalizer,
  type CanonicalRenderLifecycleEvent,
  type CanonicalRenderItemStatus,
} from '../core/render-event-item-lifecycle';
import {
  buildSeededTurnResponseTurn,
  buildTurnResponseRequest,
  getTurnResponseParticipant,
  resolveInitialResponseSlashCommand,
} from '../core/turn-response-stream-contract';
import {
  hydrateQuestionAnswersFromAskUserToolMetadata,
  turnResponsePartToChatParts,
} from '../core/turn-response-part-mapper';
import {
  type HostResponseClearToPreviousToolInvocationReason,
  type IHostStreamListener,
} from './host-turn-response-state';
import {
  cloneTurnResponseModelSidecar,
  getTurnResponseResolvedModelName,
  withExplicitAgentSummaryPreview,
} from './turn-response-response-model';
import { buildSessionTurnOwnerDiagnostics } from './session-turn-owner-diagnostics';
import { ChatPerformanceTracer } from '../services/chat-perf-tracer';
import { scheduleBrowserTask } from '../tools/browserTaskScheduler';
import { isAilyCategoryDebugEnabled } from '../core/chat-debug-flags';
import {
  liveTranscriptProjection,
  terminalTranscriptProjection,
  type ChatRuntimeTurnResponseSyncOptions,
} from '../core/chat-runtime-projection-policy';

/** Narrow context: only needs partStore for rendering + toolCallingIteration for turn tracking */
type LexRenderEventBridgeContext =
  Pick<IChatViewAccess, 'partStore' | 'list' | 'invalidateHostRequestGraph' | 'triggerSyncDetectChanges'>
  & Pick<IAgentLifecycle, 'toolCallingIteration' | 'isCancelled' | 'currentMessageSource'>
  & Pick<IChatServiceAccess, 'contextBudgetService'>
  & {
    isRuntimeViewAttached?(sessionId: string | null | undefined): boolean;
    readRuntimeViewAttachmentGeneration?(sessionId: string | null | undefined): number | null | undefined;
    isRuntimeViewAttachmentCurrent?(
      sessionId: string | null | undefined,
      generation: number | null | undefined,
    ): boolean;
    syncExecutionRuntimeTurnResponses?(
      sessionId: string | null | undefined,
      turnResponses: readonly TurnResponseTurn[] | null | undefined,
      options: ChatRuntimeTurnResponseSyncOptions,
    ): void;
  };

type RenderMessageLifecycleAccess = {
  ensureResponseItem(turnId?: string): void;
};

interface PendingLiveTurnSnapshotOptions {
  readonly fallbackStatus?: TurnResponseStatus;
  readonly usage?: TurnResponseTurn['usage'];
  readonly continuation?: TurnResponseTurn['response']['continuation'];
  readonly modelName?: string;
  readonly modelBillingLabel?: string;
  readonly modelRouting?: NonNullable<TurnResponseTurn['responseModel']>['modelRouting'];
  readonly quotaSnapshot?: TurnResponseTurn['responseModel']['quotaSnapshot'];
  readonly terminationReason?: TurnResponseTurn['response']['terminationReason'];
}

function recordRenderEventSnapshot(event: RenderEvent): void {
  if (!ChatPerformanceTracer.isEnabled()) {
    return;
  }

  const record = event as unknown as Record<string, unknown>;
  const textLength = lengthOfStringValue(record['text']);
  const contentLength = lengthOfStringValue(record['content']);
  const messageLength = lengthOfStringValue(record['message']);
  const data: Record<string, unknown> = {
    type: event.type,
  };

  const activityKind = stringValue(record['activityKind']);
  if (activityKind) data['activityKind'] = activityKind;
  const toolCallId = stringValue(record['toolCallId']);
  if (toolCallId) data['toolCallId'] = toolCallId;
  const childToolCallId = stringValue(record['childToolCallId']);
  if (childToolCallId) data['childToolCallId'] = childToolCallId;
  const toolName = stringValue(record['toolName']);
  if (toolName) data['toolName'] = toolName;
  const sourceAgentRole = stringValue(record['sourceAgentRole']);
  if (sourceAgentRole) data['sourceAgentRole'] = sourceAgentRole;
  const subAgentInvocationId = stringValue(record['subAgentInvocationId']);
  if (subAgentInvocationId) data['subAgentInvocationId'] = subAgentInvocationId;
  const parentToolCallId = stringValue(record['parentToolCallId']);
  if (parentToolCallId) data['parentToolCallId'] = parentToolCallId;
  const state = stringValue(record['state']);
  if (state) data['state'] = state;
  if (textLength > 0) data['textLength'] = textLength;
  if (contentLength > 0) data['contentLength'] = contentLength;
  if (messageLength > 0) data['messageLength'] = messageLength;

  ChatPerformanceTracer.recordRenderEvent('render_event', data);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function lengthOfStringValue(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

function isLexRenderTraceEnabled(): boolean {
  return isAilyCategoryDebugEnabled('aily.chat.traceLexRender', [
    '__AILY_CHAT_TRACE_LEX_RENDER__',
    'AILY_CHAT_TRACE_LEX_RENDER',
  ]);
}

/**
 * LexRenderEventBridge consumes live RenderEvent notifications and projects
 * the visible chat store through the canonical item lifecycle contract.
 *
 * Replaces the chain of:
 *   LexAgentEventBridge → LexRuntimeEventBridge
 *                        → LexStateEventBridge
 *                        → PartEventProcessor
 *
 * Also satisfies the minimal reset/finalize contract so LexMessageLifecycleBridge can
 * call reset()/finalize() without knowing which processor is in use.
 *
 * Side effects previously scattered across those bridges are handled inline.
 */
export class LexRenderEventBridge {
  private static readonly LIVE_TURN_SNAPSHOT_COMMIT_INTERVAL_MS = 750;
  private static readonly OWNER_COMMIT_MIN_INTERVAL_MS = 120;
  private readonly _streamBuilder: TurnResponseIncrementalBuilder;
  private readonly _sideEffects: LexSideEffectHandler;
  private readonly _itemLifecycleNormalizer = new RenderEventItemLifecycleNormalizer();
  private readonly _hostStreamEmitter = new LexRenderHostStreamEmitter();
  private readonly _projectionSync: LexRenderProjectionSync;
  private readonly _turnMaterializer: LexRenderTurnMaterializer;
  private readonly _turnResponses = new Map<string, TurnResponseTurn>();
  private _currentTurn: TurnResponseTurn | null = null;
  private _hostStreamBaselineTurn: TurnResponseTurn | null = null;
  private _pendingRequestContent = '';
  private _pendingRequestDisplayContent: string | undefined;
  private _pendingRequestMetadata: TurnResponseTurn['request']['metadata'];
  private _currentTurnHasExecutionError = false;
  private _projectionSessionResource: string | null = null;
  private _ownerCommitHandle: { dispose(): void } | null = null;
  private _ownerCommitPending = false;
  private _ownerCommitToken = 0;
  private _ownerCommitLastAt = 0;
  private _turnResponsesRevision = 0;
  private _ownerCommittedRevision = -1;
  private _liveSnapshotCommitHandle: { dispose(): void } | null = null;
  private _liveSnapshotCommitPending = false;
  private _liveSnapshotCommitTimestamp = 0;
  private _liveSnapshotCommitOptions: PendingLiveTurnSnapshotOptions | null = null;
  private _projectionVisibleAttachmentGeneration: number | null = null;

  constructor(
    private readonly ctx: LexRenderEventBridgeContext,
    private readonly hostSyncBridge: LexHostSyncBridge,
    private readonly messageLifecycleBridge: RenderMessageLifecycleAccess,
    private readonly getSessionSnapshot?: () => SessionSnapshot | null,
  ) {
    this._streamBuilder = new TurnResponseIncrementalBuilder();
    this._sideEffects = new LexSideEffectHandler(ctx, hostSyncBridge);
    this._projectionSync = new LexRenderProjectionSync(ctx, {
      readProjectionSessionResource: () => this._projectionSessionResource,
      readProjectionVisibleAttachmentGeneration: () => this._projectionVisibleAttachmentGeneration,
      isRuntimeViewAttached: (sessionId) => ctx.isRuntimeViewAttached?.(sessionId) === true,
      isRuntimeViewAttachmentCurrent: (sessionId, generation) =>
        ctx.isRuntimeViewAttachmentCurrent?.(sessionId, generation) === true,
    });
    this._turnMaterializer = new LexRenderTurnMaterializer(ctx, getSessionSnapshot);
  }

  /** H1: update the host stream listener at runtime (e.g. after session restore). */
  setHostStreamListener(listener: IHostStreamListener | null): void {
    this._hostStreamEmitter.setListener(listener);
  }

  setHostItemTextDeltaDeliveryPolicy(
    turnId: string,
    policy: HostItemLifecycleTextDeltaPolicy | null,
    itemId?: string | null,
  ): void {
    this._hostStreamEmitter.setTextDeltaDeliveryPolicy(turnId, policy, itemId);
  }

  setProjectionSessionResource(sessionResource: string | null | undefined, visibleAttachmentGeneration?: number | null): void {
    const normalized = normalizeSessionResource(sessionResource);
    this._projectionSessionResource = normalized || null;
    this._projectionVisibleAttachmentGeneration = normalizeVisibleAttachmentGeneration(visibleAttachmentGeneration);
  }

  getProjectionSessionResource(): string | null {
    return this._projectionSessionResource;
  }

  prepareTurnRequest(
    requestContent: string,
    displayContent?: string,
    metadata?: TurnResponseTurn['request']['metadata'],
  ): void {
    this._pendingRequestContent = requestContent;
    this._pendingRequestDisplayContent = displayContent;
    this._pendingRequestMetadata = metadata;
  }

  seedPendingTurn(
    turnId: string,
    requestContent: string,
    displayContent?: string,
    metadata?: TurnResponseTurn['request']['metadata'],
  ): void {
    if (!turnId || this._turnResponses.has(turnId)) {
      return;
    }

    const seededTurn = buildSeededTurnResponseTurn({
      turnId,
      requestContent,
      displayContent,
      metadata,
      participant: this.ctx.currentMessageSource,
    });

    this.setRetainedTurnResponse(seededTurn);
    this.commitTurnResponsesToOwner();
    this.invalidateVisibleProjection();
  }

  get turnResponses(): readonly TurnResponseTurn[] {
    if (!this.canUseCurrentTurnResponses()) {
      return [];
    }

    return [...this._turnResponses.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(turn => clonePublicTurnResponseTurn(turn));
  }

  hydrateTurnResponses(turnResponses: readonly TurnResponseTurn[]): void {
    const previousTurnIds = [...this._turnResponses.keys()];
    this.reset();
    this.clearRetainedTurnResponses();

    for (const turn of turnResponses) {
      this.setRetainedTurnResponse(cloneTurnResponseTurn(turn));
    }

    this.replaceProjectedResponseParts(turnResponses, previousTurnIds);
    this.restoreHydratedCurrentTurn();
  }

  processInteractionEvent(event: Extract<RenderEvent, { type: 'approval_request' | 'approval_resolve' | 'question_request' }>): boolean {
    if (!this._currentTurn) {
      return false;
    }

    this.processEvent(event);
    return true;
  }

  updateQuestionAnswers(answers: TurnResponseQuestionPart['answers'], partId: string): boolean {
    if (!this._currentTurn) {
      return false;
    }

    const parts = this._currentTurn.response.parts;
    const matchingIndex = findQuestionAnswerTargetIndex(parts, answers, partId);
    if (matchingIndex < 0) {
      return false;
    }

    const part = parts[matchingIndex] as TurnResponseQuestionPart;
    const nextParts = [...parts];
    nextParts[matchingIndex] = {
      ...part,
      answers: cloneQuestionAnswers(answers),
    };
    this._currentTurn = {
      ...this._currentTurn,
      updatedAt: Date.now(),
      response: {
        ...this._currentTurn.response,
        parts: nextParts,
      },
    };
    this.setRetainedTurnResponse(this._currentTurn);
    this.commitTurnResponsesToOwner('immediate');
    this.invalidateVisibleProjection();
    return true;
  }

  finalizeCurrentTurn(fallbackStatus: TurnResponseStatus = 'completed'): boolean {
    if (!this._currentTurn) {
      const latestStreamingTurn = this.resolveLatestStreamingTurn();
      if (!latestStreamingTurn) {
        return false;
      }

      this._streamBuilder.hydrateTurn(latestStreamingTurn);
      const finalizedTurn = this._turnMaterializer.materializeCurrentTurn(
        this._streamBuilder,
        latestStreamingTurn,
        {
          updatedAt: Date.now(),
          fallbackStatus,
          hasExecutionError: this._currentTurnHasExecutionError,
        },
      ) ?? {
        ...latestStreamingTurn,
        updatedAt: Date.now(),
        response: {
          ...latestStreamingTurn.response,
          status: fallbackStatus,
          updatedAt: Date.now(),
        },
      };
      this.setRetainedTurnResponse(finalizedTurn);
      this.commitTurnResponsesToOwner('immediate');
      this.invalidateVisibleProjection();
      this.finalizeCanonicalItemLifecycle(
        mapTurnResponseStatusToCanonicalLifecycleStatus(fallbackStatus),
        finalizedTurn.turnId,
      );
      return true;
    }

    this.syncCurrentTurn(Date.now(), fallbackStatus, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'immediate');
    this._projectionSync.projectCanonicalChanges(this._currentTurn, this._streamBuilder, [], {
      syncContent: true,
    });
    this.finalizeCanonicalItemLifecycle(
      mapTurnResponseStatusToCanonicalLifecycleStatus(fallbackStatus),
      this._currentTurn.turnId,
    );
    return true;
  }

  appendExecutionError(message: string, options: { readonly retry?: boolean } = {}): boolean {
    if (!this._currentTurn) {
      return false;
    }

    this._currentTurnHasExecutionError = true;
    if (this.canProjectToVisible()) {
      this.messageLifecycleBridge.ensureResponseItem(this._currentTurn.turnId);
    }
    const errorEvent: RenderEvent = {
      type: 'error_notice',
      message,
      timestamp: Date.now(),
      ...(options.retry ? { details: { retryable: true } } : {}),
    } as RenderEvent;
    const lifecycleEvents = this._itemLifecycleNormalizer.process(errorEvent);
    this.recordCanonicalItemLifecycleEvents(lifecycleEvents);
    this.emitCanonicalItemLifecycleEvents(lifecycleEvents, errorEvent);
    this._streamBuilder.processEvent(errorEvent);
    this.syncCurrentTurn(errorEvent.timestamp, 'error', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'immediate');
    this._projectionSync.projectCanonicalChanges(this._currentTurn, this._streamBuilder, lifecycleEvents, {
      syncContent: true,
    });
    this.finalizeCanonicalItemLifecycle('failed', this._currentTurn.turnId);
    return true;
  }

  processEvent(event: RenderEvent): void {
    const lifecycleEvents = this._itemLifecycleNormalizer.process(event);
    this.recordCanonicalItemLifecycleEvents(lifecycleEvents);
    ChatPerformanceTracer.increment(`render_event.${event.type}`);
    recordRenderEventSnapshot(event);
    if (event.type === 'subagent_activity') {
      ChatPerformanceTracer.increment(`render_event.subagent_activity.${event.activityKind}`);
      const contentLength = typeof event.content === 'string' ? event.content.length : 0;
      ChatPerformanceTracer.mark(
        'subagent_activity',
        `kind=${event.activityKind},tool=${event.toolCallId},child=${event.childToolCallId || ''},content=${contentLength}`,
      );
    }
    let turnBeginMode: 'fresh' | 'continued' | null = null;
    if (event.type === 'turn_begin') {
      turnBeginMode = this.beginTurn(event.turnId, event.timestamp);
    }
    this.emitCanonicalItemLifecycleEvents(lifecycleEvents, event);

    this._sideEffects.processEvent(event);

    if (!this._currentTurn) {
      return;
    }

    const canProjectToVisible = this.canProjectToVisible();
    this.recordLiveWritePath(event, canProjectToVisible ? 'visible-render-event-bridge' : 'runtime-only-render-event-bridge');
    if (canProjectToVisible) {
      this.messageLifecycleBridge.ensureResponseItem(this._currentTurn.turnId);
    }

    if (event.type === 'turn_begin') {
      if (turnBeginMode === 'fresh') {
        this._projectionSync.clearProjectedMessage(this._currentTurn);
      }
      this._projectionSync.syncProjectedMessageMeta(this._currentTurn);
      if (turnBeginMode === 'continued') {
        this.invalidateVisibleProjection();
      }
      return;
    }

    if (event.type === 'turn_end') {
      const snapshotOptions: PendingLiveTurnSnapshotOptions = {
        fallbackStatus: isIntermediateToolTurnEnd(event) ? this.resolveLiveFallbackStatus() : 'completed',
        usage: event.usage,
        continuation: event.continuation,
        modelName: event.modelName,
        modelBillingLabel: event.modelBillingLabel,
        modelRouting: event.modelRouting,
        quotaSnapshot: event.quotaSnapshot,
        terminationReason: event.terminationReason,
      };
      if (isIntermediateToolTurnEnd(event)) {
        this.scheduleLiveTurnSnapshotCommit(event.timestamp, snapshotOptions);
      } else {
        this.syncCurrentTurn(
          event.timestamp,
          snapshotOptions.fallbackStatus ?? 'completed',
          snapshotOptions.usage,
          snapshotOptions.continuation,
          snapshotOptions.modelName,
          snapshotOptions.modelBillingLabel,
          snapshotOptions.modelRouting,
          snapshotOptions.quotaSnapshot,
          snapshotOptions.terminationReason,
          'immediate',
        );
        this.invalidateVisibleProjection();
        this._projectionSync.projectCanonicalChanges(this._currentTurn, this._streamBuilder, lifecycleEvents, {
          syncContent: true,
          applyTurnCompletion: true,
        });
      }
      if (isIntermediateToolTurnEnd(event)) {
        this._projectionSync.projectCanonicalLifecycleOnly(this._currentTurn, lifecycleEvents);
      }
      return;
    }

    if (event.type === 'clear_to_previous_tool_invocation') {
      this._hostStreamEmitter.emitClearToPreviousToolInvocation(
        this._currentTurn.turnId,
        event.timestamp,
        toHostClearToPreviousToolInvocationReason(event.reason),
      );
      this.invalidateVisibleProjection();
      return;
    }

    const isResponseModelEvent = isResponseModelRenderEvent(event);
    const responseModelChanged = this._streamBuilder.processEvent(event) && isResponseModelEvent;
    if (isResponseModelEvent) {
      if (responseModelChanged) {
        this.syncCurrentTurn(event.timestamp, this.resolveLiveFallbackStatus(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'deferred');
        this._projectionSync.syncProjectedMessageMeta(this._currentTurn);
      }
      if (event.type === 'response_followups') {
        this._hostStreamEmitter.emitResponseFollowups(this._currentTurn.turnId, event.value, event.timestamp);
      }
      this.invalidateVisibleProjection();
      return;
    }

    const isLiveTextStreamEvent = isLiveTextStreamRenderEvent(event);
    if (isLiveTextStreamEvent) {
      this._projectionSync.projectCanonicalChanges(this._currentTurn, this._streamBuilder, lifecycleEvents, {
        syncContent: false,
      });
      if (this.emitLiveHostStreamPartChanges(event.timestamp)) {
        this.scheduleOwnerCommit();
      }
    } else {
      this._projectionSync.projectCanonicalChanges(this._currentTurn, this._streamBuilder, lifecycleEvents, {
        syncContent: false,
      });
      this.emitLiveHostStreamPartChanges(event.timestamp);
    }
    if (shouldCommitLiveTurnSnapshotImmediately(event)) {
      this.syncCurrentTurn(event.timestamp, this.resolveLiveFallbackStatus(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'immediate');
    } else if (!isLiveTextStreamEvent) {
      this.scheduleLiveTurnSnapshotCommit(event.timestamp);
    }
  }

  /** Flush an array of pending RenderEvents. */
  flushPendingEvents(events: readonly RenderEvent[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
  }

  /** Reset per-turn state. */
  reset(): void {
    this._streamBuilder.reset();
    this._itemLifecycleNormalizer.reset();
    this._currentTurn = null;
    this._hostStreamBaselineTurn = null;
    this._pendingRequestContent = '';
    this._pendingRequestDisplayContent = undefined;
    this._pendingRequestMetadata = undefined;
    this._currentTurnHasExecutionError = false;
    this.clearPendingOwnerCommit();
    this.clearPendingLiveTurnSnapshotCommit();
  }

  /** Clear all retained live turn responses when a session is replaced or restored. */
  clearSessionState(): void {
    this.reset();
    this.clearRetainedTurnResponses();
    this._hostStreamEmitter.clearSessionState();
  }

  private recordCanonicalItemLifecycleEvents(events: readonly CanonicalRenderLifecycleEvent[]): void {
    if (!events.length) {
      return;
    }
    ChatPerformanceTracer.increment('render_lifecycle.events', events.length);
    for (const event of events) {
      ChatPerformanceTracer.increment(`render_lifecycle.${event.type}`);
      if ('itemKind' in event) {
        ChatPerformanceTracer.increment(`render_lifecycle.${event.type}.${event.itemKind}`);
      }
    }
    const last = events[events.length - 1] as CanonicalRenderLifecycleEvent | undefined;
    ChatPerformanceTracer.recordRenderEvent('render_lifecycle', {
      count: events.length,
      lastType: last?.type,
      ...((last && 'itemKind' in last) ? { lastItemKind: last.itemKind, lastItemId: last.itemId } : {}),
    });
  }

  private emitCanonicalItemLifecycleEvents(
    events: readonly CanonicalRenderLifecycleEvent[],
    sourceEvent: RenderEvent,
  ): void {
    if (!events.length) {
      return;
    }

    const turnId = resolveCanonicalLifecycleTurnId(events, sourceEvent, this._currentTurn?.turnId);
    if (!turnId) {
      return;
    }

    this._hostStreamEmitter.emitItemLifecycleEvents(turnId, events);
  }

  private finalizeCanonicalItemLifecycle(status: CanonicalRenderItemStatus, turnId: string | undefined): void {
    const timestamp = Date.now();
    const events = this._itemLifecycleNormalizer.finalizeActiveTurn(status, timestamp, turnId);
    if (!events.length) {
      return;
    }
    this.recordCanonicalItemLifecycleEvents(events);
    this.emitCanonicalItemLifecycleEvents(events, {
      type: 'turn_end',
      turnId: turnId ?? '',
      timestamp,
    } as RenderEvent);
    this._projectionSync.projectCanonicalLifecycleOnly(
      turnId ? { turnId } : this._currentTurn,
      events,
      { applyTurnCompletion: true },
    );
  }

  /** Clean up. */
  dispose(): void {
    this.clearPendingOwnerCommit();
    this.clearPendingLiveTurnSnapshotCommit();
    this._projectionSync.dispose();
    this._streamBuilder.destroy();
  }

  private beginTurn(turnId: string, timestamp: number): 'fresh' | 'continued' {
    this._currentTurnHasExecutionError = false;
    const request = buildTurnResponseRequest(
      this._pendingRequestContent,
      this._pendingRequestDisplayContent,
      this._pendingRequestMetadata,
    );
    const initialSlashCommand = resolveInitialResponseSlashCommand(this._pendingRequestMetadata);

    if (this.shouldContinueCurrentTurn(request)) {
      const previousTurn = this._currentTurn!;
      const continuedTurn = this._streamBuilder.retargetCurrentTurn({
        turnId,
        request,
        participant: getTurnResponseParticipant(this.ctx.currentMessageSource),
        slashCommand: initialSlashCommand,
        timestamp,
      });
      if (continuedTurn) {
        this._currentTurn = continuedTurn;
        this._hostStreamBaselineTurn = continuedTurn;
        this.setRetainedTurnResponse(this._currentTurn);
        this.commitTurnResponsesToOwner('immediate');
        this._hostStreamEmitter.emitTurnDelta(this._currentTurn, previousTurn, []);
        return 'continued';
      }
    }

    if (this._currentTurn) {
      this.syncCurrentTurn(timestamp, 'completed', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'immediate');
    }

    this._currentTurn = this._streamBuilder.beginTurn({
      turnId,
      request,
      participant: getTurnResponseParticipant(this.ctx.currentMessageSource),
      slashCommand: initialSlashCommand,
      timestamp,
    });
    this._hostStreamBaselineTurn = this._currentTurn;
    this.setRetainedTurnResponse(this._currentTurn);
    this.commitTurnResponsesToOwner('immediate');
    this._hostStreamEmitter.emitTurnStarted(this._currentTurn);
    this._hostStreamEmitter.emitInitialTurnFieldUpdates(this._currentTurn);
    return 'fresh';
  }

  private shouldContinueCurrentTurn(request: TurnResponseTurn['request']): boolean {
    if (!this._currentTurn || this._currentTurn.response.status !== 'streaming') {
      return false;
    }

    return this._currentTurn.request.content === request.content
      && (this._currentTurn.request.displayContent ?? '') === (request.displayContent ?? '');
  }

  private resolveLatestStreamingTurn(): TurnResponseTurn | null {
    let latest: TurnResponseTurn | null = null;
    for (const turn of this._turnResponses.values()) {
      if (turn.response.status !== 'streaming') {
        continue;
      }

      if (!latest || turn.updatedAt > latest.updatedAt) {
        latest = turn;
      }
    }

    return latest;
  }

  private restoreHydratedCurrentTurn(): void {
    const latestStreamingTurn = this.resolveLatestStreamingTurn();
    if (!latestStreamingTurn) {
      this._currentTurn = null;
      this._currentTurnHasExecutionError = false;
      return;
    }

    this._currentTurn = cloneTurnResponseTurn(latestStreamingTurn);
    this._currentTurnHasExecutionError = false;
    this._streamBuilder.hydrateTurn(this._currentTurn);
  }

  private resolveLiveFallbackStatus(): TurnResponseStatus {
    const currentStatus = this._currentTurn?.response.status;
    return currentStatus && currentStatus !== 'streaming'
      ? currentStatus
      : 'streaming';
  }

  private emitLiveHostStreamPartChanges(updatedAt: number): boolean {
    if (!this._currentTurn) {
      return false;
    }

    const partChanges = this._streamBuilder.drainTurnResponsePartChanges();
    if (partChanges.length === 0) {
      return false;
    }

    const previousTurn = this._hostStreamBaselineTurn ?? this._currentTurn;
    const nextTurn = applyHostStreamPartChanges(previousTurn, partChanges, updatedAt, {
      participant: getTurnResponseParticipant(
        this.ctx.currentMessageSource || previousTurn.response.participant,
      ),
    });
    this._hostStreamEmitter.emitTurnDelta(nextTurn, previousTurn, partChanges);
    this._hostStreamBaselineTurn = nextTurn;
    this._currentTurn = nextTurn;
    this.setRetainedTurnResponse(nextTurn);
    return true;
  }

  private syncCurrentTurn(
    updatedAt: number,
    fallbackStatus: TurnResponseStatus,
    usage?: TurnResponseTurn['usage'],
    continuation?: TurnResponseTurn['response']['continuation'],
    modelName?: string,
    modelBillingLabel?: string,
    modelRouting?: NonNullable<TurnResponseTurn['responseModel']>['modelRouting'],
    quotaSnapshot?: TurnResponseTurn['responseModel']['quotaSnapshot'],
    terminationReason?: TurnResponseTurn['response']['terminationReason'],
    ownerCommitMode: 'immediate' | 'deferred' = 'immediate',
  ): void {
    if (!this._currentTurn) {
      return;
    }
    this.clearPendingLiveTurnSnapshotCommit();

    const previousTurn = this._currentTurn;
    const previousHostStreamTurn = this._hostStreamBaselineTurn ?? previousTurn;
    const materialized = this._turnMaterializer.materializeCurrentTurn(
      this._streamBuilder,
      this._currentTurn,
      {
        updatedAt,
        fallbackStatus,
        hasExecutionError: this._currentTurnHasExecutionError,
        usage,
        continuation,
        modelName,
        modelBillingLabel,
        modelRouting,
        quotaSnapshot,
        terminationReason,
      },
    );

    if (!materialized) {
      return;
    }

    this._currentTurn = withExplicitAgentSummaryPreview(materialized);

    const selectedPresetId = typeof this._currentTurn.responseModel?.modelRouting?.selectedPresetId === 'string'
      ? this._currentTurn.responseModel.modelRouting.selectedPresetId
      : undefined;
    const selectedModel = typeof this._currentTurn.responseModel?.modelRouting?.selectedModel === 'string'
      ? this._currentTurn.responseModel.modelRouting.selectedModel
      : undefined;
    if (isLexRenderTraceEnabled() && (selectedPresetId || selectedModel || this._currentTurn.responseModel?.modelName)) {
      console.log('[LexRender] materialized turn response model:', {
        turnId: this._currentTurn.turnId,
        modelName: this._currentTurn.responseModel?.modelName,
        modelBillingLabel: this._currentTurn.responseModel?.modelBillingLabel,
        selectedPresetId,
        selectedModel,
      });
    }

    const previousModelName = getTurnResponseModelName(previousTurn);
    const currentModelName = getTurnResponseModelName(this._currentTurn);
    if (currentModelName && currentModelName !== previousModelName) {
      this.ctx.contextBudgetService?.updateModelContextSize({
        model: currentModelName,
        presetId: currentModelName,
      });
    }

    this.setRetainedTurnResponse(this._currentTurn);
    this.commitTurnResponsesToOwner(ownerCommitMode);
    const partChanges = this._streamBuilder.drainTurnResponsePartChanges();
    this._hostStreamEmitter.emitTurnDelta(this._currentTurn, previousHostStreamTurn, partChanges);
    this._hostStreamBaselineTurn = this._currentTurn;
  }

  private commitTurnResponsesToOwner(mode: 'immediate' | 'deferred' = 'immediate'): void {
    if (mode === 'deferred') {
      this.scheduleOwnerCommit();
      return;
    }

    this.clearPendingOwnerCommit();
    this.commitTurnResponsesToOwnerNow('immediate');
  }

  private scheduleLiveTurnSnapshotCommit(timestamp: number, options?: PendingLiveTurnSnapshotOptions): void {
    this._liveSnapshotCommitTimestamp = Math.max(this._liveSnapshotCommitTimestamp, timestamp);
    if (options) {
      this._liveSnapshotCommitOptions = {
        ...this._liveSnapshotCommitOptions,
        ...options,
      };
    }
    this._liveSnapshotCommitPending = true;
    if (this._liveSnapshotCommitHandle !== null) {
      return;
    }

    const timerId = setTimeout(() => {
      this._liveSnapshotCommitHandle = null;
      if (!this._liveSnapshotCommitPending) {
        return;
      }
      this._liveSnapshotCommitPending = false;
      const commitTimestamp = this._liveSnapshotCommitTimestamp || Date.now();
      const commitOptions = this._liveSnapshotCommitOptions;
      this._liveSnapshotCommitTimestamp = 0;
      this._liveSnapshotCommitOptions = null;
      this.syncCurrentTurn(
        commitTimestamp,
        commitOptions?.fallbackStatus ?? this.resolveLiveFallbackStatus(),
        commitOptions?.usage,
        commitOptions?.continuation,
        commitOptions?.modelName,
        commitOptions?.modelBillingLabel,
        commitOptions?.modelRouting,
        commitOptions?.quotaSnapshot,
        commitOptions?.terminationReason,
        'deferred',
      );
    }, LexRenderEventBridge.LIVE_TURN_SNAPSHOT_COMMIT_INTERVAL_MS);

    this._liveSnapshotCommitHandle = {
      dispose: () => clearTimeout(timerId),
    };
  }

  private clearPendingLiveTurnSnapshotCommit(): void {
    this._liveSnapshotCommitHandle?.dispose();
    this._liveSnapshotCommitHandle = null;
    this._liveSnapshotCommitPending = false;
    this._liveSnapshotCommitTimestamp = 0;
    this._liveSnapshotCommitOptions = null;
  }

  private scheduleOwnerCommit(): void {
    this._ownerCommitPending = true;
    if (this._ownerCommitHandle !== null) {
      return;
    }

    const elapsedSinceLastCommit = Date.now() - this._ownerCommitLastAt;
    const delay = Math.max(0, LexRenderEventBridge.OWNER_COMMIT_MIN_INTERVAL_MS - elapsedSinceLastCommit);
    const token = ++this._ownerCommitToken;
    const timerId = scheduleBrowserTask(() => {
      this._ownerCommitHandle = null;
      this.flushScheduledOwnerCommit(token);
    }, delay);
    this._ownerCommitHandle = {
      dispose: () => clearTimeout(timerId),
    };
  }

  private clearPendingOwnerCommit(): void {
    this._ownerCommitHandle?.dispose();
    this._ownerCommitHandle = null;
    this._ownerCommitPending = false;
    this._ownerCommitToken += 1;
  }

  private flushScheduledOwnerCommit(token: number): void {
    if (token !== this._ownerCommitToken || !this._ownerCommitPending) {
      return;
    }

    this._ownerCommitPending = false;
    this.commitTurnResponsesToOwnerNow('deferred');
  }

  private commitTurnResponsesToOwnerNow(mode: 'immediate' | 'deferred'): void {
    if (typeof this.ctx.syncExecutionRuntimeTurnResponses !== 'function') {
      return;
    }

    const projectionSessionResource = normalizeSessionResource(this._projectionSessionResource);
    if (!projectionSessionResource) {
      return;
    }

    const revision = this._turnResponsesRevision;
    if (revision === this._ownerCommittedRevision) {
      return;
    }

    const startedAt = performance.now();
    let committed = false;
    let turnCount = 0;
    ChatPerformanceTracer.runWithSurface('chat_projection', () => {
      const turnResponses = this.snapshotRetainedTurnResponses();
      turnCount = turnResponses.length;
      const ownerDiagnostics = buildSessionTurnOwnerDiagnostics(projectionSessionResource, turnResponses);
      if (turnResponses.length > 0
        && ownerDiagnostics.ownerSamples.length > 0
        && !ownerDiagnostics.ownerSamples.includes(projectionSessionResource)) {
        console.warn('[LexRender][blocked-owner-commit]', {
          projectionSessionResource,
          ownerSamples: ownerDiagnostics.ownerSamples,
          firstTurnId: ownerDiagnostics.firstTurnId,
          firstRequestPreview: ownerDiagnostics.firstRequestPreview,
        });
        return;
      }

      this.ctx.syncExecutionRuntimeTurnResponses?.(
        projectionSessionResource,
        turnResponses,
        mode === 'deferred'
          ? liveTranscriptProjection('visible-render')
          : terminalTranscriptProjection('visible-render'),
      );
      committed = true;
    }, `owner_snapshot:${mode}`);

    if (committed) {
      this._ownerCommittedRevision = revision;
      this._ownerCommitLastAt = Date.now();
    }
    ChatPerformanceTracer.recordDuration(
      'owner_turn_snapshot_commit',
      performance.now() - startedAt,
      `mode=${mode},turns=${turnCount},revision=${revision},committed=${committed}`,
      { slowThresholdMs: 16 },
    );
  }

  private setRetainedTurnResponse(turn: TurnResponseTurn): void {
    this._turnResponses.set(turn.turnId, turn);
    this._turnResponsesRevision += 1;
  }

  private replaceProjectedResponseParts(
    turns: readonly TurnResponseTurn[],
    clearTurnIds: readonly string[] = [],
  ): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    const turnsById = new Map<string, TurnResponseTurn>();
    for (const turn of turns) {
      const turnId = normalizeSessionResource(turn.turnId);
      if (turnId) {
        turnsById.set(turnId, turn);
      }
    }

    const turnIds = new Set<string>();
    for (const turnId of clearTurnIds) {
      const normalizedTurnId = normalizeSessionResource(turnId);
      if (normalizedTurnId) {
        turnIds.add(normalizedTurnId);
      }
    }
    for (const turnId of turnsById.keys()) {
      turnIds.add(turnId);
    }

    for (const turnId of turnIds) {
      this.ctx.partStore.replacePartsForResponse(
        turnId,
        turnResponsePartsToChatParts(turnsById.get(turnId)?.response?.parts),
      );
    }
  }

  private clearRetainedTurnResponses(): void {
    if (this._turnResponses.size > 0) {
      this._turnResponsesRevision += 1;
    }
    this._turnResponses.clear();
  }

  private snapshotRetainedTurnResponses(): readonly TurnResponseTurn[] {
    return [...this._turnResponses.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(turn => clonePublicTurnResponseTurn(turn));
  }

  private invalidateVisibleProjection(): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    this.ctx.invalidateHostRequestGraph();
    this.ctx.triggerSyncDetectChanges();
  }

  private canProjectToVisible(): boolean {
    return this.canUseCurrentTurnResponses();
  }

  private canUseCurrentTurnResponses(): boolean {
    const projectionSessionResource = normalizeSessionResource(this._projectionSessionResource);
    if (!projectionSessionResource) {
      return false;
    }

    if (typeof this.ctx.isRuntimeViewAttached === 'function'
      && !this.ctx.isRuntimeViewAttached(projectionSessionResource)) {
      return false;
    }

    const expectedGeneration = this._projectionVisibleAttachmentGeneration;
    if (typeof this.ctx.isRuntimeViewAttachmentCurrent !== 'function') {
      return true;
    }
    if (expectedGeneration === null) {
      return false;
    }

    return this.ctx.isRuntimeViewAttachmentCurrent(projectionSessionResource, expectedGeneration);
  }

  private recordLiveWritePath(event: RenderEvent, writePath: string): void {
    if (!ChatPerformanceTracer.isEnabled() || !this._currentTurn?.turnId) {
      return;
    }

    ChatPerformanceTracer.recordRenderEvent('live_event_write_path', {
      eventType: event.type,
      writePath,
      turnId: this._currentTurn.turnId,
      responseItemId: `response:${this._currentTurn.turnId}`,
      projectionSessionResource: this._projectionSessionResource,
      visibleAttachmentGeneration: this._projectionVisibleAttachmentGeneration,
      currentVisibleAttachmentGeneration: normalizeVisibleAttachmentGeneration(
        this.ctx.readRuntimeViewAttachmentGeneration?.(this._projectionSessionResource),
      ),
      legacyHandleUsed: false,
    });
  }
}

function normalizeSessionResource(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeVisibleAttachmentGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function resolveCanonicalLifecycleTurnId(
  events: readonly CanonicalRenderLifecycleEvent[],
  sourceEvent: RenderEvent,
  currentTurnId: string | null | undefined,
): string {
  for (const event of events) {
    if ('turnId' in event && typeof event.turnId === 'string' && event.turnId.trim().length > 0) {
      return event.turnId.trim();
    }
  }

  if ('turnId' in sourceEvent && typeof sourceEvent.turnId === 'string' && sourceEvent.turnId.trim().length > 0) {
    return sourceEvent.turnId.trim();
  }

  return typeof currentTurnId === 'string' ? currentTurnId.trim() : '';
}

function applyHostStreamPartChanges(
  turn: TurnResponseTurn,
  partChanges: readonly HostStreamPartChange[],
  updatedAt: number,
  patch: { readonly participant?: string } = {},
): TurnResponseTurn {
  const parts = [...turn.response.parts];
  for (const change of partChanges) {
    if (!Number.isInteger(change.partIndex) || change.partIndex < 0) {
      continue;
    }

    parts[change.partIndex] = change.part;
  }

  return {
    ...turn,
    updatedAt,
    response: {
      ...turn.response,
      updatedAt,
      ...(patch.participant ? { participant: patch.participant } : {}),
      parts,
      // Live host-stream deltas should remain bounded. The authoritative
      // response text is recomputed by TurnResponseIncrementalBuilder at
      // snapshot/final completion; doing a full scan for every token/tool
      // delta turns long streams into repeated full-response scans.
      resultText: deriveLiveHostStreamResultText(turn, partChanges),
    },
  };
}

function deriveLiveHostStreamResultText(
  turn: TurnResponseTurn,
  partChanges: readonly HostStreamPartChange[],
): string {
  let resultText = turn.response.resultText ?? '';
  for (const change of partChanges) {
    const currentPart = change.part;
    if (currentPart?.type !== 'markdown' || isSubagentScopedHostStreamPart(currentPart)) {
      continue;
    }

    const previousPart = turn.response.parts[change.partIndex];
    if (change.kind === 'add') {
      resultText += currentPart.content;
      continue;
    }

    if (change.kind !== 'append' || previousPart?.type !== 'markdown') {
      continue;
    }

    const previousLength = previousPart.content.length;
    if (currentPart.content.length <= previousLength) {
      continue;
    }

    resultText += currentPart.content.slice(previousLength);
  }

  return resultText;
}

function isSubagentScopedHostStreamPart(part: TurnResponseTurn['response']['parts'][number]): boolean {
  const metadata = (part as { readonly metadata?: unknown }).metadata;
  return !!metadata
    && typeof metadata === 'object'
    && (metadata as Record<string, unknown>)['sourceAgentRole'] === 'subagent';
}

function getTurnResponseModelName(turn: TurnResponseTurn | null | undefined): string | undefined {
  return getTurnResponseResolvedModelName(turn);
}

function toHostClearToPreviousToolInvocationReason(
  reason: RenderClearToPreviousToolInvocationReason,
): HostResponseClearToPreviousToolInvocationReason {
  return reason;
}

function cloneTurnResponseTurn(turn: TurnResponseTurn): TurnResponseTurn {
  const responseModel = cloneTurnResponseModelSidecar(turn.responseModel);

  return {
    ...turn,
    ...(turn.usage ? { usage: { ...turn.usage } } : {}),
    request: { ...turn.request },
    rounds: turn.rounds.map(round => ({
      ...round,
      toolCalls: round.toolCalls.map(toolCall => ({ ...toolCall })),
    })),
    response: {
      ...turn.response,
      ...(turn.response.usedContext
        ? {
          usedContext: {
            ...turn.response.usedContext,
            documents: turn.response.usedContext.documents.map(document => ({
              ...document,
              ranges: document.ranges.map(range => ({ ...range })),
            })),
          },
        }
        : {}),
      contentReferences: (turn.response.contentReferences ?? []).map(reference => ({
        ...reference,
        ...(reference.options
          ? {
            options: {
              ...reference.options,
              ...(reference.options.status ? { status: { ...reference.options.status } } : {}),
              ...(reference.options.diffMeta ? { diffMeta: { ...reference.options.diffMeta } } : {}),
            },
          }
          : {}),
      })),
      codeCitations: (turn.response.codeCitations ?? []).map(citation => ({ ...citation })),
      progressMessages: (turn.response.progressMessages ?? []).map(message => ({ ...message })),
      parts: hydrateQuestionAnswersFromAskUserToolMetadata(turn.response.parts).map(part => ({ ...part })),
    },
    ...(responseModel ? { responseModel } : {}),
  };
}

function clonePublicTurnResponseTurn(turn: TurnResponseTurn): TurnResponseTurn {
  const responseModel = cloneTurnResponseModelSidecar(turn.responseModel);

  return {
    ...turn,
    ...(turn.usage ? { usage: { ...turn.usage } } : {}),
    request: { ...turn.request },
    rounds: turn.rounds.map(round => ({
      ...round,
      toolCalls: round.toolCalls.map(toolCall => ({ ...toolCall })),
    })),
    response: {
      ...turn.response,
      ...(turn.response.usedContext
        ? {
          usedContext: {
            ...turn.response.usedContext,
            documents: turn.response.usedContext.documents.map(document => ({
              ...document,
              ranges: document.ranges.map(range => ({ ...range })),
            })),
          },
        }
        : {}),
      contentReferences: (turn.response.contentReferences ?? []).map(reference => ({
        ...reference,
        ...(reference.options
          ? {
            options: {
              ...reference.options,
              ...(reference.options.status ? { status: { ...reference.options.status } } : {}),
              ...(reference.options.diffMeta ? { diffMeta: { ...reference.options.diffMeta } } : {}),
            },
          }
          : {}),
      })),
      codeCitations: (turn.response.codeCitations ?? []).map(citation => ({ ...citation })),
      progressMessages: (turn.response.progressMessages ?? []).map(message => ({ ...message })),
      parts: hydrateQuestionAnswersFromAskUserToolMetadata(turn.response.parts).map(part => ({ ...part })),
    },
    ...(responseModel ? { responseModel } : {}),
  };
}

function cloneQuestionAnswers(answers: TurnResponseQuestionPart['answers']): TurnResponseQuestionPart['answers'] {
  if (!answers) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(answers).map(([question, answer]) => [question, {
    selected: Array.isArray(answer.selected) ? [...answer.selected] : [],
    freeText: answer.freeText ?? null,
    skipped: !!answer.skipped,
  }]));
}

function findQuestionAnswerTargetIndex(
  parts: readonly TurnResponseTurn['response']['parts'][number][],
  answers: TurnResponseQuestionPart['answers'],
  partId: string,
): number {
  const normalizedPartId = typeof partId === 'string' ? partId.trim() : '';
  if (normalizedPartId.length > 0) {
    for (let index = parts.length - 1; index >= 0; index--) {
      const part = parts[index];
      if (part?.type === 'question' && part.partId === normalizedPartId) {
        return index;
      }
    }
  }

  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index] as Partial<TurnResponseQuestionPart> | undefined;
    if (part?.type === 'question' && !part.answers && questionAnswersMatchPart(answers, part)) {
      return index;
    }
  }

  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index] as Partial<TurnResponseQuestionPart> | undefined;
    if (part?.type === 'question' && questionAnswersMatchPart(answers, part)) {
      return index;
    }
  }

  return -1;
}

function turnResponsePartsToChatParts(
  parts: TurnResponseTurn['response']['parts'] | null | undefined,
) {
  return Array.isArray(parts)
    ? parts.flatMap(part => turnResponsePartToChatParts(part))
    : [];
}

function questionAnswersMatchPart(
  answers: TurnResponseQuestionPart['answers'],
  part: Partial<TurnResponseQuestionPart>,
): boolean {
  if (!answers || !Array.isArray(part.questions)) {
    return false;
  }

  const questionSet = new Set(
    part.questions
      .map(question => question?.question)
      .filter((question): question is string => typeof question === 'string' && question.trim().length > 0),
  );
  const answerKeys = Object.keys(answers).filter(question => question.trim().length > 0);
  return answerKeys.length > 0 && answerKeys.every(question => questionSet.has(question));
}

function isResponseModelRenderEvent(
  event: RenderEvent,
): event is Extract<RenderEvent, {
  type: 'response_reference' | 'response_code_citation' | 'response_progress_message' | 'response_followups' | 'response_command' | 'usage'
}> {
  return event.type === 'response_reference'
    || event.type === 'response_code_citation'
    || event.type === 'response_progress_message'
    || event.type === 'response_followups'
    || event.type === 'response_command'
    || event.type === 'usage';
}

function isLiveTextStreamRenderEvent(event: RenderEvent): boolean {
  return event.type === 'markdown_delta'
    || event.type === 'thinking_delta';
}

function shouldCommitLiveTurnSnapshotImmediately(event: RenderEvent): boolean {
  return event.type === 'question_request'
    || event.type === 'approval_request'
    || event.type === 'approval_resolve'
    || event.type === 'thinking_complete'
    || event.type === 'tool_call_begin'
    || event.type === 'tool_call_end'
    || event.type === 'approval_auto_review_start'
    || event.type === 'approval_auto_review_complete'
    || event.type === 'state_update'
    || event.type === 'error_notice'
    || event.type === 'subagent_begin'
    || event.type === 'subagent_end'
    || isStructuralSubagentActivityEvent(event)
    || event.type === 'background_task_update'
    || event.type === 'todo_update'
    || event.type === 'session_meta';
}

function isStructuralSubagentActivityEvent(event: RenderEvent): boolean {
  if (event.type !== 'subagent_activity') {
    return false;
  }

  return event.activityKind === 'tool_started'
    || event.activityKind === 'tool_completed'
    || event.activityKind === 'tool_failed';
}

function isIntermediateToolTurnEnd(event: Extract<RenderEvent, { type: 'turn_end' }>): boolean {
  const continuation = event.continuation;
  const stopReason = typeof continuation?.stopReason === 'string'
    ? continuation.stopReason
    : undefined;
  return stopReason === 'TOOL_CALLS';
}

function mapTurnResponseStatusToCanonicalLifecycleStatus(
  status: TurnResponseStatus,
): CanonicalRenderItemStatus {
  switch (status) {
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'failed';
    default:
      return 'completed';
  }
}

