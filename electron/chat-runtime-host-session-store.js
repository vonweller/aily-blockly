const HOST_SESSION_STORE_MISS = Symbol('aily-chat-runtime-host-session-store-miss');
const {
  ChatRuntimeHostTranscriptBuilder,
} = require('./chat-runtime-host-transcript-builder');

const MAX_VIEW_REQUEST_EVENTS_PER_SESSION = 50;
const MAX_RESOURCE_REQUEST_EVENTS_PER_SESSION = 100;

function isUsableWebContents(webContents) {
  return !!webContents && !webContents.isDestroyed();
}

function normalizeSessionId(sessionId) {
  return typeof sessionId === 'string' && sessionId.trim().length > 0
    ? sessionId.trim()
    : '';
}

function normalizeViewId(viewId) {
  return typeof viewId === 'string' && viewId.trim().length > 0
    ? viewId.trim()
    : '';
}

function normalizeInteractionId(interactionId) {
  return typeof interactionId === 'string' && interactionId.trim().length > 0
    ? interactionId.trim()
    : '';
}

function normalizeViewRequestId(requestId) {
  return typeof requestId === 'string' && requestId.trim().length > 0
    ? requestId.trim()
    : '';
}

function normalizeViewRequestKind(kind) {
  return kind === 'notification' || kind === 'todo-state' || kind === 'handoff'
    ? kind
    : '';
}

function normalizeResourceRequestId(requestId) {
  return typeof requestId === 'string' && requestId.trim().length > 0
    ? requestId.trim()
    : '';
}

function normalizeResourceRequestKind(kind) {
  return kind === 'abs-session-start-export'
    || kind === 'checkpoint-commit'
    || kind === 'checkpoint-settle'
    || kind === 'file-read'
    || kind === 'file-write'
    || kind === 'file-edit'
    || kind === 'workspace-mutation'
    || kind === 'save-current-session'
    || kind === 'history-persistence'
    ? kind
    : '';
}

function normalizeResourceRequestPhase(phase) {
  return phase === 'started' || phase === 'completed' || phase === 'failed'
    ? phase
    : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : '';
}

function normalizeVisibleAttachmentGeneration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function clonePayload(value) {
  if (value == null) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

class ChatRuntimeHostSessionStore {
  constructor() {
    this.sessionStates = new Map();
    this.transcriptBuilder = new ChatRuntimeHostTranscriptBuilder();
    this.interactions = new Map();
    this.viewRequestEvents = new Map();
    this.resourceRequestEvents = new Map();
    this.sessionInventoryMetadata = new Map();
    this.viewSessions = new Map();
    this.sessionViews = new Map();
    this.viewAttachmentGenerations = new Map();
    this.viewWebContents = new Map();
    this.completionWaiters = new Map();
    this.submittedTurnSequence = 0;
  }

  clearSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    this.sessionStates.delete(normalizedSessionId);
    this.transcriptBuilder.clearSession(normalizedSessionId);
    this.interactions.delete(normalizedSessionId);
    this.viewRequestEvents.delete(normalizedSessionId);
    this.resourceRequestEvents.delete(normalizedSessionId);
    this.sessionInventoryMetadata.delete(normalizedSessionId);
    this.resolveCompletionWaiters(normalizedSessionId);
    const viewIds = this.sessionViews.get(normalizedSessionId);
    if (viewIds) {
      for (const viewId of viewIds) {
        this.viewSessions.delete(viewId);
        this.viewAttachmentGenerations.delete(viewId);
        this.viewWebContents.delete(viewId);
      }
    }
    this.sessionViews.delete(normalizedSessionId);
  }

  readAttachedViewIds(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return [];
    }
    const viewIds = this.sessionViews.get(normalizedSessionId);
    return viewIds ? [...viewIds] : [];
  }

  readAttachedViewWebContents(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return [];
    }
    const viewIds = this.sessionViews.get(normalizedSessionId);
    if (!viewIds || viewIds.size === 0) {
      return [];
    }
    const webContentsList = [];
    const seenIds = new Set();
    for (const viewId of viewIds) {
      const webContents = this.viewWebContents.get(viewId);
      if (!isUsableWebContents(webContents) || seenIds.has(webContents.id)) {
        continue;
      }
      seenIds.add(webContents.id);
      webContentsList.push(webContents);
    }
    return webContentsList;
  }

  withAttachedViewIds(state) {
    if (!state || typeof state !== 'object') {
      return state;
    }
    const sessionId = normalizeSessionId(state.sessionId);
    if (!sessionId) {
      return state;
    }
    return {
      ...state,
      attachedViewIds: this.readAttachedViewIds(sessionId),
    };
  }

  buildSessionState(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    const cachedState = this.sessionStates.get(normalizedSessionId);
    if (cachedState) {
      return this.withAttachedViewIds(clonePayload(cachedState));
    }
    return {
      sessionId: normalizedSessionId,
      status: 'idle',
      requestInProgress: false,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
      activeTurnId: null,
      transcriptRevision: this.transcriptBuilder.readTranscriptRevision(normalizedSessionId),
      selectedMode: null,
      providerOptions: null,
      currentModel: null,
    };
  }

  readKnownSessionIds() {
    const sessionIds = new Set();
    for (const sessionId of this.sessionStates.keys()) {
      sessionIds.add(sessionId);
    }
    for (const sessionId of this.transcriptBuilder.readSessionIds()) {
      sessionIds.add(sessionId);
    }
    for (const sessionId of this.interactions.keys()) {
      sessionIds.add(sessionId);
    }
    for (const sessionId of this.viewRequestEvents.keys()) {
      sessionIds.add(sessionId);
    }
    for (const sessionId of this.resourceRequestEvents.keys()) {
      sessionIds.add(sessionId);
    }
    for (const sessionId of this.sessionInventoryMetadata.keys()) {
      sessionIds.add(sessionId);
    }
    for (const sessionId of this.sessionViews.keys()) {
      sessionIds.add(sessionId);
    }
    return [...sessionIds];
  }

  buildSessionInventorySnapshot() {
    const sessions = this.readKnownSessionIds()
      .map(sessionId => this.buildSessionInventoryItem(sessionId))
      .filter(Boolean)
      .sort((left, right) => {
        const leftRunning = left.requestInProgress === true ? 1 : 0;
        const rightRunning = right.requestInProgress === true ? 1 : 0;
        if (leftRunning !== rightRunning) {
          return rightRunning - leftRunning;
        }
        const revisionDelta = (Number(right.transcriptRevision) || 0) - (Number(left.transcriptRevision) || 0);
        if (revisionDelta !== 0) {
          return revisionDelta;
        }
        return String(left.sessionId).localeCompare(String(right.sessionId));
      });
    return {
      revision: sessions.reduce(
        (maxRevision, state) => Math.max(maxRevision, Number(state.transcriptRevision) || 0),
        0,
      ),
      sessions,
    };
  }

  buildSessionInventoryItem(sessionId) {
    const state = this.buildSessionState(sessionId);
    if (!state) {
      return null;
    }
    const metadata = this.sessionInventoryMetadata.get(state.sessionId) ?? {};
    return {
      ...metadata,
      ...state,
    };
  }

  buildTranscriptSnapshot(sessionId) {
    return this.transcriptBuilder.buildTranscriptSnapshot(sessionId);
  }

  buildInteractionSnapshot(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    if (this.interactions.has(normalizedSessionId)) {
      return clonePayload(this.interactions.get(normalizedSessionId));
    }
    return {
      sessionId: normalizedSessionId,
      revision: 0,
      question: null,
      confirmationQueue: [],
      activeConfirmationIndex: 0,
      activePlanReview: null,
      backgroundCommandSessionKeys: [],
    };
  }

  buildPendingInteractionEvent(sessionId) {
    const interaction = this.buildInteractionSnapshot(sessionId);
    if (!this.hasPendingInteraction(interaction)) {
      return null;
    }
    return {
      kind: 'interaction',
      sessionId: interaction.sessionId,
      revision: Number(interaction.revision) || 0,
      interaction,
    };
  }

  readViewRequestEvents(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return [];
    }
    return (this.viewRequestEvents.get(normalizedSessionId) ?? []).map(event => clonePayload(event));
  }

  readResourceRequestEvents(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return [];
    }
    return (this.resourceRequestEvents.get(normalizedSessionId) ?? []).map(event => clonePayload(event));
  }

  hasHostSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return !!normalizedSessionId
      && (this.sessionStates.has(normalizedSessionId)
        || this.transcriptBuilder.hasTranscript(normalizedSessionId)
        || this.interactions.has(normalizedSessionId)
        || this.sessionViews.has(normalizedSessionId));
  }

  attachView(viewId, sessionId, webContents, options) {
    const normalizedViewId = normalizeViewId(viewId);
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedViewId || !normalizedSessionId) {
      throw new Error('[AilyChat][RuntimeHost] attachView requires a view id and session id.');
    }
    const visibleAttachmentGeneration = normalizeVisibleAttachmentGeneration(
      options && options.visibleAttachmentGeneration,
    );
    if (visibleAttachmentGeneration === null) {
      throw new Error('[AilyChat][RuntimeHost] attachView requires a visible attachment generation.');
    }

    const previousSessionId = this.viewSessions.get(normalizedViewId);
    if (previousSessionId && previousSessionId !== normalizedSessionId) {
      const previousViews = this.sessionViews.get(previousSessionId);
      if (previousViews) {
        previousViews.delete(normalizedViewId);
        if (previousViews.size === 0) {
          this.sessionViews.delete(previousSessionId);
        }
      }
      this.refreshSessionAttachedViews(previousSessionId);
    }

    this.viewSessions.set(normalizedViewId, normalizedSessionId);
    this.viewAttachmentGenerations.set(normalizedViewId, visibleAttachmentGeneration);
    if (isUsableWebContents(webContents)) {
      this.viewWebContents.set(normalizedViewId, webContents);
      webContents.once('destroyed', () => {
        if (this.viewWebContents.get(normalizedViewId) === webContents) {
          this.detachView(normalizedViewId);
        }
      });
    }
    let viewIds = this.sessionViews.get(normalizedSessionId);
    if (!viewIds) {
      viewIds = new Set();
      this.sessionViews.set(normalizedSessionId, viewIds);
    }
    viewIds.add(normalizedViewId);
    this.refreshSessionAttachedViews(normalizedSessionId);
    return this.buildSessionState(normalizedSessionId);
  }

  detachView(viewId, expectedSessionId) {
    const normalizedViewId = normalizeViewId(viewId);
    if (!normalizedViewId) {
      throw new Error('[AilyChat][RuntimeHost] detachView requires a view id.');
    }

    const boundSessionId = this.viewSessions.get(normalizedViewId);
    const normalizedExpectedSessionId = normalizeSessionId(expectedSessionId);
    if (normalizedExpectedSessionId && boundSessionId && boundSessionId !== normalizedExpectedSessionId) {
      throw new Error('[AilyChat][RuntimeHost] Runtime view is bound to a different session.');
    }

    const targetSessionId = normalizedExpectedSessionId || boundSessionId;
    if (!targetSessionId) {
      return null;
    }

    this.viewSessions.delete(normalizedViewId);
    this.viewAttachmentGenerations.delete(normalizedViewId);
    this.viewWebContents.delete(normalizedViewId);
    const viewIds = this.sessionViews.get(targetSessionId);
    if (viewIds) {
      viewIds.delete(normalizedViewId);
      if (viewIds.size === 0) {
        this.sessionViews.delete(targetSessionId);
      }
    }
    this.refreshSessionAttachedViews(targetSessionId);
    return this.buildSessionState(targetSessionId);
  }

  refreshSessionAttachedViews(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || !this.sessionStates.has(normalizedSessionId)) {
      return;
    }
    this.sessionStates.set(
      normalizedSessionId,
      this.withAttachedViewIds(clonePayload(this.sessionStates.get(normalizedSessionId))),
    );
  }

  cacheSessionState(state) {
    const sessionId = normalizeSessionId(state && state.sessionId);
    if (!sessionId) {
      return null;
    }
    const nextState = clonePayload(this.withAttachedViewIds(state));
    this.sessionStates.set(sessionId, nextState);
    if (nextState.requestInProgress !== true) {
      this.resolveCompletionWaiters(sessionId);
    }
    return clonePayload(nextState);
  }

  cacheExecutionWorkerReportedSessionState(state) {
    const sessionId = normalizeSessionId(state && state.sessionId);
    if (!sessionId || !this.hasHostSession(sessionId)) {
      return null;
    }

    const previousState = this.buildSessionState(sessionId);
    if (this.isHostTerminalStatus(previousState && previousState.status)) {
      return null;
    }

    const workerState = clonePayload(state);
    const workerRequestInProgress = workerState && workerState.requestInProgress === true;
    const workerTranscriptRevision = Number(workerState && workerState.transcriptRevision) || 0;
    const previousTranscriptRevision = Number(previousState && previousState.transcriptRevision) || 0;
    const transcriptRevision = Math.max(previousTranscriptRevision, workerTranscriptRevision);
    let nextState;

    if (previousState && previousState.requestInProgress === true) {
      if (workerRequestInProgress) {
        const previousActiveTurnId = this.normalizeActiveTurnId(previousState.activeTurnId);
        const workerActiveTurnId = this.normalizeActiveTurnId(workerState.activeTurnId);
        let nextTranscriptRevision = transcriptRevision;
        if (previousActiveTurnId && workerActiveTurnId && previousActiveTurnId !== workerActiveTurnId) {
          const previousTurnHasProgress = this.hasExecutionWorkerTurnObservableProgress(sessionId, previousActiveTurnId);
          const migratedTranscript = previousTurnHasProgress
            ? this.seedExecutionWorkerReportedActiveTurn({
              sessionId,
              turnId: workerActiveTurnId,
              revision: transcriptRevision,
              workerState,
            })
            : this.transcriptBuilder.replaceTurnId({
              sessionId,
              fromTurnId: previousActiveTurnId,
              toTurnId: workerActiveTurnId,
              revision: transcriptRevision,
            });
          nextTranscriptRevision = Math.max(
            nextTranscriptRevision,
            Number(migratedTranscript && migratedTranscript.revision) || 0,
          );
        }
        nextState = {
          ...previousState,
          activeTurnId: workerActiveTurnId || previousActiveTurnId || previousState.activeTurnId || null,
          transcriptRevision: nextTranscriptRevision,
          selectedMode: workerState.selectedMode !== undefined
            ? workerState.selectedMode ?? null
            : previousState.selectedMode ?? null,
          providerOptions: workerState.providerOptions !== undefined
            ? workerState.providerOptions ?? null
            : previousState.providerOptions ?? null,
          attachedViewIds: this.readAttachedViewIds(sessionId),
        };
      } else {
        nextState = {
          ...previousState,
          status: this.normalizeExecutionWorkerSettledStatus(workerState.status),
          requestInProgress: false,
          activeTurnId: this.normalizeActiveTurnId(workerState.activeTurnId) || null,
          transcriptRevision,
          selectedMode: workerState.selectedMode !== undefined
            ? workerState.selectedMode ?? null
            : previousState.selectedMode ?? null,
          providerOptions: workerState.providerOptions !== undefined
            ? workerState.providerOptions ?? null
            : previousState.providerOptions ?? null,
          attachedViewIds: this.readAttachedViewIds(sessionId),
        };
      }
    } else {
      if (workerRequestInProgress) {
        const workerActiveTurnId = this.normalizeActiveTurnId(workerState.activeTurnId);
        const seededTranscript = this.seedExecutionWorkerReportedActiveTurn({
          sessionId,
          turnId: workerActiveTurnId,
          revision: transcriptRevision,
          workerState,
        });
        const nextTranscriptRevision = Math.max(
          transcriptRevision,
          Number(seededTranscript && seededTranscript.revision) || 0,
        );
        nextState = {
          ...previousState,
          sessionId,
          status: 'running',
          requestInProgress: true,
          activeTurnId: workerActiveTurnId || null,
          transcriptRevision: nextTranscriptRevision,
          selectedMode: workerState.selectedMode !== undefined
            ? workerState.selectedMode ?? null
            : previousState.selectedMode ?? null,
          providerOptions: workerState.providerOptions !== undefined
            ? workerState.providerOptions ?? null
            : previousState.providerOptions ?? null,
          attachedViewIds: this.readAttachedViewIds(sessionId),
        };
      } else {
      nextState = {
        ...previousState,
        status: this.normalizeIdleExecutionWorkerStatus(previousState && previousState.status, workerState.status),
        requestInProgress: false,
        activeTurnId: null,
        transcriptRevision,
        selectedMode: workerState.selectedMode !== undefined
          ? workerState.selectedMode ?? null
          : previousState.selectedMode ?? null,
        providerOptions: workerState.providerOptions !== undefined
          ? workerState.providerOptions ?? null
          : previousState.providerOptions ?? null,
        attachedViewIds: this.readAttachedViewIds(sessionId),
      };
      }
    }

    this.sessionStates.set(sessionId, clonePayload(nextState));
    if (nextState.requestInProgress !== true) {
      this.resolveCompletionWaiters(sessionId);
    }
    return clonePayload(nextState);
  }

  cacheTranscript(transcript) {
    return this.transcriptBuilder.acceptTranscriptSnapshot(transcript);
  }

  cacheExecutionWorkerTurnSnapshot(payload) {
    const transcript = this.transcriptBuilder.acceptTurnSnapshot({
      sessionId: payload && payload.sessionId,
      turnId: payload && payload.turnId,
      revision: payload && payload.revision,
      turn: payload && payload.turn,
    });
    return transcript
      ? {
          kind: 'transcript',
          sessionId: transcript.sessionId,
          revision: Number(transcript.revision) || Number(payload && payload.revision) || 0,
          transcript,
        }
      : null;
  }

  cacheExecutionWorkerRenderEvent(payload) {
    const transcript = this.transcriptBuilder.acceptRenderEvent({
      sessionId: payload && payload.sessionId,
      turnId: payload && payload.turnId,
      revision: payload && payload.revision,
      request: payload && payload.request,
      event: payload && payload.renderEvent,
    });
    return transcript
      ? {
          kind: 'transcript',
          sessionId: transcript.sessionId,
          revision: Number(transcript.revision) || Number(payload && payload.revision) || 0,
          transcript,
        }
      : null;
  }

  cacheInteraction(interaction) {
    const sessionId = normalizeSessionId(interaction && interaction.sessionId);
    if (!sessionId) {
      return null;
    }
    this.interactions.set(sessionId, clonePayload(interaction));
    return this.applyInteractionDerivedSessionState(sessionId);
  }

  hasPendingInteraction(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return false;
    }
    if (snapshot.question && typeof snapshot.question === 'object') {
      return true;
    }
    if (Array.isArray(snapshot.confirmationQueue) && snapshot.confirmationQueue.length > 0) {
      return true;
    }
    if (snapshot.activePlanReview && typeof snapshot.activePlanReview === 'object') {
      return true;
    }
    return Array.isArray(snapshot.backgroundCommandSessionKeys)
      && snapshot.backgroundCommandSessionKeys.length > 0;
  }

  applyInteractionDerivedSessionState(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || !this.hasHostSession(normalizedSessionId)) {
      return null;
    }
    const previousState = this.buildSessionState(normalizedSessionId);
    if (!previousState || this.isHostTerminalStatus(previousState.status)) {
      return null;
    }
    const pending = this.hasPendingInteraction(this.buildInteractionSnapshot(normalizedSessionId));
    const nextStatus = pending
      ? 'needs_input'
      : previousState.requestInProgress === true
        ? 'running'
        : previousState.status;
    if (previousState.status === nextStatus) {
      return null;
    }
    const nextState = {
      ...previousState,
      status: nextStatus,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
    };
    this.sessionStates.set(normalizedSessionId, clonePayload(nextState));
    return clonePayload(nextState);
  }

  resolveInteractionRequest(request) {
    const sessionId = normalizeSessionId(request && request.sessionId);
    if (!sessionId) {
      throw new Error('[AilyChat][RuntimeHost] resolveInteraction requires a session id.');
    }
    this.assertAttachedInteractionView(request, sessionId);

    const kind = typeof request.kind === 'string' ? request.kind : '';
    const current = this.buildInteractionSnapshot(sessionId);
    const requestId = normalizeInteractionId(request.id);
    let next = null;

    switch (kind) {
      case 'question.complete':
      case 'question.skip':
        next = this.resolveQuestionInteraction(current, requestId, kind);
        break;
      case 'confirmation.navigate':
        next = this.resolveConfirmationNavigateInteraction(current, requestId, Number(request.delta) || 0);
        break;
      case 'confirmation.resolve':
        next = this.resolveConfirmationInteraction(current, requestId);
        break;
      case 'confirmation.action':
        next = this.validateConfirmationActionInteraction(current, requestId);
        break;
      case 'planReview.resolve':
        next = this.resolvePlanReviewInteraction(current, requestId);
        break;
      case 'commandSession.action':
        next = this.validateCommandSessionInteraction(current);
        break;
      default:
        throw this.createInteractionError(`Unknown interaction request kind: ${kind || '<missing>'}.`);
    }

    const stateAfterInteraction = next.changed
      ? this.cacheInteraction(next.snapshot)
      : null;
    return {
      snapshot: clonePayload(next.snapshot),
      events: [
        next.changed
          ? {
            kind: 'interaction',
            sessionId,
            revision: Number(next.snapshot.revision) || 0,
            interaction: clonePayload(next.snapshot),
          }
          : null,
        stateAfterInteraction ? this.buildSessionStateEvent('runtime-status', sessionId) : null,
      ].filter(Boolean),
    };
  }

  assertAttachedInteractionView(request, sessionId) {
    const viewId = normalizeViewId(request && request.viewId);
    if (!viewId) {
      throw this.createInteractionError('Stale interaction request with no attached runtime view.');
    }

    const boundSessionId = this.viewSessions.get(viewId);
    if (boundSessionId !== sessionId) {
      throw this.createInteractionError(`Stale interaction request from detached view ${viewId}.`);
    }

    const expectedGeneration = this.viewAttachmentGenerations.get(viewId);
    const requestGeneration = normalizeVisibleAttachmentGeneration(request && request.visibleAttachmentGeneration);
    if (expectedGeneration === undefined || expectedGeneration === null) {
      throw this.createInteractionError(`Stale interaction request from view ${viewId} without host generation.`);
    }
    if (requestGeneration === null || requestGeneration !== expectedGeneration) {
      throw this.createInteractionError(`Stale interaction request from view ${viewId} generation ${requestGeneration ?? '<missing>'}.`);
    }
  }

  resolveQuestionInteraction(current, requestId, kind) {
    const question = current.question && typeof current.question === 'object' ? current.question : null;
    const questionId = normalizeInteractionId(question && question.partId);
    if (!question || !questionId || requestId !== questionId) {
      throw this.createInteractionError(`Stale ${kind} request for ${requestId || '<missing>'}.`);
    }
    return this.nextInteractionResult(current, { question: null });
  }

  resolveConfirmationNavigateInteraction(current, requestId, delta) {
    const queue = Array.isArray(current.confirmationQueue) ? current.confirmationQueue : [];
    if (queue.length === 0) {
      throw this.createInteractionError('Stale confirmation.navigate request with no pending confirmations.');
    }
    const activeIndex = this.normalizeConfirmationIndex(current.activeConfirmationIndex, queue.length);
    const activeId = normalizeInteractionId(queue[activeIndex] && queue[activeIndex].id);
    if (!activeId || requestId !== activeId) {
      throw this.createInteractionError(`Stale confirmation.navigate request for ${requestId || '<missing>'}.`);
    }
    const nextIndex = (activeIndex + delta + queue.length) % queue.length;
    return this.nextInteractionResult(current, { activeConfirmationIndex: nextIndex });
  }

  resolveConfirmationInteraction(current, requestId) {
    const queue = Array.isArray(current.confirmationQueue) ? current.confirmationQueue : [];
    const targetIndex = queue.findIndex(entry => normalizeInteractionId(entry && entry.id) === requestId);
    if (!requestId || targetIndex < 0) {
      throw this.createInteractionError(`Stale confirmation.resolve request for ${requestId || '<missing>'}.`);
    }
    const nextQueue = queue.filter((_, index) => index !== targetIndex);
    const nextIndex = nextQueue.length === 0
      ? 0
      : Math.min(this.normalizeConfirmationIndex(current.activeConfirmationIndex, queue.length), nextQueue.length - 1);
    return this.nextInteractionResult(current, {
      confirmationQueue: nextQueue,
      activeConfirmationIndex: nextIndex,
    });
  }

  validateConfirmationActionInteraction(current, requestId) {
    const queue = Array.isArray(current.confirmationQueue) ? current.confirmationQueue : [];
    const target = queue.find(entry => normalizeInteractionId(entry && entry.id) === requestId);
    if (!requestId || !target) {
      throw this.createInteractionError(`Stale confirmation.action request for ${requestId || '<missing>'}.`);
    }
    return { snapshot: current, changed: false };
  }

  resolvePlanReviewInteraction(current, requestId) {
    const planReview = current.activePlanReview && typeof current.activePlanReview === 'object'
      ? current.activePlanReview
      : null;
    const planReviewId = normalizeInteractionId(planReview && planReview.id);
    if (!planReview || !planReviewId || requestId !== planReviewId) {
      throw this.createInteractionError(`Stale planReview.resolve request for ${requestId || '<missing>'}.`);
    }
    return this.nextInteractionResult(current, { activePlanReview: null });
  }

  validateCommandSessionInteraction(current) {
    const backgroundKeys = Array.isArray(current.backgroundCommandSessionKeys)
      ? current.backgroundCommandSessionKeys
      : [];
    if (backgroundKeys.length === 0) {
      throw this.createInteractionError('Stale commandSession.action request with no pending command session.');
    }
    return { snapshot: current, changed: false };
  }

  nextInteractionResult(current, patch) {
    const snapshot = {
      sessionId: current.sessionId,
      revision: (Number(current.revision) || 0) + 1,
      question: Object.prototype.hasOwnProperty.call(patch, 'question')
        ? patch.question
        : current.question ?? null,
      confirmationQueue: Object.prototype.hasOwnProperty.call(patch, 'confirmationQueue')
        ? clonePayload(patch.confirmationQueue) ?? []
        : clonePayload(current.confirmationQueue) ?? [],
      activeConfirmationIndex: Object.prototype.hasOwnProperty.call(patch, 'activeConfirmationIndex')
        ? Number(patch.activeConfirmationIndex) || 0
        : Number(current.activeConfirmationIndex) || 0,
      activePlanReview: Object.prototype.hasOwnProperty.call(patch, 'activePlanReview')
        ? patch.activePlanReview
        : current.activePlanReview ?? null,
      backgroundCommandSessionKeys: clonePayload(current.backgroundCommandSessionKeys) ?? [],
    };
    return { snapshot, changed: true };
  }

  normalizeConfirmationIndex(index, length) {
    if (!Number.isFinite(index) || length <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(Number(index) || 0, length - 1));
  }

  createInteractionError(message) {
    const error = new Error(`[AilyChat][RuntimeHost] ${message}`);
    error.code = 'stale_interaction';
    return error;
  }

  cacheHostEvent(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    switch (payload.kind) {
      case 'session-state':
      case 'runtime-status':
        return this.cacheSessionState(payload.state)
          ? this.buildSessionStateEvent(payload.kind, payload.state && payload.state.sessionId)
          : null;
      case 'transcript':
        {
          const transcript = this.cacheTranscript(payload.transcript);
          return transcript
            ? {
                kind: 'transcript',
                sessionId: transcript.sessionId,
                revision: Number(transcript.revision) || Number(payload.revision) || 0,
                transcript,
              }
            : null;
        }
      case 'interaction':
        {
          const state = this.cacheInteraction(payload.interaction);
          return [
            payload,
            state ? this.buildSessionStateEvent('runtime-status', payload.sessionId) : null,
          ].filter(Boolean);
        }
      case 'view-request':
        return this.cacheViewRequestEvent(payload);
      case 'resource-request':
        return this.cacheResourceRequestEvent(payload);
      default:
        return payload;
    }
  }

  cacheExecutionWorkerEvent(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    switch (payload.kind) {
      case 'turnProgress':
        return this.cacheExecutionWorkerTurnProgress(payload);
      case 'turnInteractionRequested':
        return this.cacheExecutionWorkerTurnInteractionRequested(payload);
      case 'turnError':
        return this.cacheExecutionWorkerTurnError(payload);
      case 'turnCompleted':
        return this.cacheExecutionWorkerTurnCompleted(payload);
      default:
        return null;
    }
  }

  cacheExecutionWorkerTurnProgress(payload) {
    const sessionId = normalizeSessionId(payload && payload.sessionId);
    const payloadTurnId = this.normalizeActiveTurnId(payload && payload.turnId);
    const turnSnapshotId = this.readCanonicalTurnSnapshotId(payload && payload.turn);
    const renderEventTurnId = this.readCanonicalRenderEventTurnId(payload && payload.renderEvent);
    const turnId = turnSnapshotId || renderEventTurnId || payloadTurnId;
    if (!this.isCurrentExecutionWorkerTurn(sessionId, payloadTurnId)
      && !this.isCurrentExecutionWorkerTurn(sessionId, turnId)) {
      if (payload && payload.renderEvent && this.acceptExecutionWorkerServiceOwnedResponseProgress({
        sessionId,
        turnId: renderEventTurnId || turnId,
        request: payload.request,
        revision: payload.revision,
        renderEvent: payload.renderEvent,
      })) {
        return this.cacheExecutionWorkerRenderEvent({
          ...payload,
          sessionId,
          turnId: renderEventTurnId || turnId,
        });
      }
      if (payload && payload.turn && this.acceptExecutionWorkerServiceOwnedResponseProgress({
        sessionId,
        turnId: turnSnapshotId || turnId,
        request: payload.request,
        revision: payload.revision,
        turn: payload.turn,
      })) {
        return this.cacheExecutionWorkerTurnSnapshot({
          ...payload,
          sessionId,
          turnId: turnSnapshotId || turnId,
        });
      }
      const event = payload && payload.event;
      if (event && typeof event === 'object'
        && (event.kind === 'session-state' || event.kind === 'runtime-status')
        && event.state
        && event.state.requestInProgress === true
        && this.normalizeActiveTurnId(event.state.activeTurnId) === payloadTurnId) {
        const state = this.cacheExecutionWorkerReportedSessionState({
          ...event.state,
          sessionId,
          activeTurnId: payloadTurnId,
          requestInProgress: true,
        });
        return state
          ? this.buildSessionStateEvent(event.kind, state.sessionId)
          : null;
      }
      return null;
    }
    if (payload.turn) {
      if (turnSnapshotId && turnSnapshotId !== payloadTurnId) {
        this.acceptExecutionWorkerServiceOwnedResponseProgress({
          sessionId,
          turnId: turnSnapshotId,
          request: payload.request,
          turn: payload.turn,
          revision: payload.revision,
        });
      }
      return this.cacheExecutionWorkerTurnSnapshot({
        ...payload,
        sessionId,
        turnId: turnSnapshotId || turnId,
      });
    }
    if (payload.renderEvent) {
      if (renderEventTurnId && renderEventTurnId !== payloadTurnId) {
        this.acceptExecutionWorkerServiceOwnedResponseProgress({
          sessionId,
          turnId: renderEventTurnId,
          request: payload.request,
          revision: payload.revision,
          renderEvent: payload.renderEvent,
        });
      }
      return this.cacheExecutionWorkerRenderEvent({
        ...payload,
        sessionId,
        turnId: renderEventTurnId || turnId,
      });
    }
    const event = payload && payload.event;
    if (!event || typeof event !== 'object') {
      return null;
    }
    switch (event.kind) {
      case 'session-state':
      case 'runtime-status': {
        if (!event.state || event.state.requestInProgress !== true) {
          return null;
        }
        const state = this.cacheExecutionWorkerReportedSessionState({
          ...event.state,
          sessionId,
          activeTurnId: turnId,
          requestInProgress: true,
        });
        return state
          ? this.buildSessionStateEvent(event.kind, state.sessionId)
          : null;
      }
      case 'view-request': {
        if (!event.request || event.request.sessionId !== sessionId) {
          return null;
        }
        return this.cacheViewRequestEvent({
          ...event,
          sessionId,
        });
      }
      case 'resource-request': {
        if (!event.request || event.request.sessionId !== sessionId) {
          return null;
        }
        return this.cacheResourceRequestEvent({
          ...event,
          sessionId,
        });
      }
      default:
        return null;
    }
  }

  cacheViewRequestEvent(event) {
    const sessionId = normalizeSessionId(event && event.sessionId);
    const request = event && event.request && typeof event.request === 'object'
      ? event.request
      : null;
    const requestSessionId = normalizeSessionId(request && request.sessionId);
    const requestId = normalizeViewRequestId(request && request.id);
    const requestKind = normalizeViewRequestKind(request && request.kind);
    if (!sessionId || requestSessionId !== sessionId || !requestId || !requestKind) {
      return null;
    }

    const normalizedEvent = {
      kind: 'view-request',
      sessionId,
      revision: Number(event.revision) || this.transcriptBuilder.readTranscriptRevision(sessionId),
      request: clonePayload({
        ...request,
        id: requestId,
        sessionId,
        kind: requestKind,
      }),
    };
    const current = this.viewRequestEvents.get(sessionId) ?? [];
    let next = current.filter(item => {
      const existingId = normalizeViewRequestId(item && item.request && item.request.id);
      const existingKind = normalizeViewRequestKind(item && item.request && item.request.kind);
      return existingId !== requestId && !(requestKind === 'todo-state' && existingKind === 'todo-state');
    });
    next.push(normalizedEvent);
    if (next.length > MAX_VIEW_REQUEST_EVENTS_PER_SESSION) {
      next = next.slice(next.length - MAX_VIEW_REQUEST_EVENTS_PER_SESSION);
    }
    this.viewRequestEvents.set(sessionId, next);
    return clonePayload(normalizedEvent);
  }

  cacheResourceRequestEvent(event) {
    const sessionId = normalizeSessionId(event && event.sessionId);
    const request = event && event.request && typeof event.request === 'object'
      ? event.request
      : null;
    const requestSessionId = normalizeSessionId(request && request.sessionId);
    const requestId = normalizeResourceRequestId(request && request.id);
    const requestKind = normalizeResourceRequestKind(request && request.kind);
    const requestPhase = normalizeResourceRequestPhase(request && request.phase);
    if (!sessionId || requestSessionId !== sessionId || !requestId || !requestKind || !requestPhase) {
      return null;
    }

    const error = request.error && typeof request.error === 'object'
      ? {
          code: typeof request.error.code === 'string' ? request.error.code : undefined,
          message: typeof request.error.message === 'string' ? request.error.message : 'Resource request failed.',
          retryable: typeof request.error.retryable === 'boolean' ? request.error.retryable : undefined,
        }
      : undefined;
    const normalizedRequest = {
      id: requestId,
      sessionId,
      kind: requestKind,
      phase: requestPhase,
      ...(typeof request.label === 'string' && request.label.trim() ? { label: request.label.trim() } : {}),
      ...(typeof request.detail === 'string' && request.detail.trim() ? { detail: request.detail.trim() } : {}),
      ...(request.resource && typeof request.resource === 'object' ? { resource: clonePayload(request.resource) } : {}),
      ...(error ? { error } : {}),
    };
    const normalizedEvent = {
      kind: 'resource-request',
      sessionId,
      revision: Number(event.revision) || this.transcriptBuilder.readTranscriptRevision(sessionId),
      request: clonePayload(normalizedRequest),
    };
    const current = this.resourceRequestEvents.get(sessionId) ?? [];
    let next = current.concat([normalizedEvent]);
    if (next.length > MAX_RESOURCE_REQUEST_EVENTS_PER_SESSION) {
      next = next.slice(next.length - MAX_RESOURCE_REQUEST_EVENTS_PER_SESSION);
    }
    this.resourceRequestEvents.set(sessionId, next);
    return clonePayload(normalizedEvent);
  }

  cacheExecutionWorkerTurnInteractionRequested(payload) {
    const sessionId = normalizeSessionId(payload && payload.sessionId);
    const turnId = this.normalizeActiveTurnId(payload && payload.turnId);
    if (!this.isCurrentExecutionWorkerTurn(sessionId, turnId)) {
      return null;
    }
    const interaction = payload && payload.interaction && payload.interaction.sessionId === sessionId
      ? payload.interaction
      : null;
    if (!interaction) {
      return null;
    }
    const state = this.cacheInteraction(interaction);
    return [
      {
        kind: 'interaction',
        sessionId,
        revision: Number(interaction.revision) || Number(payload.revision) || 0,
        interaction: clonePayload(interaction),
      },
      state ? this.buildSessionStateEvent('runtime-status', sessionId) : null,
    ].filter(Boolean);
  }

  cacheExecutionWorkerTurnError(payload) {
    const sessionId = normalizeSessionId(payload && payload.sessionId);
    const turnId = this.normalizeActiveTurnId(payload && payload.turnId);
    if (!this.isCurrentExecutionWorkerTurn(sessionId, turnId)) {
      return null;
    }
    const error = payload && payload.error && typeof payload.error === 'object'
      ? payload.error
      : {};
    const transcript = this.transcriptBuilder.markTurnFailed({
      sessionId,
      turnId,
      revision: Number(payload.revision) || 0,
      error,
    });
    const failedState = this.failSubmittedTurn(sessionId);
    if (!failedState) {
      return null;
    }
    const events = [
      {
        kind: 'error',
        sessionId,
        revision: Number(payload.revision) || Number(failedState.transcriptRevision) || 0,
        error: {
          code: typeof error.code === 'string' ? error.code : undefined,
          message: typeof error.message === 'string' ? error.message : 'Execution worker turn failed.',
          retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
        },
      },
      this.buildSessionStateEvent('runtime-status', sessionId),
    ];
    if (transcript) {
      events.unshift({
        kind: 'transcript',
        sessionId,
        revision: Number(transcript.revision) || 0,
        transcript,
      });
    }
    return events.filter(Boolean);
  }

  cacheExecutionWorkerTurnCompleted(payload) {
    const sessionId = normalizeSessionId(payload && payload.sessionId);
    const payloadTurnId = this.normalizeActiveTurnId(payload && payload.turnId);
    const turnSnapshotId = this.readCanonicalTurnSnapshotId(payload && payload.turn);
    const turnId = turnSnapshotId || payloadTurnId;
    if (!this.isCurrentExecutionWorkerTurn(sessionId, payloadTurnId)
      && !this.isCurrentExecutionWorkerTurn(sessionId, turnId)) {
      if (!(payload && payload.turn && this.acceptExecutionWorkerServiceOwnedResponseProgress({
        sessionId,
        turnId: turnSnapshotId || turnId,
        request: payload.request,
        revision: payload.revision,
        turn: payload.turn,
      }))) {
        return null;
      }
    }
    const hasFinalTurn = !!(payload && payload.turn);
    const hasInteraction = !!(payload && payload.interaction && payload.interaction.sessionId === sessionId);
    if (!hasFinalTurn && !hasInteraction && !this.hasExecutionWorkerTurnObservableProgress(sessionId, turnId)) {
      return null;
    }
    const events = [];
    if (payload.turn) {
      const transcriptEvent = this.cacheExecutionWorkerTurnSnapshot({
        ...payload,
        sessionId,
        turnId: turnSnapshotId || turnId,
      });
      if (transcriptEvent) {
        events.push(transcriptEvent);
      }
    }
    if (payload.interaction && payload.interaction.sessionId === sessionId) {
      this.cacheInteraction(payload.interaction);
      events.push({
        kind: 'interaction',
        sessionId,
        revision: Number(payload.interaction.revision) || Number(payload.revision) || 0,
        interaction: clonePayload(payload.interaction),
      });
    }
    const previousState = this.buildSessionState(sessionId);
    const transcriptRevision = Math.max(
      Number(previousState && previousState.transcriptRevision) || 0,
      Number(payload.revision) || 0,
      Number(payload.state && payload.state.transcriptRevision) || 0,
      events.reduce((maxRevision, event) => Math.max(maxRevision, Number(event && event.revision) || 0), 0),
    );
    const workerState = payload.state && typeof payload.state === 'object'
      ? {
          ...payload.state,
          sessionId,
          requestInProgress: false,
          activeTurnId: this.normalizeActiveTurnId(payload.state.activeTurnId) || null,
          transcriptRevision,
        }
      : {
          ...previousState,
          sessionId,
          status: 'completed',
          requestInProgress: false,
          activeTurnId: null,
          transcriptRevision,
        };
    const state = this.cacheExecutionWorkerReportedSessionState(workerState);
    if (state) {
      events.push(this.buildSessionStateEvent('runtime-status', sessionId));
    }
    return events.filter(Boolean);
  }

  cacheCommandResult(method, args, result) {
    switch (method) {
      case 'attachView':
        this.attachView(args && args[0], args && args[1], null, args && args[2]);
        this.cacheExecutionWorkerReportedSessionState(result);
        return;
      case 'readSessionState':
        this.cacheSessionState(result);
        return;
      case 'submitTurn':
        this.cacheExecutionWorkerReportedSessionState(result);
        return;
      case 'detachView':
        this.detachView(args && args[0], args && args[1]);
        return;
      case 'ensureSessionCanRerun':
        this.cacheSessionState(result && result.state);
        return;
      case 'readTranscript':
        this.cacheTranscript(result);
        return;
      case 'readInteractionSnapshot':
      case 'resolveInteraction':
        this.cacheInteraction(result);
        return;
      case 'disposeSession':
        this.clearSession(args && args[0]);
        return;
      default:
        return;
    }
  }

  readHostCommandResult(method, args) {
    if (method === 'readSessionInventory') {
      return this.buildSessionInventorySnapshot();
    }
    const sessionId = normalizeSessionId(args && args[0]);
    if (!sessionId) {
      return HOST_SESSION_STORE_MISS;
    }
    switch (method) {
      case 'readSubmitReadiness': {
        const state = this.buildSessionState(sessionId);
        return state && state.requestInProgress === true
          ? {
              sessionId,
              canSubmit: false,
              requestInProgress: true,
            }
          : {
              sessionId,
              canSubmit: true,
              requestInProgress: false,
            };
      }
      case 'ensureSessionCanRerun': {
        const state = this.buildSessionState(sessionId);
        return state && state.requestInProgress === true
          ? {
              sessionId,
              activeRequestInProgress: true,
              staleGateCleared: false,
              state,
            }
          : {
              sessionId,
              activeRequestInProgress: false,
              staleGateCleared: false,
              state,
            };
      }
      case 'awaitRequestCompletion': {
        return this.awaitRequestCompletion(sessionId);
      }
      case 'readSessionState':
        return this.buildSessionState(sessionId);
      case 'readTranscript':
        return this.buildTranscriptSnapshot(sessionId);
      case 'readInteractionSnapshot':
        return this.buildInteractionSnapshot(sessionId);
      default:
        return HOST_SESSION_STORE_MISS;
    }
  }

  readExecutionWorkerUnavailableHostCommandResult(method, args) {
    if (method === 'attachView') {
      return this.attachView(args && args[0], args && args[1], null, args && args[2]);
    }
    if (method === 'detachView') {
      this.detachView(args && args[0], args && args[1]);
      return undefined;
    }

    const sessionId = normalizeSessionId(args && args[0]);
    if (!sessionId || !this.hasHostSession(sessionId)) {
      return HOST_SESSION_STORE_MISS;
    }

    const state = this.buildSessionState(sessionId);
    switch (method) {
      case 'readSessionState':
        return state;
      case 'readSubmitReadiness':
        return {
          sessionId,
          canSubmit: false,
          requestInProgress: state && state.requestInProgress === true,
        };
      case 'ensureSessionCanRerun':
        return {
          sessionId,
          activeRequestInProgress: state && state.requestInProgress === true,
          staleGateCleared: false,
          state: this.withAttachedViewIds(state),
        };
      case 'awaitRequestCompletion':
        return this.awaitRequestCompletion(sessionId);
      case 'readTranscript':
        return this.buildTranscriptSnapshot(sessionId);
      case 'readInteractionSnapshot':
        return this.buildInteractionSnapshot(sessionId);
      default:
        return HOST_SESSION_STORE_MISS;
    }
  }

  beginSubmittedTurn(request) {
    const sessionId = normalizeSessionId(request && request.sessionId);
    if (!sessionId) {
      throw new Error('[AilyChat][RuntimeHost] submitTurn requires a session id.');
    }
    this.cacheSubmittedTurnInventoryMetadata(sessionId, request);
    const previousState = this.buildSessionState(sessionId);
    const activeTurnId = this.normalizeActiveTurnId(request && request.activeResponseHandle)
      || this.createSubmittedTurnId(sessionId);
    const transcript = this.transcriptBuilder.seedSubmittedTurn({
      sessionId,
      turnId: activeTurnId,
      request,
      revision: Number(previousState && previousState.transcriptRevision) || 0,
      timestamp: Date.now(),
    });
    const nextState = {
      ...previousState,
      sessionId,
      status: 'running',
      requestInProgress: true,
      attachedViewIds: this.readAttachedViewIds(sessionId),
      activeTurnId,
      transcriptRevision: transcript
        ? Number(transcript.revision) || 0
        : Number(previousState && previousState.transcriptRevision) || 0,
      selectedMode: request && request.selectedMode !== undefined
        ? request.selectedMode ?? null
        : previousState.selectedMode ?? null,
      providerOptions: request && request.providerOptions !== undefined
        ? request.providerOptions ?? null
        : previousState.providerOptions ?? null,
      currentModel: request && request.currentModel !== undefined
        ? request.currentModel ?? null
        : previousState.currentModel ?? null,
    };
    this.sessionStates.set(sessionId, clonePayload(nextState));
    return clonePayload(nextState);
  }

  createSubmittedTurnId(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    this.submittedTurnSequence += 1;
    return `${normalizedSessionId}-turn-${Date.now().toString(36)}-${this.submittedTurnSequence.toString(36)}`;
  }

  markSubmittedTurnFailed(sessionId, error, revision) {
    const previousState = this.buildSessionState(sessionId);
    const normalizedSessionId = normalizeSessionId(previousState && previousState.sessionId);
    const activeTurnId = this.normalizeActiveTurnId(previousState && previousState.activeTurnId);
    if (!normalizedSessionId || !activeTurnId) {
      return null;
    }
    return this.transcriptBuilder.markTurnFailed({
      sessionId: normalizedSessionId,
      turnId: activeTurnId,
      revision,
      error,
    });
  }

  cacheSubmittedTurnInventoryMetadata(sessionId, request) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId || !request || typeof request !== 'object') {
      return;
    }
    const rawMetadata = request.metadata && typeof request.metadata === 'object'
      ? request.metadata.hostSessionInventory
      : null;
    if (!rawMetadata || typeof rawMetadata !== 'object') {
      return;
    }
    const previous = this.sessionInventoryMetadata.get(normalizedSessionId) ?? {};
    const next = { ...previous };
    const title = normalizeOptionalString(rawMetadata.title);
    if (title) {
      next.title = title;
    }
    const titleSource = normalizeOptionalString(rawMetadata.titleSource);
    if (titleSource) {
      next.titleSource = titleSource;
    }
    if (rawMetadata.titleDurable === true) {
      next.titleDurable = true;
    }
    const sessionType = normalizeOptionalString(rawMetadata.sessionType);
    if (sessionType) {
      next.sessionType = sessionType;
    }
    if (typeof rawMetadata.projectPath === 'string' || rawMetadata.projectPath === null) {
      next.projectPath = rawMetadata.projectPath;
    }
    const mode = normalizeOptionalString(rawMetadata.mode);
    if (mode) {
      next.mode = mode;
    }
    this.sessionInventoryMetadata.set(normalizedSessionId, clonePayload(next));
  }

  failSubmittedTurn(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    const previousState = this.buildSessionState(normalizedSessionId);
    const nextState = {
      ...previousState,
      sessionId: normalizedSessionId,
      status: 'failed',
      requestInProgress: false,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
      transcriptRevision: this.transcriptBuilder.readTranscriptRevision(normalizedSessionId),
    };
    this.sessionStates.set(normalizedSessionId, clonePayload(nextState));
    this.resolveCompletionWaiters(normalizedSessionId);
    return clonePayload(nextState);
  }

  failRunningTurns() {
    const runningSessionIds = [];
    for (const [sessionId, state] of this.sessionStates) {
      if (state && state.requestInProgress === true) {
        runningSessionIds.push(sessionId);
      }
    }
    return runningSessionIds
      .map(sessionId => this.failSubmittedTurn(sessionId))
      .filter(Boolean);
  }

  stopSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    const previousState = this.buildSessionState(normalizedSessionId);
    const nextState = {
      ...previousState,
      sessionId: normalizedSessionId,
      status: 'stopped',
      requestInProgress: false,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
    };
    this.sessionStates.set(normalizedSessionId, clonePayload(nextState));
    this.resolveCompletionWaiters(normalizedSessionId);
    return clonePayload(nextState);
  }

  disposeSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    const previousState = this.buildSessionState(normalizedSessionId);
    const disposedState = {
      ...previousState,
      sessionId: normalizedSessionId,
      status: 'disposed',
      requestInProgress: false,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
    };
    this.sessionStates.set(normalizedSessionId, clonePayload(disposedState));
    this.resolveCompletionWaiters(normalizedSessionId);
    this.clearSession(normalizedSessionId);
    return clonePayload(disposedState);
  }

  awaitRequestCompletion(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return Promise.resolve();
    }
    const state = this.sessionStates.get(normalizedSessionId);
    if (!state || state.requestInProgress !== true) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const waiters = this.completionWaiters.get(normalizedSessionId) || [];
      waiters.push(resolve);
      this.completionWaiters.set(normalizedSessionId, waiters);
    });
  }

  resolveCompletionWaiters(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    const waiters = this.completionWaiters.get(normalizedSessionId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.completionWaiters.delete(normalizedSessionId);
    for (const resolve of waiters) {
      resolve();
    }
  }

  normalizeActiveTurnId(value) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : '';
  }

  acceptExecutionWorkerServiceOwnedResponseProgress({ sessionId, turnId, request, revision, renderEvent, turn }) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const canonicalTurnId = this.normalizeActiveTurnId(turnId);
    if (!normalizedSessionId || !canonicalTurnId || !this.hasHostSession(normalizedSessionId)) {
      return false;
    }

    const previousState = this.buildSessionState(normalizedSessionId);
    if (this.isHostTerminalStatus(previousState && previousState.status)) {
      return false;
    }

    const transcript = this.transcriptBuilder.buildTranscriptSnapshot(normalizedSessionId);
    const turns = Array.isArray(transcript && transcript.turnResponses)
      ? transcript.turnResponses
      : [];
    const existingTurn = turns.find(item =>
      this.normalizeActiveTurnId(item && item.turnId) === canonicalTurnId);
    const previousActiveTurnId = this.normalizeActiveTurnId(previousState && previousState.activeTurnId);
    const isAlreadyCurrent = previousState
      && previousState.requestInProgress === true
      && previousActiveTurnId === canonicalTurnId;
    if (existingTurn && this.turnHasObservableProgress(existingTurn) && !isAlreadyCurrent) {
      return false;
    }

    const hasModelProgress = (renderEvent && typeof renderEvent === 'object')
      || this.turnHasObservableProgress(turn);
    if (!hasModelProgress) {
      return false;
    }

    let nextTranscriptRevision = Math.max(
      Number(previousState && previousState.transcriptRevision) || 0,
      Number(transcript && transcript.revision) || 0,
      Number(revision) || 0,
    );
    if (!existingTurn) {
      const requestId = this.readSubmitRequestId(request) || this.readTurnRequestId(turn);
      const seedTurn = this.findEmptyServiceOwnedResponseSeed({
        transcript,
        preferredTurnId: previousActiveTurnId,
        requestId,
      });
      const seedTurnId = this.normalizeActiveTurnId(seedTurn && seedTurn.turnId);
      const seededTranscript = seedTurnId
        ? this.transcriptBuilder.replaceTurnId({
          sessionId: normalizedSessionId,
          fromTurnId: seedTurnId,
          toTurnId: canonicalTurnId,
          revision,
        })
        : this.transcriptBuilder.seedSubmittedTurn({
          sessionId: normalizedSessionId,
          turnId: canonicalTurnId,
          request: this.buildExecutionWorkerServiceOwnedResponseRequest({
            sessionId: normalizedSessionId,
            request,
            turn,
          }),
          revision,
          timestamp: renderEvent && typeof renderEvent === 'object'
            ? renderEvent.timestamp
            : Date.now(),
        });
      nextTranscriptRevision = Math.max(
        nextTranscriptRevision,
        Number(seededTranscript && seededTranscript.revision) || 0,
      );
    }

    this.sessionStates.set(normalizedSessionId, clonePayload({
      ...previousState,
      sessionId: normalizedSessionId,
      status: 'running',
      requestInProgress: true,
      activeTurnId: canonicalTurnId,
      transcriptRevision: nextTranscriptRevision,
      selectedMode: request && request.selectedMode !== undefined
        ? request.selectedMode ?? null
        : previousState && previousState.selectedMode !== undefined ? previousState.selectedMode ?? null : null,
      providerOptions: request && request.providerOptions !== undefined
        ? request.providerOptions ?? null
        : previousState && previousState.providerOptions !== undefined ? previousState.providerOptions ?? null : null,
      currentModel: request && request.currentModel !== undefined
        ? request.currentModel ?? null
        : previousState && previousState.currentModel !== undefined ? previousState.currentModel ?? null : null,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
    }));
    return true;
  }

  buildExecutionWorkerServiceOwnedResponseRequest({ sessionId, request, turn }) {
    const sourceRequest = request && typeof request === 'object' ? request : {};
    const turnRequest = turn && turn.request && typeof turn.request === 'object'
      ? turn.request
      : {};
    const metadata = sourceRequest.metadata && typeof sourceRequest.metadata === 'object'
      ? sourceRequest.metadata
      : turnRequest.metadata && typeof turnRequest.metadata === 'object'
        ? turnRequest.metadata
        : undefined;
    const requestText = typeof sourceRequest.requestText === 'string'
      ? sourceRequest.requestText
      : typeof sourceRequest.content === 'string'
        ? sourceRequest.content
        : typeof turnRequest.content === 'string'
          ? turnRequest.content
          : '';
    const displayText = typeof sourceRequest.displayText === 'string'
      ? sourceRequest.displayText
      : typeof turnRequest.displayContent === 'string'
        ? turnRequest.displayContent
        : undefined;
    return {
      ...sourceRequest,
      sessionId,
      requestText,
      displayText,
      ...(metadata ? { metadata: clonePayload(metadata) } : {}),
    };
  }

  readTurnRequestId(turn) {
    const request = turn && turn.request && typeof turn.request === 'object'
      ? turn.request
      : null;
    const metadata = request && request.metadata && typeof request.metadata === 'object'
      ? request.metadata
      : null;
    return this.normalizeActiveTurnId(metadata && metadata.requestId);
  }

  readSubmitRequestId(request) {
    const metadata = request && request.metadata && typeof request.metadata === 'object'
      ? request.metadata
      : null;
    return this.normalizeActiveTurnId(metadata && metadata.requestId);
  }

  readCanonicalTurnSnapshotId(turn) {
    if (!turn || typeof turn !== 'object') {
      return '';
    }
    const turnId = this.normalizeActiveTurnId(turn.turnId);
    const response = turn.response && typeof turn.response === 'object' ? turn.response : null;
    const responseId = this.normalizeActiveTurnId(response && response.id);
    if (turnId && responseId && turnId !== responseId) {
      return '';
    }
    return turnId || responseId;
  }

  readCanonicalRenderEventTurnId(event) {
    return event && typeof event === 'object'
      ? this.normalizeActiveTurnId(event.turnId)
      : '';
  }

  findEmptyServiceOwnedResponseSeed({ transcript, preferredTurnId, requestId }) {
    const turns = Array.isArray(transcript && transcript.turnResponses)
      ? transcript.turnResponses
      : [];
    const normalizedPreferredTurnId = this.normalizeActiveTurnId(preferredTurnId);
    const normalizedRequestId = this.normalizeActiveTurnId(requestId);
    const isEligibleSeed = turn => {
      const turnId = this.normalizeActiveTurnId(turn && turn.turnId);
      if (!turnId) {
        return false;
      }
      const response = turn.response && typeof turn.response === 'object' ? turn.response : null;
      const responseId = this.normalizeActiveTurnId(response && response.id);
      if (responseId && responseId !== turnId) {
        return false;
      }
      if (normalizedRequestId && this.readTurnRequestId(turn) !== normalizedRequestId) {
        return false;
      }
      return !this.turnHasObservableProgress(turn);
    };
    if (normalizedPreferredTurnId) {
      const preferredTurn = turns.find(item =>
        this.normalizeActiveTurnId(item && item.turnId) === normalizedPreferredTurnId);
      if (isEligibleSeed(preferredTurn)) {
        return preferredTurn;
      }
    }
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (isEligibleSeed(turns[index])) {
        return turns[index];
      }
    }
    return null;
  }

  hasExecutionWorkerTurnObservableProgress(sessionId, turnId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedTurnId = this.normalizeActiveTurnId(turnId);
    if (!normalizedSessionId || !normalizedTurnId) {
      return false;
    }
    const transcript = this.transcriptBuilder.buildTranscriptSnapshot(normalizedSessionId);
    const turn = Array.isArray(transcript && transcript.turnResponses)
      ? transcript.turnResponses.find(item => this.normalizeActiveTurnId(item && item.turnId) === normalizedTurnId)
      : null;
    return this.turnHasObservableProgress(turn);
  }

  seedExecutionWorkerReportedActiveTurn({ sessionId, turnId, revision, workerState }) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedTurnId = this.normalizeActiveTurnId(turnId);
    if (!normalizedSessionId || !normalizedTurnId) {
      return null;
    }
    const currentTranscript = this.transcriptBuilder.buildTranscriptSnapshot(normalizedSessionId);
    const existingTurn = Array.isArray(currentTranscript && currentTranscript.turnResponses)
      ? currentTranscript.turnResponses.find(item =>
        this.normalizeActiveTurnId(item && item.turnId) === normalizedTurnId)
      : null;
    if (existingTurn) {
      return currentTranscript;
    }
    return this.transcriptBuilder.seedSubmittedTurn({
      sessionId: normalizedSessionId,
      turnId: normalizedTurnId,
      request: {
        sessionId: normalizedSessionId,
        requestText: typeof workerState?.requestText === 'string' ? workerState.requestText : '',
        displayText: typeof workerState?.displayText === 'string' ? workerState.displayText : undefined,
        selectedMode: workerState && workerState.selectedMode !== undefined ? workerState.selectedMode : undefined,
        providerOptions: workerState && workerState.providerOptions !== undefined ? workerState.providerOptions : undefined,
      },
      revision,
      timestamp: Date.now(),
    });
  }

  turnHasObservableProgress(turn) {
    if (!turn || typeof turn !== 'object') {
      return false;
    }
    const response = turn.response && typeof turn.response === 'object' ? turn.response : null;
    const parts = Array.isArray(response && response.parts) ? response.parts : [];
    const topLevelParts = Array.isArray(turn.parts) ? turn.parts : [];
    if (parts.length > 0 || topLevelParts.length > 0) {
      return true;
    }
    if (typeof response?.resultText === 'string' && response.resultText.trim().length > 0) {
      return true;
    }
    if (typeof turn.resultText === 'string' && turn.resultText.trim().length > 0) {
      return true;
    }
    if (Array.isArray(turn.rounds) && turn.rounds.length > 0) {
      return true;
    }
    if (Array.isArray(response?.progressMessages) && response.progressMessages.length > 0) {
      return true;
    }
    if (Array.isArray(response?.contentReferences) && response.contentReferences.length > 0) {
      return true;
    }
    if (Array.isArray(response?.codeCitations) && response.codeCitations.length > 0) {
      return true;
    }
    return false;
  }

  isCurrentExecutionWorkerTurn(sessionId, turnId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedTurnId = this.normalizeActiveTurnId(turnId);
    if (!normalizedSessionId || !normalizedTurnId) {
      return false;
    }
    const state = this.buildSessionState(normalizedSessionId);
    if (!state || state.requestInProgress !== true) {
      return false;
    }
    return this.normalizeActiveTurnId(state.activeTurnId) === normalizedTurnId;
  }

  isHostTerminalStatus(status) {
    return status === 'stopped'
      || status === 'disposed'
      || status === 'failed'
      || status === 'cancelled';
  }

  normalizeExecutionWorkerSettledStatus(status) {
    return typeof status === 'string' && status.trim().length > 0
      ? status.trim()
      : 'idle';
  }

  normalizeIdleExecutionWorkerStatus(previousStatus, workerStatus) {
    if (typeof previousStatus === 'string' && previousStatus.trim().length > 0) {
      return previousStatus;
    }
    return this.normalizeExecutionWorkerSettledStatus(workerStatus);
  }

  buildSessionStateEvent(kind, sessionId) {
    const state = this.buildSessionState(sessionId);
    if (!state) {
      return null;
    }
    return {
      kind,
      sessionId: state.sessionId,
      revision: Number(state.transcriptRevision) || 0,
      state,
    };
  }
}

module.exports = {
  ChatRuntimeHostSessionStore,
  HOST_SESSION_STORE_MISS,
  clonePayload,
  isUsableWebContents,
  normalizeSessionId,
  normalizeViewId,
};

