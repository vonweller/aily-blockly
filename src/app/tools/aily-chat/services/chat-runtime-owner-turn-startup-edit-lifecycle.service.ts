import { inject, Injectable } from '@angular/core';
import { readChatRuntimeWorkspaceEnvironment } from '../core/chat-runtime-workspace-environment';
import {
  CHAT_RUNTIME_OWNER_WORKSPACE_EDIT_LIFECYCLE_RESOURCE,
  type ChatRuntimeOwnerTurnStartupEditLifecyclePort,
  type ChatRuntimeOwnerWorkspaceEditLifecycleResourcePort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerTurnStartupEditLifecycleService implements ChatRuntimeOwnerTurnStartupEditLifecyclePort {
  private readonly workspaceEditResource = inject<ChatRuntimeOwnerWorkspaceEditLifecycleResourcePort>(
    CHAT_RUNTIME_OWNER_WORKSPACE_EDIT_LIFECYCLE_RESOURCE,
  );

  ensureAbsExport(sessionId: string | null | undefined): void {
    const projectPath = readChatRuntimeWorkspaceEnvironment().projectPath;
    this.workspaceEditResource.ensureSessionStartAbsExport(sessionId, projectPath);
  }

  saveCheckpointToDisk(sessionId: string | null | undefined): void {
    void this.workspaceEditResource.commitCurrentTurn(sessionId).catch((error: unknown) => {
      console.warn('[AilyChat][RuntimeOwner] checkpoint commit before turn failed:', error);
    });
  }

  waitForCheckpointMetadataSettled(sessionId: string | null | undefined): Promise<void> {
    return this.workspaceEditResource.waitForCheckpointMetadataSettled(sessionId);
  }
}
