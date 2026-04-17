import { createContextBudgetSnapshot } from './context-budget-snapshot';

import type { ContextBudgetSnapshot } from './context-budget-snapshot';

export interface LexContextBudgetSnapshotExtra {
  systemTokens?: number;
  toolsTokens?: number;
  messagesTokens?: number;
  usagePercent?: number;
  compressionThreshold?: number;
  summarizationThreshold?: number;
  messageCount?: number;
}

export interface LexContextBudgetSnapshotInput {
  maxTokens: number;
  usedTokens: number;
  fallbackCompressionThreshold: number;
  fallbackSummarizationThreshold: number;
  extra?: LexContextBudgetSnapshotExtra;
}

/**
 * lex ContextBudgetEvent thresholds are emitted as 0-1 ratios and need to be
 * converted back to absolute token counts for the blockly UI snapshot.
 */
export function createLexContextBudgetSnapshot(input: LexContextBudgetSnapshotInput): ContextBudgetSnapshot {
  const systemTokens = input.extra?.systemTokens ?? 0;
  const toolsTokens = input.extra?.toolsTokens ?? 0;
  const messagesTokens = input.extra?.messagesTokens ?? (input.usedTokens - systemTokens - toolsTokens);
  const usagePercent = input.extra?.usagePercent
    ?? (input.maxTokens > 0 ? Math.min(100, Math.round((input.usedTokens / input.maxTokens) * 100)) : 0);

  return createContextBudgetSnapshot({
    currentTokens: input.usedTokens,
    maxContextTokens: input.maxTokens,
    compressionThreshold: input.extra?.compressionThreshold != null
      ? Math.floor(input.maxTokens * input.extra.compressionThreshold)
      : input.fallbackCompressionThreshold,
    summarizationThreshold: input.extra?.summarizationThreshold != null
      ? Math.floor(input.maxTokens * input.extra.summarizationThreshold)
      : input.fallbackSummarizationThreshold,
    usagePercent,
    messageCount: input.extra?.messageCount ?? 0,
    systemTokens,
    toolsTokens,
    contextTokens: 0,
    messagesTokens,
  });
}