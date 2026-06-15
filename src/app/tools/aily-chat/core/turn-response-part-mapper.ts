import type {
  TurnResponseConfirmationPart,
  TurnResponsePart,
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
  mkQuestion,
  mkState,
  mkSubagentToolCall,
  mkTerminal,
  mkThinking,
  mkToolCall,
} from './chat-parts';

type MutableQuestionAnswers = Extract<ChatPart, { type: 'question' }>['answers'];

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
    case 'markdown':
      return {
        type: 'markdown',
        content: part.content,
      };
    case 'thinking':
      return {
        type: 'thinking',
        content: part.content,
        isComplete: part.isComplete,
      };
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
    case 'question':
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
      } satisfies TurnResponseQuestionPart;
    case 'confirmation':
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
        ...(part.description != null ? { description: part.description } : {}),
      } satisfies TurnResponseConfirmationPart;
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
  }
}

export function turnResponsePartToChatPart(part: TurnResponsePart, existing?: ChatPart): ChatPart {
  switch (part.type) {
    case 'markdown':
      return mkMarkdown(part.content);
    case 'thinking':
      return mkThinking(part.content, part.isComplete);
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
      })), part.isHistory, part.partId?.replace(/^question:/, ''));
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
