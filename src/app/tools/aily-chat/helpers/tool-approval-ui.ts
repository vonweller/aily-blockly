/**
 * Tool approval UI contracts and message formatting.
 *
 * Ownership now lives with the user-interaction layer.
 * core/index.ts re-exports these contracts directly for the remaining barrel path.
 */

import {
  buildToolInvocationDisplaySummary,
  flattenToolInvocationDisplaySummary,
} from '../core/tool-invocation-formatter';
import {
  isTerminalCommandToolName,
  normalizeReadSideToolName,
} from '../core/tool-name-normalizer';

export interface ToolApprovalRequest {
  toolCallId: string;
  toolName: string;
  title: string;
  subtitle?: string;
  message: string;
  source?: string;
  actions?: readonly ToolApprovalAction[];
  primaryScope?: ToolApprovalScope;
  allowAutoConfirm?: boolean;
  approveCombination?: ToolApprovalCombination;
  args?: any;
}

export interface ToolApprovalPresentation {
  readonly title?: string;
  readonly subtitle?: string;
  readonly message?: string;
  readonly source?: string;
  readonly actions?: readonly ToolApprovalAction[];
  readonly primaryScope?: ToolApprovalScope;
  readonly allowAutoConfirm?: boolean;
  readonly approveCombination?: ToolApprovalCombination;
  readonly args?: any;
}

export interface NormalizedToolApprovalPresentation {
  readonly title: string;
  readonly subtitle?: string;
  readonly message: string;
  readonly actions: readonly ToolApprovalAction[];
  readonly primaryScope: ToolApprovalScope;
  readonly allowAutoConfirm: boolean;
  readonly approveCombination?: ToolApprovalCombination;
  readonly args?: any;
}

export type ToolApprovalScope = 'once' | 'session' | 'workspace' | 'session-all-terminal' | 'session-safe';

export interface ToolApprovalCombination {
  readonly label: string;
  readonly key: string;
  readonly arguments?: string;
}

export interface ToolApprovalAction {
  readonly id?: string;
  readonly scope: ToolApprovalScope;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly disabled?: boolean;
  readonly isSecondary?: boolean;
  readonly resolves?: boolean;
  readonly combinationKey?: string;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason?: string;
  scope?: ToolApprovalScope;
  actionId?: string;
}

export type ToolApprovalCallback = (request: ToolApprovalRequest) => Promise<ToolApprovalResult>;

export function getToolApprovalTitle(toolName: string | undefined, fallbackTitle?: string): string {
  const normalizedToolName = normalizeReadSideToolName(toolName);

  switch (normalizedToolName) {
    case 'run_in_terminal':
      return '运行终端命令';
    case 'send_to_terminal':
      return '发送终端输入';
    case 'kill_terminal':
      return '结束终端会话';
    default:
      return fallbackTitle && !fallbackTitle.startsWith('确认执行: ')
        ? fallbackTitle
        : normalizedToolName
          ? `确认执行 ${normalizedToolName}`
          : (fallbackTitle || '确认操作');
  }
}

export function getToolApprovalSubtitle(toolName: string | undefined, source?: string): string | undefined {
  const normalizedToolName = normalizeReadSideToolName(toolName) || undefined;
  const normalizedSource = source?.trim();

  if (normalizedToolName && normalizedSource) {
    return `${normalizedToolName} · ${normalizedSource}`;
  }

  return normalizedToolName || normalizedSource || undefined;
}

export function getToolApprovalActions(toolName: string | undefined): readonly ToolApprovalAction[] {
  if (isTerminalCommandToolName(toolName)) {
      return [
        {
          id: 'session',
          scope: 'session',
          label: '在当前对话中自动运行此命令',
          description: '后续相同命令将直接运行，不再重复询问。',
          tooltip: '记住这条命令，并在当前对话中自动运行。',
        },
        {
          id: 'workspace',
          scope: 'workspace',
          label: '在当前工作区中自动运行此命令',
          description: '把这条命令加入工作区级 allow list。',
          tooltip: '把这条命令写入当前工作区规则。',
        },
        {
          id: 'session-all-terminal',
          scope: 'session-all-terminal',
          label: '允许当前对话中的所有终端命令',
          description: '后续 terminal 命令在本对话中直接运行。',
          tooltip: '当前对话中的后续终端命令将不再逐条确认。',
          isSecondary: true,
        },
      ];
  }

  return [
    {
      id: 'session',
      scope: 'session',
      label: '在当前对话中自动运行此工具',
      description: '同一工具的后续请求将不再重复询问。',
      tooltip: '当前对话中的同类工具请求将自动执行。',
    },
    {
      id: 'workspace',
      scope: 'workspace',
      label: '在当前工作区中自动运行此工具',
      description: '把此工具加入当前工作区级 permission rule。',
      tooltip: '当前工作区中的同类工具请求将自动执行。',
    },
  ];
}

function buildApprovalFallbackDetail(
  toolName: string | undefined,
  args: any,
  metadata?: Record<string, unknown> | null,
): string | undefined {
  if (!toolName) {
    return undefined;
  }

  return flattenToolInvocationDisplaySummary(buildToolInvocationDisplaySummary({
    toolName,
    args,
    metadata,
  }));
}

function coalesceNonEmptyString(primary: string | undefined, fallback: string | undefined): string | undefined {
  return typeof primary === 'string' && primary.trim().length > 0 ? primary : fallback;
}

function buildApproveCombinationActions(
  combination: ToolApprovalCombination | undefined,
): readonly ToolApprovalAction[] {
  if (!combination) {
    return [];
  }

  const argumentSummary = typeof combination.arguments === 'string' && combination.arguments.trim().length > 0
    ? `\n参数：${combination.arguments.trim()}`
    : '';

  return [
    {
      id: 'combination:session',
      scope: 'session',
      label: `在当前对话中允许“${combination.label}”`,
      description: '仅记住这组工具与参数的组合，不影响该工具的其他调用。',
      tooltip: `在当前对话中自动允许此工具与参数组合。${argumentSummary}`,
      combinationKey: combination.key,
    },
    {
      id: 'combination:workspace',
      scope: 'workspace',
      label: `在当前工作区中允许“${combination.label}”`,
      description: '把这组工具与参数组合写入当前工作区规则。',
      tooltip: `在当前工作区中自动允许此工具与参数组合。${argumentSummary}`,
      combinationKey: combination.key,
    },
  ];
}

export function generateApprovalMessage(
  toolName: string | undefined,
  args: any,
  metadata?: Record<string, unknown> | null,
): { title: string; message: string } {
  const normalizedToolName = normalizeReadSideToolName(toolName);

  switch (normalizedToolName) {
    case 'run_in_terminal':
      return {
        title: getToolApprovalTitle(normalizedToolName),
        message: `即将运行终端命令：\n${args?.command || '(未知命令)'}${args?.goal ? '\n目标：' + args.goal : ''}`,
      };
    case 'send_to_terminal':
      return {
        title: getToolApprovalTitle(normalizedToolName),
        message: `即将向终端发送输入：\n${args?.command || '(空输入 / 回车)'}`,
      };
    case 'kill_terminal':
      return {
        title: getToolApprovalTitle(normalizedToolName),
        message: `即将结束终端会话：${args?.id || args?.terminalId || '(未知终端)'}`,
      };
    default:
      {
        const title = getToolApprovalTitle(normalizedToolName);
        const detail = buildApprovalFallbackDetail(normalizedToolName, args, metadata);
        return {
          title,
          message: detail
            ? `即将执行工具 ${normalizedToolName || '(未知工具)'}：\n${detail}`
            : normalizedToolName
              ? `即将执行工具 ${normalizedToolName}，请确认是否继续。`
              : '即将执行工具操作，请确认是否继续。',
        };
      }
  }
}

export function normalizeToolApprovalPresentation(input: {
  toolName?: string;
  source?: string;
  title?: string;
  subtitle?: string;
  message?: string;
  actions?: readonly ToolApprovalAction[];
  primaryScope?: ToolApprovalScope;
  allowAutoConfirm?: boolean;
  approveCombination?: ToolApprovalCombination;
  args?: any;
  metadata?: Record<string, unknown> | null;
}): NormalizedToolApprovalPresentation {
  const normalizedToolName = normalizeReadSideToolName(input.toolName);
  const fallback = generateApprovalMessage(normalizedToolName, input.args, input.metadata);
  const allowAutoConfirm = input.allowAutoConfirm !== false;
  const defaultActions = allowAutoConfirm ? getToolApprovalActions(normalizedToolName) : [];
  const combinationActions = allowAutoConfirm ? buildApproveCombinationActions(input.approveCombination) : [];

  return {
    title: coalesceNonEmptyString(input.title, fallback.title) || fallback.title,
    subtitle: coalesceNonEmptyString(input.subtitle, getToolApprovalSubtitle(normalizedToolName, input.source)),
    message: coalesceNonEmptyString(input.message, fallback.message) || fallback.message,
    actions: input.actions ?? [...combinationActions, ...defaultActions],
    primaryScope: input.primaryScope ?? 'once',
    allowAutoConfirm,
    approveCombination: input.approveCombination,
    args: input.args,
  };
}

export function normalizeToolApprovalRequest(input: ToolApprovalRequest): ToolApprovalRequest {
  const normalizedToolName = normalizeReadSideToolName(input.toolName);
  const normalized = normalizeToolApprovalPresentation({
    toolName: normalizedToolName,
    source: input.source,
    title: input.title,
    subtitle: input.subtitle,
    message: input.message,
    actions: input.actions,
    primaryScope: input.primaryScope,
    allowAutoConfirm: input.allowAutoConfirm,
    approveCombination: input.approveCombination,
    args: input.args,
  });

  return {
    ...input,
    toolName: normalizedToolName,
    title: normalized.title,
    subtitle: normalized.subtitle,
    message: normalized.message,
    actions: normalized.actions,
    primaryScope: normalized.primaryScope,
    allowAutoConfirm: normalized.allowAutoConfirm,
    approveCombination: normalized.approveCombination,
    args: normalized.args,
  };
}