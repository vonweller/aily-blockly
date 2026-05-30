import { Injectable } from '@angular/core';

import type { TurnResponseTurn } from 'aily-lex/browser';
import type { HostTurnResponseState } from '../helpers/host-turn-response-state';
import {
  ChatSessionRuntimeStoreService,
  DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
  type ChatSessionRuntimeCapabilities,
  type ChatSessionRuntimeDebugSummary,
  type ChatSessionRuntimeQuotaOverlay,
  type ChatSessionRuntimeStatus,
  type ChatSessionRuntimeViewOverlay,
} from './chat-session-runtime-store.service';

export interface ChatSessionRuntimeHandle {
  readonly sessionId: string;
  readonly capabilities: ChatSessionRuntimeCapabilities;
  readonly concurrencyScope?: string;
  readonly requestInProgress: boolean;
  readonly supportsInterruption: boolean;
  readonly activeResponseHandle?: unknown;
  readonly stopSession?: () => void;
  readonly disposeSession?: () => void;
}

export interface ChatSessionRuntimeHandlePatch {
  readonly capabilities?: Partial<ChatSessionRuntimeCapabilities> | null;
  readonly concurrencyScope?: string | null;
  readonly requestInProgress?: boolean;
  readonly supportsInterruption?: boolean;
  readonly activeResponseHandle?: unknown | null;
  readonly stopSession?: (() => void) | null;
  readonly disposeSession?: (() => void) | null;
}

export interface ChatSessionRuntimeProjectionPatch extends ChatSessionRuntimeHandlePatch {
  readonly turnResponses?: readonly TurnResponseTurn[] | null | undefined;
  readonly hostProjectionState?: HostTurnResponseState | null | undefined;
  readonly status?: ChatSessionRuntimeStatus | null | undefined;
  readonly description?: string | null | undefined;
  readonly attachedView?: boolean | undefined;
  readonly quotaOverlay?: ChatSessionRuntimeQuotaOverlay | null | undefined;
  readonly viewOverlay?: ChatSessionRuntimeViewOverlay | null | undefined;
  readonly debugSummary?: Partial<ChatSessionRuntimeDebugSummary> | null | undefined;
}

@Injectable()
export class ChatSessionRuntimeRegistryService {
  private readonly handles = new Map<string, ChatSessionRuntimeHandle>();

  constructor(
    private readonly runtimeStore: ChatSessionRuntimeStoreService,
  ) {}

  readHandle(sessionId: string | null | undefined): ChatSessionRuntimeHandle | undefined {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    return normalizedSessionId ? this.handles.get(normalizedSessionId) : undefined;
  }

  getSessionIds(): readonly string[] {
    return [...new Set([
      ...this.runtimeStore.getSessionIds(),
      ...this.handles.keys(),
    ])];
  }

  canStartRequest(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const handle = this.readHandle(normalizedSessionId);
    if (!handle?.requestInProgress) {
      return !normalizedSessionId || !this.hasBlockingConcurrentHandle(normalizedSessionId, handle);
    }

    return handle.capabilities.canContinueInPlace;
  }

  syncHandleState(
    sessionId: string | null | undefined,
    patch: ChatSessionRuntimeHandlePatch,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const handle = this.upsertHandle(normalizedSessionId, patch);
    if (!this.runtimeStore.read(normalizedSessionId)) {
      return;
    }

    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      requestInProgress: handle.requestInProgress,
      supportsInterruption: handle.supportsInterruption,
      activeResponseHandle: handle.activeResponseHandle ?? null,
      stopSession: handle.supportsInterruption
        ? () => this.stopSession(normalizedSessionId)
        : null,
      disposeSession: () => this.disposeSession(normalizedSessionId),
      capabilities: handle.capabilities,
    });
  }

  projectRuntimeState(
    sessionId: string | null | undefined,
    patch: ChatSessionRuntimeProjectionPatch,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const handle = this.upsertHandle(normalizedSessionId, patch);
    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      turnResponses: patch.turnResponses,
      hostProjectionState: patch.hostProjectionState,
      status: patch.status,
      description: patch.description,
      quotaOverlay: patch.quotaOverlay,
      viewOverlay: patch.viewOverlay,
      requestInProgress: handle.requestInProgress,
      attachedView: patch.attachedView,
      supportsInterruption: handle.supportsInterruption,
      activeResponseHandle: handle.activeResponseHandle,
      stopSession: handle.supportsInterruption
        ? () => this.stopSession(normalizedSessionId)
        : null,
      disposeSession: () => this.disposeSession(normalizedSessionId),
      capabilities: handle.capabilities,
      debugSummary: patch.debugSummary,
    });
  }

  syncTurnResponses(
    sessionId: string | null | undefined,
    turnResponses: readonly TurnResponseTurn[] | null | undefined,
    hostProjectionState: HostTurnResponseState | null,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId || !Array.isArray(turnResponses)) {
      return;
    }

    const handle = this.upsertHandle(normalizedSessionId, {});
    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      turnResponses,
      hostProjectionState,
      requestInProgress: handle.requestInProgress,
      supportsInterruption: handle.supportsInterruption,
      activeResponseHandle: handle.activeResponseHandle,
      stopSession: handle.supportsInterruption
        ? () => this.stopSession(normalizedSessionId)
        : null,
      disposeSession: () => this.disposeSession(normalizedSessionId),
      capabilities: handle.capabilities,
    });
  }

  attachView(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId || !this.runtimeStore.read(normalizedSessionId)) {
      return false;
    }

    this.runtimeStore.replaceRuntimeState(normalizedSessionId, { attachedView: true });
    return true;
  }

  detachView(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId || !this.runtimeStore.read(normalizedSessionId)) {
      return false;
    }

    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      attachedView: false,
      debugSummary: {
        lastViewDetachAt: Date.now(),
      },
    });
    return true;
  }

  stopSession(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const handle = this.readHandle(normalizedSessionId);
    if (!normalizedSessionId || !handle?.supportsInterruption || typeof handle.stopSession !== 'function') {
      return false;
    }

    handle.stopSession();
    this.markRequestComplete(normalizedSessionId, {
      lastExplicitInterruptAt: Date.now(),
    });
    return true;
  }

  disposeSession(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const handle = this.handles.get(normalizedSessionId);
    handle?.disposeSession?.();
    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      requestInProgress: false,
      supportsInterruption: false,
      stopSession: null,
      disposeSession: null,
      activeResponseHandle: null,
      debugSummary: {
        lastExplicitDisposeAt: Date.now(),
      },
    });
    this.handles.delete(normalizedSessionId);
    this.runtimeStore.clearSession(normalizedSessionId);
    return true;
  }

  clearSession(sessionId: string | null | undefined): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    this.handles.delete(normalizedSessionId);
    this.runtimeStore.clearSession(normalizedSessionId);
  }

  clearAll(): void {
    this.handles.clear();
    this.runtimeStore.clearAll();
  }

  private markRequestComplete(
    sessionId: string,
    debugSummary?: Partial<ChatSessionRuntimeDebugSummary>,
  ): void {
    const previous = this.handles.get(sessionId);
    if (previous) {
      this.handles.set(sessionId, {
        ...previous,
        requestInProgress: false,
        supportsInterruption: false,
        activeResponseHandle: undefined,
        stopSession: undefined,
      });
    }

    this.runtimeStore.replaceRuntimeState(sessionId, {
      status: null,
      requestInProgress: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      capabilities: previous?.capabilities ?? DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
      debugSummary,
    });
  }

  private upsertHandle(
    sessionId: string,
    patch: ChatSessionRuntimeHandlePatch,
  ): ChatSessionRuntimeHandle {
    const previous = this.handles.get(sessionId);
    const capabilities = this.resolveCapabilities(patch.capabilities, previous);
    const activeResponseHandle = patch.activeResponseHandle !== undefined
      ? patch.activeResponseHandle ?? undefined
      : previous?.activeResponseHandle;
    const concurrencyScope = patch.concurrencyScope !== undefined
      ? patch.concurrencyScope ?? undefined
      : previous?.concurrencyScope;
    const next: ChatSessionRuntimeHandle = {
      sessionId,
      capabilities,
      ...(concurrencyScope ? { concurrencyScope } : {}),
      requestInProgress: typeof patch.requestInProgress === 'boolean'
        ? patch.requestInProgress
        : previous?.requestInProgress ?? false,
      supportsInterruption: typeof patch.supportsInterruption === 'boolean'
        ? patch.supportsInterruption
        : previous?.supportsInterruption ?? false,
      ...(activeResponseHandle !== undefined ? { activeResponseHandle } : {}),
      ...(typeof patch.stopSession === 'function'
        ? { stopSession: patch.stopSession }
        : patch.stopSession === null
          ? {}
          : previous?.stopSession
            ? { stopSession: previous.stopSession }
            : {}),
      ...(typeof patch.disposeSession === 'function'
        ? { disposeSession: patch.disposeSession }
        : patch.disposeSession === null
          ? {}
          : previous?.disposeSession
            ? { disposeSession: previous.disposeSession }
            : {}),
    };

    this.handles.set(sessionId, next);
    return next;
  }

  private hasBlockingConcurrentHandle(
    sessionId: string,
    handle: ChatSessionRuntimeHandle | undefined,
  ): boolean {
    if (!handle || handle.capabilities.canRunConcurrently) {
      return false;
    }

    const targetScope = this.resolveConcurrencyScope(handle);
    for (const candidate of this.handles.values()) {
      if (candidate.sessionId === sessionId
        || !candidate.requestInProgress
        || candidate.capabilities.canRunConcurrently
        || this.resolveConcurrencyScope(candidate) !== targetScope) {
        continue;
      }

      return true;
    }

    return false;
  }

  private resolveConcurrencyScope(handle: ChatSessionRuntimeHandle): string {
    return handle.concurrencyScope ?? handle.sessionId;
  }

  private resolveCapabilities(
    capabilities: Partial<ChatSessionRuntimeCapabilities> | null | undefined,
    previous: ChatSessionRuntimeHandle | undefined,
  ): ChatSessionRuntimeCapabilities {
    if (capabilities === null) {
      return { ...DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES };
    }

    return {
      ...DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
      ...(previous?.capabilities ?? {}),
      ...(capabilities ?? {}),
    };
  }

  private normalizeSessionId(sessionId: string | null | undefined): string {
    return typeof sessionId === 'string'
      ? sessionId.trim()
      : '';
  }
}
