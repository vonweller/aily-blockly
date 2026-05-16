import type { TurnResponseFollowup, TurnResponseTurn } from 'aily-lex/browser';

export function normalizeTurnResponseSummaryPreview(summaryPreview: string | null | undefined): string | undefined {
  return typeof summaryPreview === 'string' && summaryPreview.trim()
    ? summaryPreview.trim()
    : undefined;
}

export type TurnResponseRoundSummaryCarrier = NonNullable<NonNullable<TurnResponseTurn['responseModel']>['summary']>;

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

function normalizeTurnResponseRoundSummarySource(
  source: unknown,
): TurnResponseRoundSummaryCarrier['source'] | undefined {
  return source === 'background' || source === 'foreground' || source === 'heuristic'
    ? source
    : undefined;
}

export function cloneTurnResponseRoundSummaryCarrier(
  summary: TurnResponseTurn['responseModel']['summary'] | undefined,
): TurnResponseRoundSummaryCarrier | undefined {
  const toolCallRoundId = normalizeOptionalText(summary?.toolCallRoundId);
  const text = normalizeOptionalText(summary?.text);
  const source = normalizeTurnResponseRoundSummarySource(summary?.source);

  if (!toolCallRoundId || !text) {
    return undefined;
  }

  return {
    toolCallRoundId,
    text,
    ...(source ? { source } : {}),
  };
}

export function cloneTurnResponseRoundSummaryCarriers(
  summaries: TurnResponseTurn['responseModel']['summaries'] | undefined,
): readonly TurnResponseRoundSummaryCarrier[] | undefined {
  const cloned = (summaries ?? [])
    .map(summary => cloneTurnResponseRoundSummaryCarrier(summary))
    .filter((summary): summary is TurnResponseRoundSummaryCarrier => !!summary);

  return cloned.length > 0 ? cloned : undefined;
}

export function getTurnResponseResolvedModelName(
  turn:
    | {
      responseModel?: { modelName?: string | null } | null;
      response?: unknown;
    }
    | null
    | undefined,
): string | undefined {
  const responseModelName = normalizeOptionalText(turn?.responseModel?.modelName);
  if (responseModelName) {
    return responseModelName;
  }

  const response = turn?.response as { continuation?: { diagnostics?: unknown } | null } | null | undefined;
  const continuationDiagnostics = response?.continuation?.diagnostics;
  if (!continuationDiagnostics || typeof continuationDiagnostics !== 'object') {
    return undefined;
  }

  const usage = 'usage' in continuationDiagnostics ? continuationDiagnostics['usage'] : undefined;
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  return 'resolvedModel' in usage
    ? normalizeOptionalText(usage['resolvedModel'])
    : undefined;
}

export function cloneTurnResponseModelSidecar(
  responseModel: TurnResponseTurn['responseModel'] | undefined,
): TurnResponseTurn['responseModel'] | undefined {
  if (!responseModel) {
    return undefined;
  }

  const modelName = normalizeOptionalText(responseModel.modelName);
  const modelBillingLabel = normalizeOptionalText(responseModel.modelBillingLabel);
  const summary = cloneTurnResponseRoundSummaryCarrier(responseModel.summary);
  const summaries = cloneTurnResponseRoundSummaryCarriers(responseModel.summaries);
  const summaryPreview = normalizeTurnResponseSummaryPreview(responseModel.summaryPreview);

  if (!responseModel.slashCommand && !responseModel.followups && !summary && !summaries && !summaryPreview && !modelName && !modelBillingLabel) {
    return undefined;
  }

  return {
    ...(responseModel.slashCommand ? { slashCommand: { ...responseModel.slashCommand } } : {}),
    ...(responseModel.followups ? { followups: responseModel.followups.map((followup: TurnResponseFollowup) => ({ ...followup })) } : {}),
    ...(summary ? { summary } : {}),
    ...(summaries ? { summaries } : {}),
    ...(summaryPreview ? { summaryPreview } : {}),
    ...(modelName ? { modelName } : {}),
    ...(modelBillingLabel ? { modelBillingLabel } : {}),
  };
}

function isExplicitAgentSummaryMarkdown(part: TurnResponseTurn['response']['parts'][number]): part is Extract<TurnResponseTurn['response']['parts'][number], { type: 'markdown' }> {
  if (part.type !== 'markdown') {
    return false;
  }

  return /^\[[^\]\s]+(?:\/[^\]\s]+)?\]\s+.+$/.test(part.content.trim());
}

function hasExplicitAgentInvocationRequest(turn: TurnResponseTurn | null | undefined): boolean {
  return Boolean(turn?.request.metadata?.explicitAgentInvocation);
}

export function deriveExplicitAgentSummaryPreview(
  turn: TurnResponseTurn | null | undefined,
): string | undefined {

  if (!turn || !hasExplicitAgentInvocationRequest(turn)) {
    return undefined;
  }

  for (let index = turn.response.parts.length - 1; index >= 0; index -= 1) {
    const part = turn.response.parts[index];
    if (!isExplicitAgentSummaryMarkdown(part)) {
      continue;
    }

    return part.content.trim();
  }

  return undefined;
}

export function withExplicitAgentSummaryPreview(
  turn: TurnResponseTurn,
): TurnResponseTurn {
  const summaryPreview = deriveExplicitAgentSummaryPreview(turn);
  const currentSummaryPreview = normalizeTurnResponseSummaryPreview(turn.responseModel?.summaryPreview);

  if (summaryPreview === currentSummaryPreview) {
    return turn;
  }

  const responseModel = {
    ...(turn.responseModel ?? {}),
    ...(summaryPreview ? { summaryPreview } : {}),
  };

  if (!responseModel.slashCommand && !responseModel.followups && !responseModel.summaryPreview && !responseModel.modelName && !responseModel.modelBillingLabel) {
    const { responseModel: _responseModel, ...turnWithoutResponseModel } = turn as TurnResponseTurn & { responseModel?: TurnResponseTurn['responseModel'] };
    return turnWithoutResponseModel;
  }

  return {
    ...turn,
    responseModel,
  };
}