import { inject, Injectable } from '@angular/core';
import type { LexOwnerFacade } from '../helpers/lex-stream.helper';

import {
  createChatAgentRuntimeModeConfigKey,
  normalizeChatAgentRuntimeMode,
} from '../core/chat-agent-runtime-mode';
import { normalizeChatSelectedMode } from '../core/chat-mode';
import type { ChatRuntimeHostSubmitRequest } from '../core/chat-runtime-host-contract';
import {
  createHostSessionProviderOptionsKey,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  CHAT_RUNTIME_OWNER_SESSION_CONTEXT,
  CHAT_RUNTIME_OWNER_SUBMITTED_TURN_TITLE,
  CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  type ChatRuntimeOwnerSubmittedTurnLifecyclePort,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerSessionContextPort,
  type ChatRuntimeOwnerSessionModelPort,
  type ChatRuntimeOwnerSubmittedTurnTitlePort,
  type ChatRuntimeOwnerTurnStartupEditLifecyclePort,
} from './chat-runtime-owner-ports';
import { projectRuntimeStateToRuntimeController } from '../helpers/chat-runtime-owner-projection';

function createAgentProviderOptionsKeyWithRuntime(providerOptionsKey: string, runtimeMode: unknown): string {
  return providerOptionsKey.includes('::agent-runtime:')
    ? providerOptionsKey
    : `${providerOptionsKey}::${createChatAgentRuntimeModeConfigKey(normalizeChatAgentRuntimeMode(runtimeMode, 'unbound'))}`;
}

@Injectable()
export class ChatRuntimeOwnerSubmittedTurnLifecycleService implements ChatRuntimeOwnerSubmittedTurnLifecyclePort {
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);
  private readonly ownerSessionContext = inject<ChatRuntimeOwnerSessionContextPort>(CHAT_RUNTIME_OWNER_SESSION_CONTEXT);
  private readonly ownerSessionModel = inject<ChatRuntimeOwnerSessionModelPort>(CHAT_RUNTIME_OWNER_SESSION_MODEL);
  private readonly submittedTurnTitle = inject<ChatRuntimeOwnerSubmittedTurnTitlePort>(
    CHAT_RUNTIME_OWNER_SUBMITTED_TURN_TITLE,
  );
  private readonly turnStartupEditLifecycle = inject<ChatRuntimeOwnerTurnStartupEditLifecyclePort>(
    CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  );

  private ownerFacade: LexOwnerFacade | null = null;

  bindOwner(owner: LexOwnerFacade): void {
    if (this.ownerFacade && this.ownerFacade !== owner) {
      throw new Error('[AilyChat][RuntimeOwnerLifecycle] Runtime owner lifecycle cannot be rebound to a different owner.');
    }
    this.ownerFacade = owner;
  }

  async prepareSubmittedTurn(request: ChatRuntimeHostSubmitRequest, owner: LexOwnerFacade): Promise<void> {
    this.bindOwner(owner);
    const targetSessionId = this.normalizeSessionId(request.sessionId);
    if (!targetSessionId) {
      throw new Error('prepareSubmittedTurn requires a sessionResource owner.');
    }

    this.hydrateExistingTurnResponses(targetSessionId, owner);
    await this.ensureBlankSessionRuntimeProviderOptions(targetSessionId, owner);
    await this.ensureRuntimeAgentForSession(targetSessionId, owner);

    const displayText = request.displayText ?? request.requestText;
    this.submittedTurnTitle.prepareSubmittedTurnTitle({
      sessionId: targetSessionId,
      requestText: request.requestText,
      displayText,
      owner,
    });
  }

  async settleSubmittedTurnStartupResources(sessionId?: string | null): Promise<void> {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      throw new Error('settleSubmittedTurnStartupResources requires a sessionResource owner.');
    }

    await this.turnStartupEditLifecycle.waitForCheckpointMetadataSettled(targetSessionId);
  }

  async completeSubmittedTurn(sessionId?: string | null): Promise<void> {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      throw new Error('completeSubmittedTurn requires a sessionResource owner.');
    }

    await this.runtimeController.awaitRequestCompletion(targetSessionId);
  }

  private async ensureBlankSessionRuntimeProviderOptions(sessionId: string, owner: LexOwnerFacade): Promise<void> {
    if (this.ownerSessionModel.readTurnResponses(sessionId).length > 0) {
      return;
    }
    await this.ensureRuntimeAgentForSession(sessionId, owner);
  }

  private async ensureRuntimeAgentForSession(sessionId: string, owner: LexOwnerFacade): Promise<void> {
    const providerOptions = this.rememberRuntimeSessionProviderOptions(
      sessionId,
      this.ownerSessionContext.resolveRuntimeSessionProviderOptions(sessionId),
    );
    const providerOptionsKey = createAgentProviderOptionsKeyWithRuntime(
      createHostSessionProviderOptionsKey(providerOptions),
      this.ownerSessionContext.currentAgentRuntimeMode,
    );
    if (owner.agent.isConfiguredFor?.(sessionId, providerOptionsKey)) {
      await owner.agent.ensureAgent(sessionId, providerOptionsKey);
      return;
    }
    await owner.agent.ensureAgent(sessionId, providerOptionsKey);
  }

  private rememberRuntimeSessionProviderOptions(
    sessionId: string,
    providerOptions: HostSessionProviderOptions,
  ): HostSessionProviderOptions {
    projectRuntimeStateToRuntimeController(this.runtimeController, {
      sessionId,
      patch: {
        providerOptions,
        selectedMode: normalizeChatSelectedMode(this.ownerSessionContext.resolveRuntimeSelectedMode(sessionId)),
        debugSummary: {
          providerOptionsPresent: true,
          selectedModePresent: true,
        },
      },
    });
    return providerOptions;
  }

  private hydrateExistingTurnResponses(sessionId: string, owner: LexOwnerFacade): void {
    const turnResponses = this.ownerSessionModel.readTurnResponses(sessionId);
    owner.hydrateTurnResponses?.(sessionId, turnResponses, {
      visibility: 'detached',
    });
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
