import { DestroyRef, Injectable, inject } from '@angular/core';

import { LexOwnerFacade, type LexOwnerContext } from '../helpers/lex-stream.helper';
import { terminalTranscriptProjection } from '../core/chat-runtime-projection-policy';
import { buildSeededTurnResponseTurn } from '../core/turn-response-stream-contract';
import type {
  ChatRuntimeHost,
  ChatRuntimeHostAttachViewOptions,
  ChatRuntimeHostEvent,
  ChatRuntimeHostEventSubscription,
  ChatRuntimeHostInteractionRequest,
  ChatRuntimeHostInteractionSnapshot,
  ChatRuntimeHostRerunReadiness,
  ChatRuntimeHostSessionId,
  ChatRuntimeHostSessionState,
  ChatRuntimeHostSubmitReadiness,
  ChatRuntimeHostSubmitRequest,
  ChatRuntimeHostTranscriptSnapshot,
  ChatRuntimeHostViewRequest,
  ChatRuntimeHostViewId,
} from '../core/chat-runtime-host-contract';
import type { TurnResponseTurn } from 'aily-lex/browser';
import type { ChatSessionRuntimeState } from './chat-session-runtime-store.service';
import type { RuntimeCommandSessionActionResult } from './chat-runtime-interaction-host.service';
import {
  CHAT_RUNTIME_OWNER_INTERACTION_HOST,
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  CHAT_RUNTIME_OWNER_STATE,
  CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE,
  CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT,
  CHAT_RUNTIME_OWNER_VIEW_REQUEST,
  type ChatRuntimeOwnerContextBinderPort,
  type ChatRuntimeOwnerInteractionHostPort,
  type ChatRuntimeOwnerRuntimeControllerPort,
  type ChatRuntimeOwnerStatePort,
  type ChatRuntimeOwnerSubmittedTurnLifecyclePort,
  type ChatRuntimeOwnerViewAttachmentPort,
  type ChatRuntimeOwnerViewRequestPort,
} from './chat-runtime-owner-ports';

/**
 * Owns the live chat runtime boundary.
 *
 * This service intentionally accepts exactly one context and exposes exactly one
 * Lex owner for the current renderer process. The next migration step can move
 * this contract behind an Electron host owner without keeping ChatEngineService
 * as the runtime constructor.
 */
@Injectable()
export class ChatRuntimeOwnerService implements ChatRuntimeHost, ChatRuntimeOwnerContextBinderPort {
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);
  private readonly runtimeInteractionHost = inject<ChatRuntimeOwnerInteractionHostPort>(
    CHAT_RUNTIME_OWNER_INTERACTION_HOST,
  );
  private readonly runtimeViewRequests = inject<ChatRuntimeOwnerViewRequestPort>(CHAT_RUNTIME_OWNER_VIEW_REQUEST);
  private readonly runtimeViewAttachments = inject<ChatRuntimeOwnerViewAttachmentPort>(CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT);
  private readonly runtimeOwnerState = inject<ChatRuntimeOwnerStatePort>(CHAT_RUNTIME_OWNER_STATE);
  private readonly submittedTurnLifecycle = inject<ChatRuntimeOwnerSubmittedTurnLifecyclePort>(
    CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE,
  );
  private readonly destroyRef = inject(DestroyRef);

  private context: LexOwnerContext | null = null;
  private sourceContext: LexOwnerContext | null = null;
  private owner: LexOwnerFacade | null = null;
  private readonly eventListeners = new Set<(event: ChatRuntimeHostEvent) => void>();
  private readonly pendingLiveTranscriptSessionIds = new Set<ChatRuntimeHostSessionId>();
  private readonly transcriptRevisions = new Map<ChatRuntimeHostSessionId, number>();
  private liveTranscriptFlushScheduled = false;

  constructor() {
    const interactionSubscription = this.runtimeInteractionHost.onSnapshot(snapshot => {
      this.emitInteraction(snapshot);
    });
    const viewRequestSubscription = this.runtimeViewRequests.onRequest(request => {
      this.emitViewRequest(request);
    });
    this.destroyRef.onDestroy(() => {
      interactionSubscription.dispose();
      viewRequestSubscription.dispose();
    });
  }

  bindContext(context: LexOwnerContext): LexOwnerFacade {
    if (this.owner) {
      if (this.sourceContext !== context) {
        throw new Error('[AilyChat][RuntimeOwner] Runtime owner cannot be rebound to a different context.');
      }
      return this.owner;
    }

    this.sourceContext = context;
    this.context = this.createRuntimeOwnerContext(context);
    this.owner = new LexOwnerFacade(this.context);
    return this.owner;
  }

  readOwner(): LexOwnerFacade {
    if (!this.owner) {
      throw new Error('[AilyChat][RuntimeOwner] Runtime owner has not been bound.');
    }
    return this.owner;
  }

  async attachView(
    viewId: ChatRuntimeHostViewId,
    sessionId: ChatRuntimeHostSessionId,
    options?: ChatRuntimeHostAttachViewOptions,
  ): Promise<ChatRuntimeHostSessionState> {
    const normalizedViewId = this.normalizeViewId(viewId);
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    this.runtimeViewAttachments.attachView(normalizedViewId, normalizedSessionId, options);
    this.runtimeController.attachSessionView(normalizedSessionId);
    const state = this.buildSessionState(normalizedSessionId);
    this.emitSessionState(normalizedSessionId, 'runtime-status', state);
    return state;
  }

  async detachView(viewId: ChatRuntimeHostViewId, expectedSessionId?: ChatRuntimeHostSessionId | null): Promise<void> {
    const normalizedViewId = this.normalizeViewId(viewId);
    const boundSessionId = this.runtimeViewAttachments.readSessionForView(normalizedViewId);
    const normalizedExpectedSessionId = this.normalizeOptionalSessionId(expectedSessionId);
    if (normalizedExpectedSessionId && boundSessionId && boundSessionId !== normalizedExpectedSessionId) {
      throw new Error('[AilyChat][RuntimeOwner] Runtime view is bound to a different session.');
    }

    const targetSessionId = normalizedExpectedSessionId || boundSessionId;
    if (!targetSessionId) {
      return;
    }

    this.runtimeViewAttachments.detachView(normalizedViewId);
    this.runtimeController.detachSessionView(targetSessionId);
    this.emitSessionState(targetSessionId, 'runtime-status');
  }

  async submitTurn(request: ChatRuntimeHostSubmitRequest): Promise<ChatRuntimeHostSessionState> {
    const normalizedRequest = this.normalizeSubmitRequest(request);
    return this.startSubmittedTurn(normalizedRequest);
  }

  async readSubmitReadiness(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostSubmitReadiness> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const context = this.requireContext();
    if (typeof context.syncRuntimeHostSubmitReadiness !== 'function') {
      throw new Error('[AilyChat][RuntimeOwner] Runtime submit readiness requires host concurrency metadata support.');
    }

    context.syncRuntimeHostSubmitReadiness(normalizedSessionId);
    return this.runtimeController.readSubmitReadiness(normalizedSessionId);
  }

  async ensureSessionCanRerun(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostRerunReadiness> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    const rerunGate = this.runtimeController.ensureSessionCanRerun(normalizedSessionId);
    if (rerunGate.activeRequestInProgress) {
      return {
        sessionId: normalizedSessionId,
        activeRequestInProgress: true,
        staleGateCleared: false,
        state: this.buildSessionState(normalizedSessionId),
      };
    }

    const state = this.buildSessionState(normalizedSessionId);
    if (rerunGate.staleGateCleared) {
      this.emitSessionState(normalizedSessionId, 'runtime-status', state);
    }

    return {
      sessionId: normalizedSessionId,
      activeRequestInProgress: false,
      staleGateCleared: rerunGate.staleGateCleared,
      state,
    };
  }

  private async startSubmittedTurn(normalizedRequest: ChatRuntimeHostSubmitRequest): Promise<ChatRuntimeHostSessionState> {
    const displayText = normalizedRequest.displayText ?? normalizedRequest.requestText;
    const activeResponseHandle = normalizedRequest.activeResponseHandle ?? normalizedRequest.sessionId;
    const releaseOwnerScope = this.runtimeOwnerState.beginRuntimeSessionOwnerScope(normalizedRequest.sessionId);
    let backgroundStarted = false;
    let requestStateStarted = false;
    try {
      const owner = this.readOwner();
      await this.prepareSubmittedTurn(normalizedRequest, owner);
      this.beginSubmittedRequestState(normalizedRequest.sessionId, activeResponseHandle);
      requestStateStarted = true;
      const beginResult = owner.turn.begin(normalizedRequest.requestText, displayText, normalizedRequest.metadata ?? undefined);
      const seededTurn = this.buildSubmittedSeededTurn(owner, normalizedRequest, displayText, beginResult);
      const committedTurnResponses = this.commitSubmittedSeededTurn(normalizedRequest.sessionId, seededTurn);
      this.requireContext().syncExecutionRuntimeTurnResponses(
        normalizedRequest.sessionId,
        committedTurnResponses,
        terminalTranscriptProjection('handoff'),
      );
      this.emitSessionState(normalizedRequest.sessionId, 'runtime-status');
      this.emitTranscript(normalizedRequest.sessionId);

      backgroundStarted = true;
      this.runSubmittedTurnInBackground({
        owner,
        request: normalizedRequest,
        displayText,
        activeResponseHandle,
        releaseOwnerScope,
      });
      return this.buildSessionState(normalizedRequest.sessionId);
    } catch (error) {
      this.emitRuntimeError(normalizedRequest.sessionId, error);
      this.emitSessionState(normalizedRequest.sessionId, 'runtime-status');
      if (requestStateStarted) {
        this.completeSubmittedRequestState(normalizedRequest.sessionId, activeResponseHandle);
      }
      throw error;
    } finally {
      if (!backgroundStarted) {
        releaseOwnerScope();
      }
    }
  }

  private runSubmittedTurnInBackground(options: {
    readonly owner: LexOwnerFacade;
    readonly request: ChatRuntimeHostSubmitRequest;
    readonly displayText: string;
    readonly activeResponseHandle: unknown;
    readonly releaseOwnerScope: () => void;
  }): void {
    void (async () => {
      let completedSuccessfully = false;
      try {
        await options.owner.turn.run(options.request.requestText, options.displayText);
        completedSuccessfully = true;
      } catch (error) {
        this.emitRuntimeError(options.request.sessionId, error);
      } finally {
        this.completeSubmittedRequestState(options.request.sessionId, options.activeResponseHandle);
      }

      if (completedSuccessfully) {
        await this.completeSubmittedTurnEffects(options.request.sessionId);
      }
    })()
      .catch(error => {
        this.emitRuntimeError(options.request.sessionId, error);
      })
      .finally(() => {
        const state = this.buildSessionState(options.request.sessionId);
        this.emitTranscript(options.request.sessionId);
        this.emitSessionState(options.request.sessionId, 'runtime-status', state);
        options.releaseOwnerScope();
      });
  }

  private async prepareSubmittedTurn(
    normalizedRequest: ChatRuntimeHostSubmitRequest,
    owner: LexOwnerFacade,
  ): Promise<void> {
    try {
      await this.submittedTurnLifecycle.prepareSubmittedTurn(normalizedRequest, owner);
    } catch (error) {
      this.emitRuntimeError(normalizedRequest.sessionId, error);
      this.emitSessionState(normalizedRequest.sessionId, 'runtime-status');
      throw error;
    }
  }

  private async completeSubmittedTurnEffects(sessionId: ChatRuntimeHostSessionId): Promise<void> {
    try {
      await this.submittedTurnLifecycle.completeSubmittedTurn(sessionId);
    } catch (error) {
      this.emitRuntimeError(sessionId, error);
      this.emitSessionState(sessionId, 'runtime-status');
      throw error;
    }
  }

  private beginSubmittedRequestState(
    sessionId: ChatRuntimeHostSessionId,
    activeResponseHandle: unknown,
  ): void {
    this.runtimeController.beginSubmittedRequestState({
      sessionId,
      activeResponseHandle,
      stopSession: () => {
        void this.stopTurn(sessionId);
      },
      disposeSession: () => {
        void this.disposeSession(sessionId);
      },
      attachedView: this.hasAttachedView(sessionId),
    });
    this.emitSessionState(sessionId, 'runtime-status');
  }

  private completeSubmittedRequestState(
    sessionId: ChatRuntimeHostSessionId,
    activeResponseHandle: unknown,
  ): void {
    this.runtimeController.completeSubmittedRequestState(sessionId, activeResponseHandle);
    this.emitSessionState(sessionId, 'runtime-status');
  }

  private buildSubmittedSeededTurn(
    owner: LexOwnerFacade,
    normalizedRequest: ChatRuntimeHostSubmitRequest,
    displayText: string,
    beginResult: unknown,
  ): TurnResponseTurn {
    const turnId = this.resolveSubmittedTurnId(owner, normalizedRequest.sessionId, beginResult);
    const currentRequestMetadata = typeof owner.turns?.currentRequestMetadata === 'function'
      ? owner.turns.currentRequestMetadata()
      : undefined;
    const context = this.requireContext();
    const participant = typeof context.currentMessageSource === 'string'
      ? context.currentMessageSource
      : undefined;

    return buildSeededTurnResponseTurn({
      turnId,
      requestContent: normalizedRequest.requestText,
      displayContent: displayText,
      metadata: (currentRequestMetadata ?? normalizedRequest.metadata) as TurnResponseTurn['request']['metadata'],
      participant,
    });
  }

  private commitSubmittedSeededTurn(
    sessionId: ChatRuntimeHostSessionId,
    seededTurn: TurnResponseTurn,
  ): readonly TurnResponseTurn[] {
    const context = this.requireContext();
    if (typeof context.appendSessionModelTurnResponse !== 'function') {
      throw new Error('[AilyChat][RuntimeOwner] Runtime submit requires canonical session model append support.');
    }

    const committedTurnResponses = context.appendSessionModelTurnResponse(sessionId, seededTurn, {
      source: 'runtime-host-submit-turn',
    });
    if (!committedTurnResponses) {
      throw new Error('[AilyChat][RuntimeOwner] Runtime submit could not commit the canonical turn seed.');
    }

    return committedTurnResponses;
  }

  private resolveSubmittedTurnId(
    owner: LexOwnerFacade,
    sessionId: ChatRuntimeHostSessionId,
    beginResult: unknown,
  ): string {
    const beginTurnId = this.normalizeSubmittedTurnId(beginResult);
    if (beginTurnId) {
      return beginTurnId;
    }

    const currentTurnId = typeof owner.turns?.currentId === 'function'
      ? this.normalizeSubmittedTurnId(owner.turns.currentId())
      : '';
    if (currentTurnId) {
      return currentTurnId;
    }

    throw new Error(`[AilyChat][RuntimeOwner] Runtime submit for ${sessionId} did not create a canonical turn id.`);
  }

  private normalizeSubmittedTurnId(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (value && typeof value === 'object') {
      const record = value as { readonly id?: unknown; readonly turnId?: unknown };
      if (typeof record.turnId === 'string' && record.turnId.trim().length > 0) {
        return record.turnId.trim();
      }
      if (typeof record.id === 'string' && record.id.trim().length > 0) {
        return record.id.trim();
      }
    }

    return '';
  }

  private requireContext(): LexOwnerContext {
    if (!this.context) {
      throw new Error('[AilyChat][RuntimeOwner] Runtime owner context has not been bound.');
    }

    return this.context;
  }

  private createRuntimeOwnerContext(context: LexOwnerContext): LexOwnerContext {
    const ownerContext = Object.create(context) as LexOwnerContext;
    ownerContext.syncExecutionRuntimeTurnResponses = (
      sessionId: string | null | undefined,
      turnResponses: readonly TurnResponseTurn[] | null | undefined,
      options,
    ): void => {
      context.syncExecutionRuntimeTurnResponses(sessionId, turnResponses, options);
      this.scheduleLiveTranscriptEvent(sessionId);
    };
    return ownerContext;
  }

  private scheduleLiveTranscriptEvent(sessionId: string | null | undefined): void {
    const normalizedSessionId = this.normalizeOptionalSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }

    this.pendingLiveTranscriptSessionIds.add(normalizedSessionId);
    if (this.liveTranscriptFlushScheduled) {
      return;
    }

    this.liveTranscriptFlushScheduled = true;
    const scheduleMicrotask = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback: () => void) => { void Promise.resolve().then(callback); };
    scheduleMicrotask(() => this.flushLiveTranscriptEvents());
  }

  private flushLiveTranscriptEvents(): void {
    this.liveTranscriptFlushScheduled = false;
    const sessionIds = [...this.pendingLiveTranscriptSessionIds];
    this.pendingLiveTranscriptSessionIds.clear();
    for (const sessionId of sessionIds) {
      this.emitTranscript(sessionId);
      this.emitSessionState(sessionId, 'runtime-status');
    }
  }

  async stopTurn(sessionId: ChatRuntimeHostSessionId): Promise<void> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    this.runtimeController.stopSession(normalizedSessionId);
    this.emitSessionState(normalizedSessionId, 'runtime-status');
  }

  async disposeSession(sessionId: ChatRuntimeHostSessionId): Promise<void> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    this.runtimeController.disposeSession(normalizedSessionId);
    this.runtimeViewAttachments.detachSession(normalizedSessionId);
    this.emitSessionState(normalizedSessionId, 'session-state');
    this.transcriptRevisions.delete(normalizedSessionId);
  }

  getSessionIds(): readonly ChatRuntimeHostSessionId[] {
    return this.runtimeController.getSessionIds();
  }

  async readSessionState(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostSessionState | null> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    return this.runtimeController.readSessionState(this.buildSessionSnapshotInput(normalizedSessionId));
  }

  async readTranscript(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostTranscriptSnapshot | null> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    return this.runtimeController.readTranscript(this.buildSessionSnapshotInput(normalizedSessionId));
  }

  async awaitRequestCompletion(sessionId: ChatRuntimeHostSessionId): Promise<void> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    await this.runtimeController.awaitRequestCompletion(normalizedSessionId);
  }

  async runWorkspaceFinalizeBoundaryProbe(sessionId: ChatRuntimeHostSessionId): Promise<void> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    await this.runtimeController.runWorkspaceFinalizeBoundaryProbe(normalizedSessionId);
  }

  async readInteractionSnapshot(sessionId: ChatRuntimeHostSessionId): Promise<ChatRuntimeHostInteractionSnapshot | null> {
    const normalizedSessionId = this.normalizeSessionId(sessionId);
    return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
  }

  async resolveInteraction(request: ChatRuntimeHostInteractionRequest): Promise<ChatRuntimeHostInteractionSnapshot | null> {
    const normalizedSessionId = this.normalizeSessionId(request?.sessionId);
    switch (request.kind) {
      case 'question.complete': {
        const result = (request.payload as { result?: unknown } | null | undefined)?.result;
        this.runtimeInteractionHost.completeQuestion(normalizedSessionId, result as never);
        return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
      }
      case 'question.skip':
        this.runtimeInteractionHost.skipQuestion(normalizedSessionId);
        return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
      case 'confirmation.navigate':
        this.runtimeInteractionHost.navigateConfirmation(normalizedSessionId, Number(request.delta) || 0);
        return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
      case 'confirmation.resolve': {
        const result = (request.payload as { result?: unknown } | null | undefined)?.result;
        if (request.id) {
          this.runtimeInteractionHost.resolveConfirmation(normalizedSessionId, request.id, result as never);
        }
        return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
      }
      case 'confirmation.action': {
        const actionId = (request.payload as { actionId?: unknown } | null | undefined)?.actionId;
        if (request.id && typeof actionId === 'string') {
          this.runtimeInteractionHost.triggerConfirmationAction(normalizedSessionId, request.id, actionId);
        }
        return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
      }
      case 'planReview.resolve': {
        const result = (request.payload as { result?: unknown } | null | undefined)?.result;
        if (request.id) {
          this.runtimeInteractionHost.resolvePlanReview(normalizedSessionId, request.id, result as never);
        }
        return this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
      }
      case 'commandSession.action': {
        const commandRequest = (request.payload as { request?: unknown } | null | undefined)?.request;
        const result = await this.runtimeInteractionHost.requestCommandSessionAction(
          normalizedSessionId,
          commandRequest as never,
        ) as RuntimeCommandSessionActionResult;
        const snapshot = this.runtimeInteractionHost.readSnapshot(normalizedSessionId);
        return {
          ...snapshot,
          commandSessionActionResult: result,
        } as unknown as ChatRuntimeHostInteractionSnapshot;
      }
    }
  }

  onEvent(listener: (event: ChatRuntimeHostEvent) => void): ChatRuntimeHostEventSubscription {
    this.eventListeners.add(listener);
    return {
      dispose: () => {
        this.eventListeners.delete(listener);
      },
    };
  }

  readRuntimeState(sessionId: ChatRuntimeHostSessionId): ChatSessionRuntimeState | null {
    return this.runtimeController.readRuntimeState(this.normalizeSessionId(sessionId));
  }

  private buildSessionState(
    sessionId: ChatRuntimeHostSessionId,
  ): ChatRuntimeHostSessionState {
    return this.runtimeController.buildSessionState(this.buildSessionSnapshotInput(sessionId));
  }

  private buildTranscriptSnapshot(
    sessionId: ChatRuntimeHostSessionId,
    revision = this.readTranscriptRevision(sessionId),
  ): ChatRuntimeHostTranscriptSnapshot {
    return this.runtimeController.buildTranscriptSnapshot(this.buildSessionSnapshotInput(sessionId, revision));
  }

  private emitSessionState(
    sessionId: ChatRuntimeHostSessionId,
    kind: 'session-state' | 'runtime-status',
    state = this.buildSessionState(sessionId),
  ): void {
    const event: ChatRuntimeHostEvent = {
      kind,
      sessionId,
      revision: state.transcriptRevision,
      state,
    };
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  private emitTranscript(sessionId: ChatRuntimeHostSessionId): void {
    const transcript = this.buildTranscriptSnapshot(sessionId, this.nextTranscriptRevision(sessionId));
    const event: ChatRuntimeHostEvent = {
      kind: 'transcript',
      sessionId,
      revision: transcript.revision,
      transcript,
    };
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  private emitRuntimeError(sessionId: ChatRuntimeHostSessionId, error: unknown): void {
    const maybeError = error as { message?: unknown; code?: unknown; retryable?: unknown } | null | undefined;
    const event: ChatRuntimeHostEvent = {
      kind: 'error',
      sessionId,
      revision: this.readTranscriptRevision(sessionId),
      error: {
        code: typeof maybeError?.code === 'string' ? maybeError.code : undefined,
        message: typeof maybeError?.message === 'string' ? maybeError.message : String(error || 'Unknown runtime error'),
        retryable: typeof maybeError?.retryable === 'boolean' ? maybeError.retryable : undefined,
      },
    };
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  private emitInteraction(snapshot: ChatRuntimeHostInteractionSnapshot): void {
    const event: ChatRuntimeHostEvent = {
      kind: 'interaction',
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      interaction: snapshot,
    };
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  private emitViewRequest(request: ChatRuntimeHostViewRequest): void {
    const event: ChatRuntimeHostEvent = {
      kind: 'view-request',
      sessionId: request.sessionId,
      revision: this.readTranscriptRevision(request.sessionId),
      request,
    };
    for (const listener of [...this.eventListeners]) {
      listener(event);
    }
  }

  private readAttachedViewIds(sessionId: ChatRuntimeHostSessionId): readonly ChatRuntimeHostViewId[] {
    return this.runtimeViewAttachments.readAttachedViewIds(sessionId);
  }

  private buildSessionSnapshotInput(
    sessionId: ChatRuntimeHostSessionId,
    transcriptRevision = this.readTranscriptRevision(sessionId),
  ) {
    return {
      sessionId,
      attachedViewIds: this.readAttachedViewIds(sessionId),
      transcriptRevision,
    };
  }

  private readTranscriptRevision(sessionId: ChatRuntimeHostSessionId): number {
    return this.transcriptRevisions.get(sessionId) ?? 0;
  }

  private nextTranscriptRevision(sessionId: ChatRuntimeHostSessionId): number {
    const nextRevision = this.readTranscriptRevision(sessionId) + 1;
    this.transcriptRevisions.set(sessionId, nextRevision);
    return nextRevision;
  }

  private hasAttachedView(sessionId: ChatRuntimeHostSessionId): boolean {
    return this.runtimeViewAttachments.hasAttachedView(sessionId);
  }

  private normalizeViewId(viewId: ChatRuntimeHostViewId): ChatRuntimeHostViewId {
    const normalizedViewId = typeof viewId === 'string' ? viewId.trim() : '';
    if (!normalizedViewId) {
      throw new Error('[AilyChat][RuntimeOwner] Missing runtime view id.');
    }
    return normalizedViewId;
  }

  private normalizeSessionId(sessionId: ChatRuntimeHostSessionId): ChatRuntimeHostSessionId {
    const normalizedSessionId = this.normalizeOptionalSessionId(sessionId);
    if (!normalizedSessionId) {
      throw new Error('[AilyChat][RuntimeOwner] Missing runtime session id.');
    }
    return normalizedSessionId;
  }

  private normalizeOptionalSessionId(sessionId: ChatRuntimeHostSessionId | null | undefined): ChatRuntimeHostSessionId | null {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    return normalizedSessionId || null;
  }

  private normalizeSubmitRequest(request: ChatRuntimeHostSubmitRequest): ChatRuntimeHostSubmitRequest {
    if (!request || typeof request !== 'object') {
      throw new Error('[AilyChat][RuntimeOwner] Missing runtime submit request.');
    }

    const sessionId = this.normalizeSessionId(request.sessionId);
    const requestText = typeof request.requestText === 'string' ? request.requestText.trim() : '';
    if (!requestText) {
      throw new Error('[AilyChat][RuntimeOwner] Missing runtime submit request text.');
    }

    const displayText = typeof request.displayText === 'string' && request.displayText.trim().length > 0
      ? request.displayText
      : requestText;

    return {
      ...request,
      sessionId,
      requestText,
      displayText,
      metadata: request.metadata ?? null,
    };
  }
}
