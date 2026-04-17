/**
 * LexOwnerFacade — aily-lex 核心引擎
 *
 * aily-blockly 到 aily-lex 的主路径桥接层，
 * 统一承接 LLM 调用、事件处理和 host 侧状态同步。
 *
 * 设计要点：
 * - 动态 import(`aily-lex`) 避免硬依赖
 * - 复用引擎的 MessageDisplayHelper / ChatViewAdapter 做显示
 * - 复用 lex TurnManager 做持久化
 * - 工具执行由 lex 核心 + contributed tools (IHostToolProvider) 处理
 */

import type { IChatContext } from '../core/chat-context';
import { PartEventProcessor } from '../core/part-event-processor';
import {
  bootstrapBlocklyLexAgent,
} from './lex-agent-bootstrap';
import { LexAgentLifecycleBridge } from './lex-agent-lifecycle-bridge';
import { LexTurnSessionBridge } from './lex-turn-session-bridge';
import { LexAskConfirmationBridge } from './lex-ask-confirmation-bridge';
import { LexHostSyncBridge } from './lex-host-sync-bridge';
import { LexMessageLifecycleBridge } from './lex-message-lifecycle-bridge';
import { LexUiEventBridge } from './lex-ui-event-bridge';
import { LexTurnStartupBridge } from './lex-turn-startup-bridge';
import { LexTurnExecutionBridge } from './lex-turn-execution-bridge';
import { LexTurnRuntimeBridge } from './lex-turn-runtime-bridge';
import { LexTurnControlBridge } from './lex-turn-control-bridge';
import { LexSessionPersistenceBridge } from './lex-session-persistence-bridge';
import { LexRuntimeConfigBridge } from './lex-runtime-config-bridge';
import { LexRenderEventBridge } from './lex-render-event-bridge';
import { LexSessionRestoreBridge } from './lex-session-restore-bridge';
import { LexSessionFacade } from './lex-session-facade';

// aily-lex 类型按需获取（运行时动态加载，编译期仅用 type import）
type AilyLexModule = import('./lex-agent-bootstrap').AilyLexModule;

export class LexOwnerFacade {
  /** lex 模块/agent 生命周期桥 */
  private readonly _agentLifecycleBridge: LexAgentLifecycleBridge;
  /** turn/session 适配桥，封装 lex TurnManager 与 OpenAI 形状转换 */
  private readonly _turnBridge: LexTurnSessionBridge;
  /** ask 确认 UI 桥 */
  private readonly _askConfirmationBridge: LexAskConfirmationBridge;
  /** 宿主同步桥（文件编辑 + todo 同步） */
  private readonly _hostSyncBridge: LexHostSyncBridge;
  /** assistant 消息生命周期桥 */
  private readonly _messageLifecycleBridge: LexMessageLifecycleBridge;
  /** lex -> UI 统一事件入口 */
  private readonly _uiEventBridge: LexUiEventBridge;
  /** 主 agent turn 启动编排桥 */
  private readonly _turnStartupBridge: LexTurnStartupBridge;
  /** turn 执行编排桥 */
  private readonly _turnExecutionBridge: LexTurnExecutionBridge;
  /** turn runtime 桥，聚合 startup/execution/ui 生命周期入口 */
  private readonly _turnRuntimeBridge: LexTurnRuntimeBridge;
  /** turn 控制桥，封装 turn 历史的直接修改/完成操作 */
  private readonly _turnControlBridge: LexTurnControlBridge;
  /** session 持久化桥，封装 save/restore 与挂起事件冲刷 */
  private readonly _sessionPersistenceBridge: LexSessionPersistenceBridge;
  /** runtime 配置桥，封装 host tools 与 llm config 读取 */
  private readonly _runtimeConfigBridge: LexRuntimeConfigBridge;
  /** 持久化会话恢复桥，封装 ensureAgent + snapshot 解析 + restore */
  private readonly _sessionRestoreBridge: LexSessionRestoreBridge;
  /** 会话 owner façade，聚合持久化与 persisted restore */
  private readonly _sessionFacade: LexSessionFacade;

  get agent(): LexAgentLifecycleBridge {
    return this._agentLifecycleBridge;
  }

  get turns(): LexTurnControlBridge {
    return this._turnControlBridge;
  }

  get turn(): LexTurnRuntimeBridge {
    return this._turnRuntimeBridge;
  }

  get conversation(): LexTurnSessionBridge {
    return this._turnBridge;
  }

  get ui(): LexUiEventBridge {
    return this._uiEventBridge;
  }

  get runtime(): LexRuntimeConfigBridge {
    return this._runtimeConfigBridge;
  }

  get session(): LexSessionFacade {
    return this._sessionFacade;
  }

  /**
   * 优先从 lex 默认 SessionStorage 恢复；若不存在标准 snapshot，则回退到旧 blockly turns。
   *
   * 这样 SessionLifecycleHelper 不再需要理解旧格式 turns 的具体结构。
   */
  /** Part-based 事件处理器（Phase 1 双轨：同时写入 string + Parts） */
  private _partProcessor: PartEventProcessor;

  constructor(private ctx: IChatContext) {
    this._askConfirmationBridge = new LexAskConfirmationBridge(this.ctx);
    this._hostSyncBridge = new LexHostSyncBridge(this.ctx);
    this._agentLifecycleBridge = new LexAgentLifecycleBridge({
      getSessionId: () => this.ctx.sessionId,
      loadModule: () => import('aily-lex/browser'),
      createAgent: (lex, sessionId) => bootstrapBlocklyLexAgent({
        ctx: this.ctx,
        lex,
        sessionId,
        askHandler: (askContext) => this._askConfirmationBridge.handleAskConfirmation(askContext),
        onSubagentEvent: (event) => this._uiEventBridge.processEvent(event, 'subagent'),
      }),
      onAgentReady: (agent, _lex, currentTodoUnsubscribe) => {
        this._flushPendingEvents();

        try {
          this.ctx.editCheckpointService.setFileHistory(agent.getFileHistory());
        } catch {
          // ignore if agent not ready
        }

        currentTodoUnsubscribe?.();
        return null;
      },
    });
    this._turnBridge = new LexTurnSessionBridge(() => this._agentLifecycleBridge.getAgent());
    this._turnControlBridge = new LexTurnControlBridge(this._turnBridge);
    this._runtimeConfigBridge = new LexRuntimeConfigBridge(this.ctx);
    this._sessionPersistenceBridge = new LexSessionPersistenceBridge({
      getAgent: () => this._agentLifecycleBridge.getAgent(),
      flushPendingEvents: (events) => {
        this._turnExecutionBridge.flushPendingEvents(events);
      },
    });
    this._sessionRestoreBridge = new LexSessionRestoreBridge({
      ensureAgent: (sessionId) => this._agentLifecycleBridge.ensureAgent(sessionId),
      getLex: () => this._agentLifecycleBridge.getLex(),
      getCwd: () => this.ctx.prjPath || this.ctx.prjRootPath || '',
      restoreSnapshot: (snapshot) => this._sessionPersistenceBridge.restoreSession(snapshot),
    });
    this._sessionFacade = new LexSessionFacade(
      this._sessionPersistenceBridge,
      this._sessionRestoreBridge,
    );
    this._partProcessor = new PartEventProcessor(
      this.ctx.partStore,
      () => this._messageLifecycleBridge.currentMsgIndex,
    );
    this._messageLifecycleBridge = new LexMessageLifecycleBridge(
      this.ctx,
      this._partProcessor,
      () => {
        this._agentLifecycleBridge.setAbortController(null);
      },
    );
    this._uiEventBridge = new LexUiEventBridge(
      this.ctx,
      this._partProcessor,
      this._hostSyncBridge,
      this._messageLifecycleBridge,
      () => this._messageLifecycleBridge.currentMsgIndex,
    );
    this._turnStartupBridge = new LexTurnStartupBridge(
      this.ctx,
      (userMessage) => this._turnControlBridge.start(userMessage),
      () => this._uiEventBridge.ensureAilyMessage(),
      () => this._turnBridge.messages(),
      () => this._runtimeConfigBridge.tools(),
    );
    this._turnExecutionBridge = new LexTurnExecutionBridge(
      this.ctx,
      this._uiEventBridge,
      (controller) => {
        this._agentLifecycleBridge.setAbortController(controller);
      },
    );
    // Activate the RenderEvent path: wire the render bridge into execution
    const renderEventBridge = new LexRenderEventBridge(
      this.ctx,
      this._hostSyncBridge,
      this._messageLifecycleBridge,
    );
    this._turnExecutionBridge.setRenderEventBridge(renderEventBridge);
    this._turnRuntimeBridge = new LexTurnRuntimeBridge(
      this._agentLifecycleBridge,
      this._turnStartupBridge,
      this._turnExecutionBridge,
      this._uiEventBridge,
    );
  }

  private _flushPendingEvents(): void {
    this._turnExecutionBridge.flushPendingEvents(this._sessionPersistenceBridge.drainPendingEvents());
  }
}

