/**
 * ChatPart — Part-based 消息模型类型定义
 *
 * Phase 1: ThinkingPart + ToolCallPart（最大性能收益）
 * Phase 2: QuestionPart + ApprovalPart + TerminalPart（新渲染能力）
 *
 * 设计原则：
 *   - 每个 Part 是不可变快照（更新通过 store 重建）
 *   - discriminated union 通过 `type` 分发
 *   - 与现有 ChatMessage.content string 并行运行（双轨模式）
 */

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
  kind?: 'task_graph' | 'task_scheduler' | 'task_autonomy' | 'agent_team' | 'mcp' | 'background_task' | 'instructions';
  /** 轻量元数据，供持久化/恢复使用 */
  metadata?: Record<string, unknown>;
}

/** 错误 Part */
export interface ErrorPart {
  type: 'error';
  message: string;
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
  /** 问题列表 */
  questions: QuestionItem[];
  /** 用户回答（提交后填入） */
  answers?: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }>;
  /** 是否来自历史记录 */
  isHistory?: boolean;
}

/** 工具审批 Part — 替代 aily-approval / aily-ask-confirm markdown 代码块 */
export interface ApprovalPart {
  type: 'approval';
  /** 审批请求 ID */
  askId: string;
  /** 工具名称 */
  toolName?: string;
  /** 审批消息 */
  message: string;
  /** 消息来源 */
  source?: string;
  /** 是否已决定 */
  resolved: boolean;
  /** 结果：同意或拒绝 */
  result?: 'approved' | 'rejected';
  /** 批准范围（一次 / 会话 / 会话安全） */
  scope?: 'once' | 'session' | 'session-safe';
}

/** 终端命令输出 Part — Phase 2 新渲染能力 */
export interface TerminalPart {
  type: 'terminal';
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
}

/** 子Agent 内部的结构化子项 */
export interface SubagentChildItem {
  /** 子项类型：thinking=思考, tool=工具调用, text=文本输出 */
  kind: 'thinking' | 'tool' | 'text';
  /** 内容（thinking 文本 / markdown 文本） */
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

/** 子Agent Part — 内联可折叠（VS Code 风格） */
export interface SubagentPart {
  type: 'subagent';
  /** 工具调用 ID */
  toolCallId: string;
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
}

// ==================== 联合类型 ====================

/** 支持的 Part 类型联合 */
export type ChatPart =
  | MarkdownPart | ThinkingPart | ToolCallPart | StatePart | ErrorPart
  | QuestionPart | ApprovalPart | TerminalPart | SubagentPart;

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
  return { type: 'tool_call', toolCallId, toolName, text, state, args, metadata };
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
export function mkError(message: string): ErrorPart {
  return { type: 'error', message };
}

/** 创建 QuestionPart */
export function mkQuestion(questions: QuestionItem[], isHistory?: boolean): QuestionPart {
  return { type: 'question', questions, isHistory };
}

/** 创建 ApprovalPart */
export function mkApproval(askId: string, message: string, toolName?: string, source?: string): ApprovalPart {
  return { type: 'approval', askId, message, toolName, source, resolved: false };
}

/** 创建 TerminalPart */
export function mkTerminal(command: string, toolCallId?: string): TerminalPart {
  return { type: 'terminal', command, output: '', isRunning: true, toolCallId };
}

/** 创建 SubagentPart */
export function mkSubagent(
  toolCallId: string,
  agentName: string,
  description: string,
  metadata?: Record<string, unknown>,
): SubagentPart {
  return { type: 'subagent', toolCallId, agentName, description, state: 'doing', resultText: '', childItems: [], metadata };
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
