import type { IAgentLifecycle } from '../core/chat-context';
import type { SessionSnapshot, TurnResponseStatus, TurnResponseTurn } from 'aily-lex/browser';
import { toTurnResponseStatus } from 'aily-lex/browser';

import { TurnResponseIncrementalBuilder } from '../core/turn-response-stream-builder';
import { getTurnResponseParticipant } from '../core/turn-response-stream-contract';

type LexRenderTurnMaterializerContext = Pick<IAgentLifecycle, 'isCancelled' | 'currentMessageSource'>;

export class LexRenderTurnMaterializer {
  constructor(
    private readonly ctx: LexRenderTurnMaterializerContext,
    private readonly getSessionSnapshot?: () => SessionSnapshot | null,
  ) {}

  materializeCurrentTurn(
    streamBuilder: TurnResponseIncrementalBuilder,
    currentTurn: TurnResponseTurn,
    options: {
      updatedAt: number;
      fallbackStatus: TurnResponseStatus;
      hasExecutionError: boolean;
      usage?: TurnResponseTurn['usage'];
      continuation?: TurnResponseTurn['response']['continuation'];
      terminationReason?: TurnResponseTurn['response']['terminationReason'];
    },
  ): TurnResponseTurn | null {
    const snapshotTurnId = streamBuilder.currentSourceTurnId ?? currentTurn.turnId;
    const snapshotTurn = this.getSessionSnapshot?.()?.turns.find(turn => turn.id === snapshotTurnId);
    const status = this.resolveTurnStatus(
      snapshotTurn ? toTurnResponseStatus(snapshotTurn.status) : undefined,
      options.fallbackStatus,
      options.hasExecutionError,
    );

    return streamBuilder.materialize({
      updatedAt: options.updatedAt,
      status,
      usage: options.usage,
      continuation: options.continuation,
      terminationReason: options.terminationReason,
      participant: getTurnResponseParticipant(
        this.ctx.currentMessageSource || currentTurn.response.participant,
      ),
      snapshot: snapshotTurn
        ? {
          request: snapshotTurn.request,
          rounds: snapshotTurn.rounds ?? [],
          usage: snapshotTurn.usage,
          createdAt: snapshotTurn.createdAt,
          terminationReason: snapshotTurn.terminationReason,
          modelName: snapshotTurn.responseModel?.modelName,
          modelBillingLabel: snapshotTurn.responseModel?.modelBillingLabel,
          quotaSnapshot: snapshotTurn.responseModel?.quotaSnapshot,
        }
        : undefined,
    });
  }

  private resolveTurnStatus(
    snapshotStatus: TurnResponseStatus | undefined,
    fallbackStatus: TurnResponseStatus,
    hasExecutionError: boolean,
  ): TurnResponseStatus {
    if (snapshotStatus) {
      return snapshotStatus;
    }

    if (this.ctx.isCancelled) {
      return 'cancelled';
    }

    if (hasExecutionError) {
      return 'error';
    }

    return fallbackStatus;
  }
}