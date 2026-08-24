/**
 * BackgroundAgentService - 后台 Agent 服务
 *
 * 负责连线图子窗口与新版 Aily Chat 之间的宿主转发。
 * - 不再启动旧版 aily-chat 后台执行链
 * - 将连线图提示词交给新版 Aily Chat 会话
 * - 通过 IPC 推送提示词转交状态到连线图子窗口
 */

import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { ElectronService } from './electron.service';
import { ConnectionGraphService } from './connection-graph.service';

// ===== 类型定义 =====

export type ProgressEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'text'
  | 'complete'
  | 'error';

export interface ProgressEvent {
  type: ProgressEventType;
  content: string;
  toolName?: string;
  timestamp: number;
  data?: any;
}

export type BackgroundAgentStatus = 'idle' | 'running' | 'completed' | 'error';

const DEFAULT_SCHEMATIC_PROMPT = '@SchematicAgent 生成项目连线图';

@Injectable({
  providedIn: 'root'
})
export class BackgroundAgentService implements OnDestroy {
  // ===== 状态 =====
  private progress$ = new Subject<ProgressEvent>();
  private status: BackgroundAgentStatus = 'idle';

  constructor(
    private connectionGraphService: ConnectionGraphService,
    private electronService: ElectronService,
  ) {
    this.setupIpcListeners();
    console.log('[BackgroundAgent] 服务初始化');
  }

  ngOnDestroy(): void {
    this.status = 'idle';
  }

  // =========================================================================
  // 公共 API
  // =========================================================================

  /** 当前状态 */
  get currentStatus(): BackgroundAgentStatus {
    return this.status;
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.status === 'running';
  }

  /** 进度事件流 */
  onProgress(): Observable<ProgressEvent> {
    return this.progress$.asObservable();
  }

  /**
   * 启动连线图生成任务
   * 当前只负责将提示词转交给新版 Aily Chat；具体执行由新版会话负责。
   */
  async generateSchematic(prompt = DEFAULT_SCHEMATIC_PROMPT): Promise<void> {
    if (this.isRunning) {
      console.warn('[BackgroundAgent] 任务已在运行中');
      return;
    }

    if (!window.openAndSendToAilyChat) {
      this.status = 'error';
      this.emitProgress('error', '新版 Aily Chat 当前不可用');
      return;
    }

    this.status = 'running';
    this.emitProgress('thinking', '正在转交给新版 Aily Chat...');

    try {
      window.openAndSendToAilyChat(prompt, { autoSend: true });
      this.status = 'completed';
      this.emitProgress('complete', '已转交新版 Aily Chat');
    } catch (error: any) {
      this.status = 'error';
      this.emitProgress('error', error.message || '无法打开新版 Aily Chat');
      console.error('[BackgroundAgent] 转交失败:', error);
    }
  }

  // =========================================================================
  // IPC 监听（来自连线图子窗口的请求）
  // =========================================================================

  private setupIpcListeners(): void {
    if (!this.electronService.isElectron || !window['ipcRenderer']) return;

    window['ipcRenderer'].on('iframe-message-connection-graph', (_event: any, payload: { type: string; data?: unknown }) => {
      if (payload?.type === 'generate-graph-data') {
        const prompt = typeof (payload.data as { prompt?: unknown } | undefined)?.prompt === 'string'
          ? (payload.data as { prompt: string }).prompt
          : DEFAULT_SCHEMATIC_PROMPT;
        void this.generateSchematic(prompt);
        return;
      }
      if (payload?.type === 'send-to-chat') {
        const { text, autoSend } = (payload.data || {}) as { text?: string; autoSend?: boolean };
        if (text && window.openAndSendToAilyChat) {
          window.openAndSendToAilyChat(text, { autoSend: autoSend !== false });
        }
        return;
      }
      if (payload?.type === 'generate-graph-code') {
        console.log('[BackgroundAgent] 收到同步到代码请求');
        this.handleSyncToCodeRequest();
      }
    });
  }

  // =========================================================================
  // "同步到代码" 处理
  // =========================================================================

  private handleSyncToCodeRequest(): void {
    const connectionData = this.connectionGraphService.getConnectionGraph();
    if (!connectionData) {
      console.warn('[BackgroundAgent] 同步到代码: 无连线图数据');
      return;
    }

    const componentSummary = (connectionData.components || [])
      .map((c: any) => `- ${c.title || c.refId || c.id}`)
      .join('\n');

    const prompt = `请根据当前连线图方案，将硬件连线配置同步到项目代码中。

## 当前连线组件
${componentSummary}

## 连线数量
${(connectionData.connections || []).length} 条连线

请分析连线图，在代码中添加或修改对应的传感器初始化和引脚配置代码。`;

    if (window.openAndSendToAilyChat) {
      window.openAndSendToAilyChat(prompt, { autoSend: true });
    }
  }

  // =========================================================================
  // 进度推送
  // =========================================================================

  private emitProgress(type: ProgressEventType, content: string, toolName?: string, data?: any): void {
    const event: ProgressEvent = {
      type,
      content,
      toolName,
      timestamp: Date.now(),
      data,
    };

    this.progress$.next(event);

    if (this.electronService.isElectron && window['ipcRenderer']) {
      window['ipcRenderer'].send('iframe-message-connection-graph', { type: 'generate-graph-progress', data: event });
    }
  }
}
