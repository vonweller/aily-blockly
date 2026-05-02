/**
 * PartEventProcessor — 将 lex-stream 事件转换为 Part 操作
 *
 * 替代 _processEvent 中的 string 拼接逻辑，
 * 直接生成结构化的 Parts 写入 ChatPartStore。
 *
 * 核心收益：
 *   - 消除 filterThinkTags（<think> 解析 → ThinkingPart 直接生成）
 *   - 消除 filterToolCalls（tool JSON 行 → ToolCallPart 直接生成）
 *   - 消除 think-content-store 中间层（ThinkingPart 自带 content）
 */
import type { ChatPartStoreReadableHandle } from './chat-part-store';
import { ToolCallState } from './chat-types';
import { ChatPartMutationBridge, type ChatPartMutationStoreAccess } from './chat-part-mutation-bridge';
import {
  sanitizePartTextDelta,
} from './chat-part-markdown-postprocessor';
import {
  mkError,
  mkState,
  mkSubagentToolCall,
  mkTerminal,
  mkToolCall,
  StatePart,
} from './chat-parts';
import { parseTerminalPayload } from './terminal-payload';
import { buildToolResultMetadataPatch, collectToolResultText, extractRawToolResultPayloadText } from './tool-result-content';
import { makeJsonSafe as _makeJsonSafe } from '../services/content-sanitizer.service';
import { generateToolResultText, generateToolStartText } from '../services/tool-display.service';

type PartEventMutations = Pick<
  ChatPartMutationBridge,
  | 'addPartToCurrentMessage'
  | 'addTerminalPartForToolCall'
  | 'appendMarkdownToCurrentMessage'
  | 'appendThinkingToCurrentMessage'
  | 'completeThinkingOnCurrentMessage'
  | 'getToolCall'
  | 'patchToolCall'
  | 'updateToolCall'
  | 'updateSubagent'
  | 'upsertStateOnCurrentMessage'
  | 'postProcessMarkdownOnCurrentMessage'
>;

export class PartEventProcessor {
  /** 当前是否在 text_delta 内嵌的 <think> 块中 */
  private _insideInlineThink = false;
  /** 原生 thinking 事件是否已开始 */
  private _nativeThinkStarted = false;
  /** 缓冲区 — 用于跨 chunk 的标签检测 */
  private _tagBuffer = '';
  private readonly mutations: PartEventMutations;

  constructor(
    store: ChatPartMutationStoreAccess,
    getCurrentMessageHandle: () => ChatPartStoreReadableHandle | null,
  ) {
    this.mutations = new ChatPartMutationBridge(store, getCurrentMessageHandle);
  }

  // ==================== 事件处理 ====================

  /**
   * 处理 text_delta 事件
   * 解析内嵌的 <think> 标签，分离 markdown 和 thinking 内容
   */
  processTextDelta(text: string): void {
    // 先关闭原生 thinking（如果有）
    this._closeNativeThinking();

    // ★ Phase 3: 文本净化 — 替代 preprocess 管线中的 filter 函数
    text = sanitizePartTextDelta(text);

    // ★ 跨 chunk 标签缓冲：将上次残留的部分标签拼接到当前 chunk 前
    if (this._tagBuffer) {
      text = this._tagBuffer + text;
      this._tagBuffer = '';
    }

    let remaining = text;

    while (remaining.length > 0) {
      if (this._insideInlineThink) {
        // 在 <think> 内部，查找 </think>
        const endIdx = remaining.indexOf('</think>');
        if (endIdx === -1) {
          // 检查尾部是否有可能拆分的 </think> 标签
          const partialEnd = this._checkPartialTag(remaining, '</think>');
          if (partialEnd >= 0) {
            // 尾部有部分匹配 — 缓冲它，输出安全部分
            const safe = remaining.substring(0, partialEnd);
            if (safe) this.mutations.appendThinkingToCurrentMessage(safe);
            this._tagBuffer = remaining.substring(partialEnd);
          } else {
            this.mutations.appendThinkingToCurrentMessage(remaining);
          }
          remaining = '';
        } else {
          // 闭合 thinking
          if (endIdx > 0) {
            this.mutations.appendThinkingToCurrentMessage(remaining.substring(0, endIdx));
          }
          this.mutations.completeThinkingOnCurrentMessage();
          this._insideInlineThink = false;
          remaining = remaining.substring(endIdx + '</think>'.length);
        }
      } else {
        // 在 <think> 外部，查找 <think>
        const startIdx = remaining.indexOf('<think>');
        if (startIdx === -1) {
          // 检查尾部是否有可能拆分的 <think> 标签
          const partialStart = this._checkPartialTag(remaining, '<think>');
          if (partialStart >= 0) {
            const safe = remaining.substring(0, partialStart);
            if (safe) this.mutations.appendMarkdownToCurrentMessage(safe);
            this._tagBuffer = remaining.substring(partialStart);
          } else {
            this.mutations.appendMarkdownToCurrentMessage(remaining);
          }
          remaining = '';
        } else {
          // <think> 之前的部分是 markdown
          if (startIdx > 0) {
            this.mutations.appendMarkdownToCurrentMessage(remaining.substring(0, startIdx));
          }
          this._insideInlineThink = true;
          remaining = remaining.substring(startIdx + '<think>'.length);
        }
      }
    }
  }

  /**
   * 检查 text 尾部是否包含 tag 的部分前缀。
   * 返回部分匹配的起始位置，-1 表示没有匹配。
   *
   * 例如 text="abc<thi", tag="<think>" → 返回 3
   */
  private _checkPartialTag(text: string, tag: string): number {
    // 从 tag 长度-1 开始检查递减长度的前缀（至少 1 个字符）
    const maxCheck = Math.min(tag.length - 1, text.length);
    for (let len = maxCheck; len >= 1; len--) {
      if (text.endsWith(tag.substring(0, len))) {
        return text.length - len;
      }
    }
    return -1;
  }

  /**
   * 处理原生 thinking 事件（独立的 thinking SSE 事件）
   */
  processThinking(text: string): void {
    if (!this._nativeThinkStarted) {
      this._nativeThinkStarted = true;
    }
    this.mutations.appendThinkingToCurrentMessage(text);
  }

  /**
   * 处理 tool_call_start 事件
   */
  processToolCallStart(toolCallId: string, toolName: string, input?: any): void {
    this._closeNativeThinking();
    this._insideInlineThink = false;

    // ★ agent 工具 → Copilot 风格 tool_call（通过 metadata 承载子代理信息）
    if (toolName === 'agent') {
      const agentName = input?.agentName || input?.description || 'Agent';
      const description = input?.description || input?.prompt?.substring(0, 80) || '';
      this.mutations.addPartToCurrentMessage(mkSubagentToolCall(toolCallId, agentName, description));
      return;
    }

    const startText = generateToolStartText(toolName, input) || `执行 ${toolName}...`;
    const safeText = _makeJsonSafe(startText);
    this.mutations.addPartToCurrentMessage(mkToolCall(toolCallId, toolName, safeText, 'doing', input));
  }

  /**
   * 处理 tool_call_end 事件
   */
  processToolCallEnd(toolCallId: string, toolName: string, result?: any): void {
    const isError = result?.isError ?? false;

    // ★ agent 工具 → 更新 subagent tool_call metadata
    if (toolName === 'agent') {
      const text = this._extractResultText(result);
      const state = isError ? 'error' as const : 'done' as const;
      this.mutations.updateSubagent(toolCallId, state, text);
      return;
    }

    const currentToolCall = this.mutations.getToolCall(toolCallId);
    const resultText = generateToolResultText(toolName, currentToolCall?.args || {}, result)
      || currentToolCall?.text
      || '执行完成';
    const state: ToolCallState = isError ? ToolCallState.ERROR : ToolCallState.DONE;

    this.mutations.patchToolCall(toolCallId, {
      state,
      text: resultText,
      metadata: buildToolResultMetadataPatch({
        toolCallId,
        toolName,
        state,
        resultText,
        result,
      }),
    });
  }

  /** 从工具结果中提取文本 */
  private _extractResultText(result: any): string {
    return collectToolResultText(result);
  }

  /**
   * 处理 error 事件
   */
  processError(message: string): void {
    this.mutations.addPartToCurrentMessage(mkError(message));
  }

  /**
   * 处理终端命令输出 — 从 tool_call_end 的结果中解析终端数据
   */
  processTerminalResult(toolCallId: string, result: any): void {
    const terminalData = this._extractTerminalResult(result);
    if (!terminalData) return;

    const part = mkTerminal(terminalData.command || '', toolCallId);
    part.output = terminalData.output || '';
    part.stderr = terminalData.stderr || '';
    part.exitCode = terminalData.exitCode;
    part.isRunning = terminalData.isRunning;
    this.mutations.addTerminalPartForToolCall(toolCallId, part);
  }

  private _extractTerminalResult(result: any): {
    command: string;
    output: string;
    stderr: string;
    exitCode?: number;
    isRunning: boolean;
  } | null {
    const text = extractRawToolResultPayloadText(result);
    if (!text) return null;
    const parsed = parseTerminalPayload(text);
    if (!parsed) {
      return null;
    }
    return {
      command: parsed.command,
      output: parsed.output,
      stderr: parsed.stderr,
      exitCode: parsed.exitCode,
      isRunning: parsed.isRunning,
    };
  }

  /** 处理宿主通用状态事件（任务图/调度/自治/协作团队） */
  upsertState(
    stateId: string,
    text: string,
    state: StatePart['state'],
    options: {
      kind?: StatePart['kind'];
      progress?: number;
      metadata?: Record<string, unknown>;
    } = {},
  ): void {
    this.mutations.upsertStateOnCurrentMessage(stateId, {
      state,
      text,
      progress: options.progress,
      kind: options.kind,
      metadata: options.metadata,
    });
  }

  // ==================== 生命周期 ====================

  /**
   * 关闭原生 thinking 块（在 text_delta 或 tool_call_start 时调用）
   */
  private _closeNativeThinking(): void {
    if (this._nativeThinkStarted) {
      this.mutations.completeThinkingOnCurrentMessage();
      this._nativeThinkStarted = false;
    }
  }

  /**
   * 完成当前消息处理（关闭未闭合的 thinking 等）
   */
  finalize(): void {
    this._closeNativeThinking();
    // 如果还在 inline think 中，标记完成
    if (this._insideInlineThink) {
      this.mutations.completeThinkingOnCurrentMessage();
      this._insideInlineThink = false;
    }
    // ★ Phase 3: 后处理 MarkdownPart — 处理跨 chunk 的标签
    this._postProcessMarkdownParts();
  }

  /**
   * 重置状态（新 turn 或新消息开始时调用）
   */
  reset(): void {
    this._insideInlineThink = false;
    this._nativeThinkStarted = false;
    this._tagBuffer = '';
  }

  // ==================== Phase 3: 后处理 ====================

  /**
   * 流式结束后对 MarkdownPart 内容做最终净化：
   * - filterContextTags: <attachments>/<context> → 保持原始文本以让 x-markdown 渲染
   * - normalizeAilyMermaid: 确保 aily-mermaid 块是 JSON 格式
   * - fixContent 残余: 跨 chunk 的转义字符修复
   */
  private _postProcessMarkdownParts(): void {
    this.mutations.postProcessMarkdownOnCurrentMessage();
  }
}
