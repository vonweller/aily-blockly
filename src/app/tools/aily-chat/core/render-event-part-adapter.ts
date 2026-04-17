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
 *   - 维护必要的 UI 上下文（当前 msgIndex、活跃的 toolCallId 列表）
 *   - 提供 finalize() + reset() 供 turn 生命周期调用
 */

import type {
  RenderEvent,
  SubagentActivity,
} from 'aily-lex';
import {
  type ChatPart,
  type SubagentChildItem,
  type SubagentPart,
  type StatePart,
  mkToolCall,
  mkState,
  mkError,
  mkQuestion,
  mkApproval,
} from './chat-parts';
import type { ChatPartStore } from './chat-part-store';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RenderEventPartAdapter {
  private _msgIndex = -1;
  private readonly _store: ChatPartStore;

  /** Subagent toolCallId → partIndex in store (for childItem updates) */
  private readonly _subagentPartMap = new Map<string, number>();

  constructor(store: ChatPartStore) {
    this._store = store;
  }

  /** Set the current assistant message index for Part writes. */
  setMsgIndex(msgIndex: number): void {
    this._msgIndex = msgIndex;
  }

  get msgIndex(): number {
    return this._msgIndex;
  }

  /**
   * Process a single RenderEvent and apply the corresponding ChatPartStore mutation.
   *
   * Returns true if the event resulted in a store write, false if ignored.
   */
  process(event: RenderEvent): boolean {
    const i = this._msgIndex;
    if (i < 0) return false;

    switch (event.type) {
      // ---- Text ----
      case 'markdown_delta':
        this._store.appendToMarkdown(i, event.text);
        return true;

      case 'thinking_delta':
        this._store.appendToThinking(i, event.text);
        return true;

      case 'thinking_complete':
        this._store.completeThinking(i);
        return true;

      // ---- Tool Call ----
      case 'tool_call_begin':
        this._store.addPart(i, mkToolCall(
          event.toolCallId,
          event.toolName,
          `${event.toolName}…`,
          'doing',
          event.input,
        ));
        return true;

      case 'tool_call_progress':
        // Progress data can be free-form; update text if string
        if (typeof event.data === 'string') {
          this._store.updateToolCall(i, event.toolCallId, 'doing', event.data);
        }
        return true;

      case 'tool_call_end':
        this._store.updateToolCall(
          i,
          event.toolCallId,
          event.state === 'error' ? 'error' : 'done',
          event.resultText,
        );
        return true;

      // ---- State ----
      case 'state_update':
        this._upsertState(i, event.stateId, {
          state: event.state,
          text: event.text,
          progress: event.progress,
          kind: event.kind,
          metadata: event.metadata,
        });
        return true;

      case 'background_task_update':
        this._upsertState(i, event.stateId, {
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
        this._upsertState(i, `todo-${event.sessionId}`, {
          state: 'info',
          text: event.summary,
          kind: undefined,
          metadata: { items: event.items },
        });
        return true;

      // ---- Interaction ----
      case 'question_request':
        this._store.addPart(i, mkQuestion(
          event.questions.map(q => ({
            question: q.question,
            options: q.options?.map(o => ({ ...o })),
            allow_freeform: q.allowFreeform,
            multi_select: q.multiSelect,
          })),
        ));
        return true;

      case 'approval_request':
        this._store.addPart(i, mkApproval(
          event.requestId,
          event.message,
          event.toolName,
          event.source,
        ));
        return true;

      case 'approval_resolve':
        this._store.updateApprovalResult(i, event.requestId, {
          resolved: true,
          result: event.result,
          scope: event.scope,
        });
        return true;

      // ---- Error ----
      case 'error_notice':
        this._store.addPart(i, mkError(event.message));
        return true;

      // ---- Sub-agent ----
      case 'subagent_begin': {
        const partIndex = this._store.addPart(i, {
          type: 'subagent',
          toolCallId: event.toolCallId,
          agentName: event.agentName,
          description: event.description,
          state: 'doing',
          resultText: '',
          childItems: [],
        } satisfies SubagentPart);
        this._subagentPartMap.set(event.toolCallId, partIndex);
        return true;
      }

      case 'subagent_activity':
        this._appendSubagentChild(i, event);
        return true;

      case 'subagent_end':
        this._store.updateSubagent(i, event.toolCallId, event.state, event.resultText);
        this._subagentPartMap.delete(event.toolCallId);
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
    this._subagentPartMap.clear();
  }

  /** Clean up. */
  dispose(): void {
    this._subagentPartMap.clear();
    this._msgIndex = -1;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Upsert a StatePart: if stateId already exists in this message, update it;
   * otherwise add a new one.
   */
  private _upsertState(
    msgIndex: number,
    stateId: string,
    next: {
      state: StatePart['state'];
      text: string;
      progress?: number;
      kind?: StatePart['kind'];
      metadata?: Record<string, unknown>;
    },
  ): void {
    // Try update first
    const parts = this._store.getParts(msgIndex);
    for (let idx = parts.length - 1; idx >= 0; idx--) {
      const p = parts[idx];
      if (p.type === 'state' && p.stateId === stateId) {
        this._store.updateState(msgIndex, stateId, next);
        return;
      }
    }

    // Not found → add new
    this._store.addPart(msgIndex, mkState(
      stateId,
      next.text,
      next.state,
      next.kind,
      next.progress,
      next.metadata,
    ));
  }

  /**
   * Map SubagentActivity → SubagentChildItem and append to the SubagentPart.
   */
  private _appendSubagentChild(msgIndex: number, event: SubagentActivity): void {
    const partIndex = this._subagentPartMap.get(event.toolCallId);
    if (partIndex === undefined) return;

    const part = this._store.getPart(msgIndex, partIndex);
    if (!part || part.type !== 'subagent') return;

    const child = activityToChildItem(event);
    if (!child) return;

    // For tool events with a childToolCallId, update existing child if present
    if (event.childToolCallId && part.childItems) {
      const existing = part.childItems.findIndex(
        c => c.kind === 'tool' && c.toolCallId === event.childToolCallId
      );
      if (existing >= 0) {
        part.childItems[existing] = child;
        this._store.updatePart(msgIndex, partIndex, { ...part });
        return;
      }
    }

    // Append new child
    const children = [...(part.childItems || []), child];
    this._store.updatePart(msgIndex, partIndex, { ...part, childItems: children });
  }
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
      return {
        kind: 'tool',
        content: event.content ?? '',
        toolName: event.toolName,
        toolCallId: event.childToolCallId,
        argsSummary: event.argsSummary,
        state: 'doing',
      };

    case 'tool_progress':
      return {
        kind: 'tool',
        content: event.content ?? '',
        toolName: event.toolName,
        toolCallId: event.childToolCallId,
        argsSummary: event.argsSummary,
        state: 'doing',
      };

    case 'tool_completed':
      return {
        kind: 'tool',
        content: event.content ?? '',
        toolName: event.toolName,
        toolCallId: event.childToolCallId,
        state: 'done',
        duration: event.durationMs != null ? event.durationMs / 1000 : undefined,
      };

    case 'tool_failed':
      return {
        kind: 'tool',
        content: event.content ?? '',
        toolName: event.toolName,
        toolCallId: event.childToolCallId,
        state: 'error',
        duration: event.durationMs != null ? event.durationMs / 1000 : undefined,
      };

    default:
      return null;
  }
}
