import type { Observable } from 'rxjs';
import type { TurnResponseTurn } from 'aily-lex/browser';

import type { ModelConfigOption } from './aily-chat-config.service';
import type { LexContextBudgetSnapshotExtra } from './context-budget-lex-event';
import type { ContextBudgetSnapshot } from './context-budget-snapshot';

export interface ChatRuntimeOwnerRollbackResult {
  readonly rolledBackFiles: number;
  readonly errors: readonly string[];
}

export interface ChatRuntimeOwnerContextBudgetPort {
  getSnapshot(): ContextBudgetSnapshot;
  readonly budget$?: Observable<ContextBudgetSnapshot>;
  readonly maxContextTokens?: number;
  readonly compressionThreshold?: number;
  readonly summarizationThreshold?: number;
  updateModelContextSize(model: string | Partial<ModelConfigOption> | null): void;
  refreshLocalEstimate(messages: any[], tools?: any[]): void;
  applyLexBudgetEvent(
    maxTokens: number,
    usedTokens: number,
    extra?: LexContextBudgetSnapshotExtra,
  ): void;
  reset(): void;
}

export interface ChatRuntimeOwnerEditCheckpointPort {
  autoSaveEdits: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;

  setFileHistory(fileHistory: unknown): void;
  setTimelineContext(sessionId: string | null | undefined, workspaceRoot: string | null | undefined): void;
  startTurn(
    turnIndex: number,
    turnStartListIndex: number | null,
    responseStartListIndex: number | null,
    turnId?: string,
    requestContent?: string,
    displayContent?: string,
    checkpointId?: string,
    requestMetadata?: unknown,
  ): void;
  recordAdditionalRepositoryRootCandidates(paths: readonly string[] | undefined | null): void;
  recordEdit(filePath: string, type: 'create' | 'modify' | 'delete'): void;
  publishCurrentSummary(): Promise<void>;
  commitCurrentTurn(): Promise<void>;
  hasEditsInCurrentTurn(): boolean;
  getEditsSummary(checkpointId?: string | null): Promise<unknown>;
  requestDiffPreview(summary: unknown): void;
  acceptAllAsBaseline(): void;
  dismissSummary(): void;
  publishSummary(summary: unknown): void;

  getSnapshotByRoundId(roundId: string): unknown;
  getSnapshotByTurnId(turnId: string): unknown;
  isSnapshotActive(snapshot: unknown): boolean;
  getTurnContextForSnapshot(snapshot: unknown, fallbackTurnId?: string): unknown;
  getTurnStartListIndexForSnapshot(snapshot: unknown): number | null;
  getResponseStartListIndexForSnapshot(snapshot: unknown): number | null;
  rebuildFromTurnResponses(turnResponses: readonly TurnResponseTurn[]): Promise<boolean>;
  undo(): Promise<ChatRuntimeOwnerRollbackResult>;
  redo(): Promise<ChatRuntimeOwnerRollbackResult>;
  acceptFile(filePath: string): void;
  rejectFile(filePath: string): Promise<ChatRuntimeOwnerRollbackResult>;
  getLatestSnapshot(): unknown;

  restoreRebuildState(snapshot: unknown): void;
  restorePublishedSummary(summary: unknown): void;
  applyRebuildStateWithSummary(snapshot: unknown, summary: unknown): void;
  applyRebuildState(snapshot: unknown): void;
  truncateStateFromCheckpoint(checkpointId: string): boolean;
  captureRebuildState(): unknown;
  capturePublishedSummary(): unknown;
  buildRebuildStateFromTurnResponses(turnResponses: readonly TurnResponseTurn[]): Promise<unknown>;
  buildPublishedSummaryForRebuildState(snapshot: unknown): Promise<unknown>;
  getRequestCheckpointMetadataByCheckpointId(checkpointId: string | null | undefined): unknown;

  forkRequestCheckpointMetadata(input: {
    sourceSessionResource: string;
    targetSessionResource: string;
    retainedTurnResponses: readonly TurnResponseTurn[];
  }): Promise<TurnResponseTurn[] | null>;
  setWorkspaceCheckpointProvider(provider: unknown): void;
  waitForCheckpointMetadataSettled(): Promise<void>;
  getInitialContent(filePath: string): string | null | undefined;
  getTotalEditCount(): number;
  getRequestEditsSummarySync(turnId: string): unknown;
  clear(): void;
}
