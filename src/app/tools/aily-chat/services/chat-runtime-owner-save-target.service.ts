import { Injectable, inject } from '@angular/core';

import {
  DEFAULT_CHAT_SESSION_TYPE,
  normalizeChatSelectedMode,
  normalizeChatSessionType,
  resolveChatCurrentMode,
  type ChatSelectedMode,
} from '../core/chat-mode';
import {
  normalizeChatSessionTitleCandidate,
  normalizeChatSessionTitleText,
} from '../core/chat-session-title';
import {
  normalizeHostSessionProviderOptions,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import type { HostSessionSaveTarget } from '../helpers/host-session-save-bridge';
import { ChatRuntimeHostInventoryService } from './chat-runtime-host-inventory.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerSaveTargetPort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerSaveTargetService implements ChatRuntimeOwnerSaveTargetPort {
  private readonly hostInventory = inject(ChatRuntimeHostInventoryService);
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);

  buildExecutionSaveTarget(sessionId?: string | null): HostSessionSaveTarget | null {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      return null;
    }

    const providerOptions = this.resolveRuntimeSessionProviderOptions(targetSessionId);
    const selectedMode = this.resolveRuntimeSelectedMode(targetSessionId);
    const resolvedMode = resolveChatCurrentMode(selectedMode);
    const hostInventoryItem = this.hostInventory.readSessionState(targetSessionId);
    const sessionTitleCandidate = normalizeChatSessionTitleCandidate({
      text: normalizeChatSessionTitleText(hostInventoryItem?.title),
      source: hostInventoryItem?.titleSource ?? 'empty',
    });
    const sessionType = normalizeChatSessionType(
      hostInventoryItem?.sessionType,
      DEFAULT_CHAT_SESSION_TYPE,
    );

    return {
      sessionId: targetSessionId,
      sessionTitleCandidate,
      sessionType,
      providerOptions,
      selectedMode,
      resolvedMode,
      model: null,
    };
  }

  private resolveRuntimeSessionProviderOptions(sessionId: string): HostSessionProviderOptions {
    const runtimeProviderOptions = this.runtimeController.readRuntimeState(sessionId)?.providerOptions;
    if (runtimeProviderOptions) {
      return normalizeHostSessionProviderOptions(runtimeProviderOptions);
    }
    return normalizeHostSessionProviderOptions({
      folderPath: this.hostInventory.readSessionState(sessionId)?.projectPath ?? null,
    });
  }

  private resolveRuntimeSelectedMode(sessionId: string): ChatSelectedMode {
    const runtimeSelectedMode = this.runtimeController.readRuntimeState(sessionId)?.selectedMode;
    if (runtimeSelectedMode) {
      return normalizeChatSelectedMode(runtimeSelectedMode);
    }

    const hostInventoryItem = this.hostInventory.readSessionState(sessionId);
    return normalizeChatSelectedMode(hostInventoryItem?.selectedMode ?? {
      modeId: hostInventoryItem?.mode,
    });
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
