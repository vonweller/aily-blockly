import type { TurnResponseTurn } from 'aily-lex/browser';
import {
  formatContinuationStopReason,
  getContinuationHardStopReasonMessage,
} from '../core/continuation-stop-reason';

export type InteractionBudgetSeverity = 'normal' | 'warning' | 'danger';

export interface InteractionBudgetSnapshotItem {
  readonly key: string;
  readonly label: string;
  readonly used: number;
  readonly cap: number;
  readonly percent: number;
  readonly valueLabel: string;
  readonly severity: InteractionBudgetSeverity;
}

export interface InteractionBudgetSnapshot {
  readonly title: string;
  readonly label: string;
  readonly badgeText?: string;
  readonly severity: InteractionBudgetSeverity;
  readonly statusText?: string;
  readonly metadataText?: string;
  readonly hardStopMessage?: string;
  readonly items: readonly InteractionBudgetSnapshotItem[];
}

type ContinuationBudgetRecord = Record<string, unknown>;

export function createInteractionBudgetSnapshot(
  turns: readonly TurnResponseTurn[] | null | undefined,
): InteractionBudgetSnapshot | null {
  const continuation = findLatestContinuation(turns ?? []);
  if (!continuation) {
    return null;
  }

  const budgets = asRecord(continuation['budgets']);
  if (!budgets) {
    return null;
  }

  const items = [
    createBudgetItem('rounds', 'Rounds', budgets['roundCount'], budgets['hardRoundCap']),
    createBudgetItem('execution', 'Execution units', budgets['executionUnits'], budgets['executionUnitCap'], formatUnits),
    createBudgetItem('wall-clock', 'Wall clock', budgets['wallClockMs'], budgets['wallClockCapMs'], formatMilliseconds),
    createBudgetItem('raw-tools', 'Raw tool calls', budgets['rawToolCallCount'], budgets['rawToolCallCap']),
    createBudgetItem('questions', 'Question answers', budgets['questionAnswerCount'], budgets['questionAnswerCap']),
    createBudgetItem('confirmations', 'Confirmations', budgets['confirmationCount'], budgets['confirmationCap']),
  ].filter((item): item is InteractionBudgetSnapshotItem => item !== null);

  const hardStopReason = asString(continuation['hardStopReason']);
  if (items.length === 0 && !hardStopReason) {
    return null;
  }

  const maxPercent = items.reduce((max, item) => Math.max(max, item.percent), 0);
  const severity: InteractionBudgetSeverity = hardStopReason
    ? 'danger'
    : maxPercent >= 80
      ? 'warning'
      : 'normal';

  return {
    title: 'Current execution budget',
    label: 'Execution',
    badgeText: hardStopReason ? 'Stopped' : `${Math.round(maxPercent)}%`,
    severity,
    statusText: buildStatusText(continuation),
    metadataText: buildMetadataText(budgets, continuation),
    hardStopMessage: getContinuationHardStopReasonMessage(hardStopReason),
    items,
  };
}

function buildMetadataText(
  budgets: ContinuationBudgetRecord,
  continuation: ContinuationBudgetRecord,
): string | undefined {
  const scope = asString(budgets['scope']);
  const origin = asString(budgets['origin']);
  const executionId = asString(budgets['executionId']);
  const stopReason = asString(continuation['stopReason']);
  const diagnostics = asRecord(continuation['diagnostics']);
  const usage = asRecord(diagnostics?.['usage']);
  const outcome = asRecord(diagnostics?.['outcome']);
  const behavior = asRecord(diagnostics?.['behavior']);
  const resolvedModel = asString(usage?.['resolvedModel']);
  const modelBillingLabel = asString(usage?.['modelBillingLabel']);
  const promptTokens = asNumber(usage?.['promptTokens']);
  const completionTokens = asNumber(usage?.['completionTokens']);
  const errorCode = asString(outcome?.['errorCode']);

  const parts: string[] = [];
  if (scope) {
    parts.push(`Scope: ${scope}`);
  }
  if (origin) {
    parts.push(`Origin: ${origin}`);
  }
  if (executionId) {
    parts.push(`Execution: ${executionId}`);
  }
  if (resolvedModel || modelBillingLabel) {
    parts.push(`Model: ${resolvedModel ?? 'unknown'}${modelBillingLabel ? ` (${modelBillingLabel})` : ''}`);
  }
  if (typeof promptTokens === 'number' || typeof completionTokens === 'number') {
    parts.push(`Tokens: ${formatTokenUsage(promptTokens, completionTokens)}`);
  }
  if (stopReason) {
    parts.push(`Stop: ${formatContinuationStopReason(stopReason) ?? stopReason}`);
  }
  if (errorCode) {
    parts.push(`Error: ${errorCode}`);
  }
  const behaviorSummary = formatBehaviorMetadata(behavior);
  if (behaviorSummary) {
    parts.push(`Behavior: ${behaviorSummary}`);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function formatBehaviorMetadata(behavior: Record<string, unknown> | null): string | undefined {
  if (!behavior) {
    return undefined;
  }

  const entries = [
    formatBehaviorEntry('repeatedTextScore', behavior['repeatedTextScore']),
    formatBehaviorEntry('repeatedChunkStreak', behavior['repeatedChunkStreak']),
    formatBehaviorEntry('noProgressRounds', behavior['noProgressRounds']),
    formatBehaviorEntry('repeatedToolCallStreak', behavior['repeatedToolCallStreak']),
    formatBehaviorEntry('repeatedPendingStreak', behavior['repeatedPendingStreak']),
    formatBehaviorEntry('syncConflictStreak', behavior['syncConflictStreak']),
    formatBehaviorEntry('pendingInterruptions', behavior['pendingInterruptions']),
    formatBehaviorEntry('pendingReplyOscillationCount', behavior['pendingReplyOscillationCount']),
    formatBehaviorEntry('sameToolFingerprintCount', behavior['sameToolFingerprintCount']),
    formatBehaviorEntry('samePendingFingerprintCount', behavior['samePendingFingerprintCount']),
    formatBehaviorEntry('lastProgressAtRound', behavior['lastProgressAtRound']),
  ].filter((value): value is string => !!value);

  return entries.length > 0 ? entries.join(', ') : undefined;
}

function formatBehaviorEntry(label: string, value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${label}=${value}`
    : undefined;
}

function formatTokenUsage(promptTokens: number | null, completionTokens: number | null): string {
  const promptLabel = typeof promptTokens === 'number' ? `${Math.round(promptTokens)} prompt` : undefined;
  const completionLabel = typeof completionTokens === 'number' ? `${Math.round(completionTokens)} completion` : undefined;
  return [promptLabel, completionLabel].filter((value): value is string => !!value).join(', ');
}

function findLatestContinuation(turns: readonly TurnResponseTurn[]): ContinuationBudgetRecord | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const continuation = asRecord(turns[index]?.response?.continuation);
    if (continuation && asRecord(continuation['budgets'])) {
      return continuation;
    }
  }

  return null;
}

function createBudgetItem(
  key: string,
  label: string,
  usedValue: unknown,
  capValue: unknown,
  formatter: (value: number) => string = formatCount,
): InteractionBudgetSnapshotItem | null {
  const used = asNumber(usedValue);
  const cap = asNumber(capValue);
  if (used === null || cap === null) {
    return null;
  }

  const percent = cap <= 0
    ? (used > 0 ? 100 : 0)
    : (used / cap) * 100;
  const severity: InteractionBudgetSeverity = used > cap
    ? 'danger'
    : percent >= 80
      ? 'warning'
      : 'normal';

  return {
    key,
    label,
    used,
    cap,
    percent,
    valueLabel: `${formatter(used)} / ${formatter(cap)}`,
    severity,
  };
}

function buildStatusText(continuation: ContinuationBudgetRecord): string | undefined {
  const status = asString(continuation['status']);
  const pendingState = asRecord(continuation['pendingState']);
  const pendingKind = asString(pendingState?.['kind']);

  if (status === 'hard_stopped') {
    return 'Status: stopped';
  }
  if (pendingKind === 'tool_results') {
    return 'Status: waiting for tool results';
  }
  if (pendingKind === 'question') {
    return 'Status: waiting for answer';
  }
  if (pendingKind === 'confirmation') {
    return 'Status: waiting for confirmation';
  }
  if (status === 'running') {
    return 'Status: active';
  }

  return undefined;
}

function formatCount(value: number): string {
  return `${Math.round(value)}`;
}

function formatUnits(value: number): string {
  return Number.isInteger(value)
    ? `${value}`
    : value.toFixed(1).replace(/\.0$/, '');
}

function formatMilliseconds(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}s`;
  }

  return `${Math.round(value)}ms`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}