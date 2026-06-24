import { inject, Injectable } from '@angular/core';
import { AbsAutoSyncService } from './abs-auto-sync.service';
import {
  CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
  type ChatRuntimeOwnerTurnStartupEditLifecyclePort,
  type ChatRuntimeOwnerWorkspaceEnvironmentPort,
} from './chat-runtime-owner-ports';
import { EditCheckpointService } from './edit-checkpoint.service';

@Injectable()
export class ChatRuntimeOwnerTurnStartupEditLifecycleService implements ChatRuntimeOwnerTurnStartupEditLifecyclePort {
  private readonly absAutoSyncService = inject(AbsAutoSyncService);
  private readonly editCheckpointService = inject(EditCheckpointService);
  private readonly workspaceEnvironment = inject<ChatRuntimeOwnerWorkspaceEnvironmentPort>(
    CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
  );

  ensureAbsExport(): void {
    const projectPath = this.workspaceEnvironment.projectPath;
    if (projectPath) {
      this.absAutoSyncService.initialize(projectPath);
    }
    if (typeof this.absAutoSyncService.scheduleSessionStartExport === 'function') {
      this.absAutoSyncService.scheduleSessionStartExport();
      return;
    }
    this.absAutoSyncService.exportToAbs().catch((error: unknown) => {
      console.warn('[AilyChat][RuntimeOwner] ABS session-start export failed:', error);
    });
  }

  saveCheckpointToDisk(): void {
    if (this.editCheckpointService.getTotalEditCount() === 0) {
      return;
    }
    try {
      this.editCheckpointService.commitCurrentTurn();
    } catch (error) {
      console.warn('[AilyChat][RuntimeOwner] checkpoint commit before turn failed:', error);
    }
  }
}
