import { Injectable, signal } from '@angular/core';

import type { AskUserAnswer, AskUserFullResponse, AskUserQuestion, AskUserPresentationContext } from '../core/ask-user';
import { AilyHost } from '../core/host';
import type { IFileWatchHandle } from '../core/host-api';
import type { ToolApprovalAction, ToolApprovalRequest, ToolApprovalScope } from '../helpers/tool-approval-ui';
import { resolveBlocklyArtifactReferenceTarget } from '../helpers/chat-artifact-reference';
import { notifyAwaitingUserFeedbackIfBackground } from '../helpers/user-feedback-notify.helper';
import {
  stopBlocklyCommandSession,
  type BlocklyCommandSessionSnapshot,
} from '../helpers/lex-agent-bootstrap';

export interface RuntimeQuestionWidgetState {
  readonly sessionId: string;
  readonly partId: string;
  readonly context?: AskUserPresentationContext;
  readonly data: {
    partId: string;
    isHistory: false;
    questions: AskUserQuestion[];
    answers?: Record<string, AskUserAnswer>;
  };
}

export interface RuntimeConfirmationDecision {
  readonly approved: boolean;
  readonly scope?: ToolApprovalScope;
  readonly reason?: string;
  readonly actionId?: string;
  readonly sideEffectOnly?: boolean;
}

export interface RuntimeConfirmationWidgetState {
  readonly sessionId: string;
  readonly id: string;
  readonly kind: 'approval' | 'confirmation';
  readonly partId: string;
  readonly askId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly data: {
    kind: 'approval' | 'confirmation';
    partId: string;
    askId?: string;
    toolCallId?: string;
    toolName?: string;
    title: string;
    subtitle?: string;
    message: string;
    args?: Record<string, unknown>;
    actions: readonly ToolApprovalAction[];
    primaryScope: ToolApprovalScope;
    primaryLabel?: string;
    primaryTooltip?: string;
    rejectLabel?: string;
    rejectTooltip?: string;
    resolved?: boolean;
    approved?: boolean;
    scope?: ToolApprovalScope;
  };
}

export interface RuntimePlanReviewAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly default?: boolean;
  readonly permissionLevel?: 'autopilot';
}

export interface RuntimePlanReviewDecision {
  readonly approved: boolean;
  readonly actionId?: string;
  readonly feedback?: string;
}

export interface RuntimePlanReviewWidgetState {
  readonly sessionId: string;
  readonly id: string;
  readonly data: {
    title: string;
    planUri?: string;
    content: string;
    actions: readonly RuntimePlanReviewAction[];
    canProvideFeedback: boolean;
    resolved?: boolean;
    approved?: boolean;
    actionId?: string;
    feedback?: string;
  };
}

export type RuntimeCommandSessionActionId = 'continue_background' | 'stop';

export interface RuntimeCommandSessionActionRequest {
  readonly actionId: RuntimeCommandSessionActionId;
  readonly processId: string;
  readonly outputSessionId?: string;
  readonly outputFilePath?: string;
}

export interface RuntimeCommandSessionActionResult {
  readonly ok: boolean;
  readonly actionId: RuntimeCommandSessionActionId;
  readonly processId: string;
  readonly snapshot?: BlocklyCommandSessionSnapshot;
  readonly error?: string;
}

type QuestionRuntimeEntry = RuntimeQuestionWidgetState & {
  readonly resolve: (result: AskUserFullResponse | undefined) => void;
};

type ConfirmationRuntimeEntry = RuntimeConfirmationWidgetState & {
  readonly resolve: (result: RuntimeConfirmationDecision) => void;
  readonly onAction?: (actionId: string) => void;
};

type PlanReviewRuntimeEntry = RuntimePlanReviewWidgetState & {
  readonly resolve: (result: RuntimePlanReviewDecision) => void;
};

interface PlanReviewFileSyncState {
  readonly id: string;
  readonly absolutePath: string;
  readonly handle?: IFileWatchHandle | void;
}

@Injectable()
export class ChatRuntimeInteractionHostService {
  private readonly _questionEntries = signal<Record<string, QuestionRuntimeEntry | undefined>>({});
  private readonly _confirmationEntries = signal<Record<string, readonly ConfirmationRuntimeEntry[] | undefined>>({});
  private readonly _confirmationActiveIndices = signal<Record<string, number | undefined>>({});
  private readonly _planReviewEntries = signal<Record<string, PlanReviewRuntimeEntry | undefined>>({});
  private readonly _planReviewFileSyncs = new Map<string, PlanReviewFileSyncState>();
  private readonly _backgroundCommandSessions = new Set<string>();

  async requestCommandSessionAction(
    sessionId: string,
    request: RuntimeCommandSessionActionRequest,
  ): Promise<RuntimeCommandSessionActionResult> {
    const processId = request.processId?.trim();
    if (!processId) {
      return {
        ok: false,
        actionId: request.actionId,
        processId: '',
        error: '缺少命令进程 ID',
      };
    }

    if (request.actionId === 'continue_background') {
      this.markCommandSessionBackground(sessionId, processId);
      return { ok: true, actionId: request.actionId, processId };
    }

    if (request.actionId === 'stop') {
      const snapshot = await stopBlocklyCommandSession(processId, { yieldTimeMs: 250 });
      this.clearCommandSessionBackground(sessionId, processId);
      return snapshot
        ? { ok: true, actionId: request.actionId, processId, snapshot }
        : {
            ok: false,
            actionId: request.actionId,
            processId,
            error: `未找到命令进程：${processId}`,
          };
    }

    return {
      ok: false,
      actionId: request.actionId,
      processId,
      error: `不支持的命令会话操作：${request.actionId}`,
    };
  }

  markCommandSessionBackground(sessionId: string, processId: string): void {
    const key = this.getCommandSessionDisplayKey(sessionId, processId);
    if (key) {
      this._backgroundCommandSessions.add(key);
    }
  }

  clearCommandSessionBackground(sessionId: string, processId: string): void {
    const key = this.getCommandSessionDisplayKey(sessionId, processId);
    if (key) {
      this._backgroundCommandSessions.delete(key);
    }
  }

  isCommandSessionBackground(sessionId: string, processId: string | undefined): boolean {
    const key = this.getCommandSessionDisplayKey(sessionId, processId);
    return !!key && this._backgroundCommandSessions.has(key);
  }

  private getCommandSessionDisplayKey(sessionId: string, processId: string | undefined): string | null {
    const normalizedProcessId = processId?.trim();
    if (!normalizedProcessId) {
      return null;
    }
    return `${sessionId || 'default'}::${normalizedProcessId}`;
  }

  getQuestionWidget(sessionId: string): RuntimeQuestionWidgetState | null {
    return this._questionEntries()[sessionId] ?? null;
  }

  presentQuestion(
    sessionId: string,
    partId: string,
    questions: AskUserQuestion[],
    context?: AskUserPresentationContext,
  ): Promise<AskUserFullResponse | undefined> {
    this.clearQuestion(sessionId);

    return new Promise<AskUserFullResponse | undefined>((resolve) => {
      const current = this._questionEntries();
      this._questionEntries.set({
        ...current,
        [sessionId]: {
          sessionId,
          partId,
          context,
          resolve,
          data: {
            partId,
            isHistory: false,
            questions,
          },
        },
      });
      notifyAwaitingUserFeedbackIfBackground('Aily', '有问题需要你回答');
    });
  }

  completeQuestion(sessionId: string, result: AskUserFullResponse | undefined): void {
    const entry = this._questionEntries()[sessionId];
    if (!entry) {
      return;
    }

    entry.resolve(result);
    this.deleteQuestionEntry(sessionId);
  }

  resolveQuestionCompat(sessionId: string, answer: string, wasFreeform: boolean): void {
    const entry = this._questionEntries()[sessionId];
    if (!entry) {
      throw new Error('resolveAskUserResponse requires an active question partId.');
    }

    const firstQuestion = entry.data.questions[0];
    const questionKey = firstQuestion?.question || 'unknown';
    const answerRecord: AskUserAnswer = wasFreeform
      ? { selected: [], freeText: answer, skipped: false }
      : { selected: [answer], freeText: null, skipped: false };

    this.completeQuestion(sessionId, {
      answers: {
        [questionKey]: answerRecord,
      },
    });
  }

  skipQuestion(sessionId: string): void {
    const entry = this._questionEntries()[sessionId];
    if (!entry) {
      throw new Error('skipAskUserResponse requires an active question partId.');
    }

    const answers = Object.fromEntries(entry.data.questions.map((question) => [question.question, {
      selected: [],
      freeText: null,
      skipped: true,
    } satisfies AskUserAnswer]));

    this.completeQuestion(sessionId, { answers });
  }

  clearQuestion(sessionId: string): void {
    const entry = this._questionEntries()[sessionId];
    if (!entry) {
      return;
    }

    entry.resolve(undefined);
    this.deleteQuestionEntry(sessionId);
  }

  getConfirmationQueue(sessionId: string): readonly RuntimeConfirmationWidgetState[] {
    return this._confirmationEntries()[sessionId] ?? [];
  }

  getActiveConfirmationIndex(sessionId: string): number {
    const queue = this.getConfirmationQueue(sessionId);
    if (queue.length === 0) {
      return 0;
    }

    const rawIndex = this._confirmationActiveIndices()[sessionId] ?? 0;
    return Math.max(0, Math.min(rawIndex, queue.length - 1));
  }

  getActiveConfirmation(sessionId: string): RuntimeConfirmationWidgetState | null {
    const queue = this.getConfirmationQueue(sessionId);
    if (queue.length === 0) {
      return null;
    }

    return queue[this.getActiveConfirmationIndex(sessionId)] ?? null;
  }

  getActivePlanReview(sessionId: string): RuntimePlanReviewWidgetState | null {
    return this._planReviewEntries()[sessionId] ?? null;
  }

  navigateConfirmation(sessionId: string, delta: number): void {
    const queue = this.getConfirmationQueue(sessionId);
    if (queue.length <= 1) {
      return;
    }

    const nextIndex = (this.getActiveConfirmationIndex(sessionId) + delta + queue.length) % queue.length;
    this._confirmationActiveIndices.set({
      ...this._confirmationActiveIndices(),
      [sessionId]: nextIndex,
    });
  }

  presentToolApproval(sessionId: string, request: ToolApprovalRequest): Promise<RuntimeConfirmationDecision> {
    const actions = Array.isArray(request.actions) ? request.actions : [];
    const primaryScope = request.primaryScope ?? 'once';

    return this.enqueueConfirmation(sessionId, {
      sessionId,
      id: request.toolCallId,
      kind: 'approval',
      partId: request.toolCallId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      data: {
        kind: 'approval',
        partId: request.toolCallId,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        title: request.title || '确认操作',
        subtitle: request.subtitle,
        message: request.message,
        args: request.args,
        actions,
        primaryScope,
      },
    });
  }

  presentConfirmation(
    sessionId: string,
    confirmation: {
      askId: string;
      partId: string;
      toolName?: string;
      title: string;
      subtitle?: string;
      message: string;
      args?: Record<string, unknown>;
      actions: readonly ToolApprovalAction[];
      primaryScope: ToolApprovalScope;
      primaryLabel?: string;
      primaryTooltip?: string;
      rejectLabel?: string;
      rejectTooltip?: string;
      onAction?: (actionId: string) => void;
    },
  ): Promise<RuntimeConfirmationDecision> {
    return this.enqueueConfirmation(sessionId, {
      sessionId,
      id: confirmation.partId,
      kind: 'confirmation',
      partId: confirmation.partId,
      askId: confirmation.askId,
      toolName: confirmation.toolName,
      data: {
        kind: 'confirmation',
        partId: confirmation.partId,
        askId: confirmation.askId,
        toolName: confirmation.toolName,
        title: confirmation.title,
        subtitle: confirmation.subtitle,
        message: confirmation.message,
        args: confirmation.args,
        actions: confirmation.actions,
        primaryScope: confirmation.primaryScope,
        primaryLabel: confirmation.primaryLabel,
        primaryTooltip: confirmation.primaryTooltip,
        rejectLabel: confirmation.rejectLabel,
        rejectTooltip: confirmation.rejectTooltip,
      },
      onAction: confirmation.onAction,
    });
  }

  presentPlanReview(
    sessionId: string,
    review: {
      id: string;
      title: string;
      planUri?: string;
      content: string;
      actions: readonly RuntimePlanReviewAction[];
      canProvideFeedback: boolean;
    },
  ): Promise<RuntimePlanReviewDecision> {
    this.clearPlanReview(sessionId);
    const content = this.resolvePlanReviewContentFromFile(sessionId, review.planUri, review.content);

    return new Promise<RuntimePlanReviewDecision>((resolve) => {
      const current = this._planReviewEntries();
      this._planReviewEntries.set({
        ...current,
        [sessionId]: {
          sessionId,
          id: review.id,
          data: {
            title: review.title,
            planUri: review.planUri,
            content,
            actions: review.actions,
            canProvideFeedback: review.canProvideFeedback,
          },
          resolve,
        },
      });

      this.installPlanReviewFileSync(sessionId, review.id, review.planUri);
      notifyAwaitingUserFeedbackIfBackground('Aily', '计划已生成，等待你的审核');
    });
  }

  triggerConfirmationAction(sessionId: string, id: string, actionId: string): void {
    const queue = this._confirmationEntries()[sessionId];
    if (!queue || queue.length === 0) {
      return;
    }

    const target = queue.find(entry => entry.id === id);
    target?.onAction?.(actionId);
  }

  approveActiveConfirmation(sessionId: string, scope: ToolApprovalScope, actionId?: string): void {
    const active = this.getActiveConfirmation(sessionId);
    if (!active) {
      return;
    }

    this.resolveConfirmation(sessionId, active.id, {
      approved: true,
      scope,
      actionId,
    });
  }

  rejectActiveConfirmation(sessionId: string, reason = '用户拒绝执行'): void {
    const active = this.getActiveConfirmation(sessionId);
    if (!active) {
      return;
    }

    this.resolveConfirmation(sessionId, active.id, {
      approved: false,
      reason,
    });
  }

  resolveToolApproval(sessionId: string, toolCallId: string, result: RuntimeConfirmationDecision): void {
    this.resolveConfirmation(sessionId, toolCallId, result);
  }

  resolveConfirmation(sessionId: string, id: string, result: RuntimeConfirmationDecision): void {
    const queue = this._confirmationEntries()[sessionId];
    if (!queue || queue.length === 0) {
      return;
    }

    const targetIndex = queue.findIndex((entry) => entry.id === id);
    if (targetIndex < 0) {
      return;
    }

    const target = queue[targetIndex];
    target.resolve(result);

    const nextQueue = queue.filter((entry) => entry.id !== id);
    const nextQueues = { ...this._confirmationEntries() };
    if (nextQueue.length === 0) {
      delete nextQueues[sessionId];
    } else {
      nextQueues[sessionId] = nextQueue;
    }
    this._confirmationEntries.set(nextQueues);

    const nextIndices = { ...this._confirmationActiveIndices() };
    if (nextQueue.length === 0) {
      delete nextIndices[sessionId];
    } else {
      const currentIndex = this.getActiveConfirmationIndex(sessionId);
      nextIndices[sessionId] = Math.max(0, Math.min(currentIndex, nextQueue.length - 1));
    }
    this._confirmationActiveIndices.set(nextIndices);
  }

  clearConfirmations(sessionId: string): void {
    const queue = this._confirmationEntries()[sessionId];
    if (!queue || queue.length === 0) {
      return;
    }

    for (const entry of queue) {
      entry.resolve({ approved: false, reason: '用户拒绝执行' });
    }

    const nextQueues = { ...this._confirmationEntries() };
    delete nextQueues[sessionId];
    this._confirmationEntries.set(nextQueues);

    const nextIndices = { ...this._confirmationActiveIndices() };
    delete nextIndices[sessionId];
    this._confirmationActiveIndices.set(nextIndices);
  }

  resolvePlanReview(sessionId: string, id: string, result: RuntimePlanReviewDecision): void {
    const entry = this._planReviewEntries()[sessionId];
    if (!entry || entry.id !== id) {
      return;
    }

    entry.resolve(result);
    this.deletePlanReviewEntry(sessionId);
  }

  clearPlanReview(sessionId: string): void {
    const entry = this._planReviewEntries()[sessionId];
    if (!entry) {
      return;
    }

    entry.resolve({ approved: false });
    this.deletePlanReviewEntry(sessionId);
  }

  private enqueueConfirmation(
    sessionId: string,
    entry: RuntimeConfirmationWidgetState & { onAction?: (actionId: string) => void },
  ): Promise<RuntimeConfirmationDecision> {
    return new Promise<RuntimeConfirmationDecision>((resolve) => {
      const currentQueues = this._confirmationEntries();
      const currentQueue = currentQueues[sessionId] ?? [];
      const isNewEntry = !currentQueue.some((item) => item.id === entry.id);
      const nextQueue = currentQueue.filter((item) => item.id !== entry.id).concat({
        ...entry,
        resolve,
      });

      this._confirmationEntries.set({
        ...currentQueues,
        [sessionId]: nextQueue,
      });

      this._confirmationActiveIndices.set({
        ...this._confirmationActiveIndices(),
        [sessionId]: nextQueue.length - 1,
      });

      if (isNewEntry) {
        notifyAwaitingUserFeedbackIfBackground(
          'Aily',
          entry.kind === 'approval' ? '有操作需要你确认' : '需要你完成一项确认',
        );
      }
    });
  }

  private deleteQuestionEntry(sessionId: string): void {
    const current = { ...this._questionEntries() };
    delete current[sessionId];
    this._questionEntries.set(current);
  }

  private deletePlanReviewEntry(sessionId: string): void {
    this.disposePlanReviewFileSync(sessionId);
    const current = { ...this._planReviewEntries() };
    delete current[sessionId];
    this._planReviewEntries.set(current);
  }

  private installPlanReviewFileSync(sessionId: string, id: string, planUri: string | undefined): void {
    this.disposePlanReviewFileSync(sessionId);

    const absolutePath = this.resolvePlanReviewAbsolutePath(sessionId, planUri);
    if (!absolutePath) {
      return;
    }

    const host = AilyHost.get();
    if (typeof host.fs?.watch !== 'function') {
      this._planReviewFileSyncs.set(sessionId, { id, absolutePath });
      return;
    }

    try {
      const handle = host.fs.watch(
        absolutePath,
        () => {
          this.refreshPlanReviewContentFromFile(sessionId, id, absolutePath);
        },
        { persistent: false },
      );
      this._planReviewFileSyncs.set(sessionId, { id, absolutePath, handle });
    } catch {
      this._planReviewFileSyncs.set(sessionId, { id, absolutePath });
    }
  }

  private disposePlanReviewFileSync(sessionId: string): void {
    const existing = this._planReviewFileSyncs.get(sessionId);
    if (!existing) {
      return;
    }

    const handle = existing.handle;
    if (handle) {
      handle.close?.();
      handle.dispose?.();
      handle.unsubscribe?.();
    }
    this._planReviewFileSyncs.delete(sessionId);
  }

  private refreshPlanReviewContentFromFile(sessionId: string, id: string, absolutePath: string): void {
    const syncState = this._planReviewFileSyncs.get(sessionId);
    if (!syncState || syncState.id !== id || syncState.absolutePath !== absolutePath) {
      return;
    }

    const nextContent = this.readPlanReviewFileContent(absolutePath);
    if (nextContent === undefined) {
      return;
    }

    const entry = this._planReviewEntries()[sessionId];
    if (!entry || entry.id !== id || entry.data.content === nextContent) {
      return;
    }

    const currentEntries = this._planReviewEntries();
    this._planReviewEntries.set({
      ...currentEntries,
      [sessionId]: {
        ...entry,
        data: {
          ...entry.data,
          content: nextContent,
        },
      },
    });
  }

  private resolvePlanReviewContentFromFile(
    sessionId: string,
    planUri: string | undefined,
    fallbackContent: string,
  ): string {
    const absolutePath = this.resolvePlanReviewAbsolutePath(sessionId, planUri);
    if (!absolutePath) {
      return fallbackContent;
    }

    return this.readPlanReviewFileContent(absolutePath) ?? fallbackContent;
  }

  private resolvePlanReviewAbsolutePath(sessionId: string, planUri: string | undefined): string | undefined {
    if (!planUri) {
      return undefined;
    }

    const host = AilyHost.get();
    const cwd = host.project?.currentProjectPath || host.project?.projectRootPath;
    return resolveBlocklyArtifactReferenceTarget(host, planUri, { cwd, sessionId })?.absolutePath;
  }

  private readPlanReviewFileContent(absolutePath: string): string | undefined {
    const host = AilyHost.get();
    try {
      if (!host.fs?.existsSync?.(absolutePath)) {
        return undefined;
      }

      const stat = host.fs?.statSync?.(absolutePath);
      if (stat?.isFile && !stat.isFile()) {
        return undefined;
      }

      const content = host.fs.readFileSync(absolutePath, 'utf-8');
      return typeof content === 'string' ? content : String(content ?? '');
    } catch {
      return undefined;
    }
  }
}
