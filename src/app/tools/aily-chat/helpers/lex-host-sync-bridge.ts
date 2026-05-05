import type { ISessionAccess, IChatServiceAccess, IChatViewAccess } from '../core/chat-context';
import { buildTodoListSemanticDataFromTodos } from '../services/todoUpdate.service';
import { setTodos, type TodoItem as BlocklyTodoItem } from '../utils/todoStorage';

/** Narrow context: editCheckpointService for recording edits, ngZone for UI sync, sessionId for todo keying */
type LexHostSyncContext = Pick<ISessionAccess, 'sessionId'>
  & Pick<IChatServiceAccess, 'editCheckpointService' | 'ngZone' | 'message'>
  & Pick<IChatViewAccess, 'inputValue' | 'triggerSyncDetectChanges'>;

type AilyLexModule = import('./lex-agent-bootstrap').AilyLexModule;
type LexTodoItem = {
  id: number;
  title: string;
  activeForm?: string;
  status: BlocklyTodoItem['status'];
};

/**
 * Host-side sync bridges used by the lex stream path.
 *
 * Keeps file edit checkpoint mapping and todo sync wiring out of LexOwnerFacade.
 */
export class LexHostSyncBridge {
  private static readonly LEX_FILE_TOOL_TYPES: Record<string, 'create' | 'modify' | 'delete'> = {
    edit_file: 'modify',
    multi_edit_file: 'modify',
    write_file: 'create',
    delete_file: 'delete',
  };

  constructor(private readonly ctx: LexHostSyncContext) {}

  recordFileToolEdit(toolName: string, input: any): void {
    const editType = LexHostSyncBridge.LEX_FILE_TOOL_TYPES[toolName];
    if (!editType || !input) return;

    if (toolName === 'multi_edit_file') {
      if (input.filePath) {
        this.ctx.editCheckpointService.recordEdit(input.filePath, editType);
      }
      return;
    }

    const filePath = input.filePath || input.path;
    if (filePath) {
      this.ctx.editCheckpointService.recordEdit(filePath, editType);
    }
  }

  applyLexTodos(sessionId: string, lexTodos: readonly LexTodoItem[]): void {
    const blocklyTodos: BlocklyTodoItem[] = lexTodos.map(t => ({
      id: t.id,
      content: t.activeForm || t.title,
      status: t.status,
      priority: 'medium' as const,
      updatedAt: Date.now(),
    }));

    try {
      setTodos(blocklyTodos, sessionId);
    } catch {
      // ignore persistence failures for UI sync bridge
    }

    this.ctx.ngZone.run(() => {
      try {
        const svc = (window as any).todoUpdateService;
        if (svc) {
          svc.updateTodoListSemanticData(
            sessionId,
            buildTodoListSemanticDataFromTodos(blocklyTodos),
            blocklyTodos,
          );
        }
      } catch {
        // ignore UI notification failures
      }
    });
  }

  applyTodoStateEvent(event: { sessionId?: string; trace?: { sessionId?: string }; snapshot?: { items?: readonly LexTodoItem[] } }): void {
    const sessionId = event.sessionId || event.trace?.sessionId || this.ctx.sessionId;
    const lexTodos = event.snapshot?.items ?? [];
    this.applyLexTodos(sessionId, lexTodos);
  }

  applyHandoffEvent(event: { targetAgent?: string; reason?: string }): void {
    const targetAgent = typeof event.targetAgent === 'string' ? event.targetAgent.trim() : '';
    if (!targetAgent) {
      return;
    }

    const handoffMessage = event.reason
      ? `代理请求切换到 ${targetAgent}: ${event.reason}`
      : `代理请求切换到 ${targetAgent}`;
    const suggestedInput = `@${targetAgent} `;

    this.ctx.ngZone.run(() => {
      let prefilled = false;

      if ((this.ctx.inputValue || '').trim().length === 0) {
        this.ctx.inputValue = suggestedInput;
        this.ctx.triggerSyncDetectChanges();
        prefilled = true;
      }

      try {
        this.ctx.message.info(
          prefilled
            ? `${handoffMessage}。已在输入框中预填 ${suggestedInput.trim()}，等待你确认发送。`
            : handoffMessage,
        );
      } catch {
        // ignore UI notification failures for host sync bridge
      }
    });
  }

  subscribeLexTodoChange(lex: AilyLexModule, currentUnsubscribe?: (() => void) | null): (() => void) | null {
    currentUnsubscribe?.();
    return lex.onTodoChange((sessionId, lexTodos) => {
      this.applyLexTodos(sessionId, lexTodos);
    });
  }
}