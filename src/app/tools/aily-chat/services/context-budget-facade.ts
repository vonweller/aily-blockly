import type { LexContextBudgetSnapshotExtra } from './context-budget-lex-event';
import type { ContextBudgetSnapshot } from './context-budget-snapshot';

export interface ContextBudgetFacade {
  getSnapshot(): ContextBudgetSnapshot;
  updateModelContextSize(modelName: string | null): void;
  refreshLocalEstimate(messages: any[], tools?: any[]): void;
  applyLexBudgetEvent(
    maxTokens: number,
    usedTokens: number,
    extra?: LexContextBudgetSnapshotExtra,
  ): void;
  reset(): void;
}