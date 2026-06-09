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
import type { ResourceItem } from '../core/chat-types';
import type { IAgentLifecycle, IChatCoordination, IProjectContext, ISessionAccess } from '../core/chat-context';
import { buildUserTurnPayload, type UserTurnPayload } from './chat-user-turn-payload';
import { buildExplicitAgentInvocationPayload } from './explicit-agent-invocation';
import type { RequestUserSelectedTools } from './lex-agent-bootstrap';
import {
  applyTurnRequestPromptContextSnapshot,
  captureTurnRequestPromptContextSnapshot,
} from './turn-request-prompt-context';
import type { PendingFollowupUserSelectedTools, PreparedPendingFollowupRequest } from './chat-pending-request';

function clonePendingResourceItems(resourceItems?: readonly ResourceItem[]): ResourceItem[] | undefined {
  if (!Array.isArray(resourceItems) || resourceItems.length === 0) {
    return undefined;
  }

  return resourceItems.map((item) => ({ ...item }));
}

function clonePendingAllowedPaths(paths?: readonly string[]): string[] | undefined {
  if (!Array.isArray(paths) || paths.length === 0) {
    return undefined;
  }

  const normalized = paths.filter((path): path is string => typeof path === 'string' && path.length > 0);
  return normalized.length > 0 ? [...normalized] : undefined;
}

function clonePendingUserSelectedTools(
  userSelectedTools?: RequestUserSelectedTools,
): PendingFollowupUserSelectedTools | undefined {
  if (!userSelectedTools) {
    return undefined;
  }

  const entries = Object.entries(userSelectedTools).filter(([toolName]) => toolName.trim().length > 0);
  return entries.length > 0
    ? Object.fromEntries(entries)
    : undefined;
}

export interface PreparedUserSend extends UserTurnPayload {
  text: string;
}

type ChatSendCoordinatorContext = Pick<
  IAgentLifecycle,
  'isCancelled' | 'isCompleted' | 'isWaiting' | 'pendingUserInput' | 'activeToolExecutions' | 'pendingEditFeedback'
> & Pick<ISessionAccess, 'sessionId'>
  & Pick<IProjectContext, 'currentMode' | 'currentModel'>
  & {
    readonly currentCustomAgentTarget?: string;
    readonly currentSessionPermissionLevel?: string;
    readonly currentSessionApprovalsReviewer?: 'user' | 'auto_review';
    readonly currentSessionApprovalPolicy?: 'on_request' | 'never';
    readonly selectedMode?: ChatSelectedMode;
    readonly currentResolvedMode?: ChatResolvedMode;
  }
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
    private readonly getResourceItems: () => readonly ResourceItem[] = () => [],
    private readonly getSessionAllowedPaths: () => readonly string[] = () => [],
    private readonly getPendingRuntimeSnapshot: (
      sessionId?: string | null,
    ) => { readonly runtimeOwnerSessionId?: string; readonly providerOptionsKey?: string } = () => ({}),
    private readonly createRequestId: () => string = () => globalThis.crypto.randomUUID(),
  ) {}

  private resolveRequestId(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): string | undefined {
    const existingRequestId = typeof requestMetadata?.['requestId'] === 'string'
      ? requestMetadata['requestId'].trim()
      : '';
    if (existingRequestId) {
      return existingRequestId;
    }

    const nextRequestId = this.createRequestId().trim();
    return nextRequestId || undefined;
  }

  private applyRuntimeRequestId(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): UserTurnPayload['requestMetadata'] {
    const requestId = this.resolveRequestId(requestMetadata);
    if (!requestId) {
      return requestMetadata;
    }

    return {
      ...(requestMetadata ?? {}),
      requestId,
    };
  }

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
    const currentSessionApprovalsReviewer = this.ctx.currentSessionApprovalsReviewer === 'auto_review'
      || this.ctx.currentSessionApprovalsReviewer === 'user'
      ? this.ctx.currentSessionApprovalsReviewer
      : undefined;
    const currentSessionApprovalPolicy = this.ctx.currentSessionApprovalPolicy === 'never'
      || this.ctx.currentSessionApprovalPolicy === 'on_request'
      ? this.ctx.currentSessionApprovalPolicy
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
        ...(currentSessionApprovalsReviewer ? { approvalsReviewer: currentSessionApprovalsReviewer } : {}),
        ...(currentSessionApprovalPolicy ? { approvalPolicy: currentSessionApprovalPolicy } : {}),
        ...(existingModeInfo ?? {}),
      },
      requestRouting: {
        ...(currentSessionPermissionLevel ? { permissionLevel: currentSessionPermissionLevel } : {}),
        ...(currentSessionApprovalsReviewer ? { approvalsReviewer: currentSessionApprovalsReviewer } : {}),
        ...(currentSessionApprovalPolicy ? { approvalPolicy: currentSessionApprovalPolicy } : {}),
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
    return this.applyRuntimePromptContext(
      this.applyRuntimeModelRoutingMetadata(
        this.applyRuntimeModeMetadata(
          this.applyRuntimeRequestId(requestMetadata),
        ),
      ),
    );
  }

  private applyRuntimeModelRoutingMetadata(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): UserTurnPayload['requestMetadata'] {
    const rawModelRouting = requestMetadata?.['modelRouting'];
    const requestedModel = typeof this.ctx.currentModel?.model === 'string' && this.ctx.currentModel.model.trim().length > 0
      ? this.ctx.currentModel.model.trim()
      : undefined;
    const requestedPresetId = typeof this.ctx.currentModel?.presetId === 'string' && this.ctx.currentModel.presetId.trim().length > 0
      ? this.ctx.currentModel.presetId.trim()
      : undefined;
    const existingModelRouting = rawModelRouting && typeof rawModelRouting === 'object' && !Array.isArray(rawModelRouting)
      ? rawModelRouting as Record<string, unknown>
      : undefined;

    if (!requestedModel && !requestedPresetId && !existingModelRouting) {
      return requestMetadata;
    }

    return {
      ...(requestMetadata ?? {}),
      modelRouting: {
        ...(requestedModel ? { requestedModel } : {}),
        ...(requestedPresetId ? { requestedPresetId } : {}),
        ...(existingModelRouting ?? {}),
      },
    };
  }

  private buildPreparedUserSend(
    text: string,
    pendingEditFeedback?: string | null,
  ): PreparedPendingFollowupRequest | null {
    if (!this.ctx.sessionId || !text) {
      return null;
    }

    const resourcesText = this.getResourcesText();
    const payload = buildUserTurnPayload(
      text,
      resourcesText,
      pendingEditFeedback,
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
            resourcesText,
            editFeedback: pendingEditFeedback,
            childRequest: explicitAgentInvocation.childRequest,
          }),
        }
      : payload.requestMetadata;
    const requestMetadataWithPromptContext = this.applyRuntimeRequestMetadata(requestMetadata);

    return {
      text,
      ...payload,
      ...(requestMetadataWithPromptContext ? { requestMetadata: requestMetadataWithPromptContext } : {}),
    };
  }

  private capturePendingSnapshot(
    prepared: PreparedPendingFollowupRequest,
    sessionId?: string | null,
  ): PreparedPendingFollowupRequest {
    const requestMetadata = prepared.requestMetadata;
    const requestRouting = requestMetadata?.requestRouting && typeof requestMetadata.requestRouting === 'object' && !Array.isArray(requestMetadata.requestRouting)
      ? requestMetadata.requestRouting as Record<string, unknown>
      : undefined;
    const modelRouting = requestMetadata?.['modelRouting'] && typeof requestMetadata['modelRouting'] === 'object' && !Array.isArray(requestMetadata['modelRouting'])
      ? requestMetadata['modelRouting'] as Record<string, unknown>
      : undefined;
    const userSelectedTools = clonePendingUserSelectedTools(
      requestMetadata?.['userSelectedTools'] as RequestUserSelectedTools | undefined,
    );
    const permissionLevel = typeof requestRouting?.['permissionLevel'] === 'string' && requestRouting['permissionLevel'].trim().length > 0
      ? requestRouting['permissionLevel'].trim()
      : undefined;
    const approvalsReviewer = requestRouting?.['approvalsReviewer'] === 'auto_review' || requestRouting?.['approvalsReviewer'] === 'user'
      ? requestRouting['approvalsReviewer']
      : undefined;
    const approvalPolicy = requestRouting?.['approvalPolicy'] === 'never' || requestRouting?.['approvalPolicy'] === 'on_request'
      ? requestRouting['approvalPolicy']
      : undefined;
    const requestedModel = typeof modelRouting?.['requestedModel'] === 'string' && modelRouting['requestedModel'].trim().length > 0
      ? modelRouting['requestedModel'].trim()
      : undefined;
    const requestedPresetId = typeof modelRouting?.['requestedPresetId'] === 'string' && modelRouting['requestedPresetId'].trim().length > 0
      ? modelRouting['requestedPresetId'].trim()
      : undefined;
    const requestModeId = typeof requestMetadata?.modeId === 'string' && requestMetadata.modeId.trim().length > 0
      ? requestMetadata.modeId.trim()
      : undefined;
    const requestCustomAgentTarget = typeof requestRouting?.['customAgentTarget'] === 'string' && requestRouting['customAgentTarget'].trim().length > 0
      ? requestRouting['customAgentTarget'].trim()
      : undefined;
    const resourceItems = clonePendingResourceItems(this.getResourceItems());
    const sessionAllowedPaths = clonePendingAllowedPaths(this.getSessionAllowedPaths());
    const pendingRuntimeSnapshot = this.getPendingRuntimeSnapshot(sessionId);
    const runtimeOwnerSessionId = typeof pendingRuntimeSnapshot.runtimeOwnerSessionId === 'string'
      && pendingRuntimeSnapshot.runtimeOwnerSessionId.trim().length > 0
      ? pendingRuntimeSnapshot.runtimeOwnerSessionId.trim()
      : undefined;
    const providerOptionsKey = typeof pendingRuntimeSnapshot.providerOptionsKey === 'string'
      && pendingRuntimeSnapshot.providerOptionsKey.trim().length > 0
      ? pendingRuntimeSnapshot.providerOptionsKey.trim()
      : undefined;

    return {
      ...prepared,
      ...(resourceItems ? { resourceItems } : {}),
      ...(sessionAllowedPaths ? { sessionAllowedPaths } : {}),
      ...(runtimeOwnerSessionId ? { runtimeOwnerSessionId } : {}),
      ...(providerOptionsKey ? { providerOptionsKey } : {}),
      ...(requestedModel ? { requestedModel } : {}),
      ...(requestedPresetId ? { requestedPresetId } : {}),
      ...(requestModeId ? { requestModeId } : {}),
      ...(requestCustomAgentTarget ? { requestCustomAgentTarget } : {}),
      ...(permissionLevel ? { permissionLevel } : {}),
      ...(approvalsReviewer ? { approvalsReviewer } : {}),
      ...(approvalPolicy ? { approvalPolicy } : {}),
      ...(userSelectedTools ? { userSelectedTools } : {}),
    };
  }

  capturePendingSend(content: string, sessionId?: string | null): PreparedPendingFollowupRequest | null {
    const text = content.trim();
    const prepared = this.buildPreparedUserSend(text, this.ctx.pendingEditFeedback);
    return prepared ? this.capturePendingSnapshot(prepared, sessionId) : null;
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

    const prepared = this.buildPreparedUserSend(text, this.ctx.pendingEditFeedback);
    if (!prepared) {
      return null;
    }

    this.ctx.pendingEditFeedback = null;
    this.ctx.msg.appendMessage('user', prepared.displayText);

    return {
      ...prepared,
    };
  }

  applyRuntimePromptContext(
    requestMetadata?: UserTurnPayload['requestMetadata'],
  ): UserTurnPayload['requestMetadata'] {
    const requestId = typeof requestMetadata?.['requestId'] === 'string' && requestMetadata['requestId'].trim().length > 0
      ? requestMetadata['requestId'].trim()
      : undefined;
    const snapshot = captureTurnRequestPromptContextSnapshot({
      getSessionSnapshot: () => this.ctx.lexStream?.session?.snapshot?.() ?? null,
    });

    const requestContext = requestId
      ? {
          ...(snapshot?.requestContext ?? {}),
          requestId,
        }
      : snapshot?.requestContext;

    const nextSnapshot = requestContext || snapshot?.activeSkillNames?.length
      ? {
          ...(requestContext ? { requestContext } : {}),
          ...(snapshot?.activeSkillNames?.length ? { activeSkillNames: snapshot.activeSkillNames } : {}),
        }
      : snapshot;

    return applyTurnRequestPromptContextSnapshot(requestMetadata, nextSnapshot);
  }
}
