import type { IChatCoordination } from '../core/chat-context';

/** Narrow context: only needs lexStream for presenting/resolving approvals */
type LexAskConfirmationContext = Pick<IChatCoordination, 'lexStream'>;

/**
 * Handles lex hook `ask` confirmations through blockly approval UI.
 */
export class LexAskConfirmationBridge {
  private resolveAskConfirmation: ((confirmed: boolean) => void) | null = null;

  constructor(private readonly ctx: LexAskConfirmationContext) {}

  handleAskConfirmation(request: { message: string; source: string; toolName?: string }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolveAskConfirmation = resolve;

      const askId = Math.random().toString(36).slice(2, 10);
      this.ctx.lexStream.ui.presentApproval(askId, request.message, request.toolName, request.source);

      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail || !this.resolveAskConfirmation) return;
        if (detail.toolCallId && detail.toolCallId !== askId) return;

        document.removeEventListener('aily-approval-result', handler);
  this.ctx.lexStream.ui.resolveApproval(askId, !!detail.approved, detail.scope);

        const resolveRef = this.resolveAskConfirmation;
        this.resolveAskConfirmation = null;
        resolveRef(!!detail.approved);
      };

      document.addEventListener('aily-approval-result', handler);
    });
  }
}