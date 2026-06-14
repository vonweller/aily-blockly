/**
 * ChatPart — Part-based 消息模型类型定义
 *
 * Phase 1: ThinkingPart + ToolCallPart（最大性能收益）
 * Phase 2: QuestionPart + ConfirmationPart + TerminalPart（新渲染能力）
 *
 * 设计原则：
 *   - 每个 Part 是不可变快照（更新通过 store 重建）
 *   - discriminated union 通过 `type` 分发
 *   - 与现有 ChatMessage.content string 并行运行（双轨模式）
 */

import { normalizeToolApprovalPresentation, type ToolApprovalAction, type ToolApprovalScope } from '../helpers/tool-approval-ui';

// ==================== Phase 1 Part 类型 ====================

/** Markdown 文本 Part（收集 think/tool 之外的普通文本） */
export interface MarkdownPart {
  type: 'markdown';
  /** 累积的 markdown 文本 */
  content: string;
}

/** 思考过程 Part — 替代 filterThinkTags + think-content-store */
export interface ThinkingPart {
  type: 'thinking';
  /** 思考内容原始文本 */
  content: string;
  /** 是否已完成（未闭合的 think 块为 false） */
  isComplete: boolean;
}

/** 工具调用 Part — 替代 filterToolCalls + aily-state 代码块 */
export interface ToolCallPart {
  type: 'tool_call';
  /** 稳定 part identity，用于 turn-native 持久化与恢复 */
  partId?: string;
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 显示文本 */
  text: string;
  /** 工具调用参数 */
  args?: any;
  /** 调用状态 */
  state: 'doing' | 'done' | 'warn' | 'error' | 'pending_approval';
  /** 轻量元数据，供 restore/viewer 扩展使用 */
  metadata?: Record<string, unknown>;
}

/** 通用状态 Part — 承载任务图/调度/自治/协作团队等宿主状态 */
export interface StatePart {
  type: 'state';
  /** 状态项 ID（用于同一 turn 内增量更新） */
  stateId: string;
  /** 显示文本 */
  text: string;
  /** 状态样式 */
  state: 'doing' | 'done' | 'warn' | 'error' | 'info';
  /** 可选进度百分比 */
  progress?: number;
  /** 事件类型 */
  kind?: 'task_graph' | 'task_scheduler' | 'task_autonomy' | 'agent_team' | 'mcp' | 'background_task' | 'instructions' | 'compaction' | 'provider_context_management' | 'handoff' | 'todo';
  /** 轻量元数据，供持久化/恢复使用 */
  metadata?: Record<string, unknown>;
}

/** 错误 Part */
export interface ErrorPart {
  type: 'error';
  message: string;
  severity?: 'error' | 'warning' | 'info';
  metadata?: Record<string, unknown>;
}

// ==================== Phase 2 Part 类型 ====================

/** 问题选项 */
export interface QuestionOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

/** 单个问题定义 */
export interface QuestionItem {
  question: string;
  options?: QuestionOption[];
  allow_freeform?: boolean;
  multi_select?: boolean;
}

/** 用户提问 Part — 替代 aily-question markdown 代码块 */
export interface QuestionPart {
  type: 'question';
  /** 稳定 part identity，优先绑定 ask_user requestId */
  partId?: string;
  /** 问题列表 */
  questions: QuestionItem[];
  /** 用户回答（提交后填入） */
  answers?: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }>;
  /** 是否来自历史记录 */
  isHistory?: boolean;
}

/** 通用确认 Part — 对齐 Copilot standalone confirmation part 语义。 */
export interface ConfirmationPart {
  type: 'confirmation';
  /** 稳定 part identity，绑定 generic confirmation requestId */
  partId?: string;
  /** 确认请求 ID */
  askId: string;
  /** 可选工具名称，仅用于展示来源 */
  toolName?: string;
  /** UI 标题 */
  title: string;
  /** UI 副标题（工具 ID / 来源） */
  subtitle?: string;
  /** 确认消息 */
  message: string;
  /** 附加详情，通常用于展示 diff 预览或补充说明。 */
  description?: string;
  /** 原始参数，供 viewer 做结构化展示 */
  args?: any;
  /** 消息来源 */
  source?: string;
  /** 可选动作列表 */
  actions: readonly ToolApprovalAction[];
  /** 主按钮对应的 scope */
  primaryScope: ToolApprovalScope;
  /** 是否已决定 */
  resolved: boolean;
  /** 结果：同意或拒绝 */
  result?: 'approved' | 'rejected';
  /** 可选范围（若 host 需要额外记住本次选择） */
  scope?: ToolApprovalScope;
}

/** 终端命令输出 Part — Phase 2 新渲染能力 */
export interface TerminalPart {
  type: 'terminal';
  /** 稳定 part identity，优先绑定命令会话身份 */
  partId?: string;
  /** 执行的命令 */
  command: string;
  /** 终端输出（累积） */
  output: string;
  /** 标准错误输出 */
  stderr?: string;
  /** 退出码 */
  exitCode?: number;
  /** 是否正在运行 */
  isRunning: boolean;
  /** 关联的工具调用 ID */
  toolCallId?: string;
  /** 触发/更新该命令会话的工具调用 ID 列表 */
  sourceToolCallIds?: string[];
  /** 命令进程 ID */
  processId?: string;
  /** 长输出会话 ID */
  outputSessionId?: string;
  /** 兼容旧终端 ID 或宿主终端 ID */
  terminalId?: string;
  /** 长输出文件路径 */
  outputFilePath?: string;
  /** 命令工作目录 */
  cwd?: string;
  /** 宿主返回的命令状态 */
  status?: string;
  /** 当前已记录输出字节数 */
  bytesTotal?: number;
  /** 最近输出时间 */
  lastOutputAt?: string;
  /** 输出更新语义：delta 追加，snapshot 替换当前窗口。 */
  outputUpdateKind?: 'delta' | 'snapshot';
}

export interface TerminalPartOptions {
  processId?: string;
  outputSessionId?: string;
  terminalId?: string;
  outputFilePath?: string;
  cwd?: string;
  status?: string;
  bytesTotal?: number;
  lastOutputAt?: string;
  sourceToolCallIds?: string[];
  outputUpdateKind?: 'delta' | 'snapshot';
}

/** 子Agent 内部的结构化子项 */
export interface SubagentChildItem {
  /** 子项类型：thinking=思考, tool=工具调用, text=文本输出, question=子代理提问 */
  kind: 'thinking' | 'tool' | 'text' | 'question';
  /** 内容（thinking 文本 / markdown 文本 / question 文本） */
  content: string;
  /** 工具名称（仅 kind='tool'） */
  toolName?: string;
  /** 工具调用ID（仅 kind='tool'） */
  toolCallId?: string;
  /** 工具参数摘要（仅 kind='tool'） */
  argsSummary?: string;
  /** 工具执行状态（仅 kind='tool'） */
  state?: 'doing' | 'done' | 'error';
  /** 工具执行耗时，秒（仅 kind='tool', state='done'|'error'） */
  duration?: number;
}

/** 子Agent tool_call metadata 的临时投影视图 */
export interface SubagentToolCallSnapshot {
  /** 工具调用 ID */
  toolCallId: string;
  /** Grouping id for one subagent invocation. */
  subAgentInvocationId?: string;
  /** 子Agent 名称（如 'Explore', 'Plan'） */
  agentName: string;
  /** 任务简述 */
  description: string;
  /** 执行状态 */
  state: 'doing' | 'done' | 'error';
  /** 子Agent 返回的结果文本（兼容/序列化用） */
  resultText: string;
  /** 结构化子项（流式期间实时填充） */
  childItems?: SubagentChildItem[];
  /** 轻量元数据，供 restore/viewer 扩展使用 */
  metadata?: Record<string, unknown>;
  /** 子工具起始时间缓存，仅 bridge 内部维护 */
  _toolTimers?: Record<string, unknown>;
}

// ==================== 联合类型 ====================

/** 支持的 Part 类型联合 */
export type ChatPart =
  | MarkdownPart | ThinkingPart | ToolCallPart | StatePart | ErrorPart
  | QuestionPart | ConfirmationPart | TerminalPart;

// ==================== Part 辅助函数 ====================

/** 创建 MarkdownPart */
export function mkMarkdown(content: string): MarkdownPart {
  return { type: 'markdown', content };
}

/** 创建 ThinkingPart */
export function mkThinking(content: string, isComplete: boolean): ThinkingPart {
  return { type: 'thinking', content, isComplete };
}

/** 创建 ToolCallPart */
export function mkToolCall(
  toolCallId: string, toolName: string, text: string,
  state: ToolCallPart['state'], args?: any, metadata?: Record<string, unknown>,
): ToolCallPart {
  return {
    type: 'tool_call',
    partId: buildToolCallPartId(toolCallId),
    toolCallId,
    toolName,
    text,
    state,
    args,
    metadata,
  };
}

/** 创建 StatePart */
export function mkState(
  stateId: string,
  text: string,
  state: StatePart['state'],
  kind?: StatePart['kind'],
  progress?: number,
  metadata?: Record<string, unknown>,
): StatePart {
  return { type: 'state', stateId, text, state, kind, progress, metadata };
}

/** 创建 ErrorPart */
export function mkError(
  message: string,
  severity: ErrorPart['severity'] = 'error',
  metadata?: Record<string, unknown>,
): ErrorPart {
  return { type: 'error', message, severity, metadata };
}

/** 创建 QuestionPart */
export function mkQuestion(questions: QuestionItem[], isHistory?: boolean, requestId?: string): QuestionPart {
  return {
    type: 'question',
    partId: buildQuestionPartId(questions, requestId),
    questions,
    isHistory,
  };
}

/** 创建 ConfirmationPart */
export function mkConfirmation(
  askId: string,
  message: string,
  toolName?: string,
  source?: string,
  presentation?: Partial<Pick<ConfirmationPart, 'title' | 'subtitle' | 'description' | 'actions' | 'primaryScope' | 'args'>>,
): ConfirmationPart {
  const normalized = normalizeToolApprovalPresentation({
    toolName,
    source,
    title: presentation?.title,
    subtitle: presentation?.subtitle,
    message,
    actions: presentation?.actions,
    primaryScope: presentation?.primaryScope,
    args: presentation?.args,
  });
  return {
    type: 'confirmation',
    partId: buildConfirmationPartId(askId),
    askId,
    message: normalized.message,
    description: presentation?.description,
    args: normalized.args,
    toolName,
    title: normalized.title,
    subtitle: normalized.subtitle,
    source,
    actions: normalized.actions,
    primaryScope: normalized.primaryScope,
    resolved: false,
  };
}

/** 创建 TerminalPart */
export function mkTerminal(
  command: string,
  toolCallId?: string,
  partId?: string,
  options: TerminalPartOptions = {},
): TerminalPart {
  const sessionId = getTerminalSessionId(options);
  const sourceToolCallIds = uniqueStrings([
    ...(toolCallId ? [toolCallId] : []),
    ...(options.sourceToolCallIds ?? []),
  ]);
  return {
    type: 'terminal',
    partId: partId ?? buildTerminalPartId(command, toolCallId, sessionId),
    command,
    output: '',
    isRunning: true,
    toolCallId,
    ...(sourceToolCallIds.length > 0 ? { sourceToolCallIds } : {}),
    ...(options.processId ? { processId: options.processId } : {}),
    ...(options.outputSessionId ? { outputSessionId: options.outputSessionId } : {}),
    ...(options.terminalId ? { terminalId: options.terminalId } : {}),
    ...(options.outputFilePath ? { outputFilePath: options.outputFilePath } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(typeof options.bytesTotal === 'number' ? { bytesTotal: options.bytesTotal } : {}),
    ...(options.lastOutputAt ? { lastOutputAt: options.lastOutputAt } : {}),
    ...(options.outputUpdateKind ? { outputUpdateKind: options.outputUpdateKind } : {}),
  };
}

function normalizeQuestionIdentitySeed(questions: readonly QuestionItem[]): string {
  return questions
    .map(question => question.question.trim())
    .filter(question => question.length > 0)
    .join('|') || 'unknown';
}

export function buildToolCallPartId(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

export function buildQuestionPartId(questions: readonly QuestionItem[], requestId?: string): string {
  return requestId && requestId.trim().length > 0
    ? `question:${requestId}`
    : `question:${normalizeQuestionIdentitySeed(questions)}`;
}

export function buildConfirmationPartId(askId: string): string {
  return `confirmation:${askId}`;
}

export function buildTerminalPartId(command: string, toolCallId?: string, sessionId?: string): string {
  return sessionId && sessionId.trim().length > 0
    ? `terminal-session:${sessionId.trim()}`
    : toolCallId && toolCallId.trim().length > 0
    ? `terminal:${toolCallId}`
    : `terminal:${command.trim() || 'unknown'}`;
}

function getTerminalSessionId(options: Pick<TerminalPartOptions, 'processId' | 'outputSessionId' | 'terminalId'>): string | undefined {
  return asString(options.processId) || asString(options.outputSessionId) || asString(options.terminalId);
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return Array.from(new Set(values.map(value => asString(value)).filter((value): value is string => !!value)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
      .map(item => asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item)
      .map(item => ({ ...item }))
    : [];
}

function cloneSubagentChildItems(childItems: readonly SubagentChildItem[] | undefined): SubagentChildItem[] {
  return Array.isArray(childItems)
    ? childItems.map(item => ({ ...item }))
    : [];
}

function subagentStateToToolState(state: SubagentToolCallSnapshot['state']): ToolCallPart['state'] {
  return state === 'error' ? 'error' : state === 'done' ? 'done' : 'doing';
}

function subagentStateToNarrativePhase(state: SubagentToolCallSnapshot['state']): 'started' | 'completed' | 'failed' {
  return state === 'error' ? 'failed' : state === 'done' ? 'completed' : 'started';
}

export function mkSubagentTimelineEntry(entry: {
  recordId?: string;
  phase: 'started' | 'progress' | 'completed' | 'failed';
  summary?: string;
  resultText?: string;
  progress?: number;
  progressDetails?: Record<string, unknown>;
  timestamp?: number;
}): Record<string, unknown> {
  return {
    recordId: entry.recordId,
    phase: entry.phase,
    summary: entry.summary,
    resultText: entry.resultText,
    progress: entry.progress,
    progressDetails: entry.progressDetails,
    ...(typeof entry.timestamp === 'number' ? { timestamp: entry.timestamp } : {}),
  };
}

export function isSubagentToolCallMetadata(metadata: unknown): metadata is Record<string, unknown> {
  const record = asRecord(metadata);
  if (!record) {
    return false;
  }

  if (typeof record['subAgentInvocationId'] === 'string') {
    return true;
  }

  const toolSpecificData = asRecord(record['toolSpecificData']);
  return !!toolSpecificData && (
    typeof toolSpecificData['agentName'] === 'string'
    || typeof toolSpecificData['description'] === 'string'
  );
}

export function toolCallPartToSubagentSnapshot(part: ToolCallPart): SubagentToolCallSnapshot | null {
  if (!isSubagentToolCallMetadata(part.metadata)) {
    return null;
  }

  const metadata = asRecord(part.metadata) ?? {};
  const toolSpecificData = asRecord(metadata['toolSpecificData']) ?? {};
  const childItems = Array.isArray(toolSpecificData['childItems'])
    ? (toolSpecificData['childItems'] as unknown[])
      .map(item => asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item)
      .map(item => ({
        kind: (item['kind'] as SubagentChildItem['kind']) || 'text',
        content: asString(item['content']) || '',
        toolName: asString(item['toolName']),
        toolCallId: asString(item['toolCallId']),
        argsSummary: asString(item['argsSummary']),
        state: item['state'] as SubagentChildItem['state'],
        duration: typeof item['duration'] === 'number' ? item['duration'] : undefined,
      }))
    : [];

  return {
    toolCallId: part.toolCallId,
    subAgentInvocationId: asString(metadata['subAgentInvocationId']) || part.toolCallId,
    agentName: asString(toolSpecificData['agentName']) || part.toolName || 'Agent',
    description: asString(toolSpecificData['description'])
      || asString(metadata['argsSummary'])
      || asString(metadata['invocationMessage'])
      || asString(metadata['pastTenseMessage'])
      || part.toolName
      || 'Agent',
    state: part.state === 'error' ? 'error' : part.state === 'doing' ? 'doing' : 'done',
    resultText: asString(toolSpecificData['result']) || '',
    childItems,
    metadata,
    _toolTimers: asRecord(toolSpecificData['_toolTimers']),
  };
}

export function subagentSnapshotToToolCall(part: SubagentToolCallSnapshot, existing?: ToolCallPart): ToolCallPart {
  const existingMetadata = asRecord(existing?.metadata) ?? {};
  const partMetadata = asRecord(part.metadata) ?? {};
  const existingToolSpecificData = asRecord(existingMetadata['toolSpecificData']) ?? {};
  const partToolSpecificData = asRecord(partMetadata['toolSpecificData']) ?? {};
  const partTimeline = asRecordArray(partMetadata['timeline']);
  const existingTimeline = asRecordArray(existingMetadata['timeline']);
  const timeline = partTimeline.length > 0
    ? partTimeline
    : existingTimeline.length > 0
      ? existingTimeline
      : [mkSubagentTimelineEntry({
        recordId: `${part.toolCallId}:${part.state}`,
        phase: subagentStateToNarrativePhase(part.state),
        summary: part.description || part.agentName,
        resultText: part.resultText || undefined,
      })];

  return {
    type: 'tool_call',
    partId: existing?.partId || buildToolCallPartId(part.toolCallId),
    toolCallId: part.toolCallId,
    toolName: existing?.toolName || 'agent',
    text: existing?.text || part.description || part.agentName,
    state: subagentStateToToolState(part.state),
    args: existing?.args ?? {
      agentName: part.agentName,
      description: part.description,
    },
    metadata: {
      ...existingMetadata,
      ...partMetadata,
      toolName: asString(partMetadata['toolName']) || asString(existingMetadata['toolName']) || existing?.toolName || 'agent',
      phase: subagentStateToNarrativePhase(part.state),
      argsSummary: part.description || asString(partMetadata['argsSummary']) || asString(existingMetadata['argsSummary']),
      recordId: part.toolCallId,
      subAgentInvocationId: part.subAgentInvocationId || part.toolCallId,
      invocationMessage: asString(partMetadata['invocationMessage']) || asString(existingMetadata['invocationMessage']) || part.description || part.agentName,
      pastTenseMessage: asString(partMetadata['pastTenseMessage']) || asString(existingMetadata['pastTenseMessage']) || (part.description ? `Completed Task: "${part.description}"` : part.agentName),
      timeline,
      toolSpecificData: {
        ...existingToolSpecificData,
        ...partToolSpecificData,
        kind: 'subagent',
        agentName: part.agentName,
        description: part.description,
        result: part.resultText,
        childItems: cloneSubagentChildItems(part.childItems),
        _toolTimers: part._toolTimers,
      },
    },
  };
}

export function mkSubagentToolCall(
  toolCallId: string,
  agentName: string,
  description: string,
  metadata?: Record<string, unknown>,
): ToolCallPart {
  const initialMetadata = asRecord(metadata) ?? {};
  const timeline = asRecordArray(initialMetadata['timeline']);

  return subagentSnapshotToToolCall({
    toolCallId,
    agentName,
    description,
    state: 'doing',
    resultText: '',
    childItems: [],
    metadata: {
      ...initialMetadata,
      timeline: timeline.length > 0
        ? timeline
        : [mkSubagentTimelineEntry({
          recordId: `${toolCallId}:started`,
          phase: 'started',
          summary: description || agentName,
        })],
    },
  });
}

// ==================== Part-based 消息扩展 ====================

/**
 * 带 Parts 的消息接口 — 扩展 ChatMessage
 * Phase 1 中仅新消息（通过 lex-stream 产生）会携带 parts，
 * 历史消息和 stream-processor 消息仍为 content-only。
 */
export interface ChatMessageWithParts {
  role: string;
  content: string;
  state: 'doing' | 'done';
  source?: string;
  modelName?: string;
  /** Part-based 渲染数据（仅 lex-stream 路径产生） */
  parts?: ChatPart[];
}
