import type { ITurnDataSource, TurnSpan } from './turn-data-source';

export interface TurnSummaryPlan {
  coveredTurnIds: string[];
  anchorTurnId: string;
  anchorRoundId?: string;
  toSummarizeMessages: any[];
  historyRevision: number;
}

export interface TurnSummaryPlanOptions {
  minPreserveMessages?: number;
}

export function buildTurnSummaryPlan(
  messages: any[],
  turnDataSource: ITurnDataSource,
  options?: TurnSummaryPlanOptions,
): TurnSummaryPlan | null {
  const { turnSpans } = turnDataSource.buildMessagesWithSpans();
  if (turnSpans.length <= 1) {
    return null;
  }

  const preserveStartSpanIndex = findTurnSummaryPreserveStartSpanIndex(
    turnSpans,
    options?.minPreserveMessages,
  );
  if (preserveStartSpanIndex <= 0) {
    return null;
  }

  const anchorSpan = turnSpans[preserveStartSpanIndex - 1];
  if (!anchorSpan) {
    return null;
  }

  const coveredTurnIds = turnDataSource.getCoveredTurnIds(anchorSpan.turnIndex);
  const toSummarizeMessages = messages.slice(0, anchorSpan.endIdx);
  if (!coveredTurnIds.length || !toSummarizeMessages.length) {
    return null;
  }

  return {
    coveredTurnIds,
    anchorTurnId: anchorSpan.turnId,
    anchorRoundId: turnDataSource.getAnchorRoundId(anchorSpan.turnIndex),
    toSummarizeMessages,
    historyRevision: turnDataSource.revision,
  };
}

export function findTurnSummaryPreserveStartSpanIndex(
  spans: readonly TurnSpan[],
  minPreserveMessages = 6,
): number {
  let preservedMessages = 0;
  let preserveStart = spans.length;

  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index];
    preservedMessages += span.endIdx - span.startIdx;
    preserveStart = index;

    if (preservedMessages >= minPreserveMessages) {
      break;
    }

    if (preservedMessages > Math.ceil(spans.length / 2)) {
      break;
    }
  }

  return preserveStart;
}