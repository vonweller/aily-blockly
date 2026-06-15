import type { IAgentLifecycle, IChatServiceAccess, IChatViewAccess } from '../core/chat-context';
import type {
  RenderEvent,
  RenderClearToPreviousToolInvocationReason,
  SessionSnapshot,
  TurnResponseQuestionPart,
  TurnResponseStatus,
  TurnResponseTurn,
} from 'aily-lex/browser';
import type { TurnResponseProjectionHandle } from '../core/turn-response-host-projection-builder';
import { TurnResponseIncrementalBuilder } from '../core/turn-response-stream-builder';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';
import { LexRenderHostStreamEmitter, type HostStreamPartChange } from './lex-render-host-stream-emitter';
import { LexRenderProjectionSync } from './lex-render-projection-sync';
import { LexRenderTurnMaterializer } from './lex-render-turn-materializer';
import { LexSideEffectHandler } from './lex-side-effect-handler';
import {
  buildSeededTurnResponseTurn,
  buildTurnResponseRequest,
  getTurnResponseParticipant,
  resolveInitialResponseSlashCommand,
} from '../core/turn-response-stream-contract';
import { hydrateQuestionAnswersFromAskUserToolMetadata } from '../core/turn-response-part-mapper';
import {
  type HostResponseClearToPreviousToolInvocationReason,
  type IHostStreamListener,
} from './host-turn-response-state';
import {
  cloneTurnResponseModelSidecar,
  getTurnResponseResolvedModelName,
  withExplicitAgentSummaryPreview,
} from './turn-response-response-model';

/** Narrow context: only needs partStore for rendering + toolCallingIteration for turn tracking */
type LexRenderEventBridgeContext =
  Pick<IChatViewAccess, 'partStore' | 'list' | 'invalidateHostRequestGraph' | 'triggerSyncDetectChanges'>
  & Pick<IAgentLifecycle, 'toolCallingIteration' | 'isCancelled' | 'currentMessageSource'>
  & Pick<IChatServiceAccess, 'contextBudgetService'>
  & {
    readCurrentViewSessionResource?(): string | null;
    syncExecutionRuntimeTurnResponses?(
      sessionId: string | null | undefined,
      turnResponses: readonly TurnResponseTurn[] | null | undefined,
    ): void;
  };

type RenderMessageLifecycleAccess = {
  ensureAilyMessage(turnId?: string): void;
  readonly currentMessageHandle: TurnResponseProjectionHandle | null;
};

/**
 * LexRenderEventBridge — unified bridge that consumes RenderEvent
 * and writes to ChatPartStore via RenderEventPartAdapter.
 *
 * Replaces the chain of:
 *   LexAgentEventBridge → LexRuntimeEventBridge
 *                        → LexStateEventBridge
 *                        → LexSubagentPartBridge
 *                        → PartEventProcessor
 *
 * Also satisfies the minimal reset/finalize contract so LexMessageLifecycleBridge can
 * call reset()/finalize() without knowing which processor is in use.
 *
 * Side effects previously scattered across those bridges are handled inline.
 */
export class LexRenderEventBridge {
  private readonly _streamBuilder: TurnResponseIncrementalBuilder;
  private readonly _sideEffects: LexSideEffectHandler;
  private readonly _hostStreamEmitter = new LexRenderHostStreamEmitter();
  private readonly _projectionSync: LexRenderProjectionSync;
  private readonly _turnMaterializer: LexRenderTurnMaterializer;
  private readonly _turnResponses = new Map<string, TurnResponseTurn>();
  private _currentTurn: TurnResponseTurn | null = null;
  private _pendingRequestContent = '';
  private _pendingRequestDisplayContent: string | undefined;
  private _pendingRequestMetadata: TurnResponseTurn['request']['metadata'];
  private _currentTurnHasExecutionError = false;
  private _projectionSessionResource: string | null = null;
  private _ownerCommitHandle: { dispose(): void } | null = null;
  private _ownerCommitPending = false;

  constructor(
    private readonly ctx: LexRenderEventBridgeContext,
    private readonly hostSyncBridge: LexHostSyncBridge,
    private readonly messageLifecycleBridge: RenderMessageLifecycleAccess,
    private readonly getSessionSnapshot?: () => SessionSnapshot | null,
  ) {
    this._streamBuilder = new TurnResponseIncrementalBuilder();
    this._sideEffects = new LexSideEffectHandler(ctx, hostSyncBridge);
    this._projectionSync = new LexRenderProjectionSync(ctx, messageLifecycleBridge, {
      readProjectionSessionResource: () => this._projectionSessionResource,
      readCurrentViewSessionResource: typeof ctx.readCurrentViewSessionResource === 'function'
        ? () => ctx.readCurrentViewSessionResource?.() ?? null
        : undefined,
    });
    this._turnMaterializer = new LexRenderTurnMaterializer(ctx, getSessionSnapshot);
  }

  /** H1: update the host stream listener at runtime (e.g. after session restore). */
  setHostStreamListener(listener: IHostStreamListener | null): void {
    this._hostStreamEmitter.setListener(listener);
  }

  setProjectionSessionResource(sessionResource: string | null | undefined): void {
    const normalized = normalizeSessionResource(sessionResource);
    this._projectionSessionResource = normalized || null;
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

    this._turnResponses.set(turnId, seededTurn);
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
    this.reset();
    this._turnResponses.clear();

    for (const turn of turnResponses) {
      this._turnResponses.set(turn.turnId, cloneTurnResponseTurn(turn));
    }

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
    this._turnResponses.set(this._currentTurn.turnId, this._currentTurn);
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

      const finalizedTurn: TurnResponseTurn = {
        ...latestStreamingTurn,
        updatedAt: Date.now(),
        response: {
          ...latestStreamingTurn.response,
          status: fallbackStatus,
          updatedAt: Date.now(),
        },
      };
      this._turnResponses.set(finalizedTurn.turnId, finalizedTurn);
      this.commitTurnResponsesToOwner('immediate');
      this.invalidateVisibleProjection();
      return true;
    }

    this.syncCurrentTurn(Date.now(), fallbackStatus, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'immediate');
    this._projectionSync.projectPendingChanges(this._currentTurn, this._streamBuilder, { syncContent: true });
    return true;
  }

  appendExecutionError(message: string): boolean {
    if (!this._currentTurn) {
      return false;
    }

    this._currentTurnHasExecutionError = true;
    if (this.canProjectToVisible()) {
      this.messageLifecycleBridge.ensureAilyMessage(this._currentTurn.turnId);
    }
    this._streamBuilder.processEvent({ type: 'error_notice', message, timestamp: Date.now() });
    this.syncCurrentTurn(Date.now(), 'error', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'immediate');
    this._projectionSync.projectPendingChanges(this._currentTurn, this._streamBuilder, { syncContent: true });
    return true;
  }

  processEvent(event: RenderEvent): void {
    let turnBeginMode: 'fresh' | 'continued' | null = null;
    if (event.type === 'turn_begin') {
      turnBeginMode = this.beginTurn(event.turnId, event.timestamp);
    }

    this._sideEffects.processEvent(event);

    if (!this._currentTurn) {
      return;
    }

    if (this.canProjectToVisible()) {
      this.messageLifecycleBridge.ensureAilyMessage(this._currentTurn.turnId);
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
      this.syncCurrentTurn(
        event.timestamp,
        'completed',
        event.usage,
        event.continuation,
        event.modelName,
        event.modelBillingLabel,
        event.modelRouting,
        event.quotaSnapshot,
        event.terminationReason,
        'immediate',
      );
      this.invalidateVisibleProjection();
      this._projectionSync.projectPendingChanges(this._currentTurn, this._streamBuilder, { syncContent: true });
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

    const responseModelChanged = this._streamBuilder.processEvent(event) && isResponseModelRenderEvent(event);
    this.syncCurrentTurn(event.timestamp, this.resolveLiveFallbackStatus(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'deferred');
    this._projectionSync.projectPendingChanges(this._currentTurn, this._streamBuilder, {
      syncContent: event.type === 'markdown_delta',
    });
    if (event.type === 'response_followups') {
      this._hostStreamEmitter.emitResponseFollowups(this._currentTurn.turnId, event.value, event.timestamp);
    }
    if (responseModelChanged) {
      this.invalidateVisibleProjection();
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
    this._currentTurn = null;
    this._pendingRequestContent = '';
    this._pendingRequestDisplayContent = undefined;
    this._pendingRequestMetadata = undefined;
    this._currentTurnHasExecutionError = false;
    this.clearPendingOwnerCommit();
  }

  /** Clear all retained live turn responses when a session is replaced or restored. */
  clearSessionState(): void {
    this.reset();
    this._turnResponses.clear();
    this._hostStreamEmitter.clearSessionState();
  }

  /** Clean up. */
  dispose(): void {
    this.clearPendingOwnerCommit();
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
        this._turnResponses.set(this._currentTurn.turnId, this._currentTurn);
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
    this._turnResponses.set(turnId, this._currentTurn);
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

    const previousTurn = this._currentTurn;
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
    if (selectedPresetId || selectedModel || this._currentTurn.responseModel?.modelName) {
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

    this._turnResponses.set(this._currentTurn.turnId, this._currentTurn);
    this.commitTurnResponsesToOwner(ownerCommitMode);
    const partChanges = this._streamBuilder.drainTurnResponsePartChanges();
    this._hostStreamEmitter.emitTurnDelta(this._currentTurn, previousTurn, partChanges);
  }

  private commitTurnResponsesToOwner(mode: 'immediate' | 'deferred' = 'immediate'): void {
    if (mode === 'deferred') {
      this.scheduleOwnerCommit();
      return;
    }

    this.clearPendingOwnerCommit();
    this.commitTurnResponsesToOwnerNow();
  }

  private scheduleOwnerCommit(): void {
    this._ownerCommitPending = true;
    if (this._ownerCommitHandle !== null) {
      return;
    }

    const schedule = typeof globalThis.requestAnimationFrame === 'function'
      ? (callback: () => void) => {
        const frameId = globalThis.requestAnimationFrame(callback);
        return {
          dispose: () => globalThis.cancelAnimationFrame?.(frameId),
        };
      }
      : (callback: () => void) => {
        const timerId = setTimeout(callback, 16);
        return {
          dispose: () => clearTimeout(timerId),
        };
      };

    this._ownerCommitHandle = schedule(() => {
      this._ownerCommitHandle = null;
      if (!this._ownerCommitPending) {
        return;
      }
      this._ownerCommitPending = false;
      this.commitTurnResponsesToOwnerNow();
    });
  }

  private clearPendingOwnerCommit(): void {
    this._ownerCommitHandle?.dispose();
    this._ownerCommitHandle = null;
    this._ownerCommitPending = false;
  }

  private commitTurnResponsesToOwnerNow(): void {
    if (typeof this.ctx.syncExecutionRuntimeTurnResponses !== 'function') {
      return;
    }

    const projectionSessionResource = normalizeSessionResource(this._projectionSessionResource);
    if (!projectionSessionResource) {
      return;
    }

    this.ctx.syncExecutionRuntimeTurnResponses(
      projectionSessionResource,
      this.snapshotRetainedTurnResponses(),
    );
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
    if (typeof this.ctx.readCurrentViewSessionResource !== 'function') {
      return true;
    }

    const currentViewSessionResource = normalizeSessionResource(this.ctx.readCurrentViewSessionResource());
    if (!currentViewSessionResource) {
      return false;
    }

    const projectionSessionResource = normalizeSessionResource(this._projectionSessionResource);
    return !!projectionSessionResource && projectionSessionResource === currentViewSessionResource;
  }
}

function normalizeSessionResource(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
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
