import type { ToolCallPart } from './chat-parts';
import {
  generateApprovalMessage,
  getToolApprovalActions,
  getToolApprovalSubtitle,
  getToolApprovalTitle,
  type ToolApprovalAction,
  type ToolApprovalScope,
} from '../helpers/tool-approval-ui';

export interface ToolCallApprovalMetadata {
  toolCallId?: string;
  toolName?: string;
  previousText?: string;
  message?: string;
  description?: string;
  source?: string;
  title?: string;
  subtitle?: string;
  actions?: readonly ToolApprovalAction[];
  primaryScope?: ToolApprovalScope;
  args?: any;
  resolved?: boolean;
  result?: 'approved' | 'rejected';
  scope?: ToolApprovalScope;
}

export interface ToolCallApprovalDisplayData {
  toolCallId: string;
  toolName?: string;
  title: string;
  subtitle?: string;
  message: string;
  description?: string;
  args?: any;
  resolved?: boolean;
  approved?: boolean;
  scope?: ToolApprovalScope;
  actions: readonly ToolApprovalAction[];
  primaryScope: ToolApprovalScope;
}

export function buildPendingToolCallApprovalMetadata(input: {
  toolCallId: string;
  toolName?: string;
  message?: string;
  description?: string;
  source?: string;
  title?: string;
  subtitle?: string;
  actions?: readonly ToolApprovalAction[];
  primaryScope?: ToolApprovalScope;
  args?: any;
}): ToolCallApprovalMetadata {
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    message: input.message,
    description: input.description,
    source: input.source,
    title: input.title,
    subtitle: input.subtitle,
    actions: input.actions?.map(action => ({ ...action })) || [],
    primaryScope: input.primaryScope,
    args: input.args,
    resolved: false,
  };
}

export function buildResolvedToolCallApprovalMetadata(input: {
  toolCallId: string;
  result: 'approved' | 'rejected';
  scope?: ToolApprovalScope;
}): ToolCallApprovalMetadata {
  return {
    toolCallId: input.toolCallId,
    resolved: true,
    result: input.result,
    scope: input.scope,
  };
}

export function getToolCallApprovalMetadata(part: Pick<ToolCallPart, 'metadata'>): ToolCallApprovalMetadata | undefined {
  const metadata = asRecord(part.metadata);
  return asApprovalRecord(metadata?.['approval'])
    || asApprovalRecord(metadata?.['approvalRequest'])
    || undefined;
}

export function projectToolCallApprovalDisplayData(
  part: Pick<ToolCallPart, 'toolCallId' | 'toolName' | 'state' | 'args' | 'metadata'>,
): ToolCallApprovalDisplayData | undefined {
  const approval = getToolCallApprovalMetadata(part);
  if (!approval && part.state !== 'pending_approval') {
    return undefined;
  }

  const metadata = asRecord(part.metadata) || {};
  const source = asString(approval?.source) || asString(metadata['source']);
  const fallback = generateApprovalMessage(part.toolName, approval?.args ?? part.args);

  return {
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    title: asString(approval?.title) || getToolApprovalTitle(part.toolName, fallback.title),
    subtitle: asString(approval?.subtitle) || getToolApprovalSubtitle(part.toolName, source),
    message: asString(approval?.message) || fallback.message,
    description: asString(approval?.description),
    args: approval?.args ?? part.args,
    resolved: approval?.resolved === true,
    approved: approval?.result === 'approved',
    scope: asApprovalScope(approval?.scope),
    actions: approval?.actions?.length ? approval.actions : getToolApprovalActions(part.toolName),
    primaryScope: asApprovalScope(approval?.primaryScope) || 'once',
  };
}

function asApprovalRecord(value: unknown): ToolCallApprovalMetadata | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    toolCallId: asString(record['toolCallId']),
    toolName: asString(record['toolName']),
    message: asString(record['message']),
    description: asString(record['description']),
    source: asString(record['source']),
    title: asString(record['title']),
    subtitle: asString(record['subtitle']),
    actions: asApprovalActions(record['actions']),
    primaryScope: asApprovalScope(record['primaryScope']),
    args: record['args'],
    resolved: record['resolved'] === true,
    result: record['result'] === 'approved' || record['result'] === 'rejected'
      ? record['result']
      : undefined,
    scope: asApprovalScope(record['scope']),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asApprovalActions(value: unknown): readonly ToolApprovalAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map(item => asRecord(item))
    .filter((item): item is Record<string, unknown> => !!item)
    .filter(item => typeof item['scope'] === 'string' && typeof item['label'] === 'string')
    .map(item => ({
      scope: item['scope'] as ToolApprovalScope,
      label: item['label'] as string,
      description: asString(item['description']),
      tooltip: asString(item['tooltip']),
      disabled: item['disabled'] === true,
      isSecondary: item['isSecondary'] === true,
    }));
}

function asApprovalScope(value: unknown): ToolApprovalScope | undefined {
  if (value === 'once'
    || value === 'session'
    || value === 'workspace'
    || value === 'session-all-terminal'
    || value === 'session-safe') {
    return value;
  }
  return undefined;
}