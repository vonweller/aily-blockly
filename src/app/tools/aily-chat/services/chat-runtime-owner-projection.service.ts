import { Injectable, inject } from '@angular/core';

import type { TurnResponseTurn } from 'aily-lex/browser';
import {
  runtimeChangeOptionsFromTranscriptProjection,
  type ChatRuntimeTurnResponseSyncOptions,
} from '../core/chat-runtime-projection-policy';
import { normalizeChatSessionTitleCandidate } from '../core/chat-session-title';
import {
  buildHostProjectionStateFromPersistedRecord,
  type HostTurnResponseState,
} from '../helpers/host-turn-response-state';
import type { HostSessionSaveTarget } from '../helpers/host-session-save-bridge';
import { buildSessionTurnOwnerDiagnostics } from '../helpers/session-turn-owner-diagnostics';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  type ChatRuntimeOwnerExecutionProjectionInput,
  type ChatRuntimeOwnerHandleProjectionInput,
  type ChatRuntimeOwnerProjectionPatchInput,
  type ChatRuntimeOwnerProjectionPort,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerTurnResponsesProjectionInput,
} from './chat-runtime-owner-ports';
import type { ChatSessionRuntimeHandlePatch } from './chat-session-runtime-registry-core';
import type { ChatSessionRuntimeProjectionPatch } from './chat-session-runtime-projection-core';
import {
  DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
  type ChatSessionRuntimeCapabilities,
  type ChatSessionRuntimeChangeOptions,
} from './chat-session-runtime-store.service';

interface ChatRuntimeOwnerTurnResponsesProjectionInputInternal {
  readonly sessionId: string | null | undefined;
  readonly turnResponses: readonly TurnResponseTurn[] | null | undefined;
  readonly hostProjectionState: HostTurnResponseState | null;
  readonly capabilities?: ChatSessionRuntimeCapabilities | null;
  readonly concurrencyScope?: string | null;
  readonly projection: ChatRuntimeTurnResponseSyncOptions;
}

interface ChatRuntimeOwnerProjectionPatchInputInternal {
  readonly sessionId: string | null | undefined;
  readonly patch: ChatSessionRuntimeProjectionPatch;
  readonly options?: ChatSessionRuntimeChangeOptions;
}

interface ChatRuntimeOwnerHandleProjectionInputInternal {
  readonly sessionId: string | null | undefined;
  readonly patch: ChatSessionRuntimeHandlePatch;
}

interface ChatRuntimeOwnerExecutionProjectionInputInternal {
  readonly saveTarget: HostSessionSaveTarget | null | undefined;
}

@Injectable()
export class ChatRuntimeOwnerProjectionService implements ChatRuntimeOwnerProjectionPort {
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(
    CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  );

  buildHostProjectionState(
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
  ): HostTurnResponseState | null {
    return ChatRuntimeOwnerProjectionService.buildHostProjectionState(turnResponses);
  }

  projectExecutionRuntimeState(input: ChatRuntimeOwnerExecutionProjectionInput): boolean {
    return ChatRuntimeOwnerProjectionService.projectExecutionRuntimeStateToRuntimeController(
      this.runtimeController,
      input,
    );
  }

  projectRuntimeState(input: ChatRuntimeOwnerProjectionPatchInput): boolean {
    return ChatRuntimeOwnerProjectionService.projectRuntimeStateToRuntimeController(
      this.runtimeController,
      input,
    );
  }

  syncHandleState(input: ChatRuntimeOwnerHandleProjectionInput): boolean {
    return ChatRuntimeOwnerProjectionService.syncHandleStateToRuntimeController(
      this.runtimeController,
      input,
    );
  }

  syncTurnResponses(input: ChatRuntimeOwnerTurnResponsesProjectionInput): boolean {
    return ChatRuntimeOwnerProjectionService.syncTurnResponsesToRuntimeController(
      this.runtimeController,
      input,
    );
  }

  static buildHostProjectionState(
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
  ): HostTurnResponseState | null {
    return Array.isArray(turnResponses)
      ? buildHostProjectionStateFromPersistedRecord({ turnResponses })
      : null;
  }

  static projectExecutionRuntimeStateToRuntimeController(
    runtimeController: Pick<ChatRuntimeOwnerRuntimeControllerPort, 'projectRuntimeState' | 'readHandleProjectionMetadata'>,
    input: ChatRuntimeOwnerExecutionProjectionInputInternal,
  ): boolean {
    const saveTarget = input.saveTarget;
    const targetSessionId = ChatRuntimeOwnerProjectionService.normalizeSessionId(saveTarget?.sessionId);
    if (!targetSessionId) {
      return false;
    }

    const handle = runtimeController.readHandleProjectionMetadata(targetSessionId);
    const titleCandidate = normalizeChatSessionTitleCandidate(
      saveTarget?.sessionTitleCandidate ?? {
        text: saveTarget?.sessionTitle,
        source: saveTarget?.sessionTitleSource,
        revision: saveTarget?.sessionTitleRevision,
      },
    );
    runtimeController.projectRuntimeState(targetSessionId, {
      turnResponses: Array.isArray(saveTarget?.turnResponses)
        ? saveTarget.turnResponses
        : undefined,
      hostProjectionState: ChatRuntimeOwnerProjectionService.buildHostProjectionState(saveTarget?.turnResponses),
      status: null,
      requestInProgress: false,
      yieldRequested: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      capabilities: handle.capabilities ?? DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
      ...(handle.concurrencyScope ? { concurrencyScope: handle.concurrencyScope } : {}),
      debugSummary: {
        liveRuntimeOverlayPresent: Array.isArray(saveTarget?.turnResponses) && saveTarget.turnResponses.length > 0,
        pendingRequest: false,
        needsInput: false,
        attachedView: false,
        ...(titleCandidate.text ? { title: titleCandidate.text } : {}),
        ...(titleCandidate.text && titleCandidate.source !== 'empty' ? { titleSource: titleCandidate.source } : {}),
        ...(titleCandidate.text ? { titleRevision: titleCandidate.revision } : {}),
      },
    });
    return true;
  }

  static projectRuntimeStateToRuntimeController(
    runtimeController: Pick<ChatRuntimeOwnerRuntimeControllerPort, 'projectRuntimeState'>,
    input: ChatRuntimeOwnerProjectionPatchInputInternal,
  ): boolean {
    const targetSessionId = ChatRuntimeOwnerProjectionService.normalizeSessionId(input.sessionId);
    if (!targetSessionId) {
      return false;
    }

    runtimeController.projectRuntimeState(targetSessionId, input.patch, input.options);
    return true;
  }

  static syncHandleStateToRuntimeController(
    runtimeController: Pick<ChatRuntimeOwnerRuntimeControllerPort, 'syncRuntimeHandleState'>,
    input: ChatRuntimeOwnerHandleProjectionInputInternal,
  ): boolean {
    const targetSessionId = ChatRuntimeOwnerProjectionService.normalizeSessionId(input.sessionId);
    if (!targetSessionId) {
      return false;
    }

    runtimeController.syncRuntimeHandleState(targetSessionId, input.patch);
    return true;
  }

  static syncTurnResponsesToRuntimeController(
    runtimeController: Pick<ChatRuntimeOwnerRuntimeControllerPort, 'syncRuntimeHandleState' | 'syncRuntimeTurnResponses'>,
    input: ChatRuntimeOwnerTurnResponsesProjectionInputInternal,
  ): boolean {
    const targetSessionId = ChatRuntimeOwnerProjectionService.normalizeSessionId(input.sessionId);
    if (!targetSessionId || !Array.isArray(input.turnResponses)) {
      return false;
    }

    const ownerDiagnostics = buildSessionTurnOwnerDiagnostics(targetSessionId, input.turnResponses);
    if (input.turnResponses.length > 0
      && ownerDiagnostics.ownerSamples.length > 0
      && !ownerDiagnostics.ownerSamples.includes(targetSessionId)) {
      console.warn('[AilyChat][RuntimeOwnerProjection][blocked-owner-mismatch]', {
        targetSessionId,
        ownerSamples: ownerDiagnostics.ownerSamples,
        firstTurnId: ownerDiagnostics.firstTurnId,
        firstRequestPreview: ownerDiagnostics.firstRequestPreview,
      });
      return false;
    }

    runtimeController.syncRuntimeHandleState(targetSessionId, {
      capabilities: input.capabilities ?? DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
      concurrencyScope: input.concurrencyScope ?? null,
    });
    runtimeController.syncRuntimeTurnResponses(
      targetSessionId,
      input.turnResponses,
      input.hostProjectionState,
      runtimeChangeOptionsFromTranscriptProjection(input.projection),
    );
    return true;
  }

  private static normalizeSessionId(sessionId: string | null | undefined): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
