import type { TurnResponseTurn } from 'aily-lex/browser';

import type { ChatMessage } from '../core/chat-types';
import {
  buildDialogTurnContext,
  type DialogTurnContext,
} from '../core/user-turn-action-target';
import {
  buildTurnResponseAssistantMessageProjection,
  getTurnResponseAssistantText,
  getTurnResponseParticipant,
} from '../core/turn-response-stream-contract';

export interface ChatDialogViewItem {
  readonly trackId: string;
  readonly role: string;
  readonly content: string;
  readonly doing: boolean;
  readonly turnModelName: string;
  readonly turnContext: DialogTurnContext | null;
  readonly responseVote?: 0 | 1;
  readonly isLastAily: boolean;
  readonly isFirstUserTurn: boolean;
  readonly showCheckpointRestore: boolean;
}

export interface ChatDialogViewMessageProjection {
  readonly role: string;
  readonly content: string;
  readonly state: 'doing' | 'done';
  readonly turnContext?: DialogTurnContext | null;
  readonly source?: string;
  readonly modelName?: string;
  readonly responseVote?: 0 | 1;
}

interface InternalChatDialogViewItem extends ChatDialogViewItem {
  readonly source: string;
  readonly resolvedTurnId?: string;
}

export function buildChatDialogViewItems(
  chatList: readonly ChatMessage[],
  turnResponses: readonly TurnResponseTurn[],
  options: { disabledRequestTurnIds?: readonly string[] } = {},
): ChatDialogViewItem[] {
  return buildChatDialogViewItemsFromMessageProjections(
    chatList.map(toDialogMessageProjection),
    turnResponses,
    options,
  );
}

function toDialogMessageProjection(
  message: ChatMessage,
): ChatDialogViewMessageProjection {
  const turnContext = message.turnId
    ? buildDialogTurnContext({ turnId: message.turnId })
    : null;

  return {
    role: message.role,
    content: message.content,
    state: message.state,
    turnContext,
    source: message.source,
    modelName: message.modelName,
  };
}

export function buildChatDialogViewItemsFromMessageProjections(
  messages: readonly ChatDialogViewMessageProjection[],
  turnResponses: readonly TurnResponseTurn[],
  options: { disabledRequestTurnIds?: readonly string[] } = {},
): ChatDialogViewItem[] {
  const remainingTurns = [...turnResponses];
  const disabledRequestTurnIds = new Set(options.disabledRequestTurnIds ?? []);

  return finalizeDialogItems(messages.map((message, msgIndex) => {
    const projectionTurnId = getProjectionTurnId(message);
    const turnResponse = message.role === 'aily'
      ? takeTurnResponseForMessage(remainingTurns, projectionTurnId)
      : null;

    return createDialogViewItem(message, msgIndex, turnResponse, disabledRequestTurnIds);
  }), turnResponses, disabledRequestTurnIds);
}

function getProjectionTurnId(
  message: ChatDialogViewMessageProjection,
): string | undefined {
  return message.turnContext?.turnId;
}

function takeTurnResponseForMessage(
  remainingTurns: TurnResponseTurn[],
  turnId?: string,
): TurnResponseTurn | null {
  if (remainingTurns.length === 0) {
    return null;
  }

  if (turnId) {
    const matchedIndex = remainingTurns.findIndex(turn => turn.turnId === turnId);
    if (matchedIndex >= 0) {
      return remainingTurns.splice(matchedIndex, 1)[0];
    }
  }

  return remainingTurns.shift() ?? null;
}

function createDialogViewItem(
  message: ChatDialogViewMessageProjection,
  index: number,
  turnResponse: TurnResponseTurn | null,
  disabledRequestTurnIds: ReadonlySet<string>,
): InternalChatDialogViewItem {
  const turnId = getProjectionTurnId(message) ?? turnResponse?.turnId;
  const requestDisabled = turnId ? disabledRequestTurnIds.has(turnId) : false;
  const normalizedSource = getTurnResponseParticipant(message.source);
  const trackBase = turnId ?? `${message.role}-${normalizedSource}`;
  const assistantProjection = message.role === 'aily' && turnResponse
    ? buildTurnResponseAssistantMessageProjection(turnResponse, {
      ...(message.content ? { content: message.content } : {}),
      ...(message.source ? { source: message.source } : {}),
      ...(message.modelName ? { modelName: message.modelName } : {}),
    })
    : null;
  const effectiveState = assistantProjection?.state ?? message.state;
  const resolvedContent = message.role === 'aily' && turnResponse
    ? (assistantProjection?.content || getTurnResponseAssistantText(turnResponse))
    : message.content;
  const turnContext = buildDialogTurnContext({
    turnId,
    turnResponse: message.turnContext?.turnResponse ?? turnResponse,
    request: message.turnContext?.request ?? undefined,
    response: message.turnContext?.response ?? undefined,
    rounds: message.turnContext?.rounds,
    requestDisabled: message.turnContext?.requestDisabled === true || requestDisabled,
    requestContent: message.turnContext?.requestContent,
    displayContent: message.role === 'user'
      ? (message.turnContext?.displayContent ?? message.content)
      : message.turnContext?.displayContent,
  });

  return {
    trackId: `${trackBase}-${index}`,
    role: message.role,
    content: resolvedContent,
    doing: effectiveState === 'doing',
    source: assistantProjection?.source ?? normalizedSource,
    turnModelName: message.role === 'aily'
      ? (assistantProjection?.modelName || message.modelName || '')
      : '',
    resolvedTurnId: turnId,
    turnContext,
    responseVote: message.responseVote,
    isLastAily: false,
    isFirstUserTurn: false,
    showCheckpointRestore: false,
  } satisfies InternalChatDialogViewItem;
}

function finalizeDialogItems(
  items: InternalChatDialogViewItem[],
  turnResponses: readonly TurnResponseTurn[],
  disabledRequestTurnIds: ReadonlySet<string>,
): ChatDialogViewItem[] {
  return toPublicDialogItems(
    markRestoreCheckpointItem(
      markFirstUserTurnItem(
        markLastAilyItem(
          attachAssociatedTurns(items, turnResponses, disabledRequestTurnIds),
        ),
      ),
      disabledRequestTurnIds,
    ),
  );
}

function toPublicDialogItems(
  items: readonly InternalChatDialogViewItem[],
): ChatDialogViewItem[] {
  return items.map((item) => {
    const { source: _source, resolvedTurnId: _resolvedTurnId, ...publicItem } = item;
    return publicItem;
  });
}


function attachAssociatedTurns(
  items: InternalChatDialogViewItem[],
  turnResponses: readonly TurnResponseTurn[],
  disabledRequestTurnIds: ReadonlySet<string>,
): InternalChatDialogViewItem[] {
  const turnsById = new Map(turnResponses.map(turn => [turn.turnId, turn]));

  return items.map((item, index) => {
    const nextAssociatedTurnId = item.role === 'user'
      ? (item.turnContext?.turnId ?? item.turnContext?.turnResponse?.turnId ?? item.resolvedTurnId ?? findAssociatedTurnId(items, index))
      : undefined;
    const directTurnId = item.turnContext?.turnId ?? item.resolvedTurnId;
    const directTurn = directTurnId ? turnsById.get(directTurnId) ?? null : null;
    const actionTurn = nextAssociatedTurnId
      ? (turnsById.get(nextAssociatedTurnId) ?? directTurn ?? null)
      : null;
    const linkedTurn = item.turnContext?.turnResponse ?? directTurn ?? actionTurn;
    const nextTurnId = item.turnContext?.turnId ?? item.resolvedTurnId ?? linkedTurn?.turnId ?? actionTurn?.turnId;
    const requestDisabled = nextTurnId ? disabledRequestTurnIds.has(nextTurnId) : false;
    const nextTurnContext = buildDialogTurnContext({
      turnId: nextTurnId ?? nextAssociatedTurnId,
      turnResponse: linkedTurn ?? actionTurn ?? null,
      requestDisabled: item.turnContext?.requestDisabled === true || requestDisabled,
      requestContent: item.turnContext?.requestContent,
      displayContent: item.role === 'user' ? item.content : undefined,
    });
    const nextTrackBase = nextTurnId ?? `${item.role}-${getTurnResponseParticipant(item.source)}`;
    const nextTrackId = `${nextTrackBase}-${index}`;

    if (
      linkedTurn === item.turnContext?.turnResponse
      && nextTurnId === item.resolvedTurnId
      && nextTrackId === item.trackId
      && sameDialogTurnContext(item.turnContext, nextTurnContext)
    ) {
      return item;
    }

    return {
      ...item,
      trackId: nextTrackId,
      resolvedTurnId: nextTurnId,
      turnContext: nextTurnContext,
    } satisfies InternalChatDialogViewItem;
  });
}

function sameDialogTurnContext(
  left: DialogTurnContext | null,
  right: DialogTurnContext | null,
): boolean {
  return left?.turnId === right?.turnId
    && (left?.requestDisabled === true) === (right?.requestDisabled === true)
    && left?.requestContent === right?.requestContent
    && left?.displayContent === right?.displayContent
    && left?.roundCount === right?.roundCount
    && left?.toolCallCount === right?.toolCallCount
    && left?.lastRoundId === right?.lastRoundId
    && left?.request === right?.request
    && left?.response === right?.response
    && left?.rounds === right?.rounds
    && left?.turnResponse === right?.turnResponse;
}

function findAssociatedTurnId(
  items: readonly InternalChatDialogViewItem[],
  index: number,
): string | undefined {
  const item = items[index];
  if (item.resolvedTurnId) {
    return item.resolvedTurnId;
  }

  if (item.role !== 'user') {
    return undefined;
  }

  for (let cursor = index + 1; cursor < items.length; cursor++) {
    const candidate = items[cursor];
    if (candidate.role === 'user') {
      break;
    }
    if (candidate.resolvedTurnId) {
      return candidate.resolvedTurnId;
    }
  }

  return undefined;
}

function markLastAilyItem(items: InternalChatDialogViewItem[]): InternalChatDialogViewItem[] {
  const lastAilyIndex = findLastActionableAilyItemIndex(items);

  return items.map((item, index) => {
    const isLastAily = index === lastAilyIndex;
    if (item.isLastAily === isLastAily) {
      return item;
    }

    return {
      ...item,
      isLastAily,
    } satisfies InternalChatDialogViewItem;
  });
}

function markFirstUserTurnItem(items: InternalChatDialogViewItem[]): InternalChatDialogViewItem[] {
  const firstUserIndex = items.findIndex(item => item.role === 'user' && !!item.turnContext?.turnId);

  return items.map((item, index) => {
    const isFirstUserTurn = index === firstUserIndex;
    if (item.isFirstUserTurn === isFirstUserTurn) {
      return item;
    }

    return {
      ...item,
      isFirstUserTurn,
    } satisfies InternalChatDialogViewItem;
  });
}

function markRestoreCheckpointItem(
  items: InternalChatDialogViewItem[],
  disabledRequestTurnIds: ReadonlySet<string>,
): InternalChatDialogViewItem[] {
  const shouldShowRestore = disabledRequestTurnIds.size > 0;
  const lastItemIndex = items.length - 1;

  return items.map((item, index) => {
    const showCheckpointRestore = shouldShowRestore && index === lastItemIndex;
    if (item.showCheckpointRestore === showCheckpointRestore) {
      return item;
    }

    return {
      ...item,
      showCheckpointRestore,
    } satisfies InternalChatDialogViewItem;
  });
}

function findLastActionableAilyItemIndex(items: readonly InternalChatDialogViewItem[]): number {
  const preferTurnBackedAily = items.some(item => item.role === 'aily' && !!item.turnContext?.turnResponse);

  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.role !== 'aily') {
      continue;
    }

    if (!preferTurnBackedAily || item.turnContext?.turnResponse) {
      return index;
    }
  }

  return -1;
}
