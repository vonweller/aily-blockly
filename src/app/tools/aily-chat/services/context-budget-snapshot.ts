export interface ContextBudgetSnapshot {
  currentTokens: number;
  maxContextTokens: number;
  compressionThreshold: number;
  summarizationThreshold: number;
  usagePercent: number;
  messageCount: number;
  updatedAt: number;
  systemTokens: number;
  toolsTokens: number;
  contextTokens: number;
  messagesTokens: number;
  systemPercent: number;
  toolsPercent: number;
  contextPercent: number;
  messagesPercent: number;
}

export interface ContextBudgetSnapshotInput {
  maxContextTokens: number;
  compressionThreshold: number;
  summarizationThreshold: number;
  messageCount: number;
  systemTokens: number;
  toolsTokens: number;
  contextTokens: number;
  messagesTokens: number;
  currentTokens?: number;
  usagePercent?: number;
}

function toPercent(tokens: number, maxContextTokens: number): number {
  return maxContextTokens > 0
    ? Math.round((tokens / maxContextTokens) * 1000) / 10
    : 0;
}

export function createContextBudgetSnapshot(input: ContextBudgetSnapshotInput): ContextBudgetSnapshot {
  const currentTokens = input.currentTokens
    ?? (input.systemTokens + input.toolsTokens + input.contextTokens + input.messagesTokens);
  const usagePercent = input.usagePercent
    ?? (input.maxContextTokens > 0
      ? Math.min(100, Math.round((currentTokens / input.maxContextTokens) * 100))
      : 0);

  return {
    currentTokens,
    maxContextTokens: input.maxContextTokens,
    compressionThreshold: input.compressionThreshold,
    summarizationThreshold: input.summarizationThreshold,
    usagePercent,
    messageCount: input.messageCount,
    updatedAt: Date.now(),
    systemTokens: input.systemTokens,
    toolsTokens: input.toolsTokens,
    contextTokens: input.contextTokens,
    messagesTokens: input.messagesTokens,
    systemPercent: toPercent(input.systemTokens, input.maxContextTokens),
    toolsPercent: toPercent(input.toolsTokens, input.maxContextTokens),
    contextPercent: toPercent(input.contextTokens, input.maxContextTokens),
    messagesPercent: toPercent(input.messagesTokens, input.maxContextTokens),
  };
}

export function createEmptyContextBudgetSnapshot(options?: {
  maxContextTokens?: number;
  compressionThreshold?: number;
  summarizationThreshold?: number;
}): ContextBudgetSnapshot {
  return createContextBudgetSnapshot({
    maxContextTokens: options?.maxContextTokens ?? 0,
    compressionThreshold: options?.compressionThreshold ?? 0,
    summarizationThreshold: options?.summarizationThreshold ?? 0,
    messageCount: 0,
    systemTokens: 0,
    toolsTokens: 0,
    contextTokens: 0,
    messagesTokens: 0,
    currentTokens: 0,
    usagePercent: 0,
  });
}