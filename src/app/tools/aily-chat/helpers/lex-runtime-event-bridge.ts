import type { IAgentLifecycle, IChatServiceAccess } from '../core/chat-context';
import type { PartEventProcessor } from '../core/part-event-processor';
import type { LexHostSyncBridge } from './lex-host-sync-bridge';
import type { LexMessageLifecycleBridge } from './lex-message-lifecycle-bridge';

/** Narrow context: toolCallingIteration + contextBudgetService */
type LexRuntimeEventContext = Pick<IAgentLifecycle, 'toolCallingIteration'> & Pick<IChatServiceAccess, 'contextBudgetService'>;

export class LexRuntimeEventBridge {
  constructor(
    private readonly ctx: LexRuntimeEventContext,
    private readonly partProcessor: PartEventProcessor,
    private readonly hostSyncBridge: LexHostSyncBridge,
    private readonly messageLifecycleBridge: LexMessageLifecycleBridge,
  ) {}

  processEvent(event: any): boolean {
    switch (event.type) {
      case 'text_delta': {
        this.messageLifecycleBridge.closeNativeThinking();
        this.partProcessor.processTextDelta(event.text);
        return true;
      }

      case 'thinking':
        this.messageLifecycleBridge.startNativeThinking();
        this.partProcessor.processThinking(event.text);
        return true;

      case 'tool_call_start': {
        this.messageLifecycleBridge.closeNativeThinking();
        this.partProcessor.processToolCallStart(event.toolCallId, event.toolName, event.input);
        this.hostSyncBridge.recordFileToolEdit(event.toolName, event.input);
        return true;
      }

      case 'tool_call_progress':
        return true;

      case 'tool_call_end': {
        this.partProcessor.processToolCallEnd(event.toolCallId, event.toolName, event.result);

        if (event.toolName === 'get_terminal_output' || event.toolName === 'start_background_command') {
          this.partProcessor.processTerminalResult(event.toolCallId, event.result);
        }
        return true;
      }

      case 'turn_start':
        this.ctx.toolCallingIteration++;
        return true;

      case 'turn_end':
        return true;

      case 'error':
        this.partProcessor.processError(event.error || '未知错误');
        return true;

      case 'context_budget':
        this.ctx.contextBudgetService?.applyLexBudgetEvent(
          event.maxTokens,
          event.usedTokens,
          {
            systemTokens: event.systemTokens,
            toolsTokens: event.toolsTokens,
            messagesTokens: event.messagesTokens,
            usagePercent: event.usagePercent,
            compressionThreshold: event.compressionThreshold,
            summarizationThreshold: event.summarizationThreshold,
            messageCount: event.messageCount,
          },
        );
        return true;

      case 'todo_state':
        this.hostSyncBridge.applyTodoStateEvent(event);
        return true;

      default:
        return false;
    }
  }
}