import { Injectable, inject } from '@angular/core';

import { ChatSessionItemsService } from './chat-session-items.service';
import type {
  ChatRuntimeOwnerSaveBridgePort,
  ChatRuntimeOwnerSaveCurrentSessionInput,
  ChatRuntimeOwnerSaveTargetPort,
  ChatRuntimeOwnerSessionSaveBridgeFactoryPort,
  ChatRuntimeOwnerWorkspaceEnvironmentPort,
} from './chat-runtime-owner-ports';
import {
  CHAT_RUNTIME_OWNER_SAVE_TARGET,
  CHAT_RUNTIME_OWNER_SESSION_SAVE_BRIDGE_FACTORY,
  CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerSaveBridgeService implements ChatRuntimeOwnerSaveBridgePort {
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly ownerSaveTarget = inject<ChatRuntimeOwnerSaveTargetPort>(CHAT_RUNTIME_OWNER_SAVE_TARGET);
  private readonly sessionSaveBridgeFactory = inject<ChatRuntimeOwnerSessionSaveBridgeFactoryPort>(
    CHAT_RUNTIME_OWNER_SESSION_SAVE_BRIDGE_FACTORY,
  );
  private readonly workspaceEnvironment = inject<ChatRuntimeOwnerWorkspaceEnvironmentPort>(
    CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
  );

  saveCurrentSession(input: ChatRuntimeOwnerSaveCurrentSessionInput): void {
    const activeSessionId = this.normalizeSessionId(input.sessionId);
    const target = input.target ?? this.ownerSaveTarget.buildExecutionSaveTarget(activeSessionId);
    const saveBridge = this.sessionSaveBridgeFactory.create({
      sessionId: activeSessionId,
      sessionTitle: input.sessionTitle,
      lexStream: input.lexStream,
    });

    if (saveBridge.saveCurrentSession({
      hostProjection: input.hostProjection ?? null,
      visibleChatList: input.visibleChatList,
      hostRequestModel: input.hostRequestModel ?? null,
      target,
    })) {
      return;
    }

    this.discardUnsavedSession(target?.sessionId);
  }

  private discardUnsavedSession(sessionId: unknown): void {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      return;
    }

    this.chatSessionItemsService.sessionItemController.discardChatSessionItem(targetSessionId);
    (this.chatSessionItemsService as unknown as {
      refreshHistoryList?: (projectPath?: string | null, projectRootPath?: string | null) => void;
    }).refreshHistoryList?.(
      this.workspaceEnvironment.currentProjectPath || null,
      this.workspaceEnvironment.projectRootPath || null,
    );
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
