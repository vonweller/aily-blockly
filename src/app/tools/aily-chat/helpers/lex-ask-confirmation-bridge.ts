import type { IChatCoordination, IChatServiceAccess, ISessionAccess } from '../core/chat-context';
import {
  normalizeToolApprovalRequest,
  normalizeToolApprovalPresentation,
  type ToolApprovalPresentation,
} from './tool-approval-ui';

/** Narrow context: only needs lexStream for presenting/resolving confirmations */
type LexAskConfirmationContext = Pick<IChatCoordination, 'lexStream'>
  & Pick<ISessionAccess, 'sessionId'>
  & Pick<IChatServiceAccess, 'runtimeInteractionHost'>
  & {
    resolveActiveRuntimeSessionId?(): string | null | undefined;
    readCurrentViewSessionResource?(): string | null | undefined;
  };

/**
 * Handles lex hook `ask` confirmations through blockly confirmation UI.
 */
export class LexAskConfirmationBridge {
  private resolveAskConfirmation: ((confirmed: boolean) => void) | null = null;

  constructor(private readonly ctx: LexAskConfirmationContext) {}

  private resolveInteractionSessionResource(): string {
    const activeRuntimeSessionId = typeof this.ctx.resolveActiveRuntimeSessionId === 'function'
      ? this.ctx.resolveActiveRuntimeSessionId()
      : null;
    const activeRuntimeResource = typeof activeRuntimeSessionId === 'string'
      ? activeRuntimeSessionId.trim()
      : '';
    if (activeRuntimeResource) {
      return activeRuntimeResource;
    }

    const currentViewSessionResource = typeof this.ctx.readCurrentViewSessionResource === 'function'
      ? this.ctx.readCurrentViewSessionResource()
      : null;
    const viewResource = typeof currentViewSessionResource === 'string'
      ? currentViewSessionResource.trim()
      : '';
    if (viewResource) {
      return viewResource;
    }

    throw new Error('Lex ask confirmation requires a sessionResource owner.');
  }

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
    allowAutoConfirm?: ToolApprovalPresentation['allowAutoConfirm'];
    approveCombination?: ToolApprovalPresentation['approveCombination'];
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (request.source === 'beforeToolExecution' && request.toolCallId && request.toolName) {
        const normalizedRequest = normalizeToolApprovalRequest({
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          title: request.title || '',
          subtitle: request.subtitle,
          message: request.message,
          source: request.source,
          actions: request.actions,
          primaryScope: request.primaryScope,
          allowAutoConfirm: request.allowAutoConfirm,
          approveCombination: request.approveCombination,
          args: request.toolInput,
        });

        this.ctx.lexStream.ui.presentToolCallApproval(normalizedRequest);

        this.resolveAskConfirmation = resolve;

        void this.ctx.runtimeInteractionHost.presentToolApproval(
          this.resolveInteractionSessionResource(),
          normalizedRequest,
        ).then((result) => {
          this.ctx.lexStream.ui.resolveToolCallApproval(request.toolCallId!, !!result.approved, result.scope);
          const resolveRef = this.resolveAskConfirmation;
          this.resolveAskConfirmation = null;
          resolveRef?.(!!result.approved);
        });
        return;
      }

      const askId = Math.random().toString(36).slice(2, 10);
      const confirmationPartId = this.ctx.lexStream.ui.presentConfirmation(
        askId,
        request.message,
        request.toolName,
        request.source,
        {
          ...normalizeToolApprovalPresentation({
            toolName: request.toolName,
            source: request.source,
            title: request.title,
            subtitle: request.subtitle,
            message: request.message,
            actions: request.actions,
            primaryScope: request.primaryScope,
            allowAutoConfirm: request.allowAutoConfirm,
            approveCombination: request.approveCombination,
            args: request.toolInput,
          }),
        },
      );
      if (typeof confirmationPartId !== 'string' || !confirmationPartId.trim()) {
        throw new Error(`handleAskConfirmation requires a stable confirmation partId for ${askId}.`);
      }

      this.resolveAskConfirmation = resolve;

      void this.ctx.runtimeInteractionHost.presentConfirmation(this.resolveInteractionSessionResource(), {
        askId,
        partId: confirmationPartId,
        toolName: request.toolName,
        title: request.title || '确认操作',
        subtitle: request.subtitle,
        message: request.message,
        args: request.toolInput,
        actions: normalizeToolApprovalPresentation({
          toolName: request.toolName,
          source: request.source,
          title: request.title,
          subtitle: request.subtitle,
          message: request.message,
          actions: request.actions,
          primaryScope: request.primaryScope,
          allowAutoConfirm: request.allowAutoConfirm,
          approveCombination: request.approveCombination,
          args: request.toolInput,
        }).actions,
        primaryScope: request.primaryScope || 'once',
      }).then((result) => {
        this.ctx.lexStream.ui.resolveConfirmation(confirmationPartId, askId, !!result.approved, result.scope);
        const resolveRef = this.resolveAskConfirmation;
        this.resolveAskConfirmation = null;
        resolveRef?.(!!result.approved);
      });
    });
  }
}
