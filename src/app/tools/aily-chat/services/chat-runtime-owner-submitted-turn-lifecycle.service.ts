import { inject, Injectable } from '@angular/core';
import type { SessionSnapshot, TurnResponseTurn } from 'aily-lex/browser';
import type { LexOwnerFacade } from '../helpers/lex-stream.helper';

import {
  createChatAgentRuntimeConfigKey,
  normalizeChatAgentRuntimeMode,
  normalizeChatAgentRuntimeModeSource,
} from '../core/chat-agent-runtime-mode';
import { normalizeChatSelectedMode } from '../core/chat-mode';
import type { ChatRuntimeHostSubmitRequest } from '../core/chat-runtime-host-contract';
import {
  createHostSessionProviderOptionsKey,
  type HostSessionProviderOptions,
} from '../helpers/host-session-input-state';
import { createSessionCheckpointTimelineState } from '../helpers/session-checkpoint-timeline-model';
import { ChatSessionModelStoreService } from './chat-session-model-store.service';
import type { RequestCheckpointMetadata } from './edit-checkpoint.service';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  CHAT_RUNTIME_OWNER_SESSION_CONTEXT,
  CHAT_RUNTIME_OWNER_SUBMITTED_TURN_TITLE,
  CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  type ChatRuntimeOwnerSubmittedTurnLifecyclePort,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerSessionContextPort,
  type ChatRuntimeOwnerSessionModelPort,
  type ChatRuntimeOwnerSubmittedTurnTitlePort,
  type ChatRuntimeOwnerTurnStartupEditLifecyclePort,
} from './chat-runtime-owner-ports';
import { projectRuntimeStateToRuntimeController } from '../helpers/chat-runtime-owner-projection';

@Injectable()
export class ChatRuntimeOwnerSubmittedTurnLifecycleService implements ChatRuntimeOwnerSubmittedTurnLifecyclePort {
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);
  private readonly chatSessionModelStore = inject(ChatSessionModelStoreService);
  private readonly ownerSessionContext = inject<ChatRuntimeOwnerSessionContextPort>(CHAT_RUNTIME_OWNER_SESSION_CONTEXT);
  private readonly ownerSessionModel = inject<ChatRuntimeOwnerSessionModelPort>(CHAT_RUNTIME_OWNER_SESSION_MODEL);
  private readonly submittedTurnTitle = inject<ChatRuntimeOwnerSubmittedTurnTitlePort>(
    CHAT_RUNTIME_OWNER_SUBMITTED_TURN_TITLE,
  );
  private readonly turnStartupEditLifecycle = inject<ChatRuntimeOwnerTurnStartupEditLifecyclePort>(
    CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  );

  private ownerFacade: LexOwnerFacade | null = null;

  bindOwner(owner: LexOwnerFacade): void {
    if (this.ownerFacade && this.ownerFacade !== owner) {
      throw new Error('[AilyChat][RuntimeOwnerLifecycle] Runtime owner lifecycle cannot be rebound to a different owner.');
    }
    this.ownerFacade = owner;
  }

  async prepareSubmittedTurn(request: ChatRuntimeHostSubmitRequest, owner: LexOwnerFacade): Promise<void> {
    this.bindOwner(owner);
    const targetSessionId = this.normalizeSessionId(request.sessionId);
    if (!targetSessionId) {
      throw new Error('prepareSubmittedTurn requires a sessionResource owner.');
    }

    const startedAt = Date.now();
    const ensureAgentStartedAt = Date.now();
    await this.ensureRuntimeAgentForSession(targetSessionId, owner, request);
    const ensureAgentMs = Date.now() - ensureAgentStartedAt;

    const hydrateStartedAt = Date.now();
    const hydratedTurnCount = await this.syncExistingTurnResponses(targetSessionId, owner, request.activeResponseHandle);
    const hydrateMs = Date.now() - hydrateStartedAt;

    const displayText = request.displayText ?? request.requestText;
    const titleDispatchStartedAt = Date.now();
    this.submittedTurnTitle.prepareSubmittedTurnTitle({
      sessionId: targetSessionId,
      requestText: request.requestText,
      displayText,
      owner,
    });
    this.logSubmittedTurnStartupLatency({
      sessionId: targetSessionId,
      hydratedTurnCount,
      hydrateMs,
      ensureAgentMs,
      titleDispatchMs: Date.now() - titleDispatchStartedAt,
      elapsedMs: Date.now() - startedAt,
    });
  }

  async settleSubmittedTurnStartupResources(sessionId?: string | null): Promise<void> {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      throw new Error('settleSubmittedTurnStartupResources requires a sessionResource owner.');
    }

    await this.turnStartupEditLifecycle.waitForCheckpointMetadataSettled(targetSessionId);
  }

  async completeSubmittedTurn(sessionId?: string | null): Promise<void> {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      throw new Error('completeSubmittedTurn requires a sessionResource owner.');
    }

    await this.runtimeController.awaitRequestCompletion(targetSessionId);
    await this.turnStartupEditLifecycle.commitCurrentTurn(targetSessionId);
    await this.turnStartupEditLifecycle.waitForCheckpointMetadataSettled(targetSessionId);
    await this.rebuildCheckpointTimelineFromServiceModel(targetSessionId);
  }

  private async rebuildCheckpointTimelineFromServiceModel(sessionId: string): Promise<void> {
    const turnResponses = this.ownerSessionModel.readTurnResponses(sessionId);
    const model = this.chatSessionModelStore.get(sessionId);
    if (!model || !Array.isArray(turnResponses) || turnResponses.length === 0) {
      return;
    }

    const hydratedTurnResponses = this.cloneTurnResponses(turnResponses);
    const metadataByCheckpointId = new Map<string, RequestCheckpointMetadata>();
    const metadataByRequestId = new Map<string, RequestCheckpointMetadata>();
    const metadataByTurnId = new Map<string, RequestCheckpointMetadata>();
    await Promise.all(hydratedTurnResponses.map(async turn => {
      const lookup = this.buildCheckpointMetadataLookup(turn);
      if (!lookup.checkpointId && !lookup.requestId) {
        return;
      }
      const metadata = await this.turnStartupEditLifecycle.readFinalizedCheckpointMetadata(sessionId, lookup);
      if (!metadata) {
        return;
      }
      this.writeCheckpointMetadataToTurnResponse(turn, metadata);
      this.indexCheckpointMetadata(metadata, metadataByCheckpointId, metadataByRequestId, metadataByTurnId);
    }));
    this.ownerSessionModel.replaceTurnResponses(sessionId, hydratedTurnResponses, { source: 'checkpoint-metadata-settle' });

    const checkpointTimelineState = createSessionCheckpointTimelineState({
      sessionResource: sessionId,
      turnResponses: hydratedTurnResponses,
      metadataByCheckpointId,
      metadataByRequestId,
      metadataByTurnId,
    });
    model.replaceCheckpointTimelineState(checkpointTimelineState);
  }

  private buildCheckpointMetadataLookup(turn: unknown): {
    readonly checkpointId?: string;
    readonly requestId?: string;
  } {
    const turnRecord = this.readRecord(turn);
    const request = this.readRecord(turnRecord?.['request']);
    const metadata = this.readRecord(request?.['metadata']);
    const checkpointId = this.normalizeSessionId(metadata?.['checkpointId']);
    const requestId = this.normalizeSessionId(metadata?.['requestId'])
      || this.normalizeSessionId(turnRecord?.['turnId']);
    return {
      ...(checkpointId ? { checkpointId } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }

  private indexCheckpointMetadata(
    metadata: RequestCheckpointMetadata,
    metadataByCheckpointId: Map<string, RequestCheckpointMetadata>,
    metadataByRequestId: Map<string, RequestCheckpointMetadata>,
    metadataByTurnId: Map<string, RequestCheckpointMetadata>,
  ): void {
    const checkpointId = this.normalizeSessionId(metadata.checkpointId);
    if (checkpointId) {
      metadataByCheckpointId.set(checkpointId, metadata);
    }
    const requestId = this.normalizeSessionId(metadata.requestId);
    if (requestId) {
      metadataByRequestId.set(requestId, metadata);
    }
    const turnId = this.normalizeSessionId(metadata.turnId);
    if (turnId) {
      metadataByTurnId.set(turnId, metadata);
    }
  }

  private readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private cloneTurnResponses(turnResponses: readonly TurnResponseTurn[]): TurnResponseTurn[] {
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(turnResponses) as TurnResponseTurn[];
    }
    return JSON.parse(JSON.stringify(turnResponses)) as TurnResponseTurn[];
  }

  private writeCheckpointMetadataToTurnResponse(turn: TurnResponseTurn, metadata: RequestCheckpointMetadata): void {
    const turnRecord = turn as unknown as Record<string, unknown>;
    const request = this.readRecord(turnRecord['request']) ?? {};
    const requestMetadata = this.readRecord(request['metadata']) ?? {};
    const nextMetadata: Record<string, unknown> = {
      ...requestMetadata,
      checkpointId: metadata.checkpointId,
      checkpointNamespace: metadata.checkpointNamespace,
      checkpointTurnIndex: metadata.turnIndex,
      requestId: this.normalizeSessionId(metadata.requestId)
        || this.normalizeSessionId(requestMetadata['requestId'])
        || this.normalizeSessionId(turn.turnId),
    };
    if (metadata.turnId) {
      nextMetadata['checkpointTurnId'] = metadata.turnId;
    }
    if (metadata.startCheckpointRef) {
      nextMetadata['startCheckpointRef'] = metadata.startCheckpointRef;
    }
    if (metadata.checkpointRef) {
      nextMetadata['checkpointRef'] = metadata.checkpointRef;
    }
    if (metadata.additionalStartCheckpointRefs) {
      nextMetadata['additionalStartCheckpointRefs'] = this.cloneJson(metadata.additionalStartCheckpointRefs);
    }
    if (metadata.additionalCheckpointRefs) {
      nextMetadata['additionalCheckpointRefs'] = this.cloneJson(metadata.additionalCheckpointRefs);
    }
    turnRecord['request'] = {
      ...request,
      metadata: nextMetadata,
    };
  }

  private cloneJson<T>(value: T): T {
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(value) as T;
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private async ensureRuntimeAgentForSession(
    sessionId: string,
    owner: LexOwnerFacade,
    request?: ChatRuntimeHostSubmitRequest | null,
  ): Promise<void> {
    const providerOptions = this.rememberRuntimeSessionProviderOptions(
      sessionId,
      this.ownerSessionContext.resolveRuntimeSessionProviderOptions(sessionId),
      request,
    );
    const agentRuntimeMode = this.resolveRequestAgentRuntimeMode(request);
    const providerOptionsKey = createChatAgentRuntimeConfigKey(
      createHostSessionProviderOptionsKey(providerOptions),
      agentRuntimeMode,
      this.ownerSessionContext.currentModel,
    );
    const ensured = await owner.agent.ensureAgent(sessionId, providerOptionsKey);
    if (!ensured) {
      throw new Error(`[AilyChat][RuntimeOwnerLifecycle] Failed to initialize Lex agent for session ${sessionId}.`);
    }
    if (owner.agent.getHandle?.(sessionId) || owner.agent.getAgent?.(sessionId)) {
      return;
    }
    throw new Error(`[AilyChat][RuntimeOwnerLifecycle] Lex agent is unavailable after initialization for session ${sessionId}.`);
  }

  private rememberRuntimeSessionProviderOptions(
    sessionId: string,
    providerOptions: HostSessionProviderOptions,
    request?: ChatRuntimeHostSubmitRequest | null,
  ): HostSessionProviderOptions {
    const agentRuntimeMode = this.resolveRequestAgentRuntimeMode(request);
    const agentRuntimeModeSource = this.resolveRequestAgentRuntimeModeSource(request);
    projectRuntimeStateToRuntimeController(this.runtimeController, {
      sessionId,
      patch: {
        providerOptions,
        selectedMode: normalizeChatSelectedMode(this.ownerSessionContext.resolveRuntimeSelectedMode(sessionId)),
        agentRuntimeMode,
        agentRuntimeModeSource,
        currentModel: this.ownerSessionContext.currentModel,
        debugSummary: {
          providerOptionsPresent: true,
          selectedModePresent: true,
          agentRuntimeModePresent: true,
          currentModelPresent: !!this.ownerSessionContext.currentModel,
        },
      },
    });
    return providerOptions;
  }

  private resolveRequestAgentRuntimeMode(request?: ChatRuntimeHostSubmitRequest | null) {
    return request?.agentRuntimeMode
      ? normalizeChatAgentRuntimeMode(request.agentRuntimeMode, this.ownerSessionContext.currentAgentRuntimeMode)
      : this.ownerSessionContext.currentAgentRuntimeMode;
  }

  private resolveRequestAgentRuntimeModeSource(request?: ChatRuntimeHostSubmitRequest | null) {
    return request?.agentRuntimeModeSource
      ? normalizeChatAgentRuntimeModeSource(request.agentRuntimeModeSource, this.ownerSessionContext.currentAgentRuntimeModeSource)
      : this.ownerSessionContext.currentAgentRuntimeModeSource;
  }

  private async syncExistingTurnResponses(
    sessionId: string,
    owner: LexOwnerFacade,
    activeResponseHandle?: unknown,
  ): Promise<number> {
    const activeTurnId = this.normalizeSessionId(activeResponseHandle);
    const turnResponses = this.ownerSessionModel.readTurnResponses(sessionId);
    const historyTurnResponses = activeTurnId
      ? turnResponses.filter(turn => turn?.turnId !== activeTurnId)
      : turnResponses;

    if (historyTurnResponses.length === 0) {
      owner.hydrateTurnResponses?.(sessionId, [], {
        visibility: 'detached',
      });
      return 0;
    }

    const liveSnapshot = owner.session.snapshot(sessionId);
    if (this.isLiveSessionAlignedWithHistory(liveSnapshot, sessionId, historyTurnResponses)) {
      owner.hydrateTurnResponses?.(sessionId, historyTurnResponses, {
        visibility: 'detached',
      });
      return historyTurnResponses.length;
    }

    const restorePlan = await owner.session.resolveRestorePlan(sessionId, historyTurnResponses);
    if (!restorePlan?.snapshot) {
      throw new Error(`[AilyChat][SubmittedTurnLifecycle] Missing Lex session snapshot for restored history: session=${sessionId}, turns=${historyTurnResponses.length}`);
    }

    const restored = owner.session.restoreResolvedSnapshot(restorePlan.snapshot, sessionId);
    if (!restored) {
      throw new Error(`[AilyChat][SubmittedTurnLifecycle] Failed to restore Lex session snapshot before submitting turn: session=${sessionId}, turns=${historyTurnResponses.length}`);
    }

    owner.hydrateTurnResponses?.(sessionId, restorePlan.turnResponses, {
      visibility: 'detached',
    });
    return restorePlan.turnResponses.length;
  }

  private isLiveSessionAlignedWithHistory(
    snapshot: SessionSnapshot | null | undefined,
    sessionId: string,
    historyTurnResponses: readonly TurnResponseTurn[],
  ): boolean {
    if (!snapshot || snapshot.sessionId !== sessionId) {
      return false;
    }

    const liveTurns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
    if (liveTurns.length !== historyTurnResponses.length) {
      return false;
    }

    for (let index = 0; index < historyTurnResponses.length; index += 1) {
      const historyTurn = historyTurnResponses[index];
      const historyTurnId = this.normalizeSessionId(historyTurn?.turnId);
      const liveTurnId = this.normalizeSessionId(liveTurns[index]?.id);
      if (!historyTurnId || historyTurnId !== liveTurnId) {
        return false;
      }
    }

    return true;
  }

  private logSubmittedTurnStartupLatency(input: {
    readonly sessionId: string;
    readonly hydratedTurnCount: number;
    readonly hydrateMs: number;
    readonly ensureAgentMs: number;
    readonly titleDispatchMs: number;
    readonly elapsedMs: number;
  }): void {
    if (input.elapsedMs < 50 && input.ensureAgentMs < 50) {
      return;
    }
    console.info('[AilyChat][SubmittedTurnStartupLatency]', input);
  }

  private normalizeSessionId(sessionId: unknown): string {
    return typeof sessionId === 'string' ? sessionId.trim() : '';
  }
}
