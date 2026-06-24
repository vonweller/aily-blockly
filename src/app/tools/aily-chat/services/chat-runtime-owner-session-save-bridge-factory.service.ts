import { Injectable, inject } from '@angular/core';

import { HostSessionSaveBridge } from '../helpers/host-session-save-bridge';
import { ChatHistoryService } from './chat-history.service';
import { ChatService } from './chat.service';
import { ChatSessionModelStoreService } from './chat-session-model-store.service';
import { ContextBudgetService } from './context-budget.service';
import { EditCheckpointService } from './edit-checkpoint.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  CHAT_RUNTIME_OWNER_STATE,
  type ChatRuntimeOwnerRuntimeStateReaderPort,
  type ChatRuntimeOwnerSessionModelPort,
  type ChatRuntimeOwnerStatePort,
  type ChatRuntimeOwnerSessionSaveBridgeFactoryInput,
  type ChatRuntimeOwnerSessionSaveBridgeFactoryPort,
  type ChatRuntimeOwnerSessionSaveBridgePort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerSessionSaveBridgeFactoryService implements ChatRuntimeOwnerSessionSaveBridgeFactoryPort {
  private readonly chatService = inject(ChatService);
  private readonly chatHistoryService = inject(ChatHistoryService);
  private readonly chatSessionModelStore = inject(ChatSessionModelStoreService);
  private readonly runtimeState = inject<ChatRuntimeOwnerRuntimeStateReaderPort>(
    CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  );
  private readonly contextBudgetService = inject(ContextBudgetService);
  private readonly editCheckpointService = inject(EditCheckpointService);
  private readonly ownerSessionModel = inject<ChatRuntimeOwnerSessionModelPort>(CHAT_RUNTIME_OWNER_SESSION_MODEL);
  private readonly ownerState = inject<ChatRuntimeOwnerStatePort>(CHAT_RUNTIME_OWNER_STATE);

  create(input: ChatRuntimeOwnerSessionSaveBridgeFactoryInput): ChatRuntimeOwnerSessionSaveBridgePort {
    const service = this;
    return new HostSessionSaveBridge({
      get toolCallingIteration() { return service.ownerState.toolCallingIteration; },
      get currentMode() { return service.chatService.currentMode; },
      get currentAgentRuntimeMode() { return service.chatService.currentAgentRuntimeMode; },
      get currentAgentRuntimeModeSource() { return service.chatService.currentAgentRuntimeModeSource; },
      get currentModel() { return service.chatService.currentModel; },
      get sessionId() { return input.sessionId; },
      get sessionTitle() { return input.sessionTitle; },
      get chatService() { return service.chatService; },
      get chatHistoryService() { return service.chatHistoryService; },
      get contextBudgetService() { return service.contextBudgetService; },
      get editCheckpointService() { return service.editCheckpointService; },
      get lexStream() { return input.lexStream; },
      readCurrentViewSessionResource: () => null,
      readSessionTurnResponses: (sessionId) => service.ownerSessionModel.readTurnResponses(sessionId),
      readSessionRuntimeState: (sessionId) => service.runtimeState.readSessionRuntimeState(sessionId),
      readSessionCheckpointTimelineState: (sessionId) => {
        const targetSessionId = service.normalizeSessionId(sessionId);
        return targetSessionId
          ? service.chatSessionModelStore.get(targetSessionId)?.getCheckpointTimelineState() ?? null
          : null;
      },
    });
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
