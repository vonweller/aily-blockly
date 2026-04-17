import { estimateMessagesTokens, estimateToolsTokens } from './context-budget-estimation';
import { createContextBudgetSnapshot } from './context-budget-snapshot';

import type { ContextBudgetSnapshot } from './context-budget-snapshot';

export interface ContextBudgetLocalEstimateInput {
  messages: any[];
  tools?: any[];
  maxContextTokens: number;
  compressionThreshold: number;
  summarizationThreshold: number;
}

export class ContextBudgetLocalEstimator {
  private cachedSystemTokens: number;
  private cachedToolsTokens = 0;
  private cachedContextTokens = 0;
  private lastToolsCount = 0;

  constructor(private readonly defaultSystemTokens: number) {
    this.cachedSystemTokens = defaultSystemTokens;
  }

  reset(): void {
    this.cachedSystemTokens = this.defaultSystemTokens;
    this.cachedToolsTokens = 0;
    this.cachedContextTokens = 0;
    this.lastToolsCount = 0;
  }

  createSnapshot(input: ContextBudgetLocalEstimateInput): ContextBudgetSnapshot {
    if (input.tools) {
      this.updateToolsTokens(input.tools);
    }

    const messagesTokens = estimateMessagesTokens(input.messages);
    return createContextBudgetSnapshot({
      maxContextTokens: input.maxContextTokens,
      compressionThreshold: input.compressionThreshold,
      summarizationThreshold: input.summarizationThreshold,
      messageCount: input.messages.length,
      systemTokens: this.cachedSystemTokens,
      toolsTokens: this.cachedToolsTokens,
      contextTokens: this.cachedContextTokens,
      messagesTokens,
    });
  }

  private updateToolsTokens(tools: any[]): void {
    if (tools.length === 0) {
      this.cachedToolsTokens = 0;
      this.lastToolsCount = 0;
      return;
    }

    if (tools.length !== this.lastToolsCount) {
      this.cachedToolsTokens = estimateToolsTokens(tools);
      this.lastToolsCount = tools.length;
    }
  }
}