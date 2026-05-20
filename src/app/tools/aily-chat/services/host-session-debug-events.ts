import {
  readTurnRequestDebugArtifactContent,
  readTurnRequestDebugSectionsSnapshot,
  type TurnRequest,
  type TurnResponsePart,
} from 'aily-lex/browser';

import type { HostSessionRecord } from './chat-history.service';

export type HostSessionDebugEventKind =
  | 'toolCall'
  | 'modelTurn'
  | 'generic'
  | 'subagentInvocation'
  | 'userMessage'
  | 'agentResponse';

export type HostSessionDebugLogLevel = 'trace' | 'info' | 'warning' | 'error';

export interface HostSessionDebugMessageSection {
  readonly name: string;
  readonly content: string;
}

export type HostSessionDebugCacheMessageRole = 'user' | 'system' | 'tools';

export interface HostSessionDebugCacheInputMessage {
  readonly role: HostSessionDebugCacheMessageRole;
  readonly rawRole?: string;
  readonly label: string;
  readonly content: string;
  readonly charLength: number;
}

export interface HostSessionDebugRequestShapeInfo {
  readonly label: string;
  readonly description?: string;
  readonly isContinuation: boolean;
  readonly hasPreviousResponseId?: boolean;
  readonly inputItemTypes: readonly string[];
}

export interface HostSessionDebugCacheExplorerContent {
  readonly system?: string;
  readonly tools?: string;
  readonly inputMessages: readonly HostSessionDebugCacheInputMessage[];
  readonly requestShape: HostSessionDebugRequestShapeInfo;
}

export interface HostSessionDebugEventCommon {
  readonly id: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly turnId: string;
  readonly kind: HostSessionDebugEventKind;
  readonly created: number;
  readonly parentEventId?: string;
}

export interface HostSessionDebugToolCallEvent extends HostSessionDebugEventCommon {
  readonly kind: 'toolCall';
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly input?: string;
  readonly output?: string;
  readonly result?: 'success' | 'error';
  readonly durationInMillis?: number;
}

export interface HostSessionDebugModelTurnEvent extends HostSessionDebugEventCommon {
  readonly kind: 'modelTurn';
  readonly model?: string;
  readonly requestName?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly totalTokens?: number;
  readonly durationInMillis?: number;
  readonly status?: string;
  readonly systemPromptFile?: string;
  readonly toolsFile?: string;
}

export interface HostSessionDebugGenericEvent extends HostSessionDebugEventCommon {
  readonly kind: 'generic';
  readonly name: string;
  readonly details?: string;
  readonly level: HostSessionDebugLogLevel;
  readonly category?: string;
}

export interface HostSessionDebugSubagentInvocationEvent extends HostSessionDebugEventCommon {
  readonly kind: 'subagentInvocation';
  readonly agentName: string;
  readonly description?: string;
  readonly status?: 'running' | 'completed' | 'failed';
  readonly durationInMillis?: number;
  readonly toolCallCount?: number;
  readonly modelTurnCount?: number;
}

export interface HostSessionDebugUserMessageEvent extends HostSessionDebugEventCommon {
  readonly kind: 'userMessage';
  readonly message: string;
  readonly sections: readonly HostSessionDebugMessageSection[];
}

export interface HostSessionDebugAgentResponseEvent extends HostSessionDebugEventCommon {
  readonly kind: 'agentResponse';
  readonly message: string;
  readonly sections: readonly HostSessionDebugMessageSection[];
}

export type HostSessionDebugEvent =
  | HostSessionDebugToolCallEvent
  | HostSessionDebugModelTurnEvent
  | HostSessionDebugGenericEvent
  | HostSessionDebugSubagentInvocationEvent
  | HostSessionDebugUserMessageEvent
  | HostSessionDebugAgentResponseEvent;

export interface HostSessionDebugEventSummary {
  readonly totalEvents: number;
  readonly errorCount: number;
  readonly userMessageCount: number;
  readonly agentResponseCount: number;
  readonly modelTurnCount: number;
  readonly toolCallCount: number;
  readonly genericCount: number;
  readonly subagentInvocationCount: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCachedTokens: number;
}

export interface HostSessionDebugResolvedMessageContent {
  readonly kind: 'message';
  readonly type: 'user' | 'agent';
  readonly message: string;
  readonly sections: readonly HostSessionDebugMessageSection[];
}

export interface HostSessionDebugResolvedToolCallContent {
  readonly kind: 'toolCall';
  readonly toolName: string;
  readonly result?: 'success' | 'error';
  readonly durationInMillis?: number;
  readonly input?: string;
  readonly output?: string;
}

export interface HostSessionDebugResolvedModelTurnContent {
  readonly kind: 'modelTurn';
  readonly requestName: string;
  readonly model?: string;
  readonly status?: string;
  readonly durationInMillis?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly totalTokens?: number;
  readonly sections?: readonly HostSessionDebugMessageSection[];
}

export interface HostSessionDebugResolvedTextContent {
  readonly kind: 'text';
  readonly text: string;
}

export type HostSessionDebugResolvedEventContent =
  | HostSessionDebugResolvedMessageContent
  | HostSessionDebugResolvedToolCallContent
  | HostSessionDebugResolvedModelTurnContent
  | HostSessionDebugResolvedTextContent;

interface HostSessionDebugArtifacts {
  readonly events: HostSessionDebugEvent[];
  readonly resolvedContentById: ReadonlyMap<string, HostSessionDebugResolvedEventContent>;
}

interface HostSessionDebugStructuredMessagePart {
  readonly type?: string;
  readonly content?: string;
  readonly name?: string;
  readonly arguments?: unknown;
}

type HostSessionDebugPersistedTurn = NonNullable<HostSessionRecord['turnResponses']>[number];

type HostSessionDebugEventSeed =
  | Omit<HostSessionDebugToolCallEvent, 'id'>
  | Omit<HostSessionDebugModelTurnEvent, 'id'>
  | Omit<HostSessionDebugGenericEvent, 'id'>
  | Omit<HostSessionDebugSubagentInvocationEvent, 'id'>
  | Omit<HostSessionDebugUserMessageEvent, 'id'>
  | Omit<HostSessionDebugAgentResponseEvent, 'id'>;

export function buildHostSessionDebugEvents(
  record: Pick<HostSessionRecord, 'metadata' | 'turnResponses'>,
): HostSessionDebugEvent[] {
  return buildHostSessionDebugArtifacts(record).events;
}

export function resolveHostSessionDebugEventContent(
  record: Pick<HostSessionRecord, 'metadata' | 'turnResponses'>,
  eventId: string,
  options?: {
    readonly events?: readonly HostSessionDebugEvent[];
    readonly readCompanionFile?: (fileName: string) => string | undefined;
    readonly readRequestArtifactContent?: (kind: 'system' | 'tools', turnId: string) => string | undefined;
  },
): HostSessionDebugResolvedEventContent | undefined {
  const content = buildHostSessionDebugArtifacts(record).resolvedContentById.get(eventId);
  if (!content || content.kind !== 'modelTurn') {
    return content;
  }

  const modelTurnEvent = options.events?.find(
    (event): event is HostSessionDebugModelTurnEvent => event.id === eventId && event.kind === 'modelTurn',
  );
  if (!modelTurnEvent) {
    return content;
  }

  const systemFromCompanion = modelTurnEvent.systemPromptFile && options.readCompanionFile
    ? options.readCompanionFile(modelTurnEvent.systemPromptFile)
    : undefined;
  const toolsFromCompanion = modelTurnEvent.toolsFile && options.readCompanionFile
    ? options.readCompanionFile(modelTurnEvent.toolsFile)
    : undefined;
  const systemFromRequestArtifact = options.readRequestArtifactContent?.('system', modelTurnEvent.turnId);
  const toolsFromRequestArtifact = options.readRequestArtifactContent?.('tools', modelTurnEvent.turnId);
  const systemContent = systemFromCompanion ?? systemFromRequestArtifact;
  const toolsContent = toolsFromCompanion ?? toolsFromRequestArtifact;
  if (!systemContent && !toolsContent) {
    return content;
  }

  return {
    ...content,
    sections: mergeModelTurnSections(content.sections ?? [], systemContent, toolsContent),
  };
}

export function createHostSessionDebugEventId(
  sessionId: string,
  turnId: string,
  kind: HostSessionDebugEventKind,
  sequence: number,
): string {
  return `${sessionId}:${turnId}:${kind}:${sequence}`;
}

export function buildHostSessionDebugEventSummary(
  events: readonly HostSessionDebugEvent[],
): HostSessionDebugEventSummary {
  const summary = {
    totalEvents: events.length,
    errorCount: 0,
    userMessageCount: 0,
    agentResponseCount: 0,
    modelTurnCount: 0,
    toolCallCount: 0,
    genericCount: 0,
    subagentInvocationCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCachedTokens: 0,
  };

  for (const event of events) {
    if (isHostSessionDebugErrorEvent(event)) {
      summary.errorCount += 1;
    }

    switch (event.kind) {
      case 'userMessage':
        summary.userMessageCount += 1;
        break;
      case 'agentResponse':
        summary.agentResponseCount += 1;
        break;
      case 'modelTurn':
        summary.modelTurnCount += 1;
        summary.totalInputTokens += event.inputTokens ?? 0;
        summary.totalOutputTokens += event.outputTokens ?? 0;
        summary.totalCachedTokens += event.cachedTokens ?? 0;
        break;
      case 'toolCall':
        summary.toolCallCount += 1;
        break;
      case 'generic':
        summary.genericCount += 1;
        break;
      case 'subagentInvocation':
        summary.subagentInvocationCount += 1;
        break;
    }
  }

  return summary;
}

export function getHostSessionDebugEventTitle(event: HostSessionDebugEvent): string {
  switch (event.kind) {
    case 'toolCall':
      return `Tool call: ${event.toolName}`;
    case 'modelTurn':
      return event.model ? `Model turn: ${event.model}` : 'Model turn';
    case 'generic':
      return event.category ? `${event.category}: ${event.name}` : event.name;
    case 'subagentInvocation':
      return `Subagent: ${event.agentName}`;
    case 'userMessage':
      return 'User message';
    case 'agentResponse':
      return 'Agent response';
  }
}

export function getHostSessionDebugEventDetails(event: HostSessionDebugEvent): string | undefined {
  switch (event.kind) {
    case 'toolCall':
      return [event.input, event.output].filter(Boolean).join(' · ') || undefined;
    case 'modelTurn':
      return [
        event.requestName,
        typeof event.totalTokens === 'number' ? `${event.totalTokens} tokens` : '',
        typeof event.durationInMillis === 'number' ? `${event.durationInMillis}ms` : '',
      ].filter(Boolean).join(' · ') || undefined;
    case 'generic':
      return event.details;
    case 'subagentInvocation':
      return [event.description, event.status].filter(Boolean).join(' · ') || undefined;
    case 'userMessage':
    case 'agentResponse':
      return previewText(event.message, 180);
  }
}

export function isHostSessionDebugErrorEvent(event: HostSessionDebugEvent): boolean {
  return (event.kind === 'toolCall' && event.result === 'error')
    || (event.kind === 'modelTurn' && event.status === 'error')
    || (event.kind === 'generic' && event.level === 'error')
    || (event.kind === 'subagentInvocation' && event.status === 'failed');
}

function buildHostSessionDebugArtifacts(
  record: Pick<HostSessionRecord, 'metadata' | 'turnResponses'>,
): HostSessionDebugArtifacts {
  const sessionId = typeof record.metadata?.sessionId === 'string' ? record.metadata.sessionId : '';
  const events: HostSessionDebugEvent[] = [];
  const resolvedContentById = new Map<string, HostSessionDebugResolvedEventContent>();
  let sequence = 0;

  for (const turn of record.turnResponses ?? []) {
    const userMessageSections = buildMessageSections('request', turn.request.displayContent ?? turn.request.content);
    const requestContent = extractRequestContent(turn.request);
    let userMessageEventId: string | undefined;
    if (requestContent) {
      const event = createDebugEvent({
        sessionId,
        turnId: turn.turnId,
        sequence: sequence++,
        kind: 'userMessage',
        created: normalizeTimestamp(turn.createdAt, turn.updatedAt),
        message: requestContent,
        sections: userMessageSections,
      });
      userMessageEventId = event.id;
      events.push(event);
      resolvedContentById.set(event.id, {
        kind: 'message',
        type: 'user',
        message: requestContent,
        sections: userMessageSections,
      });
    }

    const modelTurnCreated = normalizeTimestamp(
      turn.response.timestamp,
      turn.response.updatedAt,
      turn.response.createdAt,
      turn.updatedAt,
    );
    const modelTurnDuration = typeof turn.response.elapsedMs === 'number'
      ? turn.response.elapsedMs
      : deriveDuration(turn.response.createdAt, turn.response.updatedAt);
    const modelTurnTotalTokens = sumNumbers(turn.usage?.inputTokens, turn.usage?.outputTokens);
    const modelTurnEvent = createDebugEvent({
      sessionId,
      turnId: turn.turnId,
      sequence: sequence++,
      kind: 'modelTurn',
      created: modelTurnCreated,
      parentEventId: userMessageEventId,
      model: record.metadata?.model ?? undefined,
      requestName: previewText(requestContent, 60),
      inputTokens: turn.usage?.inputTokens,
      outputTokens: turn.usage?.outputTokens,
      cachedTokens: turn.usage?.cacheReadTokens,
      totalTokens: modelTurnTotalTokens,
      durationInMillis: modelTurnDuration,
      status: turn.response.status,
    });
    events.push(modelTurnEvent);

    for (const round of turn.rounds ?? []) {
      for (const toolCall of round.toolCalls ?? []) {
        const input = safeJsonSummary(toolCall.input) || undefined;
        const output = safeUnknownSummary(toolCall.output) || toolCall.error?.trim() || undefined;
        const event = createDebugEvent({
          sessionId,
          turnId: turn.turnId,
          sequence: sequence++,
          kind: 'toolCall',
          created: normalizeTimestamp(round.timestamp, modelTurnCreated, turn.updatedAt),
          parentEventId: modelTurnEvent.id,
          toolName: toolCall.toolName || toolCall.id,
          toolCallId: toolCall.id,
          input,
          output,
          result: toolCall.error ? 'error' : 'success',
          durationInMillis: toolCall.durationMs,
        });
        events.push(event);
        resolvedContentById.set(event.id, {
          kind: 'toolCall',
          toolName: event.toolName,
          result: event.result,
          durationInMillis: event.durationInMillis,
          input: event.input,
          output: event.output,
        });
      }
    }

    const requestSections = buildModelTurnRequestSections(turn.request);
    const responseSections = buildResponseSections(turn.response.parts, turn.response.resultText);
    const modelTurnSections = [...requestSections, ...responseSections];
    for (const progressMessage of turn.response.progressMessages ?? []) {
      events.push(createDebugEvent({
        sessionId,
        turnId: turn.turnId,
        sequence: sequence++,
        kind: 'generic',
        created: modelTurnCreated,
        parentEventId: modelTurnEvent.id,
        name: 'Progress',
        details: progressMessage.content,
        level: 'info',
        category: 'progress',
      }));
    }

    for (const part of turn.response.parts ?? []) {
      const projected = projectPartEvent(part, {
        sessionId,
        turnId: turn.turnId,
        modelTurnEventId: modelTurnEvent.id,
        created: modelTurnCreated,
        sequence: sequence++,
        toolCallParentId: findToolCallParentEventId(events, modelTurnEvent.id, part),
      });
      if (!projected) {
        continue;
      }

      events.push(projected.event);
      if (projected.content) {
        resolvedContentById.set(projected.event.id, projected.content);
      }
    }

    resolvedContentById.set(modelTurnEvent.id, {
      kind: 'modelTurn',
      requestName: modelTurnEvent.requestName || 'Model turn',
      model: modelTurnEvent.model,
      status: modelTurnEvent.status,
      durationInMillis: modelTurnEvent.durationInMillis,
      inputTokens: modelTurnEvent.inputTokens,
      outputTokens: modelTurnEvent.outputTokens,
      cachedTokens: modelTurnEvent.cachedTokens,
      totalTokens: modelTurnEvent.totalTokens,
      sections: modelTurnSections,
    });

    const agentResponseEvent = createDebugEvent({
      sessionId,
      turnId: turn.turnId,
      sequence: sequence++,
      kind: 'agentResponse',
      created: modelTurnCreated,
      parentEventId: modelTurnEvent.id,
      message: turn.response.resultText,
      sections: responseSections,
    });
    events.push(agentResponseEvent);
    resolvedContentById.set(agentResponseEvent.id, {
      kind: 'message',
      type: 'agent',
      message: agentResponseEvent.message,
      sections: responseSections,
    });
  }

  return { events, resolvedContentById };
}

function createDebugEvent<TEvent extends HostSessionDebugEventSeed>(
  event: TEvent,
): TEvent & Pick<HostSessionDebugEventCommon, 'id'> {
  return {
    ...event,
    id: createHostSessionDebugEventId(event.sessionId, event.turnId, event.kind, event.sequence),
  };
}

function extractRequestContent(request: TurnRequest): string {
  const displayContent = typeof request.displayContent === 'string' ? request.displayContent.trim() : '';
  if (displayContent) {
    return displayContent;
  }

  return typeof request.content === 'string' ? request.content.trim() : '';
}

function normalizeTimestamp(...candidates: Array<number | null | undefined>): number {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 0;
}

function safeJsonSummary(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }

  try {
    const text = JSON.stringify(value);
    return previewText(text, 180) ?? '';
  } catch {
    return '';
  }
}

function safeUnknownSummary(value: unknown): string {
  if (typeof value === 'string') {
    return previewText(value, 180) ?? '';
  }

  return safeJsonSummary(value);
}

function sumNumbers(...values: Array<number | undefined>): number | undefined {
  const normalized = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!normalized.length) {
    return undefined;
  }

  return normalized.reduce((sum, value) => sum + value, 0);
}

function deriveDuration(start: number | undefined, end: number | undefined): number | undefined {
  if (typeof start !== 'number' || typeof end !== 'number') {
    return undefined;
  }

  return Math.max(0, end - start);
}

function buildMessageSections(name: string, content: string | undefined): HostSessionDebugMessageSection[] {
  const text = typeof content === 'string' ? content.trim() : '';
  return text ? [{ name, content: text }] : [];
}

function buildResponseSections(
  parts: readonly TurnResponsePart[],
  resultText: string,
): HostSessionDebugMessageSection[] {
  const sections: HostSessionDebugMessageSection[] = [];
  const outputMessages = buildOutputMessagesSection(parts, resultText);
  if (outputMessages) {
    sections.push({ name: 'Output Messages', content: outputMessages });
  }

  const responseText = previewText(resultText, 4000);
  if (responseText) {
    sections.push({ name: 'response', content: responseText });
  }

  const toolSections = parts
    .filter((part): part is Extract<TurnResponsePart, { type: 'tool_call' }> => part.type === 'tool_call')
    .map(part => ({ name: `tool:${part.toolName}`, content: previewText(part.text, 400) ?? part.toolName }));

  const genericSections = parts
    .filter(part => part.type === 'thinking' || part.type === 'info' || part.type === 'warning' || part.type === 'error')
    .map((part, index) => {
      switch (part.type) {
        case 'thinking':
          return { name: `thinking:${index + 1}`, content: previewText(part.content, 400) ?? '' };
        case 'info':
        case 'warning':
        case 'error':
          return { name: `${part.type}:${index + 1}`, content: previewText(part.message, 400) ?? '' };
        default:
          return null;
      }
    })
    .filter((section): section is HostSessionDebugMessageSection => Boolean(section?.content));

  return [...sections, ...toolSections, ...genericSections];
}

function buildModelTurnRequestSections(request: TurnRequest): HostSessionDebugMessageSection[] {
  return (readTurnRequestDebugSectionsSnapshot(request.metadata) ?? [])
    .filter(section => section.name !== 'System' && section.name !== 'Tools')
    .map(section => ({
      name: section.name,
      content: section.content,
    }));
}

function mergeModelTurnSections(
  sections: readonly HostSessionDebugMessageSection[],
  systemContent: string | undefined,
  toolsContent: string | undefined,
): HostSessionDebugMessageSection[] {
  const existingInputMessages = sections.find(section => section.name === 'Input Messages');
  const existingRequestShape = sections.find(section => section.name === 'Request Shape');
  const remainingSections = sections.filter(section => ![
    'Input Messages',
    'Request Shape',
  ].includes(section.name));

  return [
    ...(systemContent
      ? [{ name: 'System', content: systemContent }]
      : []),
    ...(existingInputMessages ? [existingInputMessages] : []),
    ...(existingRequestShape ? [existingRequestShape] : []),
    ...(toolsContent
      ? [{ name: 'Tools', content: toolsContent }]
      : []),
    ...remainingSections,
  ];
}

function buildOutputMessagesSection(
  parts: readonly TurnResponsePart[],
  resultText: string,
): string | undefined {
  const assistantParts: HostSessionDebugStructuredMessagePart[] = [];
  const responseText = typeof resultText === 'string' ? resultText.trim() : '';
  if (responseText) {
    assistantParts.push({ type: 'text', content: responseText });
  }

  for (const part of parts) {
    switch (part.type) {
      case 'tool_call':
        assistantParts.push({
          type: 'tool_call',
          name: part.toolName,
          ...(part.args !== undefined ? { arguments: part.args } : {}),
        });
        break;
      case 'thinking':
        if (part.content.trim()) {
          assistantParts.push({ type: 'reasoning', content: part.content });
        }
        break;
      case 'info':
      case 'warning':
      case 'error':
        if (part.message.trim()) {
          assistantParts.push({ type: 'text', content: part.message });
        }
        break;
      default:
        break;
    }
  }

  if (assistantParts.length === 0) {
    return undefined;
  }

  return jsonStringify([{
    role: 'assistant',
    parts: assistantParts,
  }]);
}

function jsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function findToolCallParentEventId(
  events: readonly HostSessionDebugEvent[],
  modelTurnEventId: string,
  part: TurnResponsePart,
): string {
  const toolCallId = 'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
  if (!toolCallId) {
    return modelTurnEventId;
  }

  const toolCallEvent = [...events].reverse().find((event) => {
    return event.kind === 'toolCall' && event.toolCallId === toolCallId;
  });
  return toolCallEvent?.id ?? modelTurnEventId;
}

function previewText(value: string | undefined, maxLength = 140): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return undefined;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function projectPartEvent(
  part: TurnResponsePart,
  context: {
    sessionId: string;
    turnId: string;
    modelTurnEventId: string;
    toolCallParentId: string;
    created: number;
    sequence: number;
  },
): {
  event: HostSessionDebugEvent;
  content?: HostSessionDebugResolvedEventContent;
} | null {
  switch (part.type) {
    case 'state':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.modelTurnEventId,
          name: `State: ${part.kind ?? 'state'}`,
          details: [part.state, previewText(part.text, 180)].filter(Boolean).join(' · ') || undefined,
          level: part.state === 'error' ? 'error' : 'info',
          category: 'state',
        }),
      };
    case 'question':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.modelTurnEventId,
          name: 'Question',
          details: previewText(part.questions.map(question => question.question).join(' · '), 180),
          level: 'info',
          category: 'question',
        }),
      };
    case 'confirmation':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.modelTurnEventId,
          name: 'Confirmation',
          details: previewText([
            typeof part.title === 'string' ? part.title : '',
            typeof part.message === 'string' ? part.message : '',
            typeof part.result === 'string' ? part.result : '',
          ].filter(Boolean).join(' · '), 180),
          level: part.resolved === false ? 'error' : 'info',
          category: 'confirmation',
        }),
      };
    case 'subagent':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'subagentInvocation',
          created: context.created,
          parentEventId: context.toolCallParentId,
          agentName: part.agentName,
          description: previewText([part.description, part.resultText].filter(Boolean).join(' · '), 240),
          status: part.state === 'doing' ? 'running' : (part.state === 'error' ? 'failed' : 'completed'),
          durationInMillis: sumChildItemDurations(part),
          toolCallCount: part.childItems?.filter(item => item.kind === 'tool').length,
          modelTurnCount: part.childItems?.filter(item => item.kind === 'text').length,
        }),
        content: {
          kind: 'text',
          text: previewText([part.description, part.resultText].filter(Boolean).join('\n\n'), 4000) ?? part.agentName,
        },
      };
    case 'terminal':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.toolCallParentId,
          name: 'Terminal',
          details: previewText([
            typeof part.command === 'string' ? part.command : '',
            typeof part.exitCode === 'number' ? `exit ${part.exitCode}` : (part.isRunning ? 'running' : ''),
            typeof part.stderr === 'string' ? part.stderr : '',
          ].filter(Boolean).join(' · '), 180),
          level: typeof part.exitCode === 'number' && part.exitCode !== 0 ? 'error' : 'info',
          category: 'terminal',
        }),
        content: {
          kind: 'text',
          text: [part.command, part.output, part.stderr].filter(Boolean).join('\n'),
        },
      };
    case 'info':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.modelTurnEventId,
          name: 'Info',
          details: previewText(part.message, 180),
          level: 'info',
          category: 'info',
        }),
      };
    case 'warning':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.modelTurnEventId,
          name: 'Warning',
          details: previewText(part.message, 180),
          level: 'warning',
          category: 'warning',
        }),
      };
    case 'error':
      return {
        event: createDebugEvent({
          sessionId: context.sessionId,
          turnId: context.turnId,
          sequence: context.sequence,
          kind: 'generic',
          created: context.created,
          parentEventId: context.modelTurnEventId,
          name: 'Error',
          details: previewText(part.message, 180),
          level: 'error',
          category: 'error',
        }),
      };
    default:
      return null;
  }
}

function sumChildItemDurations(part: Extract<TurnResponsePart, { type: 'subagent' }>): number | undefined {
  const durations = part.childItems
    ?.map(item => item.duration)
    .filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration));
  if (!durations?.length) {
    return undefined;
  }

  return durations.reduce((sum, duration) => sum + duration, 0);
}