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
  private static readonly TERMINAL_TOOLS = new Set([
    'run_terminal',
    'get_terminal_output',
    'send_to_terminal',
    'kill_terminal',
    'start_background_command',
  ]);

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
        // Progress data can be free-form; update text if string
        if (typeof event.data === 'string') {
          this._store.updateToolCallForHandle(this._findToolCallHandle(event.toolCallId, handle), event.toolCallId, 'doing', event.data);
        }
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
        this._upsertState(handle, `todo-${event.sessionId}`, {
          state: 'info',
          text: event.summary,
          kind: undefined,
          metadata: { items: event.items },
        });
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

  private _findToolCallHandle(toolCallId: string, fallbackHandle: ChatPartStoreOpaqueHandle | null): ChatPartStoreOpaqueHandle | null {
    return this._store.findToolCallOpaqueHandle(toolCallId) ?? fallbackHandle;
  }

  private _appendTerminalPart(handle: ChatPartStoreOpaqueHandle, event: Extract<RenderEvent, { type: 'tool_call_end' }>): void {
    if (!RenderEventPartAdapter.TERMINAL_TOOLS.has(event.toolName)) {
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
  return mkError(event.message, 'warning');
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
