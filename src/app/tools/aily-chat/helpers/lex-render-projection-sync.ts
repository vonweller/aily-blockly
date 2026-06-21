import type { IChatViewAccess } from '../core/chat-context';
import {
  TurnResponseHostProjectionBuilder,
  type IncrementalTurnResponsePartSource,
  type TurnResponseProjectionHandle,
} from '../core/turn-response-host-projection-builder';
import type { TurnResponseTurn } from 'aily-lex/browser';

import { findChatMessageHandleByTurnId } from './chat-message-handle';
import { ChatPerformanceTracer } from '../services/chat-perf-tracer';
import type {
  CanonicalRenderItemStatus,
  CanonicalRenderLifecycleEvent,
} from '../core/render-event-item-lifecycle';
import { CanonicalRenderPayloadProjector } from '../core/canonical-render-payload-projector';

type LexRenderProjectionSyncContext = Pick<
  IChatViewAccess,
  'partStore' | 'list' | 'invalidateHostRequestGraph' | 'triggerSyncDetectChanges'
>;

type RenderProjectionLifecycleAccess = {
  readonly currentMessageHandle: TurnResponseProjectionHandle | null;
};

type RenderProjectionVisibilityAccess = {
  readProjectionSessionResource?(): string | null | undefined;
  readCurrentViewSessionResource?(): string | null | undefined;
};

type ViewRefreshHandle = {
  dispose(): void;
};

type CanonicalProjectionPayloadMode = 'legacy' | 'canonical';

export class LexRenderProjectionSync {
  private readonly _hostProjectionBuilder: TurnResponseHostProjectionBuilder;
  private readonly _canonicalPayloadProjector: CanonicalRenderPayloadProjector;
  private readonly _canonicalReplayEventsByTurnId = new Map<string, CanonicalRenderLifecycleEvent[]>();
  private readonly _canonicalReplayCountsByTurnId = new Map<string, WeakMap<object, number>>();
  private _viewRefreshHandle: ViewRefreshHandle | null = null;
  private _viewRefreshPending = false;

  constructor(
    private readonly ctx: LexRenderProjectionSyncContext,
    private readonly messageLifecycleBridge: RenderProjectionLifecycleAccess,
    private readonly visibility: RenderProjectionVisibilityAccess = {},
  ) {
    this._hostProjectionBuilder = new TurnResponseHostProjectionBuilder(ctx.partStore);
    this._canonicalPayloadProjector = new CanonicalRenderPayloadProjector(ctx.partStore);
  }

  private projectPayloadChanges(
    currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'> | null,
    source: IncrementalTurnResponsePartSource,
    options: { syncContent?: boolean } = {},
  ): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle || !currentTurn) {
      return;
    }

    const projectionStartedAt = performance.now();
    const partsChanged = this._hostProjectionBuilder.projectIncrementalParts(handle, source, {
      syncContent: false,
    });
    if (options.syncContent === true) {
      handle.message.content = typeof currentTurn.response.resultText === 'string'
        ? currentTurn.response.resultText
        : '';
    }
    const metaChanged = this._hostProjectionBuilder.syncMessageMeta(handle, currentTurn);
    ChatPerformanceTracer.recordDuration(
      'visible_projection',
      performance.now() - projectionStartedAt,
      `syncContent=${options.syncContent === true},partsChanged=${partsChanged},metaChanged=${metaChanged}`,
      { slowThresholdMs: 12 },
    );

    if (partsChanged || metaChanged) {
      if (options.syncContent === true && typeof this.visibility.readCurrentViewSessionResource !== 'function') {
        this.ctx.invalidateHostRequestGraph();
        this.ctx.triggerSyncDetectChanges();
        return;
      }
      this.scheduleViewRefresh();
    }
  }

  projectCanonicalChanges(
    currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'> | null,
    source: IncrementalTurnResponsePartSource,
    lifecycleEvents: readonly CanonicalRenderLifecycleEvent[],
    options: {
      syncContent?: boolean;
      applyTurnCompletion?: boolean;
      payloadProjection?: CanonicalProjectionPayloadMode;
    } = {},
  ): void {
    const payloadProjection = options.payloadProjection ?? 'canonical';
    const projectedLifecycleEvents = payloadProjection === 'canonical'
      ? this.selectCanonicalReplayEventsForCurrentHandle(currentTurn, lifecycleEvents)
      : lifecycleEvents;
    if (payloadProjection === 'legacy') {
      this.projectPayloadChanges(currentTurn, source, {
        syncContent: options.syncContent,
      });
    } else if (options.syncContent === true) {
      this.syncProjectedCompatibilityContent(currentTurn);
      this.syncProjectedMessageMeta(currentTurn);
    } else {
      this.syncProjectedMessageMeta(currentTurn);
    }
    this.applyCanonicalLifecycleEvents(currentTurn, projectedLifecycleEvents, {
      applyTurnCompletion: options.applyTurnCompletion,
      projectPayloads: payloadProjection === 'canonical',
    });
  }

  projectCanonicalLifecycleOnly(
    currentTurn: Pick<TurnResponseTurn, 'turnId'> | null,
    events: readonly CanonicalRenderLifecycleEvent[],
    options: { applyTurnCompletion?: boolean } = {},
  ): void {
    this.applyCanonicalLifecycleEvents(currentTurn, events, {
      ...options,
      projectPayloads: true,
    });
  }

  private applyCanonicalLifecycleEvents(
    currentTurn: Pick<TurnResponseTurn, 'turnId'> | null,
    events: readonly CanonicalRenderLifecycleEvent[],
    options: { applyTurnCompletion?: boolean; projectPayloads?: boolean } = {},
  ): void {
    if (!events.length || !this.canProjectToVisible()) {
      return;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle) {
      return;
    }

    let changed = false;
    const lifecycleStartedAt = performance.now();
    if (options.projectPayloads === true) {
      changed = this._canonicalPayloadProjector.project(handle, events) || changed;
    }

    for (const event of events) {
      if (event.type === 'itemCompleted') {
        if (event.itemKind === 'thinking') {
          this.ctx.partStore.completeThinkingHandle(handle, event.scope);
          changed = true;
        } else if (event.itemKind === 'tool') {
          const toolCallId = parseLifecycleToolCallId(event.itemId);
          if (toolCallId) {
            changed = this.ctx.partStore.patchToolCallForHandle(handle, toolCallId, {
              state: toToolCallState(event.status),
            }) || changed;
          }
        } else if (event.itemKind === 'state') {
          const stateId = parseLifecycleStateId(event.itemId);
          if (stateId) {
            changed = this.ctx.partStore.patchStateForHandle(handle, stateId, {
              state: toStatePartState(event.status),
            }) || changed;
          }
        } else if (event.itemKind === 'confirmation') {
          const confirmationPartId = parseLifecycleConfirmationPartId(event.itemId);
          if (confirmationPartId) {
            changed = this.ctx.partStore.updateConfirmationResultForHandle(handle, confirmationPartId, {
              resolved: true,
              result: event.status === 'cancelled' ? 'rejected' : 'approved',
            }) || changed;
          }
        } else if (event.itemKind === 'plan') {
          changed = this.ctx.partStore.completePlanPartForHandle(
            handle,
            `canonical:plan:${event.itemId}`,
            event.status === 'failed' ? 'failed' : 'completed',
          ) || changed;
        }
        continue;
      }

      if (event.type === 'turnCompleted' && options.applyTurnCompletion === true) {
        this.ctx.partStore.finalizeRunningPartsForHandle(handle, {
          status: toRunningPartFinalizeStatus(event.status),
        });
        changed = true;
      }
    }

    ChatPerformanceTracer.recordDuration(
      'visible_lifecycle_projection',
      performance.now() - lifecycleStartedAt,
      `events=${events.length},changed=${changed}`,
      { slowThresholdMs: 8 },
    );

    if (changed) {
      this.scheduleViewRefresh();
    }
  }

  clearProjectedMessage(currentTurn: Pick<TurnResponseTurn, 'turnId'> | null): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    this._hostProjectionBuilder.clearHandle(this.resolveProjectedMessageHandle(currentTurn));
  }

  syncProjectedMessageMeta(currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'> | null): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle || !currentTurn) {
      return;
    }

    this.syncMessageMetaIfNeeded(handle, currentTurn);
  }

  private syncMessageMetaIfNeeded(
    handle: TurnResponseProjectionHandle,
    currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'>,
  ): void {
    if (this._hostProjectionBuilder.syncMessageMeta(handle, currentTurn)) {
      this.scheduleViewRefresh();
    }
  }

  private syncProjectedCompatibilityContent(
    currentTurn: Pick<TurnResponseTurn, 'turnId' | 'response'> | null,
  ): void {
    if (!this.canProjectToVisible()) {
      return;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle || !currentTurn) {
      return;
    }

    handle.message.content = typeof currentTurn.response.resultText === 'string'
      ? currentTurn.response.resultText
      : '';
  }

  dispose(): void {
    this.clearPendingViewRefresh();
  }

  private selectCanonicalReplayEventsForCurrentHandle(
    currentTurn: Pick<TurnResponseTurn, 'turnId'> | null,
    events: readonly CanonicalRenderLifecycleEvent[],
  ): readonly CanonicalRenderLifecycleEvent[] {
    const turnId = normalizeSessionResource(currentTurn?.turnId);
    if (!turnId || events.length === 0) {
      return events;
    }

    const handle = this.resolveProjectedMessageHandle(currentTurn);
    if (!handle || !handle.message || typeof handle.message !== 'object') {
      return events;
    }

    let replayEvents = this._canonicalReplayEventsByTurnId.get(turnId);
    if (!replayEvents) {
      replayEvents = [];
      this._canonicalReplayEventsByTurnId.set(turnId, replayEvents);
    }

    let replayCounts = this._canonicalReplayCountsByTurnId.get(turnId);
    if (!replayCounts) {
      replayCounts = new WeakMap<object, number>();
      this._canonicalReplayCountsByTurnId.set(turnId, replayCounts);
    }

    const messageKey = handle.message as object;
    const startIndex = replayCounts.get(messageKey) ?? 0;
    replayEvents.push(...events);
    replayCounts.set(messageKey, replayEvents.length);
    this.trimCanonicalReplayBuffers();
    return replayEvents.slice(startIndex);
  }

  private trimCanonicalReplayBuffers(): void {
    const maxTurns = 16;
    while (this._canonicalReplayEventsByTurnId.size > maxTurns) {
      const oldestTurnId = this._canonicalReplayEventsByTurnId.keys().next().value as string | undefined;
      if (!oldestTurnId) {
        return;
      }
      this._canonicalReplayEventsByTurnId.delete(oldestTurnId);
      this._canonicalReplayCountsByTurnId.delete(oldestTurnId);
    }
  }

  private scheduleViewRefresh(): void {
    this._viewRefreshPending = true;
    if (this._viewRefreshHandle !== null) {
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

    this._viewRefreshHandle = schedule(() => {
      const refreshStartedAt = performance.now();
      this._viewRefreshHandle = null;
      if (!this._viewRefreshPending) {
        return;
      }
      this._viewRefreshPending = false;
      this.ctx.invalidateHostRequestGraph();
      this.ctx.triggerSyncDetectChanges();
      ChatPerformanceTracer.recordDuration('visible_view_refresh', performance.now() - refreshStartedAt, undefined, {
        slowThresholdMs: 12,
      });
    });
  }

  private clearPendingViewRefresh(): void {
    this._viewRefreshHandle?.dispose();
    this._viewRefreshHandle = null;
    this._viewRefreshPending = false;
  }

  private resolveProjectedMessageHandle(
    currentTurn: Pick<TurnResponseTurn, 'turnId'> | null,
  ): TurnResponseProjectionHandle | null {
    if (currentTurn) {
      const byTurnId = findChatMessageHandleByTurnId(this.ctx.list, currentTurn.turnId, { role: 'aily' });
      if (byTurnId) {
        return byTurnId;
      }
    }

    return this.messageLifecycleBridge.currentMessageHandle;
  }

  private canProjectToVisible(): boolean {
    const readCurrentViewSessionResource = this.visibility.readCurrentViewSessionResource;
    if (typeof readCurrentViewSessionResource !== 'function') {
      return true;
    }

    const currentViewSessionResource = normalizeSessionResource(readCurrentViewSessionResource());
    if (!currentViewSessionResource) {
      return false;
    }

    const projectionSessionResource = normalizeSessionResource(
      this.visibility.readProjectionSessionResource?.(),
    );
    return !!projectionSessionResource && projectionSessionResource === currentViewSessionResource;
  }
}

function parseLifecycleToolCallId(itemId: string): string | null {
  const marker = ':tool:';
  const markerIndex = itemId.lastIndexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const toolCallId = itemId.slice(markerIndex + marker.length).trim();
  return toolCallId || null;
}

function parseLifecycleStateId(itemId: string): string | null {
  const statePrefixes = ['state:', 'background:', 'todo:'];
  for (const prefix of statePrefixes) {
    if (itemId.startsWith(prefix)) {
      const stateId = itemId.slice(prefix.length).trim();
      return stateId || null;
    }
  }
  return null;
}

function parseLifecycleConfirmationPartId(itemId: string): string | null {
  const marker = ':approval:';
  const markerIndex = itemId.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const askId = itemId.slice(markerIndex + marker.length).trim();
    return askId ? `confirmation:${askId}` : null;
  }

  const directPrefix = 'confirmation:';
  if (itemId.startsWith(directPrefix)) {
    return itemId.trim() || null;
  }

  return null;
}

function toToolCallState(status: CanonicalRenderItemStatus): 'done' | 'warn' | 'error' {
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'cancelled') {
    return 'warn';
  }
  return 'done';
}

function toStatePartState(status: CanonicalRenderItemStatus): 'done' | 'warn' | 'error' {
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'cancelled') {
    return 'warn';
  }
  return 'done';
}

function toRunningPartFinalizeStatus(status: CanonicalRenderItemStatus): 'completed' | 'cancelled' | 'error' {
  if (status === 'failed') {
    return 'error';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'completed';
}

function normalizeSessionResource(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}
