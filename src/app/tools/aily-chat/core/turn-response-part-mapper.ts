import type {
  TurnResponseConfirmationPart,
  TurnResponsePart,
  TurnResponsePlanPart,
  TurnResponseQuestionPart,
  TurnResponseStatePart,
  TurnResponseTerminalPart,
} from 'aily-lex/browser';

import type { ChatPart } from './chat-parts';
import {
  buildConfirmationPartId,
  mkConfirmation,
  mkError,
  mkMarkdown,
  mkPlan,
  mkQuestion,
  mkState,
  mkSubagentToolCall,
  mkTerminal,
  mkThinking,
  mkToolCall,
  normalizeChatPartScope,
  withChatPartScopeMetadata,
} from './chat-parts';
import { getMarkdownContent } from './markdown-content-store';
import { getThinkContent } from './think-content-store';

type MutableQuestionAnswers = Extract<ChatPart, { type: 'question' }>['answers'];
type ScopedTurnResponsePartMetadata = { readonly metadata?: Record<string, unknown> };

export function hydrateQuestionAnswersFromAskUserToolMetadata(
  parts: readonly TurnResponsePart[],
): readonly TurnResponsePart[] {
  const answerSets = parts
    .map(extractAskUserQuestionAnswers)
    .filter((answers): answers is NonNullable<MutableQuestionAnswers> => !!answers);
  if (answerSets.length === 0) {
    return parts;
  }

  let nextParts: TurnResponsePart[] | null = null;
  const mutableParts = () => {
    nextParts ??= parts.map(part => ({ ...part })) as TurnResponsePart[];
    return nextParts;
  };

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex] as Partial<TurnResponseQuestionPart> | undefined;
    if (part?.type !== 'question' || part.answers) {
      continue;
    }

    const matchingAnswers = answerSets.find(answers => answersMatchQuestions(answers, part));
    if (!matchingAnswers) {
      continue;
    }

    mutableParts()[partIndex] = {
      ...part,
      answers: cloneQuestionAnswers(matchingAnswers),
    } as TurnResponsePart;
  }

  return nextParts ?? parts;
}

export function chatPartToTurnResponsePart(part: ChatPart): TurnResponsePart {
  switch (part.type) {
    case 'markdown': {
      const metadata = withChatPartScopeMetadata(undefined, normalizeChatPartScope(part));
      return {
        type: 'markdown',
        content: part.content || (part.contentRef ? getMarkdownContent(part.contentRef) : ''),
        ...(metadata ? { metadata } : {}),
      } as TurnResponsePart;
    }
    case 'thinking': {
      const metadata = withChatPartScopeMetadata(undefined, normalizeChatPartScope(part));
      return {
        type: 'thinking',
        content: part.content || (part.contentRef ? getThinkContent(part.contentRef) : ''),
        isComplete: part.isComplete,
        ...(metadata ? { metadata } : {}),
      } as TurnResponsePart;
    }
    case 'tool_call':
      return {
        type: 'tool_call',
        partId: part.partId,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        text: part.text,
        state: part.state,
        args: part.args,
        metadata: part.metadata,
      };
    case 'state':
      return {
        type: 'state',
        stateId: part.stateId,
        text: part.text,
        state: part.state,
        progress: part.progress,
        kind: part.kind as TurnResponseStatePart['kind'],
        metadata: part.metadata,
      };
    case 'error':
      if (part.severity === 'warning') {
        return {
          type: 'warning',
          message: part.message,
          metadata: part.metadata,
        };
      }
      if (part.severity === 'info') {
        return {
          type: 'info',
          message: part.message,
          metadata: part.metadata,
        };
      }
      return {
        type: 'error',
        message: part.message,
        ...(part.metadata ? { metadata: part.metadata } : {}),
      } as TurnResponsePart;
    case 'question': {
      const metadata = withChatPartScopeMetadata(part.metadata, normalizeChatPartScope(part));
      return {
        type: 'question',
        partId: part.partId,
        questions: part.questions.map(question => ({
          question: question.question,
          options: question.options?.map(option => ({ ...option })),
          allowFreeform: question.allow_freeform,
          multiSelect: question.multi_select,
        })),
        answers: cloneQuestionAnswers(part.answers),
        isHistory: part.isHistory,
        ...(metadata ? { metadata } : {}),
      } satisfies TurnResponseQuestionPart;
    }
    case 'confirmation': {
      const metadata = withChatPartScopeMetadata(part.metadata, normalizeChatPartScope(part));
      return {
        type: 'confirmation',
        partId: part.partId,
        askId: part.askId,
        toolName: part.toolName,
        title: part.title,
        subtitle: part.subtitle,
        message: part.message,
        args: part.args,
        source: part.source,
        actions: part.actions,
        primaryScope: part.primaryScope,
        resolved: part.resolved,
        result: part.result,
        scope: part.scope,
        ...(metadata ? { metadata } : {}),
        ...(part.description != null ? { description: part.description } : {}),
      } satisfies TurnResponseConfirmationPart;
    }
    case 'terminal':
      return {
        type: 'terminal',
        partId: part.partId,
        command: part.command,
        output: part.output,
        stderr: part.stderr,
        exitCode: part.exitCode,
        isRunning: part.isRunning,
        toolCallId: part.toolCallId,
        sourceToolCallIds: part.sourceToolCallIds,
        processId: part.processId,
        outputSessionId: part.outputSessionId,
        terminalId: part.terminalId,
        outputFilePath: part.outputFilePath,
        cwd: part.cwd,
        status: part.status,
        bytesTotal: part.bytesTotal,
        lastOutputAt: part.lastOutputAt,
      } satisfies TurnResponseTerminalPart;
    case 'plan':
      return {
        type: 'plan',
        partId: part.partId,
        status: part.status,
        text: part.text,
        steps: part.steps?.map(step => ({ ...step })),
        assumptions: part.assumptions ? [...part.assumptions] : undefined,
        verification: part.verification ? [...part.verification] : undefined,
        source: part.source,
      } satisfies TurnResponsePlanPart;
  }
}

export function turnResponsePartToChatPart(part: TurnResponsePart, existing?: ChatPart): ChatPart {
  switch (part.type) {
    case 'markdown':
      return mkMarkdown(part.content, normalizeChatPartScope((part as ScopedTurnResponsePartMetadata).metadata));
    case 'thinking':
      return mkThinking(part.content, part.isComplete, normalizeChatPartScope((part as ScopedTurnResponsePartMetadata).metadata));
    case 'tool_call':
      return {
        ...mkToolCall(part.toolCallId, part.toolName, part.text, part.state, part.args, part.metadata),
        partId: part.partId,
      };
    case 'state':
      return mkState(part.stateId, part.text, part.state, part.kind, part.progress, part.metadata);
    case 'error':
      return mkError(part.message, 'error', readPartMetadata(part));
    case 'warning':
      return mkError(part.message, 'warning', part.metadata);
    case 'info':
      return mkError(part.message, 'info', part.metadata);
    case 'question': {
      const question = mkQuestion(part.questions.map(item => ({
        question: item.question,
        options: item.options?.map(option => ({ ...option })),
        allow_freeform: item.allowFreeform,
        multi_select: item.multiSelect,
      })), part.isHistory, part.partId?.replace(/^question:/, ''), normalizeChatPartScope(part.metadata), part.metadata);
      question.partId = part.partId ?? question.partId;
      const mergedAnswers = part.answers
        ? cloneQuestionAnswers(part.answers)
        : existing?.type === 'question'
          ? cloneQuestionAnswers(existing.answers)
          : undefined;
      if (mergedAnswers) {
        question.answers = mergedAnswers;
      }
      return question;
    }
    case 'confirmation': {
      const existingConfirmation = existing?.type === 'confirmation' ? existing : undefined;
      const confirmation = mkConfirmation(part.askId, part.message, part.toolName, part.source, {
        args: part.args ?? existingConfirmation?.args,
        title: part.title ?? existingConfirmation?.title,
        subtitle: part.subtitle ?? existingConfirmation?.subtitle,
        description: part.description ?? existingConfirmation?.description,
        actions: part.actions ?? existingConfirmation?.actions,
        primaryScope: part.primaryScope ?? existingConfirmation?.primaryScope,
        metadata: part.metadata ?? existingConfirmation?.metadata,
        ...(normalizeChatPartScope(part.metadata) ?? {}),
      });
      confirmation.partId = part.partId ?? confirmation.partId;
      confirmation.resolved = part.resolved || existingConfirmation?.resolved || false;
      confirmation.result = part.result ?? existingConfirmation?.result;
      confirmation.scope = part.scope ?? existingConfirmation?.scope;
      return confirmation;
    }
    case 'terminal': {
      const terminal = mkTerminal(part.command, part.toolCallId, part.partId, {
        sourceToolCallIds: part.sourceToolCallIds ? [...part.sourceToolCallIds] : undefined,
        processId: part.processId,
        outputSessionId: part.outputSessionId,
        terminalId: part.terminalId,
        outputFilePath: part.outputFilePath,
        cwd: part.cwd,
        status: part.status,
        bytesTotal: part.bytesTotal,
        lastOutputAt: part.lastOutputAt,
      });
      terminal.output = part.output;
      terminal.stderr = part.stderr;
      terminal.exitCode = part.exitCode;
      terminal.isRunning = part.isRunning;
      return terminal;
    }
    case 'plan':
      return mkPlan(part.text, part.status, part.partId, {
        steps: part.steps?.map(step => ({ ...step })),
        assumptions: part.assumptions ? [...part.assumptions] : undefined,
        verification: part.verification ? [...part.verification] : undefined,
        source: part.source,
      });
    case 'subagent': {
      const subAgentInvocationId = (part as { readonly subAgentInvocationId?: string }).subAgentInvocationId || part.toolCallId;
      const toolCall = mkSubagentToolCall(part.toolCallId, part.agentName, part.description, {
        ...(part.metadata || {}),
        subAgentInvocationId,
        phase: part.state === 'error' ? 'failed' : part.state === 'done' ? 'completed' : 'started',
        toolSpecificData: {
          ...((((part.metadata && typeof part.metadata === 'object' && !Array.isArray(part.metadata))
            ? (part.metadata as Record<string, unknown>)['toolSpecificData']
            : undefined) as Record<string, unknown> | undefined) || {}),
          kind: 'subagent',
          agentName: part.agentName,
          description: part.description,
          result: part.resultText,
          childItems: part.childItems?.map(item => ({ ...item })) || [],
        },
      });
      toolCall.partId = part.partId ?? toolCall.partId;
      toolCall.state = part.state === 'error' ? 'error' : part.state === 'done' ? 'done' : 'doing';
      return toolCall;
    }
  }
}

export function turnResponsePartToChatParts(part: TurnResponsePart, existing?: ChatPart): ChatPart[] {
  const primary = turnResponsePartToChatPart(part, existing);
  if (part.type !== 'subagent' || !Array.isArray(part.childItems) || part.childItems.length === 0) {
    return [primary];
  }

  const subAgentInvocationId = part.subAgentInvocationId || part.toolCallId;
  return [
    stripLegacySubagentChildItems(primary),
    ...part.childItems.map((child, index) => legacySubagentChildItemToChatPart(
      child,
      {
        sourceAgentRole: 'subagent',
        subAgentInvocationId,
        parentToolCallId: part.toolCallId,
        sequence: index,
      },
      part.toolCallId,
      index,
    )),
  ];
}

function stripLegacySubagentChildItems(part: ChatPart): ChatPart {
  if (part.type !== 'tool_call' || !part.metadata || typeof part.metadata !== 'object') {
    return part;
  }

  const metadata = { ...part.metadata };
  const toolSpecificData = metadata['toolSpecificData'];
  if (!toolSpecificData || typeof toolSpecificData !== 'object' || Array.isArray(toolSpecificData)) {
    return part;
  }

  const nextToolSpecificData = { ...(toolSpecificData as Record<string, unknown>) };
  delete nextToolSpecificData['childItems'];
  return {
    ...part,
    metadata: {
      ...metadata,
      toolSpecificData: nextToolSpecificData,
    },
  };
}

function legacySubagentChildItemToChatPart(
  child: Extract<TurnResponsePart, { type: 'subagent' }>['childItems'][number],
  scope: NonNullable<ReturnType<typeof normalizeChatPartScope>>,
  parentToolCallId: string,
  index: number,
): ChatPart {
  switch (child.kind) {
    case 'thinking':
      return mkThinking(child.content || '', true, scope);
    case 'text':
      return mkMarkdown(child.content || '', scope);
    case 'tool': {
      const toolCallId = typeof child.toolCallId === 'string' && child.toolCallId.trim().length > 0
        ? child.toolCallId
        : `${parentToolCallId}:legacy-child:${index}`;
      const toolName = typeof child.toolName === 'string' && child.toolName.trim().length > 0
        ? child.toolName
        : 'tool';
      const state = child.state === 'error'
        ? 'error'
        : child.state === 'doing'
          ? 'doing'
          : 'done';
      return mkToolCall(
        toolCallId,
        toolName,
        child.content || child.argsSummary || toolName,
        state,
        child.argsSummary ? { summary: child.argsSummary } : undefined,
        withChatPartScopeMetadata({
          legacySubagentChild: true,
          ...(typeof child.duration === 'number' ? { duration: child.duration } : {}),
        }, scope),
        scope,
      );
    }
  }
}

function cloneQuestionAnswers(
  answers: TurnResponseQuestionPart['answers'] | MutableQuestionAnswers,
): MutableQuestionAnswers | undefined {
  if (!answers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(answers).map(([key, answer]) => [key, {
      selected: [...answer.selected],
      freeText: answer.freeText,
      skipped: answer.skipped,
    }]),
  );
}

function extractAskUserQuestionAnswers(part: TurnResponsePart): MutableQuestionAnswers | undefined {
  if (part.type !== 'tool_call') {
    return undefined;
  }

  const metadata = (part as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const payload = (metadata as { askUserQuestionAnswer?: unknown }).askUserQuestionAnswer;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  return normalizeQuestionAnswers((payload as { answers?: unknown }).answers);
}

function normalizeQuestionAnswers(answers: unknown): MutableQuestionAnswers | undefined {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return undefined;
  }

  const normalized: NonNullable<MutableQuestionAnswers> = {};
  for (const [question, answer] of Object.entries(answers)) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
      continue;
    }

    const candidate = answer as { selected?: unknown; freeText?: unknown; skipped?: unknown };
    normalized[question] = {
      selected: Array.isArray(candidate.selected)
        ? candidate.selected.filter((item): item is string => typeof item === 'string')
        : [],
      freeText: typeof candidate.freeText === 'string' ? candidate.freeText : null,
      skipped: !!candidate.skipped,
    };
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function answersMatchQuestions(
  answers: NonNullable<MutableQuestionAnswers>,
  questionPart: Partial<TurnResponseQuestionPart>,
): boolean {
  const questions = Array.isArray(questionPart.questions)
    ? questionPart.questions
      .map(question => question?.question)
      .filter((question): question is string => typeof question === 'string' && question.trim().length > 0)
    : [];
  if (questions.length === 0) {
    return false;
  }

  const questionSet = new Set(questions);
  const answerKeys = Object.keys(answers).filter(question => question.trim().length > 0);
  return answerKeys.length > 0 && answerKeys.every(question => questionSet.has(question));
}

function readPartMetadata(part: unknown): Record<string, unknown> | undefined {
  const metadata = part && typeof part === 'object' && !Array.isArray(part)
    ? (part as { metadata?: unknown }).metadata
    : undefined;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : undefined;
}
