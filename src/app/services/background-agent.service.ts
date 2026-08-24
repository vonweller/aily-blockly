/**
 * BackgroundAgentService - 后台 Agent 服务
 *
 * 通过 aily-chat 后台创建独立 session，用于连线图自动生成。
 * - 不依赖聊天 UI 挂载和输入框自动发送
 * - 后台统一判断是否已有 SchematicAgent 在执行
 * - 通过 IPC 推送进度到连线图子窗口
 */

import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { ElectronService } from './electron.service';
import { ProjectService } from './project.service';
import { ConnectionGraphService } from './connection-graph.service';
import { ChildToolProcessService } from './child-tool-process.service';

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

const AILY_CHAT_TOOL_ID = 'aily-chat-react';
const AILY_CHAT_HOST_SERVICE_CHANNEL = 'aily-chat-host-service-v1';
const SCHEMATIC_GENERATION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SCHEMATIC_PROMPT = '@SchematicAgent 生成项目连线图';

interface SchematicGenerationResponse {
  channel: typeof AILY_CHAT_HOST_SERVICE_CHANNEL;
  type: 'response';
  requestId: string;
  result?: {
    accepted?: boolean;
    reason?: 'schematic-agent-running';
    sessionId?: string;
    state?: 'settled' | 'rejected' | 'failed';
    error?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class BackgroundAgentService implements OnDestroy {
  // ===== 状态 =====
  private progress$ = new Subject<ProgressEvent>();
  private status: BackgroundAgentStatus = 'idle';

  constructor(
    private projectService: ProjectService,
    private connectionGraphService: ConnectionGraphService,
    private electronService: ElectronService,
    private childToolProcess: ChildToolProcessService,
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

  /**
   * Starts the user-visible reconciliation step for a Simulator-owned Scene.
   * Completion is deliberately not implied here: the project host will only
   * accept a later Builder result that carries the exact graph revision.
   */
  requestSimulatorSceneCodeReconciliation(request: {
    sceneId: string;
    expectedGraphSemanticRevision: string;
    sceneDocument: unknown;
  }): boolean {
    if (typeof window.openAndSendToAilyChat !== 'function') return false;
    const sceneSnapshot = JSON.stringify(request.sceneDocument, null, 2);
    const prompt = `请根据 Simulator Scene 的最新硬件语义，协调当前 Blockly 代码。

## 约束
1. Scene ID: ${request.sceneId}
2. graphSemanticRevision: ${request.expectedGraphSemanticRevision}
3. 只修改当前项目的 Blockly/生成代码所需内容，不启动或控制 QEMU/GDB。
4. 完成修改后告知用户返回 Simulator 再次点击 “Sync code & rebuild”；
   Artifact 编译和替换由独立 project host 继续协调。

## SceneEditorDocument
\`\`\`json
${sceneSnapshot}
\`\`\``;
    window.openAndSendToAilyChat(prompt, { autoSend: true });
    return true;
  }

  /** 进度事件流 */
  onProgress(): Observable<ProgressEvent> {
    return this.progress$.asObservable();
  }

  /**
   * 启动连线图生成任务
   * 完整流程：启动/复用 aily-chat 后台 → 请求创建 session → 执行提示词 → 完成
   */
  async generateSchematic(prompt = DEFAULT_SCHEMATIC_PROMPT): Promise<void> {
    if (this.isRunning) {
      console.warn('[BackgroundAgent] 任务已在运行中');
      return;
    }

    const cwd = this.projectService.currentProjectPath;
    if (!cwd) {
      this.status = 'error';
      this.emitProgress('error', '请先打开项目');
      return;
    }

    this.status = 'running';
    this.emitProgress('thinking', '正在分析项目...');
    let runtimeAcquired = false;

    try {
      await this.childToolProcess.acquire(AILY_CHAT_TOOL_ID);
      runtimeAcquired = true;

      const result = await this.requestSchematicGeneration(cwd, prompt);
      if (result.accepted === false && result.reason === 'schematic-agent-running') {
        this.status = 'completed';
        this.emitProgress('complete', '已有连线图 Agent 正在执行');
        return;
      }

      if (result.accepted !== true || result.state !== 'settled') {
        throw new Error(result.error || '连线图生成失败');
      }

      this.status = 'completed';
      this.emitProgress('complete', '连线图生成完成');
    } catch (error: any) {
      this.status = 'error';
      this.emitProgress('error', error.message || '连线图生成失败');
      console.error('[BackgroundAgent] 生成失败:', error);
    } finally {
      if (runtimeAcquired) {
        await this.childToolProcess.release(AILY_CHAT_TOOL_ID);
      }
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

  private requestSchematicGeneration(
    cwd: string,
    prompt: string,
  ): Promise<NonNullable<SchematicGenerationResponse['result']>> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const removeListener = this.childToolProcess.onMessage(
        AILY_CHAT_TOOL_ID,
        (message) => {
          const response = message as unknown as SchematicGenerationResponse;
          if (
            response.channel !== AILY_CHAT_HOST_SERVICE_CHANNEL ||
            response.type !== 'response' ||
            response.requestId !== requestId
          ) {
            return;
          }

          clearTimeout(timeout);
          removeListener();
          if (response.result) resolve(response.result);
          else reject(new Error('Aily Chat 后台未返回连线图任务结果'));
        },
      );
      const timeout = setTimeout(() => {
        removeListener();
        reject(new Error('连线图后台任务执行超时'));
      }, SCHEMATIC_GENERATION_TIMEOUT_MS);

      void this.childToolProcess
        .sendMessage(AILY_CHAT_TOOL_ID, {
          channel: AILY_CHAT_HOST_SERVICE_CHANNEL,
          type: 'request',
          requestId,
          action: 'schematic.generate',
          cwd,
          prompt,
        })
        .catch((error) => {
          clearTimeout(timeout);
          removeListener();
          reject(error);
        });
    });
  }

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
