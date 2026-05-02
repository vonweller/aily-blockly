import type { IChatCoordination } from '../core/chat-context';
import {
  getToolApprovalSubtitle,
  getToolApprovalTitle,
  type ToolApprovalPresentation,
} from './tool-approval-ui';
import { AILY_CONFIRMATION_RESULT_EVENT } from './interaction-events';

/** Narrow context: only needs lexStream for presenting/resolving confirmations */
type LexAskConfirmationContext = Pick<IChatCoordination, 'lexStream'>;

/**
 * Handles lex hook `ask` confirmations through blockly confirmation UI.
 */
export class LexAskConfirmationBridge {
  private resolveAskConfirmation: ((confirmed: boolean) => void) | null = null;

  constructor(private readonly ctx: LexAskConfirmationContext) {}

  handleAskConfirmation(request: {
    message: string;
    source: string;
    toolCallId?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    title?: ToolApprovalPresentation['title'];
    subtitle?: ToolApprovalPresentation['subtitle'];
    actions?: ToolApprovalPresentation['actions'];
    primaryScope?: ToolApprovalPresentation['primaryScope'];
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (request.source === 'beforeToolExecution' && request.toolCallId && request.toolName) {
        this.ctx.lexStream.ui.presentToolCallApproval({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          title: request.title ?? getToolApprovalTitle(request.toolName),
          subtitle: request.subtitle ?? getToolApprovalSubtitle(request.toolName, request.source),
          message: request.message,
          source: request.source,
          actions: request.actions,
          primaryScope: request.primaryScope,
          args: request.toolInput,
        });

        this.resolveAskConfirmation = resolve;

        const handler = (e: Event) => {
          const detail = (e as CustomEvent).detail;
          if (!detail || !this.resolveAskConfirmation) return;
          if (detail.toolCallId !== request.toolCallId) return;

          document.removeEventListener(AILY_CONFIRMATION_RESULT_EVENT, handler);
          this.ctx.lexStream.ui.resolveToolCallApproval(request.toolCallId!, !!detail.approved, detail.scope);

          const resolveRef = this.resolveAskConfirmation;
          this.resolveAskConfirmation = null;
          resolveRef(!!detail.approved);
        };

        document.addEventListener(AILY_CONFIRMATION_RESULT_EVENT, handler);
        return;
      }

      const askId = Math.random().toString(36).slice(2, 10);
      const confirmationPartId = this.ctx.lexStream.ui.presentConfirmation(
        askId,
        request.message,
        request.toolName,
        request.source,
        {
          title: request.title,
          subtitle: request.subtitle,
          actions: request.actions,
          primaryScope: request.primaryScope,
        },
      );
      if (typeof confirmationPartId !== 'string' || !confirmationPartId.trim()) {
        throw new Error(`handleAskConfirmation requires a stable confirmation partId for ${askId}.`);
      }

      this.resolveAskConfirmation = resolve;

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || !this.resolveAskConfirmation) return;
        if (detail.askId && detail.askId !== askId) return;

        document.removeEventListener(AILY_CONFIRMATION_RESULT_EVENT, handler);
        this.ctx.lexStream.ui.resolveConfirmation(confirmationPartId, askId, !!detail.approved, detail.scope);

        const resolveRef = this.resolveAskConfirmation;
        this.resolveAskConfirmation = null;
        resolveRef(!!detail.approved);
      };

      document.addEventListener(AILY_CONFIRMATION_RESULT_EVENT, handler);
    });
  }
}