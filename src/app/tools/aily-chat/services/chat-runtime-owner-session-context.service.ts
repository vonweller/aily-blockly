import { Injectable, inject } from '@angular/core';

import {
  normalizeChatAgentRuntimeMode,
  normalizeChatAgentRuntimeModeSource,
  type ChatAgentRuntimeMode,
  type ChatAgentRuntimeModeSource,
} from '../core/chat-agent-runtime-mode';
import {
  DEFAULT_CHAT_SESSION_TYPE,
  type ChatSelectedMode,
  normalizeChatSelectedMode,
  normalizeChatSessionType,
} from '../core/chat-mode';
import {
  buildHostSessionCurrentPickerInputState,
  normalizeHostSessionProviderOptions,
  resolveHostSessionSelectedModeFromMetadata,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import { buildHostSessionCurrentPickerRoutingSummary } from '../helpers/host-session-request-routing';
import { ChatService } from './chat.service';
import { ChatSessionEntryStateService } from './chat-session-entry-state.service';
import { ChatSessionItemsService } from './chat-session-items.service';
import {
  resolveChatSessionRuntimeCapabilities,
  resolveChatSessionRuntimeConcurrencyScope,
  type ChatSessionRuntimeCapabilities,
} from './chat-session-runtime-store.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
  type ChatRuntimeOwnerSessionContextPort,
  type ChatRuntimeOwnerRuntimeStateReaderPort,
  type ChatRuntimeOwnerWorkspaceEnvironmentPort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerSessionContextService implements ChatRuntimeOwnerSessionContextPort {
  private readonly chatService = inject(ChatService);
  private readonly chatSessionEntryStateService = inject(ChatSessionEntryStateService);
  private readonly chatSessionItemsService = inject(ChatSessionItemsService);
  private readonly runtimeState = inject<ChatRuntimeOwnerRuntimeStateReaderPort>(
    CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  );
  private readonly workspaceEnvironment = inject<ChatRuntimeOwnerWorkspaceEnvironmentPort>(
    CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
  );

  get prjPath(): string {
    return this.workspaceEnvironment.projectPath;
  }

  get prjRootPath(): string {
    return this.workspaceEnvironment.projectRootPath;
  }

  get currentModel(): any {
    return this.chatService.currentModel;
  }

  get currentAgentRuntimeMode(): ChatAgentRuntimeMode {
    return this.chatService.currentAgentRuntimeMode;
  }

  get currentAgentRuntimeModeSource(): ChatAgentRuntimeModeSource {
    return this.chatService.currentAgentRuntimeModeSource;
  }

  get sessionTitle(): string {
    return this.chatService.currentSessionTitle;
  }

  get currentSessionId(): string {
    return this.normalizeSessionId(this.chatService.currentSessionId);
  }

  currentSessionPath(sessionId?: string | null): string | null {
    return this.resolveRuntimeSessionProviderOptions(sessionId).folderPath ?? this.chatService.currentSessionPath ?? null;
  }

  currentSessionPermissionMode(sessionId?: string | null): HostSessionProviderOptions['permissionMode'] {
    return this.resolveRuntimeSessionProviderOptions(sessionId).permissionMode;
  }

  currentSessionApprovalsReviewer(sessionId?: string | null): HostSessionProviderOptions['approvalsReviewer'] {
    return this.resolveRuntimeSessionProviderOptions(sessionId).approvalsReviewer;
  }

  currentSessionApprovalPolicy(sessionId?: string | null): HostSessionProviderOptions['approvalPolicy'] {
    return this.resolveRuntimeSessionProviderOptions(sessionId).approvalPolicy;
  }

  selectAgentRuntimeMode(
    mode: ChatAgentRuntimeMode | string | null | undefined,
    source: ChatAgentRuntimeModeSource | string | null | undefined = 'user_selected',
    reason?: string | null,
    sessionId?: string | null,
  ): void {
    const normalizedMode = normalizeChatAgentRuntimeMode(mode, this.currentAgentRuntimeMode);
    const normalizedSource = normalizeChatAgentRuntimeModeSource(source, 'user_selected');
    this.chatService.setCurrentAgentRuntimeMode(normalizedMode, normalizedSource);
    this.syncSessionEntryTargetRuntimeMode(sessionId);
  }

  resolveRuntimeSessionProviderOptions(sessionId?: string | null): HostSessionProviderOptions {
    const targetSessionId = this.normalizeSessionId(sessionId);
    const runtimeProviderOptions = targetSessionId
      ? this.runtimeState.readSessionRuntimeState(targetSessionId)?.providerOptions
      : undefined;
    if (runtimeProviderOptions) {
      return normalizeHostSessionProviderOptions(runtimeProviderOptions);
    }

    const currentSessionId = this.normalizeSessionId(this.chatService.currentSessionId);
    const canUseCurrentVisibleState = !targetSessionId || !currentSessionId || targetSessionId === currentSessionId;
    const currentProviderOptions = canUseCurrentVisibleState
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
    const itemProviderOptions = targetSessionId
      ? this.chatSessionItemsService.sessionItemController.getChatSessionProviderOptions?.(targetSessionId)
      : undefined;
    return normalizeHostSessionProviderOptions(itemProviderOptions, currentProviderOptions);
  }

  resolveRuntimeSelectedMode(sessionId?: string | null): ChatSelectedMode {
    const targetSessionId = this.normalizeSessionId(sessionId);
    const runtimeSelectedMode = targetSessionId
      ? this.runtimeState.readSessionRuntimeState(targetSessionId)?.selectedMode
      : undefined;
    if (runtimeSelectedMode) {
      return normalizeChatSelectedMode(runtimeSelectedMode);
    }

    const currentSessionId = this.normalizeSessionId(this.chatService.currentSessionId);
    if (!targetSessionId || !currentSessionId || targetSessionId === currentSessionId) {
      return normalizeChatSelectedMode(this.chatService.selectedMode ?? { modeId: this.chatService.currentMode });
    }

    const inputState = this.chatSessionItemsService.sessionItemController.getChatSessionInputState?.(targetSessionId);
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

  resolveRuntimeCapabilities(sessionId?: string | null): ChatSessionRuntimeCapabilities {
    return resolveChatSessionRuntimeCapabilities(this.resolveRuntimeCapabilityOwner(sessionId));
  }

  resolveRuntimeConcurrencyScope(sessionId?: string | null): string | undefined {
    return resolveChatSessionRuntimeConcurrencyScope(this.resolveRuntimeCapabilityOwner(sessionId));
  }

  private resolveRuntimeCapabilityOwner(sessionId?: string | null): {
    readonly sessionType?: unknown;
    readonly providerTarget?: unknown;
    readonly remoteProviderHandle?: unknown;
    readonly customAgentTarget?: unknown;
    readonly customModeSource?: unknown;
    readonly sessionCustomizationProviderLabel?: unknown;
    readonly sessionCustomizationProviderIconId?: unknown;
  } {
    const targetSessionId = this.normalizeSessionId(sessionId);
    const providerOptions = this.resolveRuntimeSessionProviderOptions(targetSessionId);
    const selectedMode = this.resolveRuntimeSelectedMode(targetSessionId);
    const projectPathHint = providerOptions.folderPath ?? (this.prjPath || null);
    const isCurrentSession = targetSessionId === this.normalizeSessionId(this.chatService.currentSessionId);
    const sessionType = this.chatSessionItemsService.sessionItemController.getChatSessionType?.(
      targetSessionId,
      projectPathHint,
    ) ?? normalizeChatSessionType(
      isCurrentSession ? this.chatService.currentSessionType : undefined,
      DEFAULT_CHAT_SESSION_TYPE,
    );
    const customizationProvider = isCurrentSession
      ? {
        customModeSource: this.chatService.activeCustomModeSource,
        providerLabel: this.chatService.activeSessionCustomizationProviderMetadata?.label,
        providerIconId: this.chatService.activeSessionCustomizationProviderMetadata?.iconId,
      }
      : null;

    return {
      sessionType,
      providerTarget: providerOptions.folderPath,
      customAgentTarget: selectedMode.customAgentTarget,
      customModeSource: customizationProvider?.customModeSource,
      sessionCustomizationProviderLabel: customizationProvider?.providerLabel,
      sessionCustomizationProviderIconId: customizationProvider?.providerIconId,
    };
  }

  private syncSessionEntryTargetRuntimeMode(sessionId?: string | null): void {
    const targetSessionId = this.normalizeSessionId(sessionId) || this.normalizeSessionId(this.chatService.currentSessionId);
    if (!targetSessionId) {
      return;
    }

    const providerOptions = this.resolveRuntimeSessionProviderOptions(targetSessionId);
    const selectedMode = this.resolveRuntimeSelectedMode(targetSessionId);
    const projectPath = providerOptions.folderPath ?? null;
    this.chatSessionEntryStateService.setSessionEntryTarget({
      sessionId: targetSessionId,
      projectPath,
      providerOptions,
      inputState: buildHostSessionCurrentPickerInputState(selectedMode, providerOptions),
      mode: selectedMode.modeId,
      agentRuntimeMode: this.chatService.currentAgentRuntimeMode,
      agentRuntimeModeSource: this.chatService.currentAgentRuntimeModeSource,
      requestRouting: buildHostSessionCurrentPickerRoutingSummary(
        selectedMode,
        undefined,
        providerOptions.permissionLevel,
        providerOptions.approvalsReviewer,
        providerOptions.approvalPolicy,
      ),
    }, projectPath);
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
