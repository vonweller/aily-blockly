import {
  createTurnRequestModeInfoFromResolvedMode,
  isSameChatSelectedMode,
  normalizeChatModeId,
  normalizeChatSelectedMode,
  resolveChatCurrentMode,
  resolveChatSelectedCustomAgentTarget,
  type ChatResolvedMode,
  type ChatSelectedMode,
} from '../core/chat-mode';
import type { IAgentLifecycle, IChatCoordination, IProjectContext, ISessionAccess } from '../core/chat-context';
import { buildUserTurnPayload, type UserTurnPayload } from './chat-user-turn-payload';
import { buildExplicitAgentInvocationPayload } from './explicit-agent-invocation';
import type { RequestUserSelectedTools } from './lex-agent-bootstrap';
import {
  applyTurnRequestPromptContextSnapshot,
  captureTurnRequestPromptContextSnapshot,
} from './turn-request-prompt-context';

export interface PreparedUserSend extends UserTurnPayload {
  text: string;
}

type ChatSendCoordinatorContext = Pick<
  IAgentLifecycle,
  'isCancelled' | 'isCompleted' | 'isWaiting' | 'pendingUserInput' | 'activeToolExecutions' | 'pendingEditFeedback'
> & Pick<ISessionAccess, 'sessionId'>
  & Pick<IProjectContext, 'currentMode'>
  & { readonly currentCustomAgentTarget?: string; readonly currentSessionPermissionLevel?: string; readonly selectedMode?: ChatSelectedMode; readonly currentResolvedMode?: ChatResolvedMode }
  & Pick<IChatCoordination, 'msg'>
  & Partial<Pick<IChatCoordination, 'lexStream'>>;

/**
 * Coordinates host-side preflight for a new user send.
 *
 * This keeps ChatEngineService.send focused on shell orchestration while the
 * mutable host state resets and payload shaping stay in one place.
 */
export class ChatSendCoordinator {
  constructor(
    private readonly ctx: ChatSendCoordinatorContext,
    private readonly getResourcesText: () => string,
    private readonly getUserSelectedTools?: (requestAgentId?: string) => RequestUserSelectedTools | undefined,
  ) {}

  private resolveAgentModeDefinition(
    agentId: string,
  ): unknown {
    const liveAgent = this.ctx.lexStream?.agent?.getHandle?.()?.agent
      ?? this.ctx.lexStream?.agent?.getAgent?.();
    const agentModeManager = liveAgent && typeof liveAgent === 'object' && 'agentModeManager' in liveAgent
      ? (liveAgent as { readonly agentModeManager?: { readonly get?: (agentType: string) => unknown } }).agentModeManager
      : undefined;
    const agentMode = typeof agentModeManager?.get === 'function'
      ? agentModeManager.get(agentId)
      : undefined;

    return agentMode && typeof agentMode === 'object' && !Array.isArray(agentMode)
      ? agentMode
      : undefined;
  }

  private resolveCurrentMode(
    selectedMode: ChatSelectedMode,
  ): ChatResolvedMode {
    const currentResolvedMode = this.ctx.currentResolvedMode;
    if (currentResolvedMode && isSameChatSelectedMode(selectedMode, {
      modeId: currentResolvedMode.kind,
      customAgentTarget: currentResolvedMode.customAgentTarget,
    })) {
      return currentResolvedMode;
    }

    return resolveChatCurrentMode(selectedMode, {
      resolveAgentModeDefinition: (agentId) => this.resolveAgentModeDefinition(agentId),
    });
  }

  private applyRuntimeModeMetadata(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): UserTurnPayload['requestMetadata'] {
    const selectedMode = this.ctx.selectedMode
      ? normalizeChatSelectedMode(this.ctx.selectedMode)
      : normalizeChatSelectedMode({
          modeId: this.ctx.currentMode,
          customAgentTarget: this.ctx.currentCustomAgentTarget,
        });
    const selectedCustomAgentTarget = resolveChatSelectedCustomAgentTarget(selectedMode);
    const payloadRequestRouting = requestMetadata?.requestRouting && typeof requestMetadata.requestRouting === 'object' && !Array.isArray(requestMetadata.requestRouting)
      ? requestMetadata.requestRouting as Record<string, unknown>
      : undefined;
    const requestAgentId = typeof payloadRequestRouting?.['customAgentTarget'] === 'string' && payloadRequestRouting['customAgentTarget'].trim()
      ? payloadRequestRouting['customAgentTarget'].trim()
      : selectedCustomAgentTarget;
    const modeInfo = createTurnRequestModeInfoFromResolvedMode(this.resolveCurrentMode(selectedMode));
    const currentSessionPermissionLevel = typeof this.ctx.currentSessionPermissionLevel === 'string'
      && this.ctx.currentSessionPermissionLevel.trim().length > 0
      ? this.ctx.currentSessionPermissionLevel.trim()
      : undefined;
    const existingModeInfo = requestMetadata?.modeInfo && typeof requestMetadata.modeInfo === 'object' && !Array.isArray(requestMetadata.modeInfo)
      ? requestMetadata.modeInfo as Record<string, unknown>
      : undefined;
    const requestMetadataWithMode = {
      ...(requestMetadata ?? {}),
      modeId: selectedMode.modeId,
      modeInfo: {
        ...modeInfo,
        ...(currentSessionPermissionLevel ? { permissionLevel: currentSessionPermissionLevel } : {}),
        ...(existingModeInfo ?? {}),
      },
      requestRouting: {
        ...(currentSessionPermissionLevel ? { permissionLevel: currentSessionPermissionLevel } : {}),
        ...(payloadRequestRouting ?? {}),
        modeId: selectedMode.modeId,
        ...(requestAgentId ? { customAgentTarget: requestAgentId } : {}),
      },
    };
    const userSelectedTools = this.getUserSelectedTools?.(
      requestAgentId,
    );

    return userSelectedTools
      ? {
          ...requestMetadataWithMode,
          userSelectedTools,
        }
      : requestMetadataWithMode;
  }

  applyRuntimeRequestMetadata(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): UserTurnPayload['requestMetadata'] {
    return this.applyRuntimePromptContext(this.applyRuntimeModeMetadata(requestMetadata));
  }

  prepareSend(sender: string, content: string): PreparedUserSend | null {
    if (this.ctx.isCancelled && sender === 'tool') {
      return null;
    }

    if (this.ctx.isCompleted) {
      this.ctx.isCancelled = false;
      this.ctx.isCompleted = false;
    }

    const text = content.trim();
    if (!this.ctx.sessionId || !text) {
      return null;
    }

    if (sender !== 'user') {
      return null;
    }

    if (this.ctx.isWaiting) {
      return null;
    }

    if (this.ctx.isCancelled) {
      this.ctx.isCancelled = false;
      this.ctx.pendingUserInput = false;
      this.ctx.activeToolExecutions = 0;
    }

    const payload = buildUserTurnPayload(
      text,
      this.getResourcesText(),
      this.ctx.pendingEditFeedback,
      {
        resolveCommand: ({ agentId, name, kind }) => this.ctx.lexStream
          ?.agent
          .getHandle?.()
          .resolveRequestCommand(name, kind, agentId)
          ?? this.ctx.lexStream
            ?.agent
          .getAgent()
          ?.resolveRequestCommand(name, kind, agentId),
      },
    );
    const explicitAgentInvocation = payload.requestMetadata?.explicitAgentInvocation;
    const requestMetadata = explicitAgentInvocation && typeof explicitAgentInvocation === 'object'
      ? {
          ...Object.fromEntries(
            Object.entries(payload.requestMetadata ?? {}).filter(([key]) => key !== 'agentId'),
          ),
          explicitAgentInvocation: buildExplicitAgentInvocationPayload({
            targetAgent: typeof explicitAgentInvocation.targetAgent === 'string' ? explicitAgentInvocation.targetAgent : '',
            strippedPrompt: typeof explicitAgentInvocation.strippedPrompt === 'string' ? explicitAgentInvocation.strippedPrompt : '',
            originalText: typeof explicitAgentInvocation.originalText === 'string' ? explicitAgentInvocation.originalText : text,
            resourcesText: this.getResourcesText(),
            editFeedback: this.ctx.pendingEditFeedback,
            childRequest: explicitAgentInvocation.childRequest,
          }),
        }
      : payload.requestMetadata;
    const requestMetadataWithPromptContext = this.applyRuntimeRequestMetadata(requestMetadata);
    this.ctx.pendingEditFeedback = null;
    this.ctx.msg.appendMessage('user', payload.displayText);

    return {
      text,
      ...payload,
      ...(requestMetadataWithPromptContext ? { requestMetadata: requestMetadataWithPromptContext } : {}),
    };
  }

  applyRuntimePromptContext(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): UserTurnPayload['requestMetadata'] {
    const snapshot = captureTurnRequestPromptContextSnapshot({
      getSessionSnapshot: () => this.ctx.lexStream?.session?.snapshot?.() ?? null,
    });

    return applyTurnRequestPromptContextSnapshot(requestMetadata, snapshot);
  }
}
