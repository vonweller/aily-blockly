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

import type { IChatContext } from '../core/chat-context';
import { AilyHost } from '../core/host';
import { generateApprovalMessage } from './tool-approval-ui';
import type { ToolApprovalRequest, ToolApprovalResult } from './tool-approval-ui';
import type { AskUserQuestion, AskUserFullResponse, AskUserAnswer } from '../core/ask-user';
import type { QuestionItem } from '../core/chat-parts';
import { AILY_CHAT_ONBOARDING_CONFIG } from '../../../configs/onboarding.config';

export class UserInteractionHelper {

  // ==================== 内部状态 ====================

  /** ask_user 工具的 Promise resolve 回调（等待用户在聊天界面输入） */
  _resolveAskUser: ((response: AskUserFullResponse | undefined) => void) | null = null;
  /** 当前 ask_user 的问题列表（用于事件回调时组装答案） */
  private _askUserQuestions: AskUserQuestion[] | null = null;

  /** 工具审批 Promise resolve 回调（等待用户在聊天界面确认） */
  _resolveToolApproval: ((result: ToolApprovalResult) => void) | null = null;

  constructor(private ctx: IChatContext) {}

  /** 清理内部状态（由 engine.destroy() 调用） */
  destroy(): void {
    this._resolveAskUser = null;
    this._askUserQuestions = null;
    this._resolveToolApproval = null;
  }

  // ==================== ask_user 交互处理 ====================

  /**
   * ask_user 工具的 UI 层回调。
   * 在聊天界面显示全部问题，等待用户逐题回答后 resolve 完整结果。
   */
  handleAskUser(questions: AskUserQuestion[]): Promise<AskUserFullResponse | undefined> {
    return new Promise<AskUserFullResponse | undefined>((resolve) => {
      this._askUserQuestions = questions;

      this.ctx.lexStream.ui.presentQuestion(this.toQuestionItems(questions));

      this._resolveAskUser = resolve;

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || !this._resolveAskUser) return;
        document.removeEventListener('aily-question-answer', handler);

        // 将用户回答写回 QuestionPart，后续持久化时再序列化为历史内容
        if (detail.answers) {
          this.ctx.lexStream.ui.updateQuestionAnswers(detail.answers);
        }

        const resolveRef = this._resolveAskUser;
        this._resolveAskUser = null;
        this._askUserQuestions = null;
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
      this._resolveAskUser = null;

      const q = this._askUserQuestions[0];
      const questionKey = q?.question || 'unknown';
      const ans: AskUserAnswer = wasFreeform
        ? { selected: [], freeText: answer, skipped: false }
        : { selected: [answer], freeText: null, skipped: false };
      this._askUserQuestions = null;
      resolve({ answers: { [questionKey]: ans } });
    }
  }

  /**
   * 用户跳过/取消 ask_user 问题。
   */
  skipAskUserResponse(): void {
    if (this._resolveAskUser) {
      const resolve = this._resolveAskUser;
      this._resolveAskUser = null;
      this._askUserQuestions = null;
      resolve(undefined);
    }
  }

  // ==================== 工具审批交互处理 ====================

  /**
   * lex ApprovalHandler 桥接：将 lex 的审批请求转为 blockly UI 审批流程。
  * 由 LexOwnerFacade 在 createAgent 时作为 approvalHandler 传入。
   */
  async handleToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
  ): Promise<{ approved: true } | { approved: false; reason?: string }> {
    const toolCallId = `approval-${Date.now()}`;
    const { title, message } = generateApprovalMessage(toolName, input as any);
    const result = await this._handleToolApproval({
      toolCallId,
      toolName,
      title,
      message: `${message}\n(${reason})`,
    });
    return result.approved
      ? { approved: true }
      : { approved: false, reason: result.reason };
  }

  /**
   * 工具审批的 UI 层回调。
   */
  private _handleToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> {
    return new Promise<ToolApprovalResult>((resolve) => {
      this._resolveToolApproval = resolve;

      this.ctx.lexStream.ui.presentApproval(request.toolCallId, request.message, request.toolName);

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || !this._resolveToolApproval) return;
        if (detail.toolCallId && detail.toolCallId !== request.toolCallId) return;

        document.removeEventListener('aily-approval-result', handler);

  this.ctx.lexStream.ui.resolveApproval(request.toolCallId, !!detail.approved, detail.scope);

        const resolveRef = this._resolveToolApproval;
        this._resolveToolApproval = null;
        resolveRef({
          approved: !!detail.approved,
          reason: detail.reason || (detail.approved ? undefined : '用户拒绝执行'),
          scope: detail.scope || 'once'
        });
      };
      document.addEventListener('aily-approval-result', handler);
    });
  }

  /**
   * 外部调用：用户批准工具执行。
   */
  approveToolExecution(toolCallId: string, scope: 'once' | 'session' | 'session-safe' = 'once'): void {
    if (this._resolveToolApproval) {
      document.dispatchEvent(new CustomEvent('aily-approval-result', {
        detail: { toolCallId, approved: true, scope }
      }));
    }
  }

  /**
   * 外部调用：用户拒绝工具执行。
   */
  rejectToolExecution(toolCallId: string, reason?: string): void {
    if (this._resolveToolApproval) {
      document.dispatchEvent(new CustomEvent('aily-approval-result', {
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
