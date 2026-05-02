import type { TurnResponseStatus, TurnResponseTurn } from 'aily-lex/browser';
import { collectTurnResponseText } from 'aily-lex/browser';
import {
  buildDialogTurnContext,
  type DialogTurnContext,
} from './user-turn-action-target';
import {
  MAIN_AGENT_TYPE,
  normalizeAgentIdentifier,
} from './agent-identifiers';

export type TurnResponseHostMessageState = 'doing' | 'done';

export interface TurnResponseUserEntryProjection {
  readonly displayContent?: string;
  readonly requestContent?: string;
  readonly state: TurnResponseHostMessageState;
  readonly source?: string;
  readonly modelName?: string;
}

export interface TurnResponseAssistantEntryProjection {
  readonly content?: string;
  readonly state: TurnResponseHostMessageState;
  readonly source?: string;
  readonly modelName?: string;
}

export interface TurnResponseUserMessageProjection {
  readonly role: 'user';
  readonly content: string;
  readonly state: TurnResponseHostMessageState;
  readonly turnContext: DialogTurnContext;
  readonly source?: string;
  readonly modelName?: string;
}

export interface TurnResponseAssistantMessageProjection {
  readonly role: 'aily';
  readonly content: string;
  readonly state: TurnResponseHostMessageState;
  readonly turnContext: DialogTurnContext;
  readonly source?: string;
  readonly modelName?: string;
}

export interface TurnResponseStreamProjection {
  readonly turnId: string;
  readonly request: TurnResponseTurn['request'];
  readonly rounds: TurnResponseTurn['rounds'];
  readonly usage?: TurnResponseTurn['usage'];
  readonly participant?: string;
  readonly command?: TurnResponseTurn['response']['command'];
  readonly usedContext?: TurnResponseTurn['response']['usedContext'];
  readonly contentReferences?: TurnResponseTurn['response']['contentReferences'];
  readonly codeCitations?: TurnResponseTurn['response']['codeCitations'];
  readonly progressMessages?: TurnResponseTurn['response']['progressMessages'];
  readonly status: TurnResponseStatus;
  readonly terminationReason?: TurnResponseTurn['response']['terminationReason'];
  readonly parts: TurnResponseTurn['response']['parts'];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function toTurnResponseHostMessageState(
  status: TurnResponseStatus,
): TurnResponseHostMessageState {
  return status === 'streaming' ? 'doing' : 'done';
}

export function getTurnResponseParticipant(participant?: string): string {
  return normalizeAgentIdentifier(participant) || MAIN_AGENT_TYPE;
}

export function getTurnResponseDisplayContent(
  request: TurnResponseTurn['request'],
): string {
  if (typeof request.displayContent === 'string') {
    return request.displayContent;
  }

  return typeof request.content === 'string' ? request.content : '';
}

export function buildTurnResponseRequest(
  content: string,
  displayContent?: string,
  metadata?: TurnResponseTurn['request']['metadata'],
): TurnResponseTurn['request'] {
  return {
    content,
    ...(typeof displayContent === 'string' ? { displayContent } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function withTurnResponseDisplayContent(
  request: TurnResponseTurn['request'],
  displayContent?: string,
): TurnResponseTurn['request'] {
  if (typeof displayContent !== 'string') {
    return request;
  }

  return {
    ...request,
    displayContent,
  };
}

export function withTurnResponseUserEntryProjection(
  turn: TurnResponseTurn,
  overrides: Partial<TurnResponseUserEntryProjection> = {},
): TurnResponseTurn {
  const nextContent = typeof overrides.requestContent === 'string'
    ? overrides.requestContent
    : turn.request.content;
  const requestedDisplayContent = typeof overrides.displayContent === 'string'
    ? overrides.displayContent
    : turn.request.displayContent;
  const shouldKeepDisplayContent = typeof requestedDisplayContent === 'string'
    && (typeof turn.request.displayContent === 'string' || requestedDisplayContent !== nextContent);
  const nextDisplayContent = shouldKeepDisplayContent ? requestedDisplayContent : undefined;

  if (nextContent === turn.request.content && nextDisplayContent === turn.request.displayContent) {
    return turn;
  }

  if (typeof nextDisplayContent === 'string') {
    return {
      ...turn,
      request: {
        ...turn.request,
        content: nextContent,
        displayContent: nextDisplayContent,
      },
    };
  }

  const { displayContent: _displayContent, ...requestWithoutDisplayContent } = turn.request as TurnResponseTurn['request'] & { displayContent?: string };
  return {
    ...turn,
    request: {
      ...requestWithoutDisplayContent,
      content: nextContent,
    },
  };
}

export function buildTurnResponseUserEntryProjection(
  turn: TurnResponseTurn,
  overrides: Partial<TurnResponseUserEntryProjection> = {},
): TurnResponseUserEntryProjection {
  return {
    displayContent: overrides.displayContent ?? getTurnResponseDisplayContent(turn.request),
    requestContent: overrides.requestContent ?? turn.request.content,
    state: overrides.state ?? 'done',
    source: overrides.source,
    modelName: overrides.modelName,
  };
}

export function buildTurnResponseAssistantEntryProjection(
  turn: TurnResponseTurn,
  overrides: Partial<TurnResponseAssistantEntryProjection> = {},
): TurnResponseAssistantEntryProjection {
  return {
    content: overrides.content ?? '',
    state: overrides.state ?? toTurnResponseHostMessageState(turn.response.status),
    source: overrides.source ?? getTurnResponseParticipant(turn.response.participant),
    modelName: overrides.modelName,
  };
}

export function buildTurnResponseUserMessageProjection(
  turn: TurnResponseTurn,
  overrides: Partial<TurnResponseUserEntryProjection> = {},
): TurnResponseUserMessageProjection {
  const projection = buildTurnResponseUserEntryProjection(turn, overrides);
  const turnContext = buildDialogTurnContext({
    turnResponse: turn,
    requestContent: projection.requestContent,
    displayContent: projection.displayContent,
  });
  return {
    role: 'user',
    content: projection.displayContent ?? '',
    state: projection.state,
    turnContext: turnContext!,
    source: projection.source,
    modelName: projection.modelName,
  };
}

export function buildTurnResponseAssistantMessageProjection(
  turn: TurnResponseTurn,
  overrides: Partial<TurnResponseAssistantEntryProjection> = {},
): TurnResponseAssistantMessageProjection {
  const projection = buildTurnResponseAssistantEntryProjection(turn, overrides);
  const content = overrides.content === undefined
    && projection.content === ''
    && turn.response.parts.length === 0
    ? getTurnResponseResponseText(turn.response)
    : (projection.content ?? '');
  const turnContext = buildDialogTurnContext({ turnResponse: turn });
  return {
    role: 'aily',
    content,
    state: projection.state,
    turnContext: turnContext!,
    source: projection.source,
    modelName: projection.modelName,
  };
}

export function getTurnResponseAssistantText(
  turn: TurnResponseTurn,
): string {
  return getTurnResponseResponseText(turn.response);
}

export function getTurnResponseResponseText(
  response: Pick<TurnResponseTurn['response'], 'resultText' | 'parts'>,
): string {
  return response.resultText || collectTurnResponseText(response.parts) || '';
}

export function isCanonicalTurnResponseUserEntryProjection(
  turn: TurnResponseTurn,
  projection: Partial<TurnResponseUserEntryProjection>,
): boolean {
  const actual = buildTurnResponseUserEntryProjection(turn, projection);
  const canonical = buildTurnResponseUserEntryProjection(turn);
  return actual.displayContent === canonical.displayContent
    && actual.requestContent === canonical.requestContent
    && actual.state === canonical.state
    && actual.source === canonical.source
    && actual.modelName === canonical.modelName;
}

export function isCanonicalTurnResponseAssistantEntryProjection(
  turn: TurnResponseTurn,
  projection: Partial<TurnResponseAssistantEntryProjection>,
): boolean {
  const actual = buildTurnResponseAssistantEntryProjection(turn, projection);
  const canonical = buildTurnResponseAssistantEntryProjection(turn);
  return actual.content === canonical.content
    && actual.state === canonical.state
    && actual.source === canonical.source;
}

export function buildTurnResponseTurn(
  projection: TurnResponseStreamProjection,
): TurnResponseTurn {
  const participant = getTurnResponseParticipant(projection.participant);
  const contentReferences = projection.contentReferences ? [...projection.contentReferences] : [];
  const codeCitations = projection.codeCitations ? [...projection.codeCitations] : [];
  const progressMessages = projection.progressMessages ? [...projection.progressMessages] : [];

  return {
    turnId: projection.turnId,
    request: projection.request,
    rounds: projection.rounds,
    usage: projection.usage,
    response: {
      id: projection.turnId,
      participant,
      command: projection.command,
      usedContext: projection.usedContext,
      contentReferences,
      codeCitations,
      progressMessages,
      status: projection.status,
      terminationReason: projection.terminationReason,
      parts: projection.parts,
      resultText: collectTurnResponseText(projection.parts),
      createdAt: projection.createdAt,
      updatedAt: projection.updatedAt,
    },
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
  };
}