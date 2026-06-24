import { Injectable, inject } from '@angular/core';

import {
  DEFAULT_CHAT_SESSION_TYPE,
  normalizeChatSelectedMode,
  normalizeChatSessionType,
  resolveChatCurrentMode,
  type ChatResolvedMode,
  type ChatSelectedMode,
} from '../core/chat-mode';
import {
  normalizeChatSessionTitleCandidate,
  normalizeChatSessionTitleText,
} from '../core/chat-session-title';
import {
  normalizeHostSessionProviderOptions,
  resolveHostSessionSelectedModeFromMetadata,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import type { HostSessionSaveTarget } from '../helpers/host-session-save-bridge';
import { ChatHistoryService } from './chat-history.service';
import { ChatService } from './chat.service';
import { ChatSessionItemsService } from './chat-session-items.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  type ChatRuntimeOwnerRuntimeStateReaderPort,
  type ChatRuntimeOwnerSaveTargetPort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerSaveTargetService implements ChatRuntimeOwnerSaveTargetPort {
  private readonly chatService = inject(ChatService);
  private readonly chatHistoryService = inject(ChatHistoryService);
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly runtimeState = inject<ChatRuntimeOwnerRuntimeStateReaderPort>(
    CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  );

  buildExecutionSaveTarget(sessionId?: string | null): HostSessionSaveTarget | null {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      return null;
    }

    const providerOptions = this.resolveRuntimeSessionProviderOptions(targetSessionId);
    const selectedMode = this.resolveRuntimeSelectedMode(targetSessionId);
    const resolvedMode = this.resolveRuntimeResolvedMode(targetSessionId, selectedMode);
    const projectPathHint = providerOptions.folderPath ?? null;
    const sessionEntry = this.chatHistoryService.findEntry?.(targetSessionId);
    const persistedTitle = normalizeChatSessionTitleText(sessionEntry?.title);
    const isCurrentSession = targetSessionId === this.normalizeSessionId(this.chatService.currentSessionId);
    const fallbackTitle = isCurrentSession
      ? normalizeChatSessionTitleText(this.chatService.currentSessionTitle || '')
      : '';
    const currentTitleCandidate = isCurrentSession
      ? (typeof this.chatService.readCurrentSessionTitleCandidate === 'function'
        ? this.chatService.readCurrentSessionTitleCandidate()
        : normalizeChatSessionTitleCandidate({
          text: this.chatService.currentSessionTitle,
          source: this.chatService.currentSessionTitleSource,
          revision: this.chatService.currentSessionTitleRevision,
        }))
      : normalizeChatSessionTitleCandidate(undefined);
    const sessionTitleCandidate = normalizeChatSessionTitleCandidate({
      text: persistedTitle || fallbackTitle,
      source: persistedTitle ? 'restored-custom' : currentTitleCandidate.source,
      revision: currentTitleCandidate.revision,
    });
    const sessionType = this.chatSessionItemsService.sessionItemController.getChatSessionType?.(
      targetSessionId,
      projectPathHint,
    ) ?? normalizeChatSessionType(this.chatService.currentSessionType, DEFAULT_CHAT_SESSION_TYPE);

    return {
      sessionId: targetSessionId,
      sessionTitleCandidate,
      sessionType,
      providerOptions,
      selectedMode,
      resolvedMode,
      model: this.chatService.currentModel ? { ...this.chatService.currentModel } : null,
    };
  }

  private resolveRuntimeSessionProviderOptions(sessionId: string): HostSessionProviderOptions {
    const runtimeProviderOptions = this.runtimeState.readSessionRuntimeState(sessionId)?.providerOptions;
    if (runtimeProviderOptions) {
      return normalizeHostSessionProviderOptions(runtimeProviderOptions);
    }

    const currentSessionId = this.normalizeSessionId(this.chatService.currentSessionId);
    const canUseCurrentVisibleState = !currentSessionId || sessionId === currentSessionId;
    const fallback = canUseCurrentVisibleState
      ? this.chatService.getCurrentSessionProviderOptions?.()
        ?? {
          folderPath: this.chatService.currentSessionPath || null,
          permissionMode: this.chatService.currentSessionPermissionMode,
          ...(this.chatService.currentSessionPermissionLevel
            ? { permissionLevel: this.chatService.currentSessionPermissionLevel }
            : {}),
          ...(this.chatService.currentSessionApprovalsReviewer
            ? { approvalsReviewer: this.chatService.currentSessionApprovalsReviewer }
            : {}),
          ...(this.chatService.currentSessionApprovalPolicy
            ? { approvalPolicy: this.chatService.currentSessionApprovalPolicy }
            : {}),
        }
      : null;
    const rawProviderOptions = this.chatSessionItemsService.sessionItemController
      .getChatSessionProviderOptions?.(sessionId);
    return normalizeHostSessionProviderOptions(rawProviderOptions, fallback);
  }

  private resolveRuntimeSelectedMode(sessionId: string): ChatSelectedMode {
    const runtimeSelectedMode = this.runtimeState.readSessionRuntimeState(sessionId)?.selectedMode;
    if (runtimeSelectedMode) {
      return normalizeChatSelectedMode(runtimeSelectedMode);
    }

    const currentSessionId = this.normalizeSessionId(this.chatService.currentSessionId);
    if (!currentSessionId || sessionId === currentSessionId) {
      return normalizeChatSelectedMode(this.chatService.selectedMode ?? { modeId: this.chatService.currentMode });
    }

    const inputState = this.chatSessionItemsService.sessionItemController.getChatSessionInputState?.(sessionId);
    if (inputState) {
      return resolveHostSessionSelectedModeFromMetadata({
        inputState,
      }, {
        resolveModeById: (modeId) => this.chatService.findResolvedModeById?.(modeId),
        resolveModeByName: (modeName) => this.chatService.findResolvedModeByName?.(modeName),
      });
    }

    return normalizeChatSelectedMode(undefined);
  }

  private resolveRuntimeResolvedMode(
    sessionId: string,
    selectedMode: ChatSelectedMode,
  ): ChatResolvedMode {
    const currentResolvedMode = this.chatService.currentResolvedMode;
    const currentSessionId = this.normalizeSessionId(this.chatService.currentSessionId);
    if (sessionId === currentSessionId
      && selectedMode.modeId === currentResolvedMode.kind
      && selectedMode.customAgentTarget === currentResolvedMode.customAgentTarget) {
      return currentResolvedMode;
    }

    return (selectedMode.customAgentTarget
      ? this.chatService.findResolvedModeById?.(selectedMode.customAgentTarget)
      : undefined)
      ?? this.chatService.findResolvedModeById?.(selectedMode.modeId)
      ?? resolveChatCurrentMode(selectedMode);
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
