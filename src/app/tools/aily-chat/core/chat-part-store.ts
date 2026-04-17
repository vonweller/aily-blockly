/**
 * ChatPartStore — Part-based 消息存储
 *
 * 管理每条消息的 Parts 数组，支持：
 *   - addPart / updatePart / appendToMarkdown — 增量更新
 *   - getParts / getLastPart — 查询
 *   - changes$ — 变更通知（供组件 subscribe 驱动渲染）
 *
 * 设计：纯 TypeScript class（非 Angular injectable），由 ChatEngineService 持有实例。
 * 与 think-content-store 类似的全局 Map 模式，但结构化。
 */

import { Subject } from 'rxjs';
import {
  ChatPart, MarkdownPart, ThinkingPart, ToolCallPart, StatePart,
  mkMarkdown, mkThinking, mkToolCall, mkError,
} from './chat-parts';
import type { SubagentPart } from './chat-parts';
import type { ApprovalPart, QuestionPart } from './chat-parts';

// ==================== 变更事件 ====================

export interface PartChange {
  /** 消息在 list 中的索引 */
  msgIndex: number;
  /** Part 在该消息 parts 数组中的索引 */
  partIndex: number;
  /** 变更类型 */
  kind: 'add' | 'update' | 'append';
}

// ==================== Store ====================

export class ChatPartStore {
  /** msgIndex → ChatPart[] */
  private _store = new Map<number, ChatPart[]>();

  /** 变更通知流 */
  readonly changes$ = new Subject<PartChange>();

  // ==================== 查询 ====================

  /** 获取指定消息的所有 Parts */
  getParts(msgIndex: number): ChatPart[] {
    return this._store.get(msgIndex) || [];
  }

  /** 获取指定消息的最后一个 Part */
  getLastPart(msgIndex: number): ChatPart | undefined {
    const parts = this._store.get(msgIndex);
    return parts && parts.length > 0 ? parts[parts.length - 1] : undefined;
  }

  /** 获取指定消息的指定 Part */
  getPart(msgIndex: number, partIndex: number): ChatPart | undefined {
    const parts = this._store.get(msgIndex);
    return parts ? parts[partIndex] : undefined;
  }

  /** 检查消息是否有 Parts */
  hasParts(msgIndex: number): boolean {
    const parts = this._store.get(msgIndex);
    return !!parts && parts.length > 0;
  }

  // ==================== 写入 ====================

  /** 添加新 Part 到消息末尾 */
  addPart(msgIndex: number, part: ChatPart): number {
    let parts = this._store.get(msgIndex);
    if (!parts) {
      parts = [];
      this._store.set(msgIndex, parts);
    }
    const partIndex = parts.length;
    parts.push(part);
    this.changes$.next({ msgIndex, partIndex, kind: 'add' });
    return partIndex;
  }

  /** 在指定位置插入 Part。超出范围时追加到末尾。 */
  insertPart(msgIndex: number, partIndex: number, part: ChatPart): number {
    let parts = this._store.get(msgIndex);
    if (!parts) {
      parts = [];
      this._store.set(msgIndex, parts);
    }

    const nextIndex = Math.max(0, Math.min(partIndex, parts.length));
    parts.splice(nextIndex, 0, part);
    this.changes$.next({ msgIndex, partIndex: nextIndex, kind: 'add' });
    return nextIndex;
  }

  /** 更新指定 Part（整体替换） */
  updatePart(msgIndex: number, partIndex: number, part: ChatPart): void {
    const parts = this._store.get(msgIndex);
    if (!parts || partIndex >= parts.length) return;
    parts[partIndex] = part;
    this.changes$.next({ msgIndex, partIndex, kind: 'update' });
  }

  /** 移除指定 Part */
  removePart(msgIndex: number, partIndex: number): void {
    const parts = this._store.get(msgIndex);
    if (!parts || partIndex >= parts.length) return;
    parts.splice(partIndex, 1);
    // 通知变更（使用最后一个有效索引）
    this.changes$.next({ msgIndex, partIndex: Math.max(0, parts.length - 1), kind: 'update' });
  }

  /**
   * 追加文本到最后一个 MarkdownPart。
   * 如果最后一个 Part 不是 MarkdownPart，则创建新的。
   * 返回受影响的 partIndex。
   */
  appendToMarkdown(msgIndex: number, text: string): number {
    let parts = this._store.get(msgIndex);
    if (!parts) {
      parts = [];
      this._store.set(msgIndex, parts);
    }

    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (last && last.type === 'markdown') {
      const idx = parts.length - 1;
      (last as MarkdownPart).content += text;
      this.changes$.next({ msgIndex, partIndex: idx, kind: 'append' });
      return idx;
    }

    // 创建新 MarkdownPart
    const idx = parts.length;
    parts.push(mkMarkdown(text));
    this.changes$.next({ msgIndex, partIndex: idx, kind: 'add' });
    return idx;
  }

  /**
   * 追加文本到最后一个 ThinkingPart。
   * 如果最后一个 Part 不是 ThinkingPart，则创建新的。
   */
  appendToThinking(msgIndex: number, text: string): number {
    let parts = this._store.get(msgIndex);
    if (!parts) {
      parts = [];
      this._store.set(msgIndex, parts);
    }

    const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
    if (last && last.type === 'thinking') {
      const idx = parts.length - 1;
      (last as ThinkingPart).content += text;
      this.changes$.next({ msgIndex, partIndex: idx, kind: 'append' });
      return idx;
    }

    // 创建新 ThinkingPart（streaming，未完成）
    const idx = parts.length;
    parts.push(mkThinking(text, false));
    this.changes$.next({ msgIndex, partIndex: idx, kind: 'add' });
    return idx;
  }

  /**
   * 完成最后一个 ThinkingPart（设 isComplete = true）
   */
  completeThinking(msgIndex: number): void {
    const parts = this._store.get(msgIndex);
    if (!parts) return;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === 'thinking') {
        (parts[i] as ThinkingPart).isComplete = true;
        this.changes$.next({ msgIndex, partIndex: i, kind: 'update' });
        break;
      }
    }
  }

  /**
   * 更新 ToolCallPart 的状态和文本
   */
  updateToolCall(msgIndex: number, toolCallId: string, state: ToolCallPart['state'], text: string): void {
    const parts = this._store.get(msgIndex);
    if (!parts) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.type === 'tool_call' && p.toolCallId === toolCallId) {
        (p as ToolCallPart).state = state;
        (p as ToolCallPart).text = text;
        this.changes$.next({ msgIndex, partIndex: i, kind: 'update' });
        return;
      }
    }
  }

  /** 更新 StatePart 的状态/文本 */
  updateState(
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
    const parts = this._store.get(msgIndex);
    if (!parts) return;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type === 'state' && p.stateId === stateId) {
        (p as StatePart).state = next.state;
        (p as StatePart).text = next.text;
        if ('progress' in next) {
          (p as StatePart).progress = next.progress;
        }
        if ('kind' in next) {
          (p as StatePart).kind = next.kind;
        }
        if ('metadata' in next) {
          (p as StatePart).metadata = next.metadata;
        }
        this.changes$.next({ msgIndex, partIndex: i, kind: 'update' });
        return;
      }
    }
  }

  /**
   * 更新 SubagentPart 的状态和结果
   */
  updateSubagent(msgIndex: number, toolCallId: string, state: SubagentPart['state'], resultText: string): void {
    const parts = this._store.get(msgIndex);
    if (!parts) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.type === 'subagent' && p.toolCallId === toolCallId) {
        (p as SubagentPart).state = state;
        (p as SubagentPart).resultText = resultText;
        this.changes$.next({ msgIndex, partIndex: i, kind: 'update' });
        return;
      }
    }
  }

  updateQuestionAnswers(
    msgIndex: number,
    answers: QuestionPart['answers'],
  ): boolean {
    const parts = this._store.get(msgIndex);
    if (!parts) return false;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part.type !== 'question') continue;
      this.updatePart(msgIndex, i, {
        ...(part as QuestionPart),
        answers,
      });
      return true;
    }
    return false;
  }

  updateApprovalResult(
    msgIndex: number,
    askId: string,
    next: {
      resolved: boolean;
      result?: ApprovalPart['result'];
      scope?: ApprovalPart['scope'];
    },
  ): boolean {
    const parts = this._store.get(msgIndex);
    if (!parts) return false;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part.type !== 'approval' || part.askId !== askId) continue;
      this.updatePart(msgIndex, i, {
        ...(part as ApprovalPart),
        resolved: next.resolved,
        result: next.result,
        scope: next.scope,
      });
      return true;
    }
    return false;
  }

  // ==================== 按 toolCallId 查找 ====================

  /** 查找包含指定 toolCallId 的消息索引（兼容 ToolCallPart 和 SubagentPart） */
  findToolCallMsgIndex(toolCallId: string): number | undefined {
    for (const [msgIndex, parts] of this._store) {
      for (const p of parts) {
        if ((p.type === 'tool_call' || p.type === 'subagent') && p.toolCallId === toolCallId) {
          return msgIndex;
        }
      }
    }
    return undefined;
  }

  // ==================== 生命周期 ====================

  /** 清除指定消息的 Parts */
  clearMessage(msgIndex: number): void {
    this._store.delete(msgIndex);
  }

  /** 重置所有数据 */
  reset(): void {
    this._store.clear();
  }

  /** 销毁（关闭 Subject） */
  destroy(): void {
    this._store.clear();
    this.changes$.complete();
  }

  // ==================== 序列化 ====================

  /**
   * 将 Parts 序列化为 content string（用于会话持久化）
   * 将 Part 模型转换回现有的 string 格式（<think>、aily-state 代码块等）
   */
  serializeToContent(msgIndex: number): string {
    const parts = this._store.get(msgIndex);
    if (!parts || parts.length === 0) return '';

    const segments: string[] = [];
    for (const part of parts) {
      switch (part.type) {
        case 'markdown':
          segments.push(part.content);
          break;
        case 'thinking':
          segments.push(`<think>${part.content}</think>`);
          break;
        case 'tool_call':
          segments.push(
            `\n\`\`\`aily-state\n${JSON.stringify({ state: part.state, text: part.text, id: part.toolCallId })}\n\`\`\`\n`
          );
          break;
        case 'state': {
          const payload: Record<string, unknown> = {
            displayKind: 'state',
            state: part.state,
            text: part.text,
            id: part.stateId,
          };
          if (part.kind) payload['kind'] = part.kind;
          if (part.progress != null) payload['progress'] = part.progress;
          if (part.metadata) payload['metadata'] = part.metadata;
          segments.push(`\n\`\`\`aily-state\n${JSON.stringify(payload)}\n\`\`\`\n`);
          break;
        }
        case 'error':
          segments.push(
            `\n\`\`\`aily-error\n${JSON.stringify({ message: part.message })}\n\`\`\`\n`
          );
          break;
        case 'question':
          segments.push(
            `\n\`\`\`aily-question\n${JSON.stringify({ questions: part.questions, answers: part.answers })}\n\`\`\`\n`
          );
          break;
        case 'approval':
          segments.push(
            `\n\`\`\`aily-ask-confirm\n${JSON.stringify({ askId: part.askId, message: part.message, toolName: part.toolName, source: part.source, resolved: part.resolved, result: part.result, scope: part.scope })}\n\`\`\`\n`
          );
          break;
        case 'terminal':
          segments.push(
            `\n\`\`\`aily-terminal\n${JSON.stringify({ command: part.command, output: part.output, stderr: part.stderr, exitCode: part.exitCode, isRunning: false, toolCallId: part.toolCallId })}\n\`\`\`\n`
          );
          break;
        case 'subagent': {
          const saData: Record<string, unknown> = {
            agentName: part.agentName,
            description: part.description,
            state: part.state,
            toolCallId: part.toolCallId,
          };
          if (part.childItems && part.childItems.length > 0) {
            saData['childItems'] = part.childItems;
          }
          if (part.resultText) {
            saData['resultText'] = part.resultText;
          }
          segments.push(
            `\n\`\`\`aily-subagent\n${JSON.stringify(saData)}\n\`\`\`\n`
          );
          break;
        }
      }
    }
    return segments.join('');
  }
}
