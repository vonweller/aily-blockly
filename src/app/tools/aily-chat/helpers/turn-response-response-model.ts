import type { TurnResponseFollowup, TurnResponseTurn } from 'aily-lex/browser';

export function normalizeTurnResponseSummaryPreview(summaryPreview: string | null | undefined): string | undefined {
  return typeof summaryPreview === 'string' && summaryPreview.trim()
    ? summaryPreview.trim()
    : undefined;
}

export function cloneTurnResponseModelSidecar(
  responseModel: TurnResponseTurn['responseModel'] | undefined,
): TurnResponseTurn['responseModel'] | undefined {
  if (!responseModel) {
    return undefined;
  }

  const modelName = typeof responseModel.modelName === 'string' && responseModel.modelName.trim()
    ? responseModel.modelName.trim()
    : undefined;
  const modelBillingLabel = typeof responseModel.modelBillingLabel === 'string' && responseModel.modelBillingLabel.trim()
    ? responseModel.modelBillingLabel.trim()
    : undefined;
  const summaryPreview = normalizeTurnResponseSummaryPreview(responseModel.summaryPreview);

  if (!responseModel.slashCommand && !responseModel.followups && !summaryPreview && !modelName && !modelBillingLabel) {
    return undefined;
  }

  return {
    ...(responseModel.slashCommand ? { slashCommand: { ...responseModel.slashCommand } } : {}),
    ...(responseModel.followups ? { followups: responseModel.followups.map((followup: TurnResponseFollowup) => ({ ...followup })) } : {}),
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

function hasSubagentToolCallPart(turn: TurnResponseTurn | null | undefined): boolean {
  if (!turn) {
    return false;
  }

  return turn.response.parts.some((part) => {
    if (part.type !== 'tool_call') {
      return false;
    }

    const metadata = part.metadata as Record<string, unknown> | undefined;
    const toolSpecificData = metadata?.['toolSpecificData'] as Record<string, unknown> | undefined;
    return Boolean(
      metadata?.['subAgentInvocationId']
      || toolSpecificData?.['kind'] === 'subagent'
      || part.toolName === 'agent',
    );
  });
}

export function deriveExplicitAgentSummaryPreview(
  turn: TurnResponseTurn | null | undefined,
  options?: {
    allowSubagentPartFallback?: boolean;
  },
): string | undefined {
  const allowSubagentPartFallback = options?.allowSubagentPartFallback ?? false;
  const shouldInspectSummary = hasExplicitAgentInvocationRequest(turn)
    || (allowSubagentPartFallback && hasSubagentToolCallPart(turn));

  if (!turn || !shouldInspectSummary) {
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
  options?: {
    allowSubagentPartFallback?: boolean;
  },
): TurnResponseTurn {
  const summaryPreview = deriveExplicitAgentSummaryPreview(turn, options);
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