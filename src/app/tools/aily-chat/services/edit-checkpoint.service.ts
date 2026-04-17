/**
 * EditCheckpointService — Copilot-style 文件变更快照与回滚服务
 *
 * v2: 后端委托 aily-lex FileHistory 实现磁盘级备份/回滚，
 * 本服务仅负责 UI 协调（时间线游标、undo/redo、accept/reject、editsSummary）。
 *
 * 核心设计：
 * - fileHistory: aily-lex FileHistory 实例，负责文件备份与磁盘回滚
 * - initialFileContents: 每个文件首次被 AI 编辑前的原始内容（保留后刷新为当前态）
 * - currentTurnBaselines: 本轮 AI 编辑前的磁盘快照（每轮 recordEdit 时重新捕获）
 * - timeline: 线性快照时间线，每个 turn 一条元数据
 * - timelineIndex: 当前游标位置，支持 undo/redo 双向导航
 * - pendingSnapshot: Undo 前自动保存的"最新磁盘状态"Map，确保 redo 可恢复
 *
 * 持久化规则：
 * - 文件备份/快照由 lex FileHistory 自动持久化到 .aily/file-history/{sessionId}/
 * - 本服务不再独立持久化到 .aily_checkpoints/（已废弃）
 * - 会话恢复时通过 loadFromFileHistory() 从 FileHistory 重建状态
 */

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AilyHost } from '../core/host';
import type { FileHistory } from 'aily-lex';

// ============================
// 类型定义
// ============================

/** 一个 turn/request 对应的快照元数据（文件内容由 FileHistory 管理） */
export interface TurnSnapshot {
  requestId: string;
  turnIndex: number;
  /** @deprecated 使用 turnId 进行 Turn-native 截断 */
  conversationStartIndex: number;
  listStartIndex: number;
  /** 对应 TurnManager 中 Turn 的 ID，用于 Turn-native 回滚 */
  turnId?: string;
  /** 本 turn 是否有文件变更 */
  hasFileEdits: boolean;
  createdAt: number;
}

/** 回滚/恢复操作的结果 */
export interface RollbackResult {
  rolledBackFiles: number;
  errors: string[];
}

// ============================
// Service
// ============================

@Injectable()
export class EditCheckpointService {

  // ---- FileHistory (aily-lex) ----
  private fileHistory: FileHistory | null = null;

  /** 注入 FileHistory 实例（由 LexOwnerFacade 在 agent 创建后调用） */
  setFileHistory(fh: FileHistory | null): void {
    this.fileHistory = fh;
  }

  /** 获取 FileHistory 引用 */
  getFileHistory(): FileHistory | null {
    return this.fileHistory;
  }

  // ---- 内存状态 ----

  /** 每个文件首次被 AI 编辑前的原始内容 (null = 文件不存在) */
  private initialFileContents = new Map<string, string | null>();

  /** 快照时间线（线性历史），无上限 */
  private timeline: TurnSnapshot[] = [];

  /** 当前在时间线中的位置 (-1 = 初始状态/所有 turn 均已 undo) */
  private timelineIndex: number = -1;

  /**
   * 用户"保留"操作后的时间线索引位置。
   * undo 不会回退到此索引之前；getEditsSummary 以此为 diff 基线下限。
   * -1 表示未保留过。
   */
  private keptTimelineIndex: number = -1;

  /**
   * Copilot-style pendingSnapshot：
   * 在首次 undo 时自动拍摄当前磁盘状态（Map<filePath, content|null>），
   * 确保 redo 到最末端时能恢复。新 turn 开始时清除。
   */
  private pendingSnapshot: Map<string, string | null> | null = null;

  /** 当前 turn 中被修改的文件路径集合 */
  private currentTurnTrackedPaths = new Set<string>();

  /** 当前 turn 中各文件的操作类型 */
  private currentTurnOperations = new Map<string, 'create' | 'modify' | 'delete'>();

  /**
   * 本轮 AI 编辑前的磁盘基线（per-turn baseline）。
   * 每次 recordEdit 时捕获该文件此刻的磁盘内容，用于 getEditsSummary diff。
   */
  private currentTurnBaselines = new Map<string, string | null>();

  /** 是否在活跃 turn 中 */
  private isInTurn = false;

  /** 自动保存模式 */
  autoSaveEdits = false;

  // ---- UI 信号 ----

  private summarySubject = new BehaviorSubject<EditsSummary | null>(null);
  summaryChanged$ = this.summarySubject.asObservable();

  publishSummary(summary: EditsSummary | null): void {
    this.summarySubject.next(summary);
  }

  publishCurrentSummary(): void {
    if (this.autoSaveEdits && this.isInTurn) return;
    const summary = this.getEditsSummary();
    this.summarySubject.next(summary);
  }

  dismissSummary(): void {
    this.summarySubject.next(null);
  }

  // ==================== 保留（Accept All as Baseline） ====================

  acceptAllAsBaseline(): void {
    this.keptTimelineIndex = this.timelineIndex;
    this.pendingSnapshot = null;

    const fs = AilyHost.get().fs;
    for (const filePath of [...this.initialFileContents.keys()]) {
      try {
        if (fs.existsSync(filePath)) {
          this.initialFileContents.set(filePath, fs.readFileSync(filePath, 'utf-8'));
        } else {
          this.initialFileContents.set(filePath, null);
        }
      } catch { /* ignore */ }
    }
  }

  // ==================== Turn 管理 ====================

  startTurn(turnIndex: number, conversationStartIndex: number, listStartIndex: number, turnId?: string): void {
    if (this.isInTurn) {
      this.commitCurrentTurn();
    }

    // 截断 redo 历史
    if (this.timelineIndex < this.timeline.length - 1) {
      this.timeline.splice(this.timelineIndex + 1);
    }
    this.pendingSnapshot = null;

    const snapshot: TurnSnapshot = {
      requestId: `cp_${Date.now()}_${turnIndex}`,
      turnIndex,
      conversationStartIndex,
      listStartIndex,
      turnId,
      hasFileEdits: false,
      createdAt: Date.now(),
    };

    this.timeline.push(snapshot);
    this.timelineIndex = this.timeline.length - 1;

    this.currentTurnTrackedPaths.clear();
    this.currentTurnOperations.clear();
    this.currentTurnBaselines.clear();

    // 预捕获所有已跟踪文件的当前磁盘态作为本轮基线
    const fs = AilyHost.get().fs;
    for (const filePath of this.initialFileContents.keys()) {
      try {
        if (fs.existsSync(filePath)) {
          this.currentTurnBaselines.set(filePath, fs.readFileSync(filePath, 'utf-8'));
        } else {
          this.currentTurnBaselines.set(filePath, null);
        }
      } catch { /* ignore */ }
    }

    this.isInTurn = true;
  }

  /**
   * 记录一次文件编辑（在工具实际写盘前调用）。
   * 仅捕获内存级基线，磁盘备份由 lex FileHistory.trackEdit 负责。
   */
  recordEdit(filePath: string, type: 'create' | 'modify' | 'delete'): void {
    const fs = AilyHost.get().fs;

    if (!this.initialFileContents.has(filePath)) {
      let content: string | null = null;
      try {
        if (fs.existsSync(filePath)) {
          content = fs.readFileSync(filePath, 'utf-8');
        }
      } catch { /* ignore */ }
      this.initialFileContents.set(filePath, content);
    }

    if (!this.currentTurnBaselines.has(filePath)) {
      let content: string | null = null;
      try {
        if (fs.existsSync(filePath)) {
          content = fs.readFileSync(filePath, 'utf-8');
        }
      } catch { /* ignore */ }
      this.currentTurnBaselines.set(filePath, content);
    }

    this.currentTurnTrackedPaths.add(filePath);
    this.currentTurnOperations.set(filePath, type);
  }

  /**
   * 提交当前 turn — 标记完成。
   * 磁盘快照由 lex agent 的 FileHistory.makeSnapshot() 处理。
   */
  commitCurrentTurn(): void {
    if (!this.isInTurn) return;
    this.isInTurn = false;

    if (this.currentTurnTrackedPaths.size > 0) {
      const currentTurn = this.timeline[this.timelineIndex];
      if (currentTurn) {
        currentTurn.hasFileEdits = true;
      }
    }
  }

  // ==================== Undo / Redo ====================

  get canUndo(): boolean {
    return this.timelineIndex > this.keptTimelineIndex;
  }

  get canRedo(): boolean {
    return this.timelineIndex < this.timeline.length - 1 || this.pendingSnapshot !== null;
  }

  /**
   * 撤销到上一个快照状态。
   * 委托 FileHistory.rewind(turnId) 恢复磁盘文件。
   */
  async undo(): Promise<RollbackResult> {
    if (!this.canUndo) {
      return { rolledBackFiles: 0, errors: ['没有可撤销的操作'] };
    }

    this.ensurePendingSnapshot();
    this.timelineIndex--;

    // 确定目标 turnId
    const targetTurnId = this.timelineIndex >= 0
      ? this.timeline[this.timelineIndex].turnId
      : null;

    if (this.fileHistory) {
      try {
        if (targetTurnId) {
          const changed = await this.fileHistory.rewind(targetTurnId);
          return { rolledBackFiles: changed.length, errors: [] };
        }
        // 回到初始状态
        const initId = this.fileHistory.initialTurnId;
        if (initId) {
          const changed = await this.fileHistory.rewind(initId);
          return { rolledBackFiles: changed.length, errors: [] };
        }
      } catch (err: any) {
        return { rolledBackFiles: 0, errors: [err.message] };
      }
    }

    // Fallback: restore from initialFileContents
    return this.restoreToInitialState();
  }

  /**
   * 重做到下一个快照状态。
   * 时间线内使用 FileHistory.rewind; 超出部分使用 pendingSnapshot。
   */
  async redo(): Promise<RollbackResult> {
    if (this.timelineIndex < this.timeline.length - 1) {
      this.timelineIndex++;

      const turnId = this.timeline[this.timelineIndex].turnId;
      if (turnId && this.fileHistory) {
        try {
          const changed = await this.fileHistory.rewind(turnId);
          return { rolledBackFiles: changed.length, errors: [] };
        } catch (err: any) {
          return { rolledBackFiles: 0, errors: [err.message] };
        }
      }
      return { rolledBackFiles: 0, errors: [] };
    }

    if (this.pendingSnapshot) {
      return this.restoreFromPending();
    }

    return { rolledBackFiles: 0, errors: ['没有可重做的操作'] };
  }

  // ==================== Per-file Accept / Reject ====================

  acceptFile(filePath: string): void {
    this.initialFileContents.delete(filePath);
    this.currentTurnTrackedPaths.delete(filePath);
    this.currentTurnBaselines.delete(filePath);
    this.currentTurnOperations.delete(filePath);
  }

  /**
   * 拒绝单个文件的 AI 编辑 — 恢复到初始内容。
   * 优先通过 FileHistory.restoreFile 恢复；fallback 使用内存基线。
   */
  async rejectFile(filePath: string): Promise<RollbackResult> {
    if (!this.initialFileContents.has(filePath)) {
      return { rolledBackFiles: 0, errors: ['该文件未被追踪'] };
    }

    let result: RollbackResult;

    if (this.fileHistory?.initialTurnId) {
      try {
        const restored = await this.fileHistory.restoreFile(filePath, this.fileHistory.initialTurnId);
        result = { rolledBackFiles: restored ? 1 : 0, errors: [] };
      } catch (err: any) {
        result = { rolledBackFiles: 0, errors: [err.message] };
      }
    } else {
      result = this.restoreOneFile(filePath, this.initialFileContents.get(filePath)!);
    }

    this.initialFileContents.delete(filePath);
    this.currentTurnTrackedPaths.delete(filePath);
    this.currentTurnBaselines.delete(filePath);
    this.currentTurnOperations.delete(filePath);

    return result;
  }

  // ==================== 快照访问 ====================

  getSnapshotByRequestId(requestId: string): TurnSnapshot | undefined {
    return this.timeline.find(s => s.requestId === requestId);
  }

  getSnapshotByListIndex(listIndex: number): TurnSnapshot | undefined {
    return this.timeline.find(s =>
      s.listStartIndex === listIndex || s.listStartIndex === listIndex + 1
    );
  }

  getTurnStartListIndexByAnyListIndex(listIndex: number): number | null {
    let matched: TurnSnapshot | undefined;
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const snapshot = this.timeline[i];
      const userMsgIndex = snapshot.listStartIndex - 1;
      if (userMsgIndex <= listIndex) {
        matched = snapshot;
        break;
      }
    }
    return matched ? matched.listStartIndex - 1 : null;
  }

  getLatestSnapshot(): TurnSnapshot | undefined {
    return this.timeline.length > 0 ? this.timeline[this.timeline.length - 1] : undefined;
  }

  // ==================== 截断（用于 restoreToCheckpoint / regenerate） ====================

  async truncateFromSnapshot(requestId: string): Promise<RollbackResult> {
    const idx = this.timeline.findIndex(s => s.requestId === requestId);
    if (idx === -1) {
      return { rolledBackFiles: 0, errors: [`未找到快照: ${requestId}`] };
    }

    let result: RollbackResult;

    if (this.fileHistory) {
      try {
        const targetTurnId = idx > 0 ? this.timeline[idx - 1].turnId : this.fileHistory.initialTurnId;
        if (targetTurnId) {
          const changed = await this.fileHistory.rewind(targetTurnId);
          result = { rolledBackFiles: changed.length, errors: [] };
        } else {
          result = this.restoreToInitialState();
        }
      } catch (err: any) {
        result = { rolledBackFiles: 0, errors: [err.message] };
      }
    } else {
      result = this.restoreToInitialState();
    }

    this.timeline.splice(idx);
    this.timelineIndex = this.timeline.length - 1;
    this.pendingSnapshot = null;
    this.keptTimelineIndex = this.timeline.length - 1;

    return result;
  }

  // ==================== 查询 ====================

  hasEditsInCurrentTurn(): boolean {
    return this.currentTurnTrackedPaths.size > 0;
  }

  getTotalEditCount(): number {
    return this.initialFileContents.size;
  }

  get trackedFileCount(): number {
    return this.initialFileContents.size;
  }

  hasUnsavedEdits(): boolean {
    if (this.initialFileContents.size === 0) return false;
    return this.keptTimelineIndex < this.timelineIndex;
  }

  getTrackedFiles(): string[] {
    return [...this.initialFileContents.keys()];
  }

  getInitialContent(filePath: string): string | null | undefined {
    return this.initialFileContents.get(filePath);
  }

  // ==================== 编辑摘要 ====================

  getEditsSummary(requestId?: string): EditsSummary | null {
    if (this.initialFileContents.size === 0 && this.currentTurnTrackedPaths.size === 0) {
      return null;
    }
    if (this.keptTimelineIndex >= this.timelineIndex && this.currentTurnTrackedPaths.size === 0) {
      return null;
    }

    const fs = AilyHost.get().fs;
    const pathUtil = AilyHost.get().path;
    const projectPath = AilyHost.get().project.currentProjectPath || '';

    let totalAdded = 0;
    let totalRemoved = 0;
    const files: EditFileSummary[] = [];

    const filesToCheck = this.currentTurnTrackedPaths.size > 0
      ? this.currentTurnTrackedPaths
      : this.initialFileContents.keys();

    for (const filePath of filesToCheck) {
      const baselineContent = this.currentTurnBaselines.get(filePath)
        ?? this.initialFileContents.get(filePath)
        ?? null;

      let currentContent: string | null = null;
      try {
        if (fs.existsSync(filePath)) {
          currentContent = fs.readFileSync(filePath, 'utf-8');
        }
      } catch { /* ignore */ }

      if (currentContent === baselineContent) continue;

      const relativePath = projectPath
        ? pathUtil.relative(projectPath, filePath)
        : pathUtil.basename(filePath);

      let added = 0, removed = 0;
      let type: 'create' | 'modify' | 'delete';

      if (baselineContent === null && currentContent !== null) {
        type = 'create';
        added = currentContent.split('\n').length;
      } else if (baselineContent !== null && currentContent === null) {
        type = 'delete';
        removed = baselineContent.split('\n').length;
      } else {
        type = this.currentTurnOperations.get(filePath) || 'modify';
        const oldLines = (baselineContent || '').split('\n');
        const newLines = (currentContent || '').split('\n');
        const oldBag = new Map<string, number>();
        for (const line of oldLines) {
          oldBag.set(line, (oldBag.get(line) || 0) + 1);
        }
        let matched = 0;
        const tempBag = new Map(oldBag);
        for (const line of newLines) {
          const count = tempBag.get(line) || 0;
          if (count > 0) {
            tempBag.set(line, count - 1);
            matched++;
          }
        }
        removed = oldLines.length - matched;
        added = newLines.length - matched;
      }

      totalAdded += added;
      totalRemoved += removed;
      files.push({ path: relativePath, fullPath: filePath, type, added, removed });
    }

    if (files.length === 0) return null;

    const latestSnapshot = this.getLatestSnapshot();
    return {
      checkpointId: requestId || latestSnapshot?.requestId || 'current',
      fileCount: files.length,
      totalAdded,
      totalRemoved,
      files,
    };
  }

  // ==================== 从 FileHistory 加载（替代旧 loadFromDisk） ====================

  /**
   * 从 lex FileHistory 恢复时间线状态。
   * 替代旧的 loadFromDisk()，不再读取 .aily_checkpoints/。
   */
  async loadFromFileHistory(): Promise<boolean> {
    if (!this.fileHistory) return false;

    try {
      await this.fileHistory.load();

      const snapshots = this.fileHistory.snapshots;
      if (snapshots.length === 0) return false;

      // 从 FileHistory.snapshots 重建时间线（跳过 __init__ 等内部快照）
      this.timeline = [];
      for (const snap of snapshots) {
        if (snap.turnId === '__init__') continue;
        this.timeline.push({
          requestId: `cp_fh_${snap.timestamp}_${this.timeline.length}`,
          turnIndex: this.timeline.length,
          conversationStartIndex: -1,
          listStartIndex: -1,
          turnId: snap.turnId,
          hasFileEdits: Object.keys(snap.trackedFileBackups).length > 0,
          createdAt: snap.timestamp,
        });
      }

      this.timelineIndex = this.timeline.length - 1;
      this.keptTimelineIndex = -1;

      // 从 __init__ 快照恢复 initialFileContents
      this.initialFileContents.clear();
      const initId = this.fileHistory.initialTurnId;
      if (initId) {
        for (const filePath of this.fileHistory.trackedFiles) {
          const content = await this.fileHistory.readBackup(filePath, initId);
          if (content !== undefined) {
            this.initialFileContents.set(filePath, content);
          }
        }
      }

      this.pendingSnapshot = null;
      this.currentTurnTrackedPaths.clear();
      this.currentTurnOperations.clear();
      this.currentTurnBaselines.clear();
      this.isInTurn = false;

      return true;
    } catch (err) {
      console.warn('[EditCheckpoint] loadFromFileHistory failed:', err);
      return false;
    }
  }

  // ==================== 清理 ====================

  /**
   * 静态方法：删除指定会话的 FileHistory 文件。
   * 供 ChatHistoryService 在删除会话时调用。
   */
  static cleanSessionCheckpoints(projectPath: string, sessionId: string): void {
    if (!projectPath || !sessionId) return;
    const fs = AilyHost.get().fs;
    const pathUtil = AilyHost.get().path;

    // 清理新格式：.aily/file-history/{sessionId}/
    const fhDir = pathUtil.join(projectPath, '.aily', 'file-history', sessionId);
    try {
      if (fs.existsSync(fhDir)) {
        const removeDir = (dirPath: string) => {
          if (!fs.existsSync(dirPath)) return;
          const entries = fs.readdirSync(dirPath);
          for (const entry of entries) {
            const fullPath = `${dirPath}/${entry}`;
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) { removeDir(fullPath); } else { fs.unlinkSync(fullPath); }
          }
          fs.rmdirSync(dirPath);
        };
        removeDir(fhDir);
      }
    } catch (err) {
      console.warn('[EditCheckpoint] cleanSessionCheckpoints (fh) failed:', err);
    }

    // 兼容清理旧格式：.aily_checkpoints/{sessionId}/
    const legacyDir = pathUtil.join(projectPath, '.aily_checkpoints', sessionId);
    try {
      if (fs.existsSync(legacyDir)) {
        const removeDir = (dirPath: string) => {
          if (!fs.existsSync(dirPath)) return;
          const entries = fs.readdirSync(dirPath);
          for (const entry of entries) {
            const fullPath = `${dirPath}/${entry}`;
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) { removeDir(fullPath); } else { fs.unlinkSync(fullPath); }
          }
          fs.rmdirSync(dirPath);
        };
        removeDir(legacyDir);
      }
    } catch { /* ignore legacy cleanup errors */ }
  }

  clear(): void {
    this.initialFileContents.clear();
    this.timeline = [];
    this.timelineIndex = -1;
    this.keptTimelineIndex = -1;
    this.pendingSnapshot = null;
    this.currentTurnTrackedPaths.clear();
    this.currentTurnOperations.clear();
    this.currentTurnBaselines.clear();
    this.isInTurn = false;
    this.fileHistory = null;
  }

  // ==================== 内部辅助方法 ====================

  /** 在首次 undo 时拍摄当前磁盘状态，确保 redo 可恢复 */
  private ensurePendingSnapshot(): void {
    if (this.pendingSnapshot) return;
    const fs = AilyHost.get().fs;
    const map = new Map<string, string | null>();
    for (const filePath of this.initialFileContents.keys()) {
      try {
        if (fs.existsSync(filePath)) {
          map.set(filePath, fs.readFileSync(filePath, 'utf-8'));
        } else {
          map.set(filePath, null);
        }
      } catch { /* ignore */ }
    }
    this.pendingSnapshot = map;
  }

  /** 从 pendingSnapshot 恢复所有文件 */
  private restoreFromPending(): RollbackResult {
    if (!this.pendingSnapshot) return { rolledBackFiles: 0, errors: ['没有待恢复的快照'] };
    const fs = AilyHost.get().fs;
    const pathUtil = AilyHost.get().path;
    let rolledBackFiles = 0;
    const errors: string[] = [];

    for (const [filePath, content] of this.pendingSnapshot) {
      try {
        const currentExists = fs.existsSync(filePath);
        const currentContent = currentExists ? fs.readFileSync(filePath, 'utf-8') : null;
        if (currentContent === content) continue;

        if (content === null) {
          if (currentExists) { fs.unlinkSync(filePath); rolledBackFiles++; }
        } else {
          const dirPath = pathUtil.dirname(filePath);
          if (!fs.existsSync(dirPath)) { fs.mkdirSync(dirPath, { recursive: true }); }
          fs.writeFileSync(filePath, content, 'utf-8');
          rolledBackFiles++;
        }
      } catch (err: any) {
        errors.push(`恢复 ${filePath} 失败: ${err.message}`);
      }
    }

    this.pendingSnapshot = null;
    return { rolledBackFiles, errors };
  }

  /** Fallback: 从内存 initialFileContents 恢复所有文件到初始状态 */
  private restoreToInitialState(): RollbackResult {
    const fs = AilyHost.get().fs;
    const pathUtil = AilyHost.get().path;
    let rolledBackFiles = 0;
    const errors: string[] = [];

    for (const [filePath, initialContent] of this.initialFileContents) {
      try {
        const currentExists = fs.existsSync(filePath);
        const currentContent = currentExists ? fs.readFileSync(filePath, 'utf-8') : null;
        if (currentContent === initialContent) continue;

        if (initialContent === null) {
          if (currentExists) { fs.unlinkSync(filePath); rolledBackFiles++; }
        } else {
          const dirPath = pathUtil.dirname(filePath);
          if (!fs.existsSync(dirPath)) { fs.mkdirSync(dirPath, { recursive: true }); }
          fs.writeFileSync(filePath, initialContent, 'utf-8');
          rolledBackFiles++;
        }
      } catch (err: any) {
        errors.push(`恢复 ${filePath} 失败: ${err.message}`);
      }
    }

    return { rolledBackFiles, errors };
  }

  /** 恢复单个文件到目标内容 */
  private restoreOneFile(filePath: string, targetContent: string | null): RollbackResult {
    const fs = AilyHost.get().fs;
    const pathUtil = AilyHost.get().path;
    try {
      if (targetContent === null) {
        if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
      } else {
        const dirPath = pathUtil.dirname(filePath);
        if (!fs.existsSync(dirPath)) { fs.mkdirSync(dirPath, { recursive: true }); }
        fs.writeFileSync(filePath, targetContent, 'utf-8');
      }
      return { rolledBackFiles: 1, errors: [] };
    } catch (err: any) {
      return { rolledBackFiles: 0, errors: [`恢复 ${filePath} 失败: ${err.message}`] };
    }
  }
}

// ============================
// 导出类型
// ============================

export interface EditFileSummary {
  path: string;
  fullPath: string;
  type: 'create' | 'modify' | 'delete';
  added: number;
  removed: number;
}

export interface EditsSummary {
  checkpointId: string;
  fileCount: number;
  totalAdded: number;
  totalRemoved: number;
  files: EditFileSummary[];
}
