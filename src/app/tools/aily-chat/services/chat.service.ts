import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject } from 'rxjs';
import { MCPTool } from './mcp.service';
import { ChatAPI } from '../core/api-endpoints';
import { AilyChatConfigService, ModelConfigOption } from './aily-chat-config.service';
import { ContextBudgetService } from './context-budget.service';
import { AilyHost } from '../core/host';

// 使用 ModelConfigOption 作为统一的模型配置类型，保留 ModelConfig 别名以兼容旧代码
export type ModelConfig = ModelConfigOption;

export interface ChatTextOptions {
  sender?: string;
  type?: string;
  cover?: boolean;  // 是否覆盖之前的内容
  autoSend?: boolean; // 是否自动发送
  newChatFirst?: boolean; // 发送前先新建会话
}

export interface ChatTextMessage {
  text: string;
  options?: ChatTextOptions;
  timestamp?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ChatService {

  currentMode = 'agent'; // 默认为代理模式
  currentModel: ModelConfig | null = null; // 当前模型，在构造函数中初始化
  resolvedActiveModel: ModelConfig | null = null;

  currentSessionId = '';
  currentSessionTitle = '';

  // 记录当前会话创建时的项目路径，用于确保历史记录保存到正确位置
  currentSessionPath = '';

  /** 由 ChatEngineService 同步：是否正在等待 AI 响应 */
  isWaiting = false;

  /**
   * ReplaySubject(1) 仅用于“聊天面板尚未挂载时”暂存最近一条外部消息。
   * 消息被 ChatEngineService 消费后会立即清空，避免重新打开面板时重复自动发送。
   */
  private textSubject = new ReplaySubject<ChatTextMessage | null>(1);
  private static instance: ChatService;


  constructor(
    private http: HttpClient,
    private ailyChatConfigService: AilyChatConfigService,
    private contextBudgetService: ContextBudgetService,
  ) {
    ChatService.instance = this;
    // 从配置加载AI聊天模式
    this.loadChatMode();
    // 从配置加载AI模型
    this.loadChatModel();

    // 订阅配置变更，当模型列表更新时重新加载
    this.ailyChatConfigService.configChanged$.subscribe(() => {
      this.loadChatModel();
    });

    this.ailyChatConfigService.modelCatalogChanged$.subscribe(() => {
      this.refreshCurrentModelRuntimeMetadata();
    });
  }

  /**
   * 从配置加载AI聊天模式
   */
  private loadChatMode(): void {
    const config = AilyHost.get().config;
    if (config.data?.aiChatMode) {
      this.currentMode = config.data.aiChatMode;
    }
  }

  /**
   * 保存AI聊天模式到配置
   */
  saveChatMode(mode: 'agent' | 'ask'): void {
    this.currentMode = mode;
    const config = AilyHost.get().config;
    if (config.data) config.data.aiChatMode = mode;
    config.save?.();
  }

  /**
   * 从配置加载AI模型
   */
  private loadChatModel(): void {
    const savedModel = AilyHost.get().config.data?.aiChatModel;
    const enabledModels = this.ailyChatConfigService.getEnabledModels();

    // 重置当前模型，确保每次都重新验证
    this.currentModel = null;

    if (savedModel) {
      this.currentModel = this.ailyChatConfigService.resolveSavedModel(savedModel);
    }

    // 如果没有保存模型或保存的模型不可用，优先回退到内置 Auto preset。
    if (!this.currentModel) {
      this.currentModel = this.ailyChatConfigService.resolvePresetModel(
        this.ailyChatConfigService.getDefaultModelPresetId(),
      );
    }

    // 如果 Auto preset 也不可用，再回退到第一个已启用的具体模型。
    if (!this.currentModel && enabledModels.length > 0) {
      this.currentModel = enabledModels[0];
    }

    this.clearResolvedActiveModel();

    if (this.currentModel) {
      // 更新保存的模型配置
      this.saveChatModel(this.currentModel);
      return;
    }

    this.contextBudgetService.updateModelContextSize(this.currentModel);
  }

  /**
   * 保存AI模型到配置
   */
  saveChatModel(model: ModelConfig): void {
    this.currentModel = this.ailyChatConfigService.normalizeRuntimeModel(model);
    this.clearResolvedActiveModel();
    this.contextBudgetService.updateModelContextSize(this.currentModel);
    const config = AilyHost.get().config;
    if (config.data) config.data.aiChatModel = this.currentModel;
    config.save?.();
  }

  private refreshCurrentModelRuntimeMetadata(): void {
    if (this.currentModel) {
      const refreshedModel = this.ailyChatConfigService.resolveSavedModel(this.currentModel);
      if (refreshedModel) {
        this.currentModel = refreshedModel;
        this.refreshResolvedActiveModelRuntimeMetadata();
        this.contextBudgetService.updateModelContextSize(this.currentModel);
        return;
      }
    }

    this.currentModel = this.ailyChatConfigService.resolvePresetModel(
      this.ailyChatConfigService.getDefaultModelPresetId(),
    );
    this.refreshResolvedActiveModelRuntimeMetadata();
    this.contextBudgetService.updateModelContextSize(this.currentModel);
  }

  getActiveDisplayModel(): ModelConfig | null {
    return this.resolvedActiveModel ?? this.currentModel;
  }

  clearResolvedActiveModel(): void {
    this.resolvedActiveModel = null;
  }

  private isLegacyContextInfoSession(sessionId: string): boolean {
    return !!sessionId && !sessionId.startsWith('lex-');
  }

  async syncResolvedActiveModelFromContextInfo(sessionId: string): Promise<void> {
    if (!sessionId) {
      this.clearResolvedActiveModel();
      return;
    }

    // /api/v1/context_info only understands legacy stateful sessions stored on the service.
    // Lex stateless sessions use lex-* ids and already stream context budget + response model metadata.
    if (!this.isLegacyContextInfoSession(sessionId)) {
      this.clearResolvedActiveModel();
      return;
    }

    const contextInfo = await this.fetchContextInfo(sessionId);
    if (!contextInfo) {
      return;
    }

    this.resolvedActiveModel = this.ailyChatConfigService.resolveRuntimeModelFromServerModelName(
      contextInfo.model_name,
      { contextWindowTokens: contextInfo.model_context_limit },
    );

    if (this.resolvedActiveModel) {
      this.contextBudgetService.updateModelContextSize(this.resolvedActiveModel);
      return;
    }

    if (typeof contextInfo.model_context_limit === 'number' && contextInfo.model_context_limit > 0) {
      this.contextBudgetService.maxContextTokens = contextInfo.model_context_limit;
    }
  }

  private refreshResolvedActiveModelRuntimeMetadata(): void {
    if (!this.resolvedActiveModel) {
      return;
    }

    this.resolvedActiveModel = this.ailyChatConfigService.resolveRuntimeModelFromServerModelName(
      this.resolvedActiveModel.model || this.resolvedActiveModel.name,
      { contextWindowTokens: this.resolvedActiveModel.contextWindowTokens },
    );
  }


  /**
     * 发送文本到聊天组件
     * @param text 要发送的文本内容
     * @param options 发送选项，包含 sender、type、cover 等参数
     */
  sendTextToChat(text: string, options?: ChatTextOptions): void {
    // 设置默认值：cover 默认为 true
    const finalOptions: ChatTextOptions = {
      cover: true,  // 默认覆盖模式
      ...options    // 用户提供的选项会覆盖默认值
    };

    const message: ChatTextMessage = {
      text,
      options: finalOptions,
      timestamp: Date.now()
    };
    this.textSubject.next(message);

    // 发送后滚动到页面底部
  }

  /**
   * 获取文本消息的Observable，供聊天组件订阅
   */
  getTextMessages(): Observable<ChatTextMessage | null> {
    return this.textSubject.asObservable();
  }

  /**
   * 清空已消费的外部消息缓冲，避免 ReplaySubject 在新订阅时重放旧消息。
   */
  clearBufferedTextMessage(timestamp?: number): void {
    if (timestamp == null) {
      this.textSubject.next(null);
      return;
    }

    this.textSubject.next(null);
  }

  /**
   * 静态方法，提供全局访问
   * @param text 要发送的文本内容
   * @param options 发送选项，包含 sender、type、cover 等参数
   */
  static sendToChat(text: string, options?: ChatTextOptions): void {
    if (ChatService.instance) {
      ChatService.instance.sendTextToChat(text, options);
    } else {
      console.warn('ChatService尚未初始化');
    }
  }

  startSession(
    mode: string,
    tools: MCPTool[] | null = null,
    maxCount?: number,
    customllmConfig?: any,
    selectModel?: string,
    customSessionId?: string,
    modelPresetId?: string,
    reasoningEffort?: ModelConfig['reasoningEffort'],
  ): Observable<any> {
    const payload: any = {
      session_id: customSessionId || this.currentSessionId,
      tools: tools || [],
      mode
    };

    const effectiveModelPresetId = modelPresetId ?? this.currentModel?.presetId;
    const effectiveReasoningEffort = reasoningEffort ?? this.currentModel?.reasoningEffort;

    // 如果提供了 maxCount 参数，添加到请求中
    if (maxCount !== undefined && maxCount > 0) {
      payload.max_count = maxCount;
    }

    // 如果提供了自定义LLM配置，添加到请求中
    if (customllmConfig) {
      payload.llm_config = customllmConfig;
    }

    // 如果提供了选择的模型名称，添加到请求中
    if (selectModel) {
      payload.select_model = selectModel;
    }

    if (effectiveModelPresetId) {
      payload.model_preset_id = effectiveModelPresetId;
    }

    if (effectiveReasoningEffort) {
      payload.reasoning_effort = effectiveReasoningEffort;
    }

    return this.http.post(ChatAPI.startSession, payload);
  }

  /**
    * 获取旧版有状态会话的系统提示词 / 工具定义 token 数和模型上下文窗口大小。
    * Lex 无状态会话不走这里，而是依赖流式 context_budget / responseModel 元数据。
   */
  async fetchContextInfo(sessionId: string): Promise<{
    system_tokens: number;
    tools_tokens: number;
    model_context_limit: number;
    model_name?: string;
  } | null> {
    try {
      const token = await AilyHost.get().auth.getToken!();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(`${ChatAPI.contextInfo}/${sessionId}`, { headers });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (e) {
      console.warn('[ChatService] fetchContextInfo failed:', e);
      return null;
    }
  }

  closeSession(sessionId: string) {
    return this.http.post(`${ChatAPI.closeSession}/${sessionId}`, {});
  }

  getHistory(sessionId: string) {
    return this.http.get(`${ChatAPI.getHistory}/${sessionId}`);
  }

  stopSession(sessionId: string) {
    return this.http.post(`${ChatAPI.stopSession}/${sessionId}`, {});
  }

  cancelTask(sessionId: string) {
    return this.http.post(`${ChatAPI.cancelTask}/${sessionId}`,{});
  }
}
