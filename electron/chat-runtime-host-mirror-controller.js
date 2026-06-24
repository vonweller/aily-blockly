const MIRROR_MISS = Symbol('aily-chat-runtime-host-mirror-miss');

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

function clonePayload(value) {
  if (value == null) {
    return value;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

class ChatRuntimeHostMirrorController {
  constructor() {
    this.sessionStates = new Map();
    this.transcripts = new Map();
    this.interactions = new Map();
    this.viewSessions = new Map();
    this.sessionViews = new Map();
    this.viewWebContents = new Map();
    this.completionWaiters = new Map();
  }

  clearSession(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    this.sessionStates.delete(normalizedSessionId);
    this.transcripts.delete(normalizedSessionId);
    this.interactions.delete(normalizedSessionId);
    this.resolveCompletionWaiters(normalizedSessionId);
    const viewIds = this.sessionViews.get(normalizedSessionId);
    if (viewIds) {
      for (const viewId of viewIds) {
        this.viewSessions.delete(viewId);
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
    const cachedTranscript = this.transcripts.get(normalizedSessionId);
    return {
      sessionId: normalizedSessionId,
      status: 'idle',
      requestInProgress: false,
      attachedViewIds: this.readAttachedViewIds(normalizedSessionId),
      activeTurnId: null,
      transcriptRevision: Number(cachedTranscript && cachedTranscript.revision) || 0,
      selectedMode: null,
    };
  }

  hasSessionMirror(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return !!normalizedSessionId
      && (this.sessionStates.has(normalizedSessionId)
        || this.transcripts.has(normalizedSessionId)
        || this.interactions.has(normalizedSessionId)
        || this.sessionViews.has(normalizedSessionId));
  }

  attachView(viewId, sessionId, webContents) {
    const normalizedViewId = normalizeViewId(viewId);
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedViewId || !normalizedSessionId) {
      throw new Error('[AilyChat][RuntimeHost] attachView requires a view id and session id.');
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
      return;
    }
    this.sessionStates.set(sessionId, clonePayload(this.withAttachedViewIds(state)));
    if (state.requestInProgress !== true) {
      this.resolveCompletionWaiters(sessionId);
    }
  }

  cacheTranscript(transcript) {
    const sessionId = normalizeSessionId(transcript && transcript.sessionId);
    if (!sessionId) {
      return;
    }
    this.transcripts.set(sessionId, clonePayload(transcript));
  }

  cacheInteraction(interaction) {
    const sessionId = normalizeSessionId(interaction && interaction.sessionId);
    if (!sessionId) {
      return;
    }
    this.interactions.set(sessionId, clonePayload(interaction));
  }

  cacheHostEvent(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    switch (payload.kind) {
      case 'session-state':
      case 'runtime-status':
        this.cacheSessionState(payload.state);
        return;
      case 'transcript':
        this.cacheTranscript(payload.transcript);
        return;
      case 'interaction':
        this.cacheInteraction(payload.interaction);
        return;
      default:
        return;
    }
  }

  cacheCommandResult(method, args, result) {
    switch (method) {
      case 'attachView':
        this.attachView(args && args[0], args && args[1]);
        this.cacheSessionState(result);
        return;
      case 'readSessionState':
      case 'submitTurn':
        this.cacheSessionState(result);
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

  readMirrorCommandResult(method, args) {
    const sessionId = normalizeSessionId(args && args[0]);
    if (!sessionId) {
      return MIRROR_MISS;
    }
    switch (method) {
      case 'readSubmitReadiness': {
        const state = this.sessionStates.has(sessionId)
          ? this.withAttachedViewIds(clonePayload(this.sessionStates.get(sessionId)))
          : null;
        return state && state.requestInProgress === true
          ? {
              sessionId,
              canSubmit: false,
              requestInProgress: true,
            }
          : MIRROR_MISS;
      }
      case 'ensureSessionCanRerun': {
        const state = this.sessionStates.has(sessionId)
          ? this.withAttachedViewIds(clonePayload(this.sessionStates.get(sessionId)))
          : null;
        return state && state.requestInProgress === true
          ? {
              sessionId,
              activeRequestInProgress: true,
              staleGateCleared: false,
              state,
            }
          : MIRROR_MISS;
      }
      case 'awaitRequestCompletion': {
        return this.awaitRequestCompletion(sessionId);
      }
      case 'readSessionState':
        return this.hasSessionMirror(sessionId)
          ? this.buildSessionState(sessionId)
          : MIRROR_MISS;
      case 'readTranscript':
        return this.transcripts.has(sessionId)
          ? clonePayload(this.transcripts.get(sessionId))
          : MIRROR_MISS;
      case 'readInteractionSnapshot':
        return this.interactions.has(sessionId)
          ? clonePayload(this.interactions.get(sessionId))
          : MIRROR_MISS;
      default:
        return MIRROR_MISS;
    }
  }

  readOwnerUnavailableMirrorCommandResult(method, args) {
    if (method === 'attachView') {
      return this.attachView(args && args[0], args && args[1]);
    }
    if (method === 'detachView') {
      this.detachView(args && args[0], args && args[1]);
      return undefined;
    }

    const sessionId = normalizeSessionId(args && args[0]);
    if (!sessionId || !this.hasSessionMirror(sessionId)) {
      return MIRROR_MISS;
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
      default:
        return MIRROR_MISS;
    }
  }

  beginSubmittedTurn(request) {
    const sessionId = normalizeSessionId(request && request.sessionId);
    if (!sessionId) {
      throw new Error('[AilyChat][RuntimeHost] submitTurn requires a session id.');
    }
    const previousState = this.buildSessionState(sessionId);
    const activeTurnId = this.normalizeActiveTurnId(request && request.activeResponseHandle)
      || this.normalizeActiveTurnId(previousState && previousState.activeTurnId)
      || sessionId;
    const nextState = {
      ...previousState,
      sessionId,
      status: 'running',
      requestInProgress: true,
      attachedViewIds: this.readAttachedViewIds(sessionId),
      activeTurnId,
      transcriptRevision: Number(previousState && previousState.transcriptRevision) || 0,
      selectedMode: request && request.selectedMode !== undefined
        ? request.selectedMode ?? null
        : previousState.selectedMode ?? null,
    };
    this.sessionStates.set(sessionId, clonePayload(nextState));
    return clonePayload(nextState);
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
    };
    this.sessionStates.set(normalizedSessionId, clonePayload(nextState));
    this.resolveCompletionWaiters(normalizedSessionId);
    return clonePayload(nextState);
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
}

module.exports = {
  ChatRuntimeHostMirrorController,
  MIRROR_MISS,
  clonePayload,
  isUsableWebContents,
  normalizeSessionId,
  normalizeViewId,
};
