/**
 * UserInteractionHelper — 用户交互辅助类
 *
 * 封装所有需要用户在聊天界面确认/回答的交互操作：
 * - ask_user 工具：显示问题 → 等待用户回答 → resolve Promise
 * - 工具审批：显示审批请求 → 等待用户批准/拒绝 → resolve Promise
 * - 新手引导：首次使用时的 onboarding 流程
 *
 * 从 ChatEngineService 中提取（Phase 4），减轻后者的体积。
 */

import type { IChatCoordination, IProjectContext, ISessionAccess } from '../core/chat-context';
import { AilyHost } from '../core/host';
import { generateApprovalMessage } from './tool-approval-ui';
import type { ToolApprovalRequest, ToolApprovalResult, ToolApprovalScope } from './tool-approval-ui';
import type { AskUserQuestion, AskUserFullResponse, AskUserAnswer } from '../core/ask-user';
import type { QuestionItem } from '../core/chat-parts';
import { AILY_CHAT_ONBOARDING_CONFIG } from '../../../configs/onboarding.config';
import type { AilyChatConfigService } from '../services/aily-chat-config.service';
import { AILY_CONFIRMATION_RESULT_EVENT } from './interaction-events';

type UserInteractionContext = Pick<IChatCoordination, 'lexStream'>
  & Pick<IProjectContext, 'isLoggedIn' | 'getCurrentProjectPath'>
  & Pick<ISessionAccess, 'sessionId'>
  & {
    readonly ailyChatConfigService: Pick<
      AilyChatConfigService,
      'terminalAllowList' | 'save' | 'hasWorkspaceToolApprovalRule' | 'addWorkspaceToolApprovalRule'
    >;
  };

const TERMINAL_APPROVAL_TOOL_NAMES = new Set(['run_in_terminal', 'run_terminal']);

function isTerminalApprovalTool(toolName: string): boolean {
  return TERMINAL_APPROVAL_TOOL_NAMES.has(toolName);
}

function escapeRegExpCharacters(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTerminalCommand(command: unknown): string {
  return typeof command === 'string' ? command.trim() : '';
}

function buildExactTerminalRule(command: string): string {
  return `/^${escapeRegExpCharacters(command)}$/`;
}

function compileTerminalPermissionRule(rule: string): RegExp | undefined {
  const trimmed = rule.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }

  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0) {
    return undefined;
  }

  try {
    return new RegExp(trimmed.slice(1, lastSlash), trimmed.slice(lastSlash + 1));
  } catch {
    return undefined;
  }
}

function matchesTerminalPermissionRule(command: string, rule: string): boolean {
  const normalizedRule = rule.trim();
  if (!normalizedRule) {
    return false;
  }

  const regex = compileTerminalPermissionRule(normalizedRule);
  if (regex) {
    return regex.test(command);
  }

  return command === normalizedRule
    || command.startsWith(`${normalizedRule} `);
}

function matchesTerminalPermissionList(command: string, rules: readonly string[]): boolean {
  return rules.some((rule) => matchesTerminalPermissionRule(command, rule));
}

export class UserInteractionHelper {
  // ==================== 内部状态 ====================

  /** ask_user 工具的 Promise resolve 回调（等待用户在聊天界面输入） */
  _resolveAskUser: ((response: AskUserFullResponse | undefined) => void) | null = null;
  /** 当前 ask_user 的问题列表（用于事件回调时组装答案） */
  private _askUserQuestions: AskUserQuestion[] | null = null;
  /** 当前 ask_user 对应的 canonical question partId */
  private _askUserQuestionPartId: string | null = null;

  /** 工具审批 Promise resolve 回调（等待用户在聊天界面确认） */
  _resolveToolApproval: ((result: ToolApprovalResult) => void) | null = null;

  private _approvalSessionId: string | null = null;
  private readonly _sessionApprovedTools = new Set<string>();
  private readonly _sessionApprovedTerminalCommands = new Set<string>();
  private _sessionAllowAllTerminalCommands = false;

  constructor(private ctx: UserInteractionContext) {}

  /** 清理内部状态（由 engine.destroy() 调用） */
  destroy(): void {
    this._resolveAskUser = null;
    this._askUserQuestions = null;
    this._askUserQuestionPartId = null;
    this._resolveToolApproval = null;
    this.resetApprovalSessionState();
  }

  /** 显式重置当前运行中的 session 级审批缓存。 */
  resetApprovalState(): void {
    this._resolveToolApproval = null;
    this.resetApprovalSessionState();
  }

  // ==================== ask_user 交互处理 ====================

  /**
   * ask_user 工具的 UI 层回调。
   * 在聊天界面显示全部问题，等待用户逐题回答后 resolve 完整结果。
   */
  handleAskUser(questions: AskUserQuestion[]): Promise<AskUserFullResponse | undefined> {
    return new Promise<AskUserFullResponse | undefined>((resolve) => {
      this._askUserQuestions = questions;
      this._askUserQuestionPartId = this.ctx.lexStream.ui.presentQuestion(this.toQuestionItems(questions));

      this._resolveAskUser = resolve;

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || !this._resolveAskUser) return;
        document.removeEventListener('aily-question-answer', handler);

        // 将用户回答写回 QuestionPart，后续持久化时再序列化为历史内容
        if (detail.answers) {
          const partId = typeof detail.partId === 'string' && detail.partId.trim().length > 0
            ? detail.partId
            : this._askUserQuestionPartId;
          if (!partId) {
            throw new Error('ask_user answer event is missing question partId.');
          }
          this.ctx.lexStream.ui.updateQuestionAnswers(detail.answers, partId);
        }

        const resolveRef = this._resolveAskUser;
        this._resolveAskUser = null;
        this._askUserQuestions = null;
        this._askUserQuestionPartId = null;
        resolveRef(detail as AskUserFullResponse);
      };
      document.addEventListener('aily-question-answer', handler);
    });
  }

  /**
   * ★ Phase 3: 为 ask_user 创建原生 QuestionPart
   */
  private toQuestionItems(questions: AskUserQuestion[]): QuestionItem[] {
    return questions.map(q => ({
      question: q.question,
      options: q.options?.map(o => ({
        label: o.label,
        description: o.description,
        recommended: o.recommended,
      })),
      allow_freeform: q.allow_freeform,
      multi_select: q.multi_select,
    }));
  }

  /**
   * 用户在聊天界面回答 ask_user 问题后调用此方法（兼容外部调用）。
   */
  resolveAskUserResponse(answer: string, wasFreeform: boolean): void {
    if (this._resolveAskUser && this._askUserQuestions) {
      const resolve = this._resolveAskUser;
      const partId = this._askUserQuestionPartId;
      this._resolveAskUser = null;

      const q = this._askUserQuestions[0];
      const questionKey = q?.question || 'unknown';
      const ans: AskUserAnswer = wasFreeform
        ? { selected: [], freeText: answer, skipped: false }
        : { selected: [answer], freeText: null, skipped: false };
      if (!partId) {
        throw new Error('resolveAskUserResponse requires an active question partId.');
      }
      this.ctx.lexStream.ui.updateQuestionAnswers({ [questionKey]: ans }, partId);
      this._askUserQuestions = null;
      this._askUserQuestionPartId = null;
      resolve({ answers: { [questionKey]: ans } });
    }
  }

  /**
   * 用户跳过/取消 ask_user 问题。
   */
  skipAskUserResponse(): void {
    if (this._resolveAskUser && this._askUserQuestions) {
      const resolve = this._resolveAskUser;
      const questions = this._askUserQuestions;
      const partId = this._askUserQuestionPartId;
      this._resolveAskUser = null;
      this._askUserQuestions = null;
      this._askUserQuestionPartId = null;
      const answers = Object.fromEntries(questions.map((question) => [question.question, {
        selected: [],
        freeText: null,
        skipped: true,
      } satisfies AskUserAnswer]));
      if (!partId) {
        throw new Error('skipAskUserResponse requires an active question partId.');
      }
      this.ctx.lexStream.ui.updateQuestionAnswers(answers, partId);
      resolve({ answers });
    }
  }

  // ==================== 工具审批交互处理 ====================

  /**
   * lex ApprovalHandler 桥接：将 lex 的审批请求转为 blockly UI 审批流程。
  * 由 LexOwnerFacade 在 createAgent 时作为 approvalHandler 传入。
   */
  async handleToolApproval(
    request: ToolApprovalRequest,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    const toolName = request.toolName;
    const input = request.args && typeof request.args === 'object'
      ? request.args as Record<string, unknown>
      : {};
    this.ensureApprovalSessionState();
    if (this.shouldAutoApprove(toolName, input)) {
      return { approved: true };
    }

    const fallback = generateApprovalMessage(toolName, input as any);
    const result = await this._handleToolApproval({
      toolCallId: request.toolCallId,
      toolName,
      title: request.title || fallback.title,
      subtitle: request.subtitle,
      source: request.source,
      actions: request.actions,
      primaryScope: request.primaryScope,
      message: request.message || fallback.message,
      args: input,
    });
    if (result.approved) {
      this.rememberApproval(toolName, input, result.scope ?? 'once');
    }
    return result.approved
      ? { approved: true }
      : { approved: false, reason: result.reason };
  }

  private ensureApprovalSessionState(): void {
    const sessionId = typeof this.ctx.sessionId === 'string' ? this.ctx.sessionId : '';
    if (this._approvalSessionId === sessionId) {
      return;
    }

    this.resetApprovalSessionState();
    this._approvalSessionId = sessionId;
  }

  private resetApprovalSessionState(): void {
    this._approvalSessionId = null;
    this._sessionApprovedTools.clear();
    this._sessionApprovedTerminalCommands.clear();
    this._sessionAllowAllTerminalCommands = false;
  }

  private shouldAutoApprove(toolName: string, input: Record<string, unknown>): boolean {
    if (isTerminalApprovalTool(toolName)) {
      if (this._sessionAllowAllTerminalCommands) {
        return true;
      }

      const command = normalizeTerminalCommand(input['command']);
      if (!command) {
        return false;
      }

      if (matchesTerminalPermissionList(command, [...this._sessionApprovedTerminalCommands])) {
        return true;
      }

      return matchesTerminalPermissionList(command, this.ctx.ailyChatConfigService.terminalAllowList ?? []);
    }

    return this._sessionApprovedTools.has(toolName)
      || this.ctx.ailyChatConfigService.hasWorkspaceToolApprovalRule(this.ctx.getCurrentProjectPath(), toolName);
  }

  private rememberApproval(toolName: string, input: Record<string, unknown>, scope: ToolApprovalScope): void {
    const normalizedScope = scope === 'session-safe' ? 'session-all-terminal' : scope;

    if (normalizedScope === 'once') {
      return;
    }

    if (isTerminalApprovalTool(toolName)) {
      const command = normalizeTerminalCommand(input['command']);
      if (normalizedScope === 'session-all-terminal') {
        this._sessionAllowAllTerminalCommands = true;
        return;
      }

      if (!command) {
        return;
      }

      const exactRule = buildExactTerminalRule(command);
      this._sessionApprovedTerminalCommands.add(exactRule);

      if (normalizedScope === 'workspace') {
        const currentAllowList = this.ctx.ailyChatConfigService.terminalAllowList ?? [];
        if (!currentAllowList.includes(exactRule)) {
          this.ctx.ailyChatConfigService.terminalAllowList = [...currentAllowList, exactRule];
          this.ctx.ailyChatConfigService.save();
        }
      }
      return;
    }

    if (normalizedScope === 'session') {
      this._sessionApprovedTools.add(toolName);
      return;
    }

    if (normalizedScope === 'workspace'
      && this.ctx.ailyChatConfigService.addWorkspaceToolApprovalRule(this.ctx.getCurrentProjectPath(), toolName)) {
      this.ctx.ailyChatConfigService.save();
    }
  }

  /**
   * 工具审批的 UI 层回调。
   */
  private _handleToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> {
    return new Promise<ToolApprovalResult>((resolve) => {
      this.ctx.lexStream.ui.presentToolCallApproval(request);

      this._resolveToolApproval = resolve;

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || !this._resolveToolApproval) return;
        if (detail.toolCallId !== request.toolCallId) return;

        document.removeEventListener(AILY_CONFIRMATION_RESULT_EVENT, handler);

        this.ctx.lexStream.ui.resolveToolCallApproval(request.toolCallId, !!detail.approved, detail.scope);

        const resolveRef = this._resolveToolApproval;
        this._resolveToolApproval = null;
        resolveRef({
          approved: !!detail.approved,
          reason: detail.reason || (detail.approved ? undefined : '用户拒绝执行'),
          scope: detail.scope || 'once'
        });
      };
      document.addEventListener(AILY_CONFIRMATION_RESULT_EVENT, handler);
    });
  }

  /**
   * 外部调用：用户批准工具执行。
   */
  approveToolExecution(toolCallId: string, scope: ToolApprovalScope = 'once'): void {
    if (this._resolveToolApproval) {
      document.dispatchEvent(new CustomEvent(AILY_CONFIRMATION_RESULT_EVENT, {
        detail: { toolCallId, approved: true, scope }
      }));
    }
  }

  /**
   * 外部调用：用户拒绝工具执行。
   */
  rejectToolExecution(toolCallId: string, reason?: string): void {
    if (this._resolveToolApproval) {
      document.dispatchEvent(new CustomEvent(AILY_CONFIRMATION_RESULT_EVENT, {
        detail: { toolCallId, approved: false, reason: reason || '用户拒绝执行' }
      }));
    }
  }

  // ==================== 新手引导 ====================

  checkFirstUsage(): void {
    const hasSeenOnboarding = AilyHost.get().config.data?.ailyChatOnboardingCompleted;
    if (!hasSeenOnboarding && this.ctx.isLoggedIn) {
      setTimeout(() => {
        AilyHost.get().onboarding?.start(AILY_CHAT_ONBOARDING_CONFIG, {
          onClosed: () => this._onOnboardingClosed(),
          onCompleted: () => this._onOnboardingClosed()
        });
      }, 500);
    }
  }

  private _onOnboardingClosed(): void {
    AilyHost.get().config.data.ailyChatOnboardingCompleted = true;
    AilyHost.get().config.save?.();
  }
}
