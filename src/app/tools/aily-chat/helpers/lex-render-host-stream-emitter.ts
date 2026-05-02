import type { TurnResponseTurn } from 'aily-lex/browser';

import {
  createHostStreamClearToPreviousToolInvocationItem,
  createHostStreamResponseIdentityUpdateItem,
  createHostStreamResponsePartUpdateItem,
  createHostStreamResponseCodeCitationItem,
  createHostStreamResponseContentReferenceItem,
  createHostStreamResponseFollowupsItem,
  createHostStreamResponseProgressMessageItem,
  createHostStreamResponseStartedItem,
  createHostStreamResponseStatusUpdateItem,
  createHostStreamResponseUsedContextItem,
  createHostStreamUsageItem,
  type HostResponseClearToPreviousToolInvocationReason,
  type HostStreamResponseCodeCitationEvent,
  type HostStreamResponseFollowupsEvent,
  type HostStreamResponseIdentityPatch,
  type HostStreamResponseIdentityUpdateEvent,
  type HostStreamResponseProgressMessageEvent,
  type HostStreamResponseReferenceEvent,
  type HostStreamTurnRequestPatch,
  type HostStreamTurnRoundsPatch,
  createHostStreamTurnRequestUpdateItem,
  createHostStreamTurnRoundsUpdateItem,
  type IHostStreamListener,
} from './host-turn-response-state';

export type HostStreamPartChange = {
  partIndex: number;
  kind: 'add' | 'update' | 'append';
  part: TurnResponseTurn['response']['parts'][number];
};

function areTurnResponseCommandsEqual(
  left: TurnResponseTurn['response']['command'] | undefined,
  right: TurnResponseTurn['response']['command'] | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.name === right.name
    && left.description === right.description
    && left.sampleRequest === right.sampleRequest
    && left.isSticky === right.isSticky
    && left.when === right.when
    && JSON.stringify(left.disambiguation ?? []) === JSON.stringify(right.disambiguation ?? []);
}

export class LexRenderHostStreamEmitter {
  private _listener: IHostStreamListener | null = null;

  setListener(listener: IHostStreamListener | null): void {
    this._listener = listener;
  }

  clearSessionState(): void {
    this._listener?.onHostStreamEvent({ type: 'session_cleared' });
  }

  emitClearToPreviousToolInvocation(
    turnId: string,
    updatedAt: number,
    reason: HostResponseClearToPreviousToolInvocationReason,
  ): void {
    const item = createHostStreamClearToPreviousToolInvocationItem(updatedAt, reason);
    this._listener?.onHostStreamEvent({
      type: 'clearToPreviousToolInvocation',
      turnId,
      updatedAt: item.updatedAt,
      reason: item.reason,
    });
  }

  emitResponseFollowups(
    turnId: string,
    followups: TurnResponseTurn['response']['followups'],
    updatedAt: number,
  ): void {
    this.emitResponseItem(
      turnId,
      createHostStreamResponseFollowupsItem(followups ? [...followups] : undefined, updatedAt),
    );
  }

  emitTurnStarted(turn: TurnResponseTurn): void {
    this.emitResponseItem(
      turn.turnId,
      createHostStreamResponseStartedItem(turn.createdAt),
    );
  }

  emitInitialTurnFieldUpdates(turn: TurnResponseTurn): void {
    const requestPatch = this.buildHostTurnRequestPatch(turn.request);
    if (requestPatch) {
      this.emitResponseItem(
        turn.turnId,
        createHostStreamTurnRequestUpdateItem(requestPatch),
      );
    }

    const identityPatch = this.buildResponseIdentityPatch(turn.response);
    if (identityPatch) {
      this.emitResponseItem(
        turn.turnId,
        createHostStreamResponseIdentityUpdateItem(identityPatch, turn.updatedAt),
      );
    }

    this.emitResponseProgressUpdates(turn.turnId, turn.response, turn.updatedAt);
  }

  emitTurnDelta(
    currentTurn: TurnResponseTurn,
    previousTurn: TurnResponseTurn,
    partChanges: HostStreamPartChange[],
  ): void {
    const requestPatch = this.buildHostTurnRequestPatch(currentTurn.request, previousTurn.request);
    if (requestPatch) {
      this.emitResponseItem(
        currentTurn.turnId,
        createHostStreamTurnRequestUpdateItem(requestPatch),
      );
    }

    const roundsPatch = this.buildHostTurnRoundsPatch(currentTurn.rounds, previousTurn.rounds);
    if (roundsPatch) {
      this.emitResponseItem(
        currentTurn.turnId,
        createHostStreamTurnRoundsUpdateItem(roundsPatch),
      );
    }

    const identityPatch = this.buildResponseIdentityPatch(currentTurn.response, previousTurn.response);
    if (identityPatch) {
      this.emitResponseItem(
        currentTurn.turnId,
        createHostStreamResponseIdentityUpdateItem(identityPatch, currentTurn.updatedAt),
      );
    }

    this.emitResponseProgressUpdates(
      currentTurn.turnId,
      currentTurn.response,
      currentTurn.updatedAt,
      previousTurn.response,
    );

    if (previousTurn.response.status !== currentTurn.response.status) {
      this.emitResponseItem(
        currentTurn.turnId,
        createHostStreamResponseStatusUpdateItem(currentTurn.response.status, currentTurn.updatedAt),
      );
    }

    if (!this.areHostTurnUsageEquivalent(previousTurn.usage, currentTurn.usage) && currentTurn.usage) {
      this.emitResponseItem(
        currentTurn.turnId,
        createHostStreamUsageItem(currentTurn.usage, currentTurn.updatedAt),
      );
    }

    for (const change of partChanges) {
      this.emitResponsePartChange(currentTurn, previousTurn, change);
    }
  }

  private emitResponsePartChange(
    currentTurn: TurnResponseTurn,
    previousTurn: TurnResponseTurn,
    change: HostStreamPartChange,
  ): void {
    const item = createHostStreamResponsePartUpdateItem({
      updatedAt: currentTurn.updatedAt,
      partIndex: change.partIndex,
      kind: change.kind,
      part: change.part,
    });

    const previousPart = previousTurn.response.parts[change.partIndex];
    const explicitTextEvent = this.createExplicitTextStreamEvent(currentTurn.turnId, item, previousPart);
    if (explicitTextEvent) {
      this._listener?.onHostStreamEvent(explicitTextEvent);
      return;
    }

    this.emitResponseItem(currentTurn.turnId, item);
  }

  private emitResponseItem(turnId: string, item: ReturnType<typeof createHostStreamResponseStartedItem>
    | ReturnType<typeof createHostStreamTurnRequestUpdateItem>
    | ReturnType<typeof createHostStreamTurnRoundsUpdateItem>
    | HostStreamResponseIdentityUpdateEvent
    | HostStreamResponseReferenceEvent
    | HostStreamResponseCodeCitationEvent
    | HostStreamResponseProgressMessageEvent
    | HostStreamResponseFollowupsEvent
    | ReturnType<typeof createHostStreamResponseStatusUpdateItem>
    | ReturnType<typeof createHostStreamUsageItem>
    | ReturnType<typeof createHostStreamClearToPreviousToolInvocationItem>
    | ReturnType<typeof createHostStreamResponsePartUpdateItem>): void {
    switch (item.itemType) {
      case 'response_started': {
        const responseItem = item as ReturnType<typeof createHostStreamResponseStartedItem>;
        this._listener?.onHostStreamEvent({
          type: 'response_started',
          turnId,
          createdAt: responseItem.createdAt,
        });
        return;
      }
      case 'turn_request_update': {
        const requestItem = item as ReturnType<typeof createHostStreamTurnRequestUpdateItem>;
        this._listener?.onHostStreamEvent({
          type: 'turn_request_update',
          turnId,
          value: requestItem.value,
        });
        return;
      }
      case 'turn_rounds_update': {
        const roundsItem = item as ReturnType<typeof createHostStreamTurnRoundsUpdateItem>;
        this._listener?.onHostStreamEvent({
          type: 'turn_rounds_update',
          turnId,
          value: roundsItem.value,
        });
        return;
      }
      case 'response_identity_update': {
        const identityItem = item as HostStreamResponseIdentityUpdateEvent;
        this._listener?.onHostStreamEvent({
          type: 'response_identity_update',
          turnId,
          value: identityItem.value,
          updatedAt: identityItem.updatedAt,
        });
        return;
      }
      case 'response_reference': {
        const referenceItem = item as HostStreamResponseReferenceEvent;
        this._listener?.onHostStreamEvent({
          type: 'reference',
          turnId,
          updatedAt: referenceItem.updatedAt,
          value: referenceItem.value,
        });
        return;
      }
      case 'response_code_citation': {
        const citationItem = item as HostStreamResponseCodeCitationEvent;
        this._listener?.onHostStreamEvent({
          type: 'codeCitation',
          turnId,
          updatedAt: citationItem.updatedAt,
          value: citationItem.value,
        });
        return;
      }
      case 'response_progress_message': {
        const progressItem = item as HostStreamResponseProgressMessageEvent;
        this._listener?.onHostStreamEvent({
          type: 'progress',
          turnId,
          updatedAt: progressItem.updatedAt,
          value: progressItem.value,
        });
        return;
      }
      case 'response_followups': {
        const followupsItem = item as HostStreamResponseFollowupsEvent;
        this._listener?.onHostStreamEvent({
          type: 'response_followups',
          turnId,
          updatedAt: followupsItem.updatedAt,
          value: followupsItem.value,
        });
        return;
      }
      case 'response_status_update': {
        const statusItem = item as ReturnType<typeof createHostStreamResponseStatusUpdateItem>;
        this._listener?.onHostStreamEvent({
          type: 'response_status_update',
          turnId,
          value: statusItem.value,
          updatedAt: statusItem.updatedAt,
        });
        return;
      }
      case 'usage': {
        const usageItem = item as ReturnType<typeof createHostStreamUsageItem>;
        this._listener?.onHostStreamEvent({
          type: 'usage',
          turnId,
          updatedAt: usageItem.updatedAt,
          value: usageItem.value,
        });
        return;
      }
      case 'clear_to_previous_tool_invocation': {
        const clearItem = item as ReturnType<typeof createHostStreamClearToPreviousToolInvocationItem>;
        this._listener?.onHostStreamEvent({
          type: 'clearToPreviousToolInvocation',
          turnId,
          updatedAt: clearItem.updatedAt,
          reason: clearItem.reason,
        });
        return;
      }
      case 'response_part_update': {
        const partItem = item as ReturnType<typeof createHostStreamResponsePartUpdateItem>;
        const partIndex = partItem.partIndex;
        if (partItem.part.type === 'confirmation') {
          this._listener?.onHostStreamEvent({
            type: 'confirmation',
            turnId,
            partIndex,
            updatedAt: partItem.updatedAt,
            part: partItem.part,
          });
          return;
        }

        if (partItem.part.type === 'question') {
          this._listener?.onHostStreamEvent({
            type: 'questionCarousel',
            turnId,
            partIndex,
            updatedAt: partItem.updatedAt,
            part: partItem.part,
          });
          return;
        }

        if (partItem.part.type === 'tool_call') {
          this._listener?.onHostStreamEvent({
            type: partItem.kind === 'add' ? 'beginToolInvocation' : 'updateToolInvocation',
            turnId,
            partIndex,
            updatedAt: partItem.updatedAt,
            part: partItem.part,
          });
          return;
        }

        if (partItem.part.type === 'warning') {
          this._listener?.onHostStreamEvent({
            type: 'warning',
            turnId,
            partIndex,
            updatedAt: partItem.updatedAt,
            message: partItem.part.message,
          });
          return;
        }

        if (partItem.part.type === 'info') {
          this._listener?.onHostStreamEvent({
            type: 'info',
            turnId,
            partIndex,
            updatedAt: partItem.updatedAt,
            message: partItem.part.message,
          });
          return;
        }

        if (partItem.part.type === 'state') {
          this._listener?.onHostStreamEvent({
            type: 'push',
            turnId,
            partIndex,
            updatedAt: partItem.updatedAt,
            kind: partItem.kind,
            part: partItem.part,
          });
          return;
        }

        this._listener?.onHostStreamEvent({
          type: 'push',
          turnId,
          partIndex,
          updatedAt: partItem.updatedAt,
          kind: partItem.kind,
          part: partItem.part,
        });
        return;
      }
    }
  }

  private buildResponseIdentityPatch(
    response: TurnResponseTurn['response'],
    previous?: TurnResponseTurn['response'],
  ): HostStreamResponseIdentityPatch | null {
    const patch: HostStreamResponseIdentityPatch = {};

    if (!previous || previous.participant !== response.participant) {
      patch.participant = response.participant;
    }

    if (!previous || !areTurnResponseCommandsEqual(previous.command, response.command)) {
      patch.command = response.command ?? null;
    }

    return Object.keys(patch).length > 0 ? patch : null;
  }

  private createExplicitTextStreamEvent(
    turnId: string,
    item: ReturnType<typeof createHostStreamResponsePartUpdateItem>,
    previousPart: TurnResponseTurn['response']['parts'][number] | undefined,
  ):
    | {
      type: 'markdown';
      turnId: string;
      partIndex: number;
      updatedAt: number;
      kind: 'add' | 'append';
      content: string;
    }
    | {
      type: 'thinkingProgress';
      turnId: string;
      partIndex: number;
      updatedAt: number;
      kind: 'add' | 'append' | 'update';
      content: string;
      isComplete: boolean;
    }
    | null {
    if (item.part.type === 'markdown') {
      const content = this.deriveExplicitTextDelta(item.kind, previousPart, item.part);
      if (content !== null) {
        const kind = item.kind === 'append' ? 'append' : 'add';
        return {
          type: 'markdown',
          turnId,
          partIndex: item.partIndex,
          updatedAt: item.updatedAt,
          kind,
          content,
        };
      }
    }

    if (item.part.type === 'thinking') {
      const thinkingEvent = this.deriveExplicitThinkingEvent(item, previousPart);
      if (thinkingEvent) {
        return {
          type: 'thinkingProgress',
          turnId,
          partIndex: item.partIndex,
          updatedAt: item.updatedAt,
          ...thinkingEvent,
        };
      }
    }

    return null;
  }

  private deriveExplicitTextDelta(
    kind: HostStreamPartChange['kind'],
    previousPart: TurnResponseTurn['response']['parts'][number] | undefined,
    currentPart: Extract<TurnResponseTurn['response']['parts'][number], { type: 'markdown' | 'thinking' }>,
  ): string | null {
    if (kind === 'add') {
      return currentPart.content.length > 0 ? currentPart.content : null;
    }

    if (kind !== 'append' || !previousPart || previousPart.type !== currentPart.type) {
      return null;
    }

    if (!currentPart.content.startsWith(previousPart.content)) {
      return null;
    }

    const appendedText = currentPart.content.slice(previousPart.content.length);
    return appendedText.length > 0 ? appendedText : null;
  }

  private deriveExplicitThinkingEvent(
    item: ReturnType<typeof createHostStreamResponsePartUpdateItem>,
    previousPart: TurnResponseTurn['response']['parts'][number] | undefined,
  ): { kind: 'add' | 'append' | 'update'; content: string; isComplete: boolean } | null {
    if (item.part.type !== 'thinking') {
      return null;
    }

    const content = this.deriveExplicitTextDelta(item.kind, previousPart, item.part);
    if (content !== null) {
      return {
        kind: item.kind === 'append' ? 'append' : 'add',
        content,
        isComplete: item.part.isComplete,
      };
    }

    if (
      item.kind === 'update'
      && previousPart?.type === 'thinking'
      && previousPart.content === item.part.content
      && previousPart.isComplete !== item.part.isComplete
    ) {
      return {
        kind: 'update',
        content: '',
        isComplete: item.part.isComplete,
      };
    }

    return null;
  }

  private buildHostTurnRequestPatch(
    nextRequest: TurnResponseTurn['request'],
    previousRequest?: TurnResponseTurn['request'],
  ): HostStreamTurnRequestPatch | null {
    const patch: HostStreamTurnRequestPatch = {};

    if (!previousRequest || previousRequest.content !== nextRequest.content) {
      patch.content = nextRequest.content;
    }

    if (!previousRequest || previousRequest.displayContent !== nextRequest.displayContent) {
      patch.displayContent = nextRequest.displayContent;
    }

    return Object.prototype.hasOwnProperty.call(patch, 'content')
      || Object.prototype.hasOwnProperty.call(patch, 'displayContent')
      ? patch
      : null;
  }

  private buildHostTurnRoundsPatch(
    nextRounds: TurnResponseTurn['rounds'],
    previousRounds?: TurnResponseTurn['rounds'],
  ): HostStreamTurnRoundsPatch | null {
    if (!previousRounds) {
      return nextRounds.length > 0
        ? {
          startIndex: 0,
          rounds: nextRounds,
        }
        : null;
    }

    let startIndex = 0;
    const maxSharedLength = Math.min(previousRounds.length, nextRounds.length);
    while (startIndex < maxSharedLength
      && this.areHostTurnRoundsEquivalent(previousRounds[startIndex], nextRounds[startIndex])) {
      startIndex += 1;
    }

    if (startIndex === previousRounds.length && startIndex === nextRounds.length) {
      return null;
    }

    return {
      startIndex,
      rounds: nextRounds.slice(startIndex),
    };
  }

  private areHostTurnRoundsEquivalent(left: TurnResponseTurn['rounds'][number], right: TurnResponseTurn['rounds'][number]): boolean {
    return left === right || JSON.stringify(left) === JSON.stringify(right);
  }

  private areHostTurnUsageEquivalent(
    left: TurnResponseTurn['usage'] | undefined,
    right: TurnResponseTurn['usage'] | undefined,
  ): boolean {
    return left === right || JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  private emitResponseProgressUpdates(
    turnId: string,
    nextResponse: TurnResponseTurn['response'],
    updatedAt: number,
    previousResponse?: TurnResponseTurn['response'],
  ): void {
    if (this.shouldEmitUsedContextUpdate(nextResponse, previousResponse)) {
      this.emitResponseItem(turnId, createHostStreamResponseUsedContextItem(nextResponse.usedContext ?? null, updatedAt));
    }

    this.emitResponseProgressListUpdates(
      turnId,
      nextResponse.contentReferences ?? [],
      previousResponse?.contentReferences ?? [],
      updatedAt,
      createHostStreamResponseContentReferenceItem,
    );

    this.emitResponseProgressListUpdates(
      turnId,
      nextResponse.codeCitations ?? [],
      previousResponse?.codeCitations ?? [],
      updatedAt,
      createHostStreamResponseCodeCitationItem,
    );

    this.emitResponseProgressListUpdates(
      turnId,
      nextResponse.progressMessages ?? [],
      previousResponse?.progressMessages ?? [],
      updatedAt,
      createHostStreamResponseProgressMessageItem,
    );
  }

  private shouldEmitUsedContextUpdate(
    nextResponse: TurnResponseTurn['response'],
    previousResponse?: TurnResponseTurn['response'],
  ): boolean {
    if (!previousResponse) {
      return nextResponse.usedContext != null;
    }

    return JSON.stringify(previousResponse.usedContext ?? null) !== JSON.stringify(nextResponse.usedContext ?? null);
  }

  private emitResponseProgressListUpdates<TItem>(
    turnId: string,
    nextItems: readonly TItem[],
    previousItems: readonly TItem[],
    updatedAt: number,
    createItem: (value: TItem, updatedAt: number) => HostStreamResponseReferenceEvent | HostStreamResponseCodeCitationEvent | HostStreamResponseProgressMessageEvent,
  ): void {
    if (nextItems.length === 0 && previousItems.length === 0) {
      return;
    }

    if (this.isMetadataListPrefix(previousItems, nextItems)) {
      for (const item of nextItems.slice(previousItems.length)) {
        this.emitResponseItem(turnId, createItem(item, updatedAt));
      }
      return;
    }
  }

  private isMetadataListPrefix<TItem>(
    previousItems: readonly TItem[],
    nextItems: readonly TItem[],
  ): boolean {
    if (previousItems.length > nextItems.length) {
      return false;
    }

    return previousItems.every((item, index) => JSON.stringify(item) === JSON.stringify(nextItems[index]));
  }
}