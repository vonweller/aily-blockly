import { inject, Injectable } from '@angular/core';
import type { LexOwnerFacade } from '../helpers/lex-stream.helper';

import {
  createChatAgentRuntimeModeConfigKey,
  normalizeChatAgentRuntimeMode,
} from '../core/chat-agent-runtime-mode';
import { normalizeChatSelectedMode } from '../core/chat-mode';
import { normalizeChatSessionTitleCandidate } from '../core/chat-session-title';
import type { ChatRuntimeHostSubmitRequest } from '../core/chat-runtime-host-contract';
import { ChatTitleCoordinator } from '../helpers/chat-title-coordinator';
import { ChatTitleRequestService } from '../helpers/chat-title-request.service';
import {
  createHostSessionProviderOptionsKey,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import { ChatHistoryService } from './chat-history.service';
import { ChatService } from './chat.service';
import { ChatSessionItemsService } from './chat-session-items.service';
import { ChatSessionModelStoreService } from './chat-session-model-store.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  CHAT_RUNTIME_OWNER_PROJECTION,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  CHAT_RUNTIME_OWNER_SESSION_CONTEXT,
  CHAT_RUNTIME_OWNER_STATE,
  type ChatRuntimeOwnerSubmittedTurnLifecyclePort,
  type ChatRuntimeOwnerProjectionPort,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerSessionContextPort,
  type ChatRuntimeOwnerSessionModelPort,
  type ChatRuntimeOwnerStatePort,
} from './chat-runtime-owner-ports';
import { EditCheckpointService } from './edit-checkpoint.service';

function createAgentProviderOptionsKeyWithRuntime(providerOptionsKey: string, runtimeMode: unknown): string {
  return providerOptionsKey.includes('::agent-runtime:')
    ? providerOptionsKey
    : `${providerOptionsKey}::${createChatAgentRuntimeModeConfigKey(normalizeChatAgentRuntimeMode(runtimeMode, 'unbound'))}`;
}

@Injectable()
export class ChatRuntimeOwnerSubmittedTurnLifecycleService implements ChatRuntimeOwnerSubmittedTurnLifecyclePort {
  private readonly chatService = inject(ChatService);
  private readonly chatHistoryService = inject(ChatHistoryService);
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly chatSessionModelStore = inject(ChatSessionModelStoreService);
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);
  private readonly editCheckpointService = inject(EditCheckpointService);
  private readonly ownerProjection = inject<ChatRuntimeOwnerProjectionPort>(CHAT_RUNTIME_OWNER_PROJECTION);
  private readonly ownerSessionContext = inject<ChatRuntimeOwnerSessionContextPort>(CHAT_RUNTIME_OWNER_SESSION_CONTEXT);
  private readonly ownerSessionModel = inject<ChatRuntimeOwnerSessionModelPort>(CHAT_RUNTIME_OWNER_SESSION_MODEL);
  private readonly ownerState = inject<ChatRuntimeOwnerStatePort>(CHAT_RUNTIME_OWNER_STATE);

  private ownerFacade: LexOwnerFacade | null = null;
  private readonly titleRequestService = new ChatTitleRequestService(() => {
    const currentModel = this.chatService.currentModel as { isCustom?: boolean; apiKey?: string; baseUrl?: string } | null;
    if (!currentModel?.isCustom) {
      return null;
    }

    const apiKey = typeof currentModel.apiKey === 'string' ? currentModel.apiKey.trim() : '';
    const baseUrl = typeof currentModel.baseUrl === 'string' ? currentModel.baseUrl.trim() : '';
    return apiKey && baseUrl ? { apiKey, baseUrl } : null;
  });
  private readonly titleCoordinator = this.createTitleCoordinator();

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

    const waitForCheckpointMetadataSettled = this.editCheckpointService?.waitForCheckpointMetadataSettled;
    if (typeof waitForCheckpointMetadataSettled === 'function') {
      await waitForCheckpointMetadataSettled.call(this.editCheckpointService);
    }

    const displayText = request.displayText ?? request.requestText;
    this.applyDefaultSessionTitleIfNeeded(displayText, targetSessionId);
    void this.titleCoordinator.generate(request.requestText, targetSessionId);
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
      this.chatService.currentAgentRuntimeMode,
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
    this.ownerProjection.projectRuntimeState({
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

  private applyDefaultSessionTitleIfNeeded(content: string, sessionId: string): void {
    const targetModel = this.chatSessionModelStore.get(sessionId);
    const modelTitle = targetModel?.title;
    const currentTitle = modelTitle?.text
      ?? (sessionId === this.normalizeSessionId(this.chatService.currentSessionId)
        ? this.chatService.currentSessionTitle
        : '');
    const currentTitleSource = modelTitle?.source
      ?? (sessionId === this.normalizeSessionId(this.chatService.currentSessionId)
        ? this.chatService.currentSessionTitleSource
        : undefined);
    const normalizedTitle = typeof currentTitle === 'string' ? currentTitle.trim() : '';
    if (normalizedTitle && currentTitleSource !== 'default-first-request') {
      return;
    }

    const firstLine = content.trim().split('\n')[0]?.trim().substring(0, 200) ?? '';
    const defaultTitle = firstLine || 'New Chat';
    const candidate = normalizeChatSessionTitleCandidate({
      text: defaultTitle,
      source: 'default-first-request',
    });
    this.chatSessionModelStore.updateMetadata(sessionId, { title: candidate });
    this.chatHistoryService.updateTitle(sessionId, defaultTitle, { source: 'generated' });
    if (sessionId === this.normalizeSessionId(this.chatService.currentSessionId)) {
      this.chatService.setCurrentSessionTitle?.(candidate);
    }
  }

  private createTitleCoordinator(): ChatTitleCoordinator {
    const service = this;
    return new ChatTitleCoordinator(
      {
        get sessionId() {
          return service.ownerState.resolveActiveRuntimeSessionId(service.chatService.currentSessionId);
        },
        get sessionTitle() { return service.chatService.currentSessionTitle; },
        get chatService() { return service.chatService; },
        get chatHistoryService() { return service.chatHistoryService; },
        get session() {
          return {
            saveCurrentSession: () => undefined,
          } as never;
        },
        get lexStream() {
          if (!service.ownerFacade) {
            throw new Error('[AilyChat][RuntimeOwnerLifecycle] Runtime owner facade is not bound yet.');
          }
          return service.ownerFacade;
        },
        readCurrentViewSessionResource: () => null,
        updateSessionModelTitle: (sessionId, title) => {
          service.chatSessionModelStore.updateMetadata(sessionId, { title });
        },
      },
      this.titleRequestService,
      (sessionId, title) => {
        this.chatSessionItemsService.sessionItemController.updateManagedChatSessionItemTitle(sessionId, title);
      },
    );
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
