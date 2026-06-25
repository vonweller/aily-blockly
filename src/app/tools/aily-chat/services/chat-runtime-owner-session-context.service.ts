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
} from '../core/chat-mode';
import {
  buildHostSessionCurrentPickerInputState,
  normalizeHostSessionProviderOptions,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import { buildHostSessionCurrentPickerRoutingSummary } from '../helpers/host-session-request-routing';
import { ChatService } from './chat.service';
import { readChatRuntimeWorkspaceEnvironment } from '../core/chat-runtime-workspace-environment';
import { ChatSessionEntryStateService } from './chat-session-entry-state.service';
import {
  resolveChatSessionRuntimeCapabilities,
  resolveChatSessionRuntimeConcurrencyScope,
  type ChatSessionRuntimeCapabilities,
} from './chat-session-runtime-store.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerSessionContextPort,
} from './chat-runtime-owner-ports';

@Injectable()
export class ChatRuntimeOwnerSessionContextService implements ChatRuntimeOwnerSessionContextPort {
  private readonly chatService = inject(ChatService);
  private readonly chatSessionEntryStateService = inject(ChatSessionEntryStateService);
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);

  get prjPath(): string {
    return readChatRuntimeWorkspaceEnvironment().projectPath;
  }

  get prjRootPath(): string {
    return readChatRuntimeWorkspaceEnvironment().projectRootPath;
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
    return this.resolveRuntimeSessionProviderOptions(sessionId).folderPath ?? null;
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
    this.syncSessionEntryTargetRuntimeMode(sessionId, normalizedMode, normalizedSource);
  }

  resolveRuntimeSessionProviderOptions(sessionId?: string | null): HostSessionProviderOptions {
    const targetSessionId = this.normalizeSessionId(sessionId);
    const runtimeProviderOptions = targetSessionId
      ? this.runtimeController.readRuntimeState(targetSessionId)?.providerOptions
      : undefined;
    if (runtimeProviderOptions) {
      return normalizeHostSessionProviderOptions(runtimeProviderOptions);
    }

    return normalizeHostSessionProviderOptions(undefined);
  }

  resolveRuntimeSelectedMode(sessionId?: string | null): ChatSelectedMode {
    const targetSessionId = this.normalizeSessionId(sessionId);
    const runtimeSelectedMode = targetSessionId
      ? this.runtimeController.readRuntimeState(targetSessionId)?.selectedMode
      : undefined;
    if (runtimeSelectedMode) {
      return normalizeChatSelectedMode(runtimeSelectedMode);
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

    return {
      sessionType: DEFAULT_CHAT_SESSION_TYPE,
      providerTarget: providerOptions.folderPath,
      customAgentTarget: selectedMode.customAgentTarget,
    };
  }

  private syncSessionEntryTargetRuntimeMode(
    sessionId: string | null | undefined,
    agentRuntimeMode: ChatAgentRuntimeMode,
    agentRuntimeModeSource: ChatAgentRuntimeModeSource,
  ): void {
    const targetSessionId = this.normalizeSessionId(sessionId);
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
      agentRuntimeMode,
      agentRuntimeModeSource,
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
