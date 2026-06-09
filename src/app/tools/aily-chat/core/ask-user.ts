/**
 * ask_user 类型定义与回调注册
 *
 * 从 askUserTool.ts 提取的纯逻辑部分：
 * - 类型定义（供 UI 组件使用）
 * - 全局回调注册（供 ChatEngineService / lex 桥接使用）
 * - askUserSingle（供 lex IAskUserExtension 桥接使用）
 */

// ============================
// 类型定义
// ============================

/** 单个选项（富信息） */
export interface AskUserOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

/** 问题定义 */
export interface AskUserQuestion {
  question: string;
  options?: AskUserOption[];
  allow_freeform?: boolean;
  multi_select?: boolean;
}

/** 工具入参 */
export interface AskUserArgs {
  questions: AskUserQuestion[];
}

/** 单个问题的回答 */
export interface AskUserAnswer {
  selected: string[];
  freeText: string | null;
  skipped: boolean;
}

/** 全部问题的回答 */
export interface AskUserFullResponse {
  answers: Record<string, AskUserAnswer>;
}

export interface AskUserBridgeResponse {
  answer: string;
  cancelled: boolean;
  fullResponse?: AskUserFullResponse;
}

/** 兼容旧回调的单问题应答 */
export interface AskUserResponse {
  answer: string;
  wasFreeform: boolean;
}

// ============================
// 全局回调注册
// ============================

type AskUserFullCallback = (questions: AskUserQuestion[]) => Promise<AskUserFullResponse | undefined>;

let _registeredCallback: AskUserFullCallback | null = null;

/**
 * 注册用户交互回调。由 UI 层（ChatEngineService）初始化时调用。
 * 回调负责在聊天界面显示全部问题和选项，等待用户逐题回答后返回完整结果。
 */
export function registerAskUserCallback(cb: AskUserFullCallback): void {
  _registeredCallback = cb;
}

/**
 * 取消注册回调（组件销毁时调用）
 */
export function unregisterAskUserCallback(): void {
  _registeredCallback = null;
}

// ============================
// 单问题桥接（供 lex IAskUserExtension 使用）
// ============================

/**
 * 向用户提一个问题并返回原始应答。
 * 由 lex 引擎的 ask_user 核心工具通过 IAskUserExtension.ask() 桥接调用。
 */
export async function askUserSingle(
  question: string,
  options?: { label: string; description?: string; recommended?: boolean }[],
  multiSelect?: boolean,
  allowFreeform = true,
): Promise<AskUserBridgeResponse> {
  const q: AskUserQuestion = {
    question,
    options: options?.map(o => ({ label: o.label, description: o.description, recommended: o.recommended })),
    multi_select: multiSelect,
    allow_freeform: allowFreeform,
  };

  return askUserMany([q]);
}

export async function askUserMany(
  questions: AskUserQuestion[],
): Promise<AskUserBridgeResponse> {
  if (_registeredCallback) {
    const response = await _registeredCallback(questions);
    if (!response) return { answer: '', cancelled: true };

    const parts: string[] = [];
    for (const question of questions) {
      const ans = response.answers[question.question];
      if (!ans || ans.skipped) {
        return { answer: '', cancelled: true };
      }

      if (ans.selected.length) parts.push(ans.selected.join(', '));
      if (ans.freeText) parts.push(ans.freeText);
    }

    return { answer: parts.join('\n'), cancelled: false, fullResponse: response };
  }

  // 降级：window.prompt
  if (typeof window !== 'undefined') {
    const firstQuestion = questions[0]?.question || '';
    const result = window.prompt(firstQuestion);
    return result === null
      ? { answer: '', cancelled: true }
      : { answer: result, cancelled: false };
  }
  return { answer: '', cancelled: true };
}
