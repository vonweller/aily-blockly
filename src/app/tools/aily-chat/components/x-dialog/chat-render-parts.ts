import type { TurnResponsePart, TurnResponseTurn } from 'aily-lex/browser';

import type { ChatPart } from '../../core/chat-parts';

export interface ProgressMessageDisplayPart {
  type: 'progress';
  content: string;
  progressKind: 'working' | 'confirmation_pending';
}

export type RenderableChatPart = ChatPart | ProgressMessageDisplayPart;

export function isProgressMessageDisplayPart(part: RenderableChatPart | null | undefined): part is ProgressMessageDisplayPart {
  return !!part && part.type === 'progress';
}

export function mkProgressMessageDisplayPart(
  content: string,
  progressKind: ProgressMessageDisplayPart['progressKind'] = 'working',
): ProgressMessageDisplayPart {
  return {
    type: 'progress',
    content,
    progressKind,
  };
}

export function buildRenderableProgressParts(
  response: TurnResponseTurn['response'] | null | undefined,
  doing: boolean,
  showConfirmationPendingProgress = false,
): readonly ProgressMessageDisplayPart[] {
  if (!response || !doing) {
    return [];
  }

  const parts: ProgressMessageDisplayPart[] = [];
  const existingContents = new Set<string>();
  for (const message of response.progressMessages ?? []) {
    if (message?.kind !== 'progressMessage' || typeof message.content !== 'string' || !message.content.trim()) {
      continue;
    }

    const content = message.content.trim();
    if (existingContents.has(content)) {
      continue;
    }

    existingContents.add(content);
    parts.push(mkProgressMessageDisplayPart(content, 'working'));
  }

  const responseParts = response.parts ?? [];
  const pendingConfirmationCount = showConfirmationPendingProgress
    ? getPendingConfirmationCount(responseParts, false)
    : 0;
  const shouldShowFallbackConfirmationProgress = showConfirmationPendingProgress
    && pendingConfirmationCount === 0
    && !getPendingConfirmationCount(responseParts, true)
    && !hasActiveSubagentPart(responseParts);
  if (pendingConfirmationCount > 0 || shouldShowFallbackConfirmationProgress) {
    const content = getConfirmationPendingLabel(pendingConfirmationCount || 1);
    if (!existingContents.has(content)) {
      parts.push(mkProgressMessageDisplayPart(content, 'confirmation_pending'));
    }
  }

  return parts;
}

function hasActiveSubagentPart(parts: readonly TurnResponsePart[]): boolean {
  return parts.some(part => {
    if (part.type === 'subagent') {
      return part.state !== 'done' && part.state !== 'error';
    }

    if (part.type !== 'tool_call') {
      return false;
    }

    const metadata = asRecord(part.metadata);
    const toolSpecificData = asRecord(metadata?.['toolSpecificData']);
    return part.state === 'doing' && (
      typeof metadata?.['subAgentInvocationId'] === 'string'
      || toolSpecificData?.['kind'] === 'subagent'
    );
  });
}

function getPendingConfirmationCount(parts: readonly TurnResponsePart[], includeSubagentConfirmations: boolean): number {
  let count = 0;
  for (const part of parts) {
    if (part.type === 'tool_call' && part.state === 'pending_approval' && isSubagentToolCall(part) === includeSubagentConfirmations) {
      count += 1;
      continue;
    }

    if (!includeSubagentConfirmations && part.type === 'confirmation' && part.resolved !== true) {
      count += 1;
    }
  }

  return count;
}

function isSubagentToolCall(part: Extract<TurnResponsePart, { type: 'tool_call' }>): boolean {
  const metadata = asRecord(part.metadata);
  const toolSpecificData = asRecord(metadata?.['toolSpecificData']);
  return typeof metadata?.['subAgentInvocationId'] === 'string'
    || toolSpecificData?.['kind'] === 'subagent';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getConfirmationPendingLabel(count: number): string {
  return count === 1
    ? '1 confirmation pending'
    : `${count} confirmations pending`;
}