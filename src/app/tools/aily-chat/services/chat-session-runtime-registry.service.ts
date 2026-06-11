import { Injectable } from '@angular/core';

import type { TurnResponseTurn } from 'aily-lex/browser';
import { GitAwareWorkspaceChangeCollector } from 'aily-lex/browser';
import { AilyHost } from '../core/host';
import type { ChatSelectedMode } from '../core/chat-mode';
import type { HostTurnResponseState } from '../helpers/host-turn-response-state';
import type { PendingFollowupRequest } from '../helpers/chat-pending-request';
import type { HostSessionProviderOptions } from '../helpers/host-session-input-state';
import { EditingContentStore } from './editing-content-store.service';
import { EditingTimelineRepository } from './editing-timeline-repository.service';
import { EditingTimelineRecordingBridge } from './editing-timeline-recording-bridge';
import {
  ChatSessionRuntimeStoreService,
  DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
  type ChatSessionRuntimeChangeReason,
  type ChatSessionRuntimeCapabilities,
  type ChatSessionRuntimeDebugSummary,
  type ChatSessionRuntimeQuotaOverlay,
  type ChatSessionRuntimeState,
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
  readonly abortController?: AbortController;
  readonly stopSession?: () => void;
  readonly disposeSession?: () => void;
}

export interface ChatSessionRuntimeHandlePatch {
  readonly capabilities?: Partial<ChatSessionRuntimeCapabilities> | null;
  readonly concurrencyScope?: string | null;
  readonly requestInProgress?: boolean;
  readonly supportsInterruption?: boolean;
  readonly activeResponseHandle?: unknown | null;
  readonly abortController?: AbortController | null;
  readonly stopSession?: (() => void) | null;
  readonly disposeSession?: (() => void) | null;
}

export interface ChatSessionActiveRequestHandle extends ChatSessionRuntimeHandlePatch {
  readonly requestInProgress: true;
  readonly supportsInterruption: true;
  readonly activeResponseHandle: unknown;
  readonly stopSession: () => void;
}

export interface ChatSessionRuntimeProjectionPatch extends ChatSessionRuntimeHandlePatch {
  readonly turnResponses?: readonly TurnResponseTurn[] | null | undefined;
  readonly hostProjectionState?: HostTurnResponseState | null | undefined;
  readonly pendingFollowupRequests?: readonly PendingFollowupRequest[] | null | undefined;
  readonly yieldRequested?: boolean | null | undefined;
  readonly status?: ChatSessionRuntimeStatus | null | undefined;
  readonly description?: string | null | undefined;
  readonly attachedView?: boolean | undefined;
  readonly quotaOverlay?: ChatSessionRuntimeQuotaOverlay | null | undefined;
  readonly viewOverlay?: ChatSessionRuntimeViewOverlay | null | undefined;
  readonly providerOptions?: HostSessionProviderOptions | null | undefined;
  readonly selectedMode?: ChatSelectedMode | null | undefined;
  readonly debugSummary?: Partial<ChatSessionRuntimeDebugSummary> | null | undefined;
}

export interface ChatSessionLexPostTurnResources {
  readonly cwd: string;
  readonly editingTimelineRecorder: EditingTimelineRecordingBridge;
  readonly workspaceChangeCollector: GitAwareWorkspaceChangeCollector;
}

export interface ChatSessionLexRequestCompletedInput {
  readonly sessionId: string;
  readonly turnId: string;
  readonly reason: string;
  readonly runWorkspaceFinalize: () => Promise<void>;
  readonly runSessionEndHooks: () => Promise<void>;
}

@Injectable()
export class ChatSessionRuntimeRegistryService {
  private readonly handles = new Map<string, ChatSessionRuntimeHandle>();
  private readonly lexPostTurnResources = new Map<string, ChatSessionLexPostTurnResources>();
  private readonly pendingLexRequestCompletion = new Map<string, Promise<void>>();

  constructor(
    private readonly runtimeStore: ChatSessionRuntimeStoreService,
  ) {}

  readHandle(sessionId: string | null | undefined): ChatSessionRuntimeHandle | undefined {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    return normalizedSessionId ? this.handles.get(normalizedSessionId) : undefined;
  }

  readProjectedRuntimeState(sessionId: string | null | undefined): ChatSessionRuntimeState | undefined {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return undefined;
    }

    const runtimeState = this.runtimeStore.read(normalizedSessionId);
    const activeHandle = this.handles.get(normalizedSessionId);
    if (activeHandle?.requestInProgress) {
      return {
        ...(runtimeState ?? {
          turnResponses: [],
          hostProjectionState: null,
          attachedView: false,
        }),
        requestInProgress: true,
        status: runtimeState?.status ?? 'in_progress',
        supportsInterruption: activeHandle.supportsInterruption,
        activeResponseHandle: activeHandle.activeResponseHandle ?? runtimeState?.activeResponseHandle,
      };
    }

    if (!runtimeState || !this.hasRuntimeRequestGate(runtimeState)) {
      return runtimeState;
    }

    const {
      activeResponseHandle: _activeResponseHandle,
      stopSession: _stopSession,
      status,
      ...rest
    } = runtimeState;
    return {
      ...rest,
      ...(status && status !== 'in_progress' ? { status } : {}),
      requestInProgress: false,
      supportsInterruption: false,
    };
  }

  getSessionIds(): readonly string[] {
    return [...new Set([
      ...this.runtimeStore.getSessionIds(),
      ...this.handles.keys(),
      ...this.lexPostTurnResources.keys(),
    ])];
  }

  getOrCreateLexPostTurnResources(
    sessionId: string | null | undefined,
    cwd: string | null | undefined,
  ): ChatSessionLexPostTurnResources | undefined {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const normalizedCwd = typeof cwd === 'string' ? cwd.trim() : '';
    if (!normalizedSessionId || !normalizedCwd) {
      return undefined;
    }

    const existing = this.lexPostTurnResources.get(normalizedSessionId);
    if (existing && existing.cwd === normalizedCwd) {
      return existing;
    }

    const nextResources: ChatSessionLexPostTurnResources = {
      cwd: normalizedCwd,
      editingTimelineRecorder: new EditingTimelineRecordingBridge(
        new EditingTimelineRepository({
          joinPath: (...parts) => AilyHost.get().path.join(...parts),
        }),
        new EditingContentStore({
          joinPath: (...parts) => AilyHost.get().path.join(...parts),
        }),
        normalizedCwd,
        normalizedSessionId,
      ),
      workspaceChangeCollector: new GitAwareWorkspaceChangeCollector(),
    };

    this.lexPostTurnResources.set(normalizedSessionId, nextResources);
    return nextResources;
  }

  scheduleLexRequestCompleted(input: ChatSessionLexRequestCompletedInput): void {
    const normalizedSessionId = this.normalizeSessionId(input.sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const runCompletion = async (): Promise<void> => {
      await input.runWorkspaceFinalize();
      await input.runSessionEndHooks();
    };

    const previous = this.pendingLexRequestCompletion.get(normalizedSessionId) ?? Promise.resolve();
    const next = previous.then(runCompletion, runCompletion).finally(() => {
      if (this.pendingLexRequestCompletion.get(normalizedSessionId) === next) {
        this.pendingLexRequestCompletion.delete(normalizedSessionId);
      }
    });
    this.pendingLexRequestCompletion.set(normalizedSessionId, next);
  }

  async awaitPendingLexRequestCompleted(sessionId?: string | null): Promise<void> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (normalizedSessionId) {
      await (this.pendingLexRequestCompletion.get(normalizedSessionId) ?? Promise.resolve());
      return;
    }

    await Promise.all([...this.pendingLexRequestCompletion.values()]);
  }

  canStartRequest(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const handle = this.readHandle(normalizedSessionId);
    if (!handle?.requestInProgress) {
      return !normalizedSessionId || !this.hasBlockingConcurrentHandle(normalizedSessionId, handle);
    }

    return handle.capabilities.canContinueInPlace;
  }

  beginRequest(
    sessionId: string | null | undefined,
    handle: ChatSessionActiveRequestHandle,
    projection?: Omit<ChatSessionRuntimeProjectionPatch, keyof ChatSessionRuntimeHandlePatch>,
  ): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    const patch: ChatSessionRuntimeProjectionPatch = {
      ...projection,
      requestInProgress: true,
      supportsInterruption: true,
      activeResponseHandle: handle.activeResponseHandle,
      stopSession: handle.stopSession,
      ...(handle.disposeSession ? { disposeSession: handle.disposeSession } : {}),
      ...(handle.capabilities ? { capabilities: handle.capabilities } : {}),
      ...(handle.concurrencyScope !== undefined ? { concurrencyScope: handle.concurrencyScope } : {}),
    };
    this.projectRuntimeState(normalizedSessionId, patch);
  }

  completeRequest(
    sessionId: string | null | undefined,
    handleId?: unknown,
    debugSummary?: Partial<ChatSessionRuntimeDebugSummary>,
  ): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const previous = this.handles.get(normalizedSessionId);
    if (!previous?.requestInProgress) {
      return false;
    }

    if (handleId !== undefined && previous.activeResponseHandle !== handleId) {
      return false;
    }

    this.markRequestComplete(normalizedSessionId, debugSummary);
    return true;
  }

  cancelRequest(
    sessionId: string | null | undefined,
    options?: {
      readonly source?: 'user' | 'system';
      readonly handleId?: unknown;
      readonly debugSummary?: Partial<ChatSessionRuntimeDebugSummary>;
    },
  ): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const handle = this.readHandle(normalizedSessionId);
    if (!normalizedSessionId || !handle?.supportsInterruption) {
      return false;
    }

    if (options?.handleId !== undefined && handle.activeResponseHandle !== options.handleId) {
      return false;
    }

    handle.abortController?.abort();
    handle.stopSession?.();
    return this.completeRequest(normalizedSessionId, handle.activeResponseHandle, {
      ...(options?.debugSummary ?? {}),
      ...(options?.source === 'user' || options?.source === undefined
        ? { lastExplicitInterruptAt: Date.now() }
        : {}),
    });
  }

  clearStaleRequestGate(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const handle = this.handles.get(normalizedSessionId);
    if (handle?.requestInProgress) {
      return false;
    }

    const runtimeState = this.runtimeStore.read(normalizedSessionId);
    if (!this.hasRuntimeRequestGate(runtimeState)) {
      return false;
    }

    if (handle) {
      this.handles.set(normalizedSessionId, {
        ...handle,
        requestInProgress: false,
        supportsInterruption: false,
        activeResponseHandle: undefined,
        abortController: undefined,
        stopSession: undefined,
      });
    }

    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      status: null,
      requestInProgress: false,
      yieldRequested: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      debugSummary: {
        pendingRequest: false,
      },
    }, {
      reason: 'handle',
    });
    return true;
  }

  setAbortController(
    sessionId: string | null | undefined,
    controller: AbortController | null,
  ): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const previous = this.handles.get(normalizedSessionId);
    const handle = this.upsertHandle(normalizedSessionId, {
      abortController: controller,
      requestInProgress: controller ? previous?.requestInProgress ?? true : previous?.requestInProgress,
      supportsInterruption: controller ? true : previous?.supportsInterruption,
    });
    if (!this.runtimeStore.read(normalizedSessionId)) {
      return true;
    }

    this.projectHandleToRuntimeStore(normalizedSessionId, handle);
    return true;
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

    this.projectHandleToRuntimeStore(normalizedSessionId, handle);
  }

  releaseHandle(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return false;
    }

    const hadHandle = this.handles.delete(normalizedSessionId);
    if (!this.runtimeStore.read(normalizedSessionId)) {
      return hadHandle;
    }

    this.runtimeStore.replaceRuntimeState(normalizedSessionId, {
      requestInProgress: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      disposeSession: null,
    }, {
      reason: 'handle',
    });
    return hadHandle;
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
      pendingFollowupRequests: patch.pendingFollowupRequests,
      yieldRequested: patch.yieldRequested,
      status: patch.status,
      description: patch.description,
      quotaOverlay: patch.quotaOverlay,
      viewOverlay: patch.viewOverlay,
      providerOptions: patch.providerOptions,
      selectedMode: patch.selectedMode,
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
    }, {
      reason: this.resolveProjectionChangeReason(patch),
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
    }, {
      reason: 'transcript',
      highFrequency: true,
    });
  }

  attachView(sessionId: string | null | undefined): boolean {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId || !this.runtimeStore.read(normalizedSessionId)) {
      return false;
    }

    this.runtimeStore.replaceRuntimeState(normalizedSessionId, { attachedView: true }, {
      reason: 'view',
    });
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
    }, {
      reason: 'view',
    });
    return true;
  }

  stopSession(sessionId: string | null | undefined): boolean {
    return this.cancelRequest(sessionId, { source: 'user' });
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
      yieldRequested: false,
      debugSummary: {
        lastExplicitDisposeAt: Date.now(),
      },
    }, {
      reason: 'handle',
    });
    this.handles.delete(normalizedSessionId);
    this.lexPostTurnResources.delete(normalizedSessionId);
    this.pendingLexRequestCompletion.delete(normalizedSessionId);
    this.runtimeStore.clearSession(normalizedSessionId);
    return true;
  }

  clearSession(sessionId: string | null | undefined): void {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    this.handles.delete(normalizedSessionId);
    this.lexPostTurnResources.delete(normalizedSessionId);
    this.pendingLexRequestCompletion.delete(normalizedSessionId);
    this.runtimeStore.clearSession(normalizedSessionId);
  }

  clearAll(): void {
    this.handles.clear();
    this.lexPostTurnResources.clear();
    this.pendingLexRequestCompletion.clear();
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
        abortController: undefined,
        stopSession: undefined,
      });
    }

    this.runtimeStore.replaceRuntimeState(sessionId, {
      status: null,
      requestInProgress: false,
      yieldRequested: false,
      supportsInterruption: false,
      activeResponseHandle: null,
      stopSession: null,
      capabilities: previous?.capabilities ?? DEFAULT_CHAT_SESSION_RUNTIME_CAPABILITIES,
      debugSummary,
    }, {
      reason: 'status',
    });
  }

  private resolveProjectionChangeReason(
    patch: ChatSessionRuntimeProjectionPatch,
  ): ChatSessionRuntimeChangeReason {
    if (patch.status !== undefined) {
      return 'status';
    }
    if (patch.description !== undefined) {
      return 'description';
    }
    if (patch.attachedView !== undefined) {
      return 'view';
    }
    if (patch.requestInProgress !== undefined
      || patch.supportsInterruption !== undefined
      || patch.activeResponseHandle !== undefined
      || patch.stopSession !== undefined
      || patch.disposeSession !== undefined) {
      return 'handle';
    }
    if (patch.quotaOverlay !== undefined) {
      return 'quota';
    }
    if (patch.viewOverlay !== undefined) {
      return 'view';
    }
    if (patch.providerOptions !== undefined || patch.selectedMode !== undefined) {
      return 'state';
    }
    if (patch.debugSummary !== undefined) {
      return 'debug';
    }
    if (patch.turnResponses !== undefined || patch.hostProjectionState !== undefined) {
      return 'transcript';
    }

    return 'state';
  }

  private upsertHandle(
    sessionId: string,
    patch: ChatSessionRuntimeHandlePatch,
  ): ChatSessionRuntimeHandle {
    const previous = this.handles.get(sessionId);
    const capabilities = this.resolveCapabilities(patch.capabilities, previous);
    const concurrencyScope = patch.concurrencyScope !== undefined
      ? patch.concurrencyScope ?? undefined
      : previous?.concurrencyScope;
    const requestInProgress = typeof patch.requestInProgress === 'boolean'
      ? patch.requestInProgress
      : previous?.requestInProgress ?? false;
    const supportsInterruption = typeof patch.supportsInterruption === 'boolean'
      ? patch.supportsInterruption
      : requestInProgress
        ? previous?.supportsInterruption ?? false
        : false;
    const activeResponseHandle = patch.activeResponseHandle !== undefined
      ? patch.activeResponseHandle ?? undefined
      : requestInProgress
        ? previous?.activeResponseHandle
        : undefined;
    const abortController = patch.abortController !== undefined
      ? patch.abortController ?? undefined
      : requestInProgress
        ? previous?.abortController
        : undefined;
    const next: ChatSessionRuntimeHandle = {
      sessionId,
      capabilities,
      ...(concurrencyScope ? { concurrencyScope } : {}),
      requestInProgress,
      supportsInterruption,
      ...(activeResponseHandle !== undefined ? { activeResponseHandle } : {}),
      ...(abortController ? { abortController } : {}),
      ...(typeof patch.stopSession === 'function'
        ? { stopSession: patch.stopSession }
        : patch.stopSession === null
          ? {}
          : supportsInterruption && previous?.stopSession
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

  private projectHandleToRuntimeStore(
    sessionId: string,
    handle: ChatSessionRuntimeHandle,
  ): void {
    this.runtimeStore.replaceRuntimeState(sessionId, {
      requestInProgress: handle.requestInProgress,
      supportsInterruption: handle.supportsInterruption,
      activeResponseHandle: handle.activeResponseHandle ?? null,
      stopSession: handle.supportsInterruption
        ? () => this.stopSession(sessionId)
        : null,
      disposeSession: () => this.disposeSession(sessionId),
      capabilities: handle.capabilities,
    }, {
      reason: 'handle',
    });
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

  private hasRuntimeRequestGate(runtimeState: ChatSessionRuntimeState | undefined): boolean {
    return runtimeState?.requestInProgress === true
      || runtimeState?.supportsInterruption === true
      || runtimeState?.status === 'in_progress'
      || typeof runtimeState?.stopSession === 'function'
      || (runtimeState?.activeResponseHandle !== undefined && runtimeState.activeResponseHandle !== null);
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
