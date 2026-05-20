/**
 * RenderEventPartAdapter — RenderEvent → ChatPart 薄映射层
 *
 * 消费 aily-lex 的 RenderEvent 流，将每个事件映射为 ChatPartStore 的写操作。
 * 不含状态机逻辑 — 所有状态跟踪（think tag 解析、工具调用生命周期等）
 * 已由 lex 侧的 RenderEventEmitter 处理。
 *
 * 事件流：
 *   AgentHandle.chat() → RenderEvent → RenderEventPartAdapter → ChatPartStore
 *
 * 职责：
 *   - 每种 RenderEvent 精确映射到一个 ChatPartStore 操作
 *   - 维护必要的 UI 上下文（当前消息 handle、活跃的 toolCallId 列表）
 *   - 提供 finalize() + reset() 供 turn 生命周期调用
 */

import type {
  RenderEvent,
  SubagentActivity,
} from 'aily-lex/browser';
import {
  buildConfirmationPartId,
  type SubagentChildItem,
  type StatePart,
  mkSubagentTimelineEntry,
  mkSubagentToolCall,
  mkTerminal,
  mkToolCall,
  mkState,
  mkError,
  mkQuestion,
  mkConfirmation,
} from './chat-parts';
import {
  buildPendingToolCallApprovalMetadata,
  buildResolvedToolCallApprovalMetadata,
} from './tool-call-approval';
import { isTerminalSessionToolName, isTodoToolName } from './tool-name-normalizer';
import { parseTerminalPayload } from './terminal-payload';
import { buildToolResultMetadataPatch, collectToolResultText, extractRawToolResultPayloadText } from './tool-result-content';
import {
  type ChatPartStore,
  type ChatPartStoreOpaqueHandle,
  type ToolCallPartPatch,
} from './chat-part-store';

export type RenderEventPartStoreAccess = Pick<
  ChatPartStore,
  | 'appendToMarkdownHandle'
  | 'appendToThinkingHandle'
  | 'completeThinkingHandle'
  | 'addPartToHandle'
  | 'getPartsForHandle'
  | 'updateToolCallForHandle'
  | 'patchToolCallForHandle'
  | 'upsertStateForHandle'
  | 'updateConfirmationResultForHandle'
  | 'updateSubagentForHandle'
  | 'upsertSubagentChildItemForHandle'
  | 'findToolCallOpaqueHandle'
>;

function hasUsableStoreHandle(
  handle: ({ storeKey?: object | symbol; message?: unknown; msgIndex?: unknown } & object) | null,
): boolean {
  if (!handle) {
    return false;
  }

  if (typeof handle.storeKey === 'object' || typeof handle.storeKey === 'symbol') {
    return true;
  }

  if (typeof handle.msgIndex === 'number' && handle.msgIndex >= 0) {
    return true;
  }

  return !!handle.message && typeof handle.message === 'object';
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RenderEventPartAdapter {
  private readonly _store: RenderEventPartStoreAccess;

  constructor(store: RenderEventPartStoreAccess) {
    this._store = store;
  }

  /**
   * Process a single RenderEvent and apply the corresponding ChatPartStore mutation.
   *
   * Returns true if the event resulted in a store write, false if ignored.
   */
  process(event: RenderEvent, handle: ChatPartStoreOpaqueHandle | null): boolean {
    if (!hasUsableStoreHandle(handle)) return false;

    switch (event.type) {
      // ---- Text ----
      case 'markdown_delta':
        this._store.appendToMarkdownHandle(handle, event.text);
        return true;

      case 'thinking_delta':
        this._store.appendToThinkingHandle(handle, event.text);
        return true;

      case 'thinking_complete':
        this._store.completeThinkingHandle(handle);
        return true;

      // ---- Tool Call ----
      case 'tool_call_begin':
        this._store.addPartToHandle(handle, mkToolCall(
          event.toolCallId,
          event.toolName,
          `${event.toolName}…`,
          'doing',
          event.input,
        ));
        return true;

      case 'tool_call_progress':
        this._applyToolCallProgress(handle, event);
        return true;

      case 'tool_call_end':
        this._store.patchToolCallForHandle(
          this._findToolCallHandle(event.toolCallId, handle),
          event.toolCallId,
          {
            state: event.state === 'error' ? 'error' : 'done',
            text: event.resultText,
            metadata: buildToolResultMetadataPatch({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              state: event.state === 'error' ? 'error' : 'done',
              resultText: event.resultText,
              result: event.result,
              timestamp: event.timestamp,
              durationMs: event.durationMs,
            }),
          },
        );
        this._appendTerminalPart(handle, event);
        return true;

      // ---- State ----
      case 'state_update':
        this._upsertState(handle, event.stateId, {
          state: event.state,
          text: event.text,
          progress: event.progress,
          kind: event.kind,
          metadata: event.metadata,
        });
        return true;

      case 'background_task_update':
        this._upsertState(handle, event.stateId, {
          state: event.state,
          text: event.description,
          progress: event.progress,
          kind: 'background_task',
          metadata: {
            taskId: event.taskId,
            agentName: event.agentName,
            summary: event.summary,
            activity: event.activity,
          },
        });
        return true;

      case 'todo_update':
        const todoMetadata = buildTodoStateMetadata(
          event.sessionId,
          event.summary,
          event.items,
          this.getExistingStateMetadata(handle, `todo-${event.sessionId}`),
        );
        this._upsertState(handle, `todo-${event.sessionId}`, {
          state: resolveTodoState(event.items),
          text: event.summary,
          kind: 'todo',
          metadata: todoMetadata,
        });
        this.patchLatestTodoToolCall(handle, todoMetadata);
        return true;

      // ---- Interaction ----
      case 'question_request':
        this._store.addPartToHandle(handle, questionRequestToPart(event));
        return true;

      case 'approval_request':
        if (isToolExecutionApprovalEvent(event)) {
          this._store.patchToolCallForHandle(
            this._findToolCallHandle(event.toolCallId, handle),
            event.toolCallId,
            approvalRequestToToolCallPatch(event),
          );
        } else {
          this._store.addPartToHandle(handle, confirmationRequestToPart(event));
        }
        return true;

      case 'approval_resolve':
        if (isToolExecutionApprovalEvent(event)) {
          this._store.patchToolCallForHandle(
            this._findToolCallHandle(event.toolCallId, handle),
            event.toolCallId,
            approvalResolveToToolCallPatch(event),
          );
        } else {
          this._store.updateConfirmationResultForHandle(handle, buildConfirmationPartId(getStandaloneApprovalRequestId(event)), {
            resolved: true,
            result: event.result,
            scope: event.scope,
          });
        }
        return true;

      // ---- Info / Warning / Error ----
      case 'info_notice':
        this._store.addPartToHandle(handle, infoNoticeToPart(event));
        return true;

      case 'warning_notice':
        this._store.addPartToHandle(handle, warningNoticeToPart(event));
        return true;

      case 'error_notice':
        this._store.addPartToHandle(handle, errorNoticeToPart(event));
        return true;

      // ---- Sub-agent ----
      case 'subagent_begin': {
        this._store.addPartToHandle(handle, subagentBeginToPart(event));
        return true;
      }

      case 'subagent_activity':
        this._appendSubagentChild(event, handle);
        return true;

      case 'subagent_end':
        this._store.updateSubagentForHandle(this._findToolCallHandle(event.toolCallId, handle), event.toolCallId, event.state, event.resultText);
        return true;

      // ---- Turn lifecycle (non-Part) ----
      case 'turn_begin':
      case 'turn_end':
      case 'session_meta':
        // These are lifecycle signals, not rendered as Parts.
        // The caller (bridge) may use them for message lifecycle management.
        return false;

      default:
        return false;
    }
  }

  /** Reset per-turn state. Call at the start of each new turn. */
  reset(): void {
    // no-op: current-handle ownership lives with the caller/runtime
  }

  /** Clean up. */
  dispose(): void {
    // no-op
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Upsert a StatePart: if stateId already exists in this message, update it;
   * otherwise add a new one.
   */
  private _upsertState(
    handle: ChatPartStoreOpaqueHandle,
    stateId: string,
    next: {
      state: StatePart['state'];
      text: string;
      progress?: number;
      kind?: StatePart['kind'];
      metadata?: Record<string, unknown>;
    },
  ): void {
    this._store.upsertStateForHandle(handle, stateId, next);
  }

  /**
   * Map SubagentActivity → SubagentChildItem and append to the tool_call metadata.
   */
  private _appendSubagentChild(event: SubagentActivity, fallbackHandle: ChatPartStoreOpaqueHandle): void {
    const handle = this._findToolCallHandle(event.toolCallId, fallbackHandle);
    if (!handle) {
      return;
    }

    const child = activityToChildItem(event);
    if (!child) return;

    this._store.upsertSubagentChildItemForHandle(handle, event.toolCallId, child);
  }

  private _applyToolCallProgress(
    fallbackHandle: ChatPartStoreOpaqueHandle,
    event: Extract<RenderEvent, { type: 'tool_call_progress' }>,
  ): void {
    const toolHandle = this._findToolCallHandle(event.toolCallId, fallbackHandle);
    if (!toolHandle) {
      return;
    }

    const toolPart = this._findToolCallPart(toolHandle, event.toolCallId);
    const progressUpdate = normalizeToolCallProgressUpdate(event.data, toolPart?.toolName);
    if (!progressUpdate) {
      return;
    }

    const nextMetadata = buildToolCallProgressMetadataPatch({
      toolCallId: event.toolCallId,
      toolName: toolPart?.toolName,
      timestamp: event.timestamp,
      summary: progressUpdate.summary,
      progress: progressUpdate.progress,
      detail: progressUpdate.detail,
      step: progressUpdate.step,
      statusText: progressUpdate.statusText,
      existingMetadata: toolPart?.metadata,
    });

    this._store.patchToolCallForHandle(toolHandle, event.toolCallId, {
      state: 'doing',
      ...(progressUpdate.summary ? { text: progressUpdate.summary } : {}),
      metadata: nextMetadata,
    });
  }

  private _findToolCallPart(
    handle: ChatPartStoreOpaqueHandle,
    toolCallId: string,
  ): Extract<ReturnType<RenderEventPartStoreAccess['getPartsForHandle']>[number], { type: 'tool_call' }> | undefined {
    return this._store.getPartsForHandle(handle).find(
      (part): part is Extract<ReturnType<RenderEventPartStoreAccess['getPartsForHandle']>[number], { type: 'tool_call' }> =>
        part.type === 'tool_call' && part.toolCallId === toolCallId,
    );
  }

  private _findToolCallHandle(toolCallId: string, fallbackHandle: ChatPartStoreOpaqueHandle | null): ChatPartStoreOpaqueHandle | null {
    return this._store.findToolCallOpaqueHandle(toolCallId) ?? fallbackHandle;
  }

  private getExistingStateMetadata(
    handle: ChatPartStoreOpaqueHandle,
    stateId: string,
  ): Record<string, unknown> | undefined {
    const part = this._store.getPartsForHandle(handle).find(
      (candidate): candidate is StatePart => candidate.type === 'state' && candidate.stateId === stateId,
    );

    return asRecord(part?.metadata);
  }

  private patchLatestTodoToolCall(
    handle: ChatPartStoreOpaqueHandle,
    todoMetadata: Record<string, unknown>,
  ): void {
    const parts = this._store.getPartsForHandle(handle);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (part.type !== 'tool_call' || !isTodoToolName(part.toolName)) {
        continue;
      }

      this._store.patchToolCallForHandle(handle, part.toolCallId, {
        metadata: {
          toolSpecificData: buildTodoToolSpecificData(todoMetadata),
        },
      });
      return;
    }
  }

  private _appendTerminalPart(handle: ChatPartStoreOpaqueHandle, event: Extract<RenderEvent, { type: 'tool_call_end' }>): void {
    if (!isTerminalSessionToolName(event.toolName)) {
      return;
    }

    const terminal = extractTerminalPart(event.toolCallId, event.result);
    if (!terminal) {
      return;
    }

    const toolHandle = this._findToolCallHandle(event.toolCallId, handle);
    this._store.addPartToHandle(toolHandle ?? handle, terminal);
  }
}

function buildTodoStateMetadata(
  sessionId: string,
  summary: string,
  items: readonly { id: number; title: string; status: string }[],
  previousMetadata?: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedItems = items.map(item => ({
    id: item.id,
    title: item.title,
    status: item.status,
  }));
  const completedCount = normalizedItems.filter(item => item.status === 'completed').length;
  const totalCount = normalizedItems.length;
  const activeTodo = normalizedItems.find(item => item.status === 'in-progress')
    ?? normalizedItems.find(item => item.status === 'not-started');
  const currentStep = totalCount > 0
    ? Math.min(totalCount, activeTodo ? completedCount + 1 : totalCount)
    : 0;
  const state = resolveTodoState(items);
  const signature = buildTodoSignature(normalizedItems);
  const previousTimeline = asRecordArray(previousMetadata?.['timeline']);
  const previousSnapshot = previousTimeline.at(-1);
  const phase = classifyTodoPhase(previousSnapshot, normalizedItems, {
    summary,
    state,
    totalCount,
    completedCount,
    currentStep,
    activeTitle: activeTodo?.title,
  });
  const snapshot: Record<string, unknown> = {
    recordId: asString(previousSnapshot?.['recordId']) && asString(previousSnapshot?.['signature']) === signature
      ? asString(previousSnapshot?.['recordId'])
      : `todo:${sessionId}:${previousTimeline.length + 1}`,
    signature,
    summary,
    state,
    totalCount,
    completedCount,
    currentStep,
    activeTitle: activeTodo?.title,
    phaseKind: phase.kind,
    phaseLabel: phase.label,
    phaseDetail: phase.detail,
    items: normalizedItems,
  };

  const timeline = previousTimeline.length === 0
    ? [snapshot]
    : asString(previousSnapshot?.['signature']) === signature
      ? [...previousTimeline.slice(0, -1), snapshot]
      : [...previousTimeline, snapshot].slice(-8);

  return {
    items: normalizedItems,
    summary,
    state,
    totalCount,
    completedCount,
    currentStep,
    activeTitle: activeTodo?.title,
    signature,
    timeline,
  };
}

function classifyTodoPhase(
  previousSnapshot: Record<string, unknown> | undefined,
  items: readonly { id: number; title: string; status: string }[],
  next: {
    summary: string;
    state: StatePart['state'];
    totalCount: number;
    completedCount: number;
    currentStep: number;
    activeTitle?: string;
  },
): { kind: string; label: string; detail?: string } {
  const previousItems = asRecordArray(previousSnapshot?.['items']).map(item => ({
    id: Number(item['id']),
    title: asString(item['title']) || '',
    status: asString(item['status']) || 'not-started',
  }));
  const previousActiveTitle = asString(previousSnapshot?.['activeTitle']);
  const previousCompletedCount = asNumber(previousSnapshot?.['completedCount']) ?? 0;
  const previousTotalCount = asNumber(previousSnapshot?.['totalCount']) ?? 0;

  if (!previousSnapshot) {
    if (next.totalCount === 0) {
      return { kind: 'empty', label: 'Todo 列表为空' };
    }

    if (next.activeTitle) {
      return { kind: 'start', label: `开始 ${next.activeTitle}`, detail: formatTodoProgress(next.currentStep, next.totalCount) };
    }

    return { kind: 'snapshot', label: '建立 Todo 计划', detail: formatTodoProgress(next.currentStep, next.totalCount) };
  }

  if (next.totalCount === 0 && previousTotalCount > 0) {
    return { kind: 'cleared', label: '清空 Todo 列表' };
  }

  if (next.totalCount > 0 && next.completedCount === next.totalCount) {
    if (previousActiveTitle) {
      return { kind: 'complete-all', label: `完成 ${previousActiveTitle}`, detail: '全部完成' };
    }

    return { kind: 'complete-all', label: '完成全部任务', detail: formatTodoProgress(next.totalCount, next.totalCount) };
  }

  if (next.completedCount > previousCompletedCount && previousActiveTitle) {
    return next.activeTitle && next.activeTitle !== previousActiveTitle
      ? {
          kind: 'advance',
          label: `完成 ${previousActiveTitle}`,
          detail: `切换到 ${next.activeTitle}`,
        }
      : {
          kind: 'complete',
          label: `完成 ${previousActiveTitle}`,
          detail: formatTodoProgress(next.currentStep, next.totalCount),
        };
  }

  if (next.activeTitle && next.activeTitle !== previousActiveTitle) {
    return {
      kind: 'switch',
      label: `切换到 ${next.activeTitle}`,
      detail: formatTodoProgress(next.currentStep, next.totalCount),
    };
  }

  if (next.totalCount !== previousTotalCount) {
    return {
      kind: 'reshape',
      label: next.totalCount > previousTotalCount ? '扩展 Todo 计划' : '收缩 Todo 计划',
      detail: formatTodoProgress(next.currentStep, next.totalCount),
    };
  }

  const changedTitles = items.filter(item => {
    const previous = previousItems.find(candidate => candidate.id === item.id);
    return !!previous && previous.title !== item.title;
  });
  if (changedTitles.length > 0) {
    return {
      kind: 'rename',
      label: `更新 ${changedTitles[0].title}`,
      detail: formatTodoProgress(next.currentStep, next.totalCount),
    };
  }

  return {
    kind: 'sync',
    label: next.activeTitle ? `同步 ${next.activeTitle}` : '同步 Todo 列表',
    detail: formatTodoProgress(next.currentStep, next.totalCount),
  };
}

function formatTodoProgress(currentStep: number, totalCount: number): string | undefined {
  return totalCount > 0 ? `${Math.max(0, currentStep)}/${totalCount}` : undefined;
}

function buildTodoToolSpecificData(todoMetadata: Record<string, unknown>): Record<string, unknown> {
  const items = asRecordArray(todoMetadata['items']);
  return {
    kind: 'todoList',
    todoList: items.map(item => ({
      id: String(item['id'] ?? ''),
      title: asString(item['title']) || 'Todo',
      status: asString(item['status']) || 'not-started',
    })),
    summary: asString(todoMetadata['summary']) || '',
    currentTask: asString(todoMetadata['activeTitle']) || undefined,
    totalCount: asNumber(todoMetadata['totalCount']) ?? items.length,
    completedCount: asNumber(todoMetadata['completedCount']) ?? 0,
    currentStep: asNumber(todoMetadata['currentStep']) ?? 0,
    result: asString(todoMetadata['summary']) || '',
  };
}

function buildTodoSignature(items: readonly { id: number; title: string; status: string }[]): string {
  return items
    .map(item => `${item.id}:${item.status}:${item.title}`)
    .join('|');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
      .map(entry => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry)
      .map(entry => ({ ...entry }))
    : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveTodoState(items: readonly { status: string }[]): StatePart['state'] {
  if (!items.length) {
    return 'info';
  }

  const hasInFlightItem = items.some(item => item.status === 'in-progress' || item.status === 'not-started');
  if (hasInFlightItem) {
    return 'doing';
  }

  return items.every(item => item.status === 'completed') ? 'done' : 'info';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activityToChildItem(event: SubagentActivity): SubagentChildItem | null {
  switch (event.activityKind) {
    case 'thinking':
      return { kind: 'thinking', content: event.content ?? '' };

    case 'text':
      return { kind: 'text', content: event.content ?? '' };

    case 'tool_started':
      return toolActivityToChildItem(event, 'doing');

    case 'tool_progress':
      return toolActivityToChildItem(event, 'doing');

    case 'tool_completed':
      return toolActivityToChildItem(event, 'done');

    case 'tool_failed':
      return toolActivityToChildItem(event, 'error');

    default:
      return null;
  }
}

function toolActivityToChildItem(
  event: Pick<SubagentActivity, 'content' | 'toolName' | 'childToolCallId' | 'argsSummary' | 'durationMs'>,
  state: 'doing' | 'done' | 'error',
): SubagentChildItem {
  return {
    kind: 'tool',
    content: event.content ?? '',
    toolName: event.toolName,
    toolCallId: event.childToolCallId,
    argsSummary: event.argsSummary,
    state,
    duration: event.durationMs != null ? event.durationMs / 1000 : undefined,
  };
}

function extractTerminalPart(toolCallId: string, result: Extract<RenderEvent, { type: 'tool_call_end' }>['result']) {
  const text = extractRawToolResultPayloadText(result);
  if (!text) {
    return null;
  }

  const parsed = parseTerminalPayload(text);
  if (!parsed) {
    return null;
  }

  const terminal = mkTerminal(parsed.command, toolCallId);
  terminal.output = parsed.output;
  terminal.stderr = parsed.stderr;
  terminal.exitCode = parsed.exitCode;
  terminal.isRunning = parsed.isRunning;
  return terminal;
}

function extractToolResultText(result: Extract<RenderEvent, { type: 'tool_call_end' }>['result']): string {
  return collectToolResultText(result);
}

function normalizeToolCallProgressUpdate(
  data: unknown,
  toolName?: string,
): {
  summary?: string;
  progress?: number;
  detail?: string;
  step?: string;
  statusText?: string;
} | null {
  if (typeof data === 'string') {
    const summary = data.trim();
    return summary ? { summary } : null;
  }

  if (typeof data === 'number' && Number.isFinite(data)) {
    return {
      summary: toolName ? `${toolName} still running...` : 'Tool still running...',
      progress: data,
    };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const record = data as Record<string, unknown>;
  const summary = firstMeaningfulString(record['message'], record['text'], record['status'], record['detail'], record['step']);
  const detail = firstMeaningfulString(record['detail']);
  const step = firstMeaningfulString(record['step']);
  const statusText = firstMeaningfulString(record['status'], record['statusText']);
  const progress = asNumber(record['progress']) ?? asNumber(record['percentage']);

  if (!summary && progress == null && !detail && !step && !statusText) {
    return null;
  }

  return {
    summary: summary ?? (toolName ? `${toolName} still running...` : 'Tool still running...'),
    ...(progress != null ? { progress } : {}),
    ...(detail ? { detail } : {}),
    ...(step ? { step } : {}),
    ...(statusText ? { statusText } : {}),
  };
}

function buildToolCallProgressMetadataPatch(input: {
  toolCallId: string;
  toolName?: string;
  timestamp: number;
  summary?: string;
  progress?: number;
  detail?: string;
  step?: string;
  statusText?: string;
  existingMetadata?: Record<string, unknown>;
}): Record<string, unknown> {
  const existingMetadata = asRecord(input.existingMetadata) ?? {};
  const existingTimeline = asRecordArray(existingMetadata['timeline']);
  const progressEntry: Record<string, unknown> = {
    recordId: `${input.toolCallId}:progress`,
    phase: 'progress',
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.progress != null ? { progress: input.progress } : {}),
    ...((input.summary || input.detail || input.step || input.statusText || input.progress != null)
      ? {
          progressDetails: {
            ...(input.summary ? { message: input.summary } : {}),
            ...(input.detail ? { detail: input.detail } : {}),
            ...(input.step ? { step: input.step } : {}),
            ...(input.statusText ? { statusText: input.statusText } : {}),
            ...(input.progress != null ? { progress: input.progress } : {}),
          },
        }
      : {}),
    timestamp: input.timestamp,
  };

  const timeline = mergeProgressTimeline(existingTimeline, progressEntry);

  return {
    ...existingMetadata,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    phase: 'progress',
    ...(input.progress != null ? { progress: input.progress } : {}),
    timeline,
  };
}

function mergeProgressTimeline(
  existingTimeline: readonly Record<string, unknown>[],
  progressEntry: Record<string, unknown>,
): Record<string, unknown>[] {
  if (existingTimeline.length === 0) {
    return [{ ...progressEntry }];
  }

  const nextTimeline = existingTimeline.map(entry => ({ ...entry }));
  const lastEntry = nextTimeline[nextTimeline.length - 1];
  if (asString(lastEntry?.['recordId']) === asString(progressEntry['recordId'])) {
    nextTimeline[nextTimeline.length - 1] = { ...progressEntry };
    return nextTimeline;
  }

  nextTimeline.push({ ...progressEntry });
  return nextTimeline;
}

function firstMeaningfulString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function questionRequestToPart(event: Extract<RenderEvent, { type: 'question_request' }>) {
  return mkQuestion(
    event.questions.map(q => ({
      question: q.question,
      options: q.options?.map(o => ({ ...o })),
      allow_freeform: q.allowFreeform,
      multi_select: q.multiSelect,
    })),
    undefined,
    event.requestId,
  );
}

function confirmationRequestToPart(event: Extract<RenderEvent, { type: 'approval_request' }>) {
  return mkConfirmation(
    getStandaloneApprovalRequestId(event),
    event.message,
    event.toolName,
    event.source,
    {
      args: event.input,
      title: event.title,
      subtitle: event.subtitle,
      description: event.description,
      actions: event.actions,
      primaryScope: event.primaryScope,
    },
  );
}

function approvalRequestToToolCallPatch(
  event: Extract<RenderEvent, { type: 'approval_request' }> & { toolCallId: string },
): ToolCallPartPatch {
  return {
    state: 'pending_approval',
    text: event.message || `${event.toolName} requires approval`,
    args: event.input,
    metadata: {
      approval: buildPendingToolCallApprovalMetadata({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        message: event.message,
        description: event.description,
        source: event.source,
        title: event.title,
        subtitle: event.subtitle,
        actions: event.actions,
        primaryScope: event.primaryScope,
        args: event.input,
      }),
    },
  };
}

function approvalResolveToToolCallPatch(
  event: Extract<RenderEvent, { type: 'approval_resolve' }> & { toolCallId: string },
): ToolCallPartPatch {
  return {
    state: event.result === 'approved' ? 'doing' : 'error',
    metadata: {
      approval: buildResolvedToolCallApprovalMetadata({
        toolCallId: event.toolCallId,
        result: event.result,
        scope: event.scope,
      }),
    },
  };
}

function isToolExecutionApprovalEvent(
  event: Extract<RenderEvent, { type: 'approval_request' | 'approval_resolve' }>,
): event is Extract<RenderEvent, { type: 'approval_request' | 'approval_resolve' }> & { toolCallId: string } {
  return typeof event.toolCallId === 'string' && event.toolCallId.trim().length > 0;
}

function getStandaloneApprovalRequestId(
  event: Extract<RenderEvent, { type: 'approval_request' | 'approval_resolve' }>,
): string {
  if (typeof event.requestId === 'string' && event.requestId.trim().length > 0) {
    return event.requestId;
  }

  return '';
}

function errorNoticeToPart(event: Extract<RenderEvent, { type: 'error_notice' }>) {
  return mkError(event.message);
}

function warningNoticeToPart(event: Extract<RenderEvent, { type: 'warning_notice' }>) {
  return mkError(event.message, 'warning', {
    ...(typeof event.code === 'string' ? { code: event.code } : {}),
    ...(event.details && typeof event.details === 'object' ? { details: event.details } : {}),
  });
}

function infoNoticeToPart(event: Extract<RenderEvent, { type: 'info_notice' }>) {
  return mkError(event.message, 'info');
}

function subagentBeginToPart(event: Extract<RenderEvent, { type: 'subagent_begin' }>) {
  return mkSubagentToolCall(
    event.toolCallId,
    event.agentName,
    event.description,
    buildSubagentMetadata(event),
  );
}

function buildSubagentMetadata(
  event: Extract<RenderEvent, { type: 'subagent_begin' }>,
): Record<string, unknown> {
  const description = event.description?.trim() || event.agentName;

  return {
    toolName: 'agent',
    phase: 'started',
    argsSummary: event.description,
    recordId: event.toolCallId,
    subAgentInvocationId: event.toolCallId,
    invocationMessage: description,
    pastTenseMessage: description ? `Completed Task: "${description}"` : event.agentName,
    timeline: [mkSubagentTimelineEntry({
      recordId: `${event.toolCallId}:started`,
      phase: 'started',
      summary: description,
      timestamp: event.timestamp,
    })],
    toolSpecificData: {
      kind: 'subagent',
      description: event.description,
      agentName: event.agentName,
      result: '',
    },
  };
}
