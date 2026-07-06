import { exec as execCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  AilyServicesEndpoint,
  OpenAIEndpoint,
  createAgentHandleAsync,
  createBlocklyHostBridge,
} from 'aily-lex';

const DEFAULT_MODEL_ID = 'auto';
const DEFAULT_API_ENDPOINT = 'https://api.aily.pro';
const DEFAULT_INTERACTION_SOFT_ROUND_LIMIT = 200;
const execAsync = promisify(execCallback);

function createAbortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

export function createRuntimeOwner(options = {}) {
  return new LexExecutionRuntimeOwner(options);
}

export default createRuntimeOwner;

class LexExecutionRuntimeOwner {
  constructor(options = {}) {
    this.callHost = typeof options.callHost === 'function' ? options.callHost : null;
    this.requestResourceOperation = typeof options.requestResourceOperation === 'function'
      ? options.requestResourceOperation
      : null;
    this.env = options.env || process.env;
    this.listeners = new Set();
    this.sessions = new Map();
  }

  onEvent(listener) {
    if (typeof listener !== 'function') {
      return { dispose() {} };
    }
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  async prewarmRuntime(command = {}) {
    const sessionId = normalizeSessionId(command.sessionId);
    const projectInfo = await this.readProjectInfo(sessionId);
    await this.ensureSession(sessionId, command, projectInfo);
    return {
      sessionId,
      ensured: true,
      executionHost: 'lex-headless',
      projectInfo,
    };
  }

  async startTurn(command = {}) {
    const sessionId = normalizeSessionId(command.sessionId || command.request?.sessionId);
    const turnId = normalizeTurnId(command.turnId || command.request?.activeResponseHandle);
    const request = command.request || {};
    const session = await this.ensureSession(sessionId, command, await this.readProjectInfo(sessionId));

    if (session.activeAbortController) {
      throw new Error('[AilyChat][ExecutionHost] Cannot start a new turn while another is active.');
    }

    this.applyProtocolTruncation(session, request.protocolTruncation);

    const abortController = new AbortController();
    session.activeAbortController = abortController;
    session.activeTurnId = turnId;
    session.revision += 1;
    this.emitRuntimeStatus(session, 'running', true);

    const text = typeof request.requestText === 'string'
      ? request.requestText
      : String(request.displayText || '');
    this.prepareSubmittedTurnTitle(sessionId, request, text);

    const turnPromise = this.runTurn(session, turnId, request, text, abortController)
      .catch(error => {
        if (!abortController.signal.aborted) {
          this.emit({
            kind: 'turnError',
            sessionId,
            turnId,
            revision: ++session.revision,
            error: toErrorPayload(error),
          });
        }
      })
      .finally(() => {
        if (session.activeTurnPromise === turnPromise) {
          session.activeAbortController = null;
          session.activeTurnId = null;
          session.activeTurnPromise = null;
          this.emitRuntimeStatus(session, abortController.signal.aborted ? 'cancelled' : 'completed', false);
        }
      });
    session.activeTurnPromise = turnPromise;

    return this.createSessionState(session, 'running', true, turnId);
  }

  applyProtocolTruncation(session, protocolTruncation) {
    const truncation = normalizeProtocolTruncation(protocolTruncation);
    if (!truncation || !session?.handle) {
      return;
    }

    const readSnapshot = typeof session.handle.getSessionSnapshot === 'function'
      ? () => session.handle.getSessionSnapshot()
      : () => session.handle.saveSession();
    const snapshot = readSnapshot();
    const result = truncateSessionSnapshot(snapshot, truncation);
    if (!result.changed) {
      return;
    }

    session.pendingApprovals?.clear?.();
    session.handle.restoreSession(result.snapshot);
    session.revision += 1;

    console.info('[AilyChat][LexExecutionHostProtocolTruncation]', JSON.stringify({
      sessionId: session.sessionId,
      kind: truncation.kind,
      turnId: truncation.turnId || null,
      beforeTurnCount: result.beforeTurnCount,
      afterTurnCount: result.afterTurnCount,
      retainedTurnIds: truncation.retainedTurnIds,
      discardedTurnIds: truncation.discardedTurnIds,
    }));
  }

  async stopTurn(command = {}) {
    const sessionId = normalizeSessionId(command.sessionId);
    const session = this.sessions.get(sessionId);
    if (!session?.activeAbortController) {
      return session ? this.createSessionState(session, 'cancelled', false, null) : undefined;
    }

    const activeTurnPromise = session.activeTurnPromise;
    session.activeAbortController.abort(createAbortError('[AilyChat][ExecutionHost] Turn stopped by host.'));
    if (activeTurnPromise && typeof activeTurnPromise.then === 'function') {
      await activeTurnPromise.catch(() => undefined);
    }
    return this.createSessionState(session, 'cancelled', false, null);
  }

  async disposeSessionResources(command = {}) {
    const sessionId = normalizeSessionId(command.sessionId);
    const session = this.sessions.get(sessionId);
    if (session?.activeAbortController) {
      session.activeAbortController.abort(createAbortError('[AilyChat][ExecutionHost] Session disposed.'));
    }
    try {
      session?.handle?.dispose?.();
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  async resolveInteraction(command = {}) {
    const sessionId = normalizeSessionId(command.sessionId);
    const session = this.sessions.get(sessionId);
    const request = command.request || {};
    const interactionId = command.interactionId || request.id || request.payload?.id;
    if (!session?.handle || typeof interactionId !== 'string') {
      return null;
    }
    if (request.kind === 'confirmation.resolve' || request.kind === 'confirmation.action') {
      const pending = session.pendingApprovals?.get(interactionId);
      if (pending) {
        session.pendingApprovals.delete(interactionId);
        pending.resolve(normalizeApprovalDecision(request.payload));
        return this.createInteractionSnapshot(session);
      }
      session.handle.respondToApproval(interactionId, normalizeApprovalDecision(request.payload).approved, request.payload || undefined);
    }
    if (request.kind === 'question.complete') {
      session.handle.respondToQuestion(interactionId, String(request.payload?.answer ?? ''));
    }
    return this.createInteractionSnapshot(session);
  }

  async runTurn(session, turnId, request, text, abortController) {
    for await (const renderEvent of session.handle.chat(text, abortController.signal, { turnId })) {
      if (abortController.signal.aborted) {
        continue;
      }
      this.emit({
        kind: 'render-event',
        sessionId: session.sessionId,
        turnId,
        revision: ++session.revision,
        request,
        renderEvent,
      });
    }
  }

  async ensureSession(sessionId, command = {}, projectInfo = null) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      await existing.handlePromise;
      return existing;
    }

    const request = command.request || {};
    const executionContext = command.executionContext && typeof command.executionContext === 'object'
      ? command.executionContext
      : null;
    const currentModel = command.currentModel || executionContext?.currentModel || request.currentModel || null;
    const providerOptions = command.providerOptions || executionContext?.providerOptions || request.providerOptions || null;
    const session = {
      sessionId,
      providerOptions,
      currentModel,
      revision: 0,
      activeTurnId: null,
      activeAbortController: null,
      activeTurnPromise: null,
      handle: null,
      handlePromise: null,
      pendingApprovals: new Map(),
      completionChain: Promise.resolve(),
    };
    this.sessions.set(sessionId, session);

    const hostAPI = this.createExternalHostAPI(sessionId, projectInfo, currentModel);
    const runtimeConfig = readRuntimeConfig(projectInfo);
    const endpoint = this.createEndpoint(currentModel, runtimeConfig);
    const bridge = createBlocklyHostBridge({
      hostAPI,
      endpoint,
      model: this.createModelConfig(currentModel),
      cwd: this.resolveCwd(projectInfo, providerOptions),
      extensions: {
        sessionCompletionCoordinator: this.createSessionCompletionCoordinator(session),
      },
      permissionMode: normalizePermissionMode(providerOptions),
      approvalPolicy: normalizeApprovalPolicy(providerOptions),
      approvalHandler: approvalRequest => this.requestApproval(session, approvalRequest),
    });

    session.handlePromise = createAgentHandleAsync(bridge, {
      sessionId,
      permissionMode: normalizePermissionMode(providerOptions),
      approvalPolicy: normalizeApprovalPolicy(providerOptions),
    }).then(handle => {
      session.handle = handle;
      return handle;
    });
    await session.handlePromise;
    return session;
  }

  prepareSubmittedTurnTitle(sessionId, request, text) {
    if (!this.requestResourceOperation) {
      return;
    }
    const requestText = typeof request?.requestText === 'string' && request.requestText.trim()
      ? request.requestText
      : text;
    if (!requestText || !String(requestText).trim()) {
      return;
    }
    void this.requestResourceOperation({
      sessionId,
      kind: 'session-title',
      label: 'Preparing chat session title',
      payload: {
        adapter: 'chatTitle',
        requestText,
        displayContent: typeof request?.displayText === 'string' ? request.displayText : requestText,
      },
    }).catch(error => {
      console.warn('[AilyChat][LexExecutionHostTitleFailed]', error?.message || error);
    });
  }

  createSessionCompletionCoordinator(session) {
    return {
      scheduleRequestCompleted: input => {
        session.completionChain = Promise.resolve(session.completionChain)
          .catch(() => undefined)
          .then(async () => {
            try {
              await input?.runWorkspaceFinalize?.();
              await input?.runSessionEndHooks?.();
            } catch (error) {
              console.warn('[AilyChat][LexExecutionHostCompletionEffectsFailed]', error?.message || error);
            }
          });
      },
    };
  }

  requestApproval(session, approvalRequest) {
    const interaction = createApprovalInteraction(session, approvalRequest);
    const approvalPromise = new Promise(resolve => {
      session.pendingApprovals.set(interaction.id, { resolve });
    });
    const snapshot = this.createInteractionSnapshot(session, [interaction]);
    this.emit({
      kind: 'turnInteractionRequested',
      sessionId: session.sessionId,
      turnId: session.activeTurnId || approvalRequest?.toolCallId || interaction.id,
      revision: snapshot.revision,
      interaction: snapshot,
    });
    return approvalPromise;
  }

  async readProjectInfo(sessionId) {
    if (!this.requestResourceOperation) {
      return null;
    }
    try {
      const result = await this.requestResourceOperation({
        sessionId,
        kind: 'project-info',
        payload: {
          adapter: 'project',
          action: 'getProjectInfo',
        },
      });
      return result && typeof result === 'object' && 'result' in result ? result.result : result;
    } catch (error) {
      console.warn('[AilyChat][LexExecutionHostProjectInfoFailed]', error?.message || error);
      return null;
    }
  }

  createExternalHostAPI(sessionId, projectInfo, currentModel) {
    return {
      fs: createExternalFileSystem(),
      terminal: createExternalTerminal(this.resolveCwd(projectInfo, null)),
      platform: createExternalPlatform(this.resolveCwd(projectInfo, null)),
      path: createPathExtension(),
      project: createExternalProject(sessionId, this.requestResourceOperation, projectInfo),
      builder: createExternalBuilder(sessionId, this.requestResourceOperation, projectInfo),
      blockly: createExternalBlockly(sessionId, this.requestResourceOperation),
      connectionGraph: createExternalConnectionGraph(sessionId, this.requestResourceOperation),
      auth: {
        getToken: async () => this.resolveAuthToken(currentModel, readRuntimeConfig(projectInfo)),
        token: this.resolveAuthToken(currentModel, readRuntimeConfig(projectInfo)),
        isLoggedIn: () => Boolean(this.resolveAuthToken(currentModel, readRuntimeConfig(projectInfo))),
      },
      config: {
        apiEndpoint: this.resolveAilyServicesBaseUrl(currentModel, readRuntimeConfig(projectInfo)),
        getApiEndpoint: () => this.resolveAilyServicesBaseUrl(currentModel, readRuntimeConfig(projectInfo)),
        locale: this.env.AILY_CHAT_LOCALE || this.env.LANG || 'zh-CN',
      },
    };
  }

  createEndpoint(currentModel, runtimeConfig = null) {
    const customBaseUrl = normalizeString(currentModel?.baseUrl || currentModel?.llmConfig?.baseUrl);
    const customApiKey = normalizeString(currentModel?.apiKey || currentModel?.llmConfig?.apiKey);
    if (customBaseUrl && customApiKey) {
      console.info('[AilyChat][LexExecutionHostEndpoint]', JSON.stringify({
        kind: 'openai-compatible',
        baseUrl: customBaseUrl,
        model: normalizeString(currentModel?.model || currentModel?.modelId) || DEFAULT_MODEL_ID,
        hasApiKey: true,
      }));
      return new OpenAIEndpoint({
        baseUrl: customBaseUrl,
        apiKey: customApiKey,
        modelFamily: normalizeString(currentModel?.family) || 'openai',
      });
    }

    const baseUrl = this.resolveAilyServicesBaseUrl(currentModel, runtimeConfig);
    const authToken = this.resolveAuthToken(currentModel, runtimeConfig);
    console.info('[AilyChat][LexExecutionHostEndpoint]', JSON.stringify({
      kind: 'aily-services',
      baseUrl,
      model: normalizeString(currentModel?.model || currentModel?.modelId) || DEFAULT_MODEL_ID,
      presetId: normalizeString(currentModel?.presetId) || '',
      hasAuthToken: Boolean(authToken),
      isLoggedIn: Boolean(runtimeConfig?.isLoggedIn || authToken),
      maxRequests: normalizeSoftRoundLimit(runtimeConfig?.maxRequests),
    }));
    return new AilyServicesEndpoint({
      baseUrl,
      authTokenProvider: async () => authToken,
      authStateFingerprintProvider: () => ({
        isLoggedIn: Boolean(runtimeConfig?.isLoggedIn || authToken),
        token: authToken,
        userId: runtimeConfig?.userId || null,
        snapshot: {
          isLoggedIn: Boolean(runtimeConfig?.isLoggedIn || authToken),
          userId: runtimeConfig?.userId || null,
        },
      }),
      interactionBudget: this.buildInteractionBudgetConfig(runtimeConfig),
      ...(currentModel?.providerContextManagementSupport
        ? { providerContextManagementSupport: currentModel.providerContextManagementSupport }
        : {}),
    });
  }

  buildInteractionBudgetConfig(runtimeConfig = null) {
    return {
      softRoundLimit: normalizeSoftRoundLimit(runtimeConfig?.maxRequests),
    };
  }

  createModelConfig(currentModel) {
    return {
      modelId: normalizeString(currentModel?.model || currentModel?.modelId) || DEFAULT_MODEL_ID,
      ...(normalizeString(currentModel?.presetId) ? { presetId: normalizeString(currentModel.presetId) } : {}),
      ...(Number.isFinite(currentModel?.contextWindowTokens) ? { contextWindowTokens: currentModel.contextWindowTokens } : {}),
      ...(normalizeString(currentModel?.reasoningEffort) ? { reasoningEffort: normalizeString(currentModel.reasoningEffort) } : {}),
      ...(currentModel?.providerContextManagementSupport
        ? { providerContextManagementSupport: currentModel.providerContextManagementSupport }
        : {}),
    };
  }

  resolveAilyServicesBaseUrl(currentModel, runtimeConfig = null) {
    return normalizeString(currentModel?.apiEndpoint)
      || normalizeString(runtimeConfig?.apiEndpoint)
      || normalizeString(this.env.AILY_SERVICES_API_ENDPOINT)
      || normalizeString(this.env.AILY_API_ENDPOINT)
      || DEFAULT_API_ENDPOINT;
  }

  resolveAuthToken(currentModel, runtimeConfig = null) {
    return normalizeString(currentModel?.authToken)
      || normalizeString(runtimeConfig?.authToken)
      || normalizeString(this.env.AILY_AUTH_TOKEN)
      || normalizeString(this.env.AILY_SERVICES_AUTH_TOKEN)
      || normalizeString(this.env.AILY_API_TOKEN);
  }

  resolveCwd(projectInfo, providerOptions) {
    return normalizeString(projectInfo?.rootPath)
      || normalizeString(projectInfo?.path)
      || normalizeString(providerOptions?.folderPath)
      || process.cwd();
  }

  emitRuntimeStatus(session, status, requestInProgress) {
    this.emit({
      kind: 'runtime-status',
      sessionId: session.sessionId,
      revision: ++session.revision,
      state: this.createSessionState(session, status, requestInProgress, session.activeTurnId),
    });
  }

  createSessionState(session, status, requestInProgress, activeTurnId) {
    return {
      sessionId: session.sessionId,
      status,
      requestInProgress,
      attachedViewIds: [],
      activeTurnId: activeTurnId || null,
      transcriptRevision: session.revision,
      providerOptions: session.providerOptions || null,
      currentModel: session.currentModel || null,
    };
  }

  createInteractionSnapshot(session, confirmationQueue = []) {
    return {
      sessionId: session.sessionId,
      revision: ++session.revision,
      question: null,
      confirmationQueue,
      activeConfirmationIndex: confirmationQueue.length > 0 ? 0 : -1,
      activePlanReview: null,
      backgroundCommandSessionKeys: [],
    };
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[AilyChat][LexExecutionHostEventListenerFailed]', error?.message || error);
      }
    }
  }
}

function createExternalFileSystem() {
  return {
    readFile: (filePath, encoding = 'utf-8') => fs.readFile(filePath, encoding),
    writeFile: (filePath, content, encoding = 'utf-8') => fs.writeFile(filePath, content, encoding),
    exists: async filePath => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    readdir: dirPath => fs.readdir(dirPath),
    stat: filePath => fs.stat(filePath),
    mkdir: (dirPath, options) => fs.mkdir(dirPath, options),
    delete: (targetPath, options = {}) => options.recursive
      ? fs.rm(targetPath, { recursive: true, force: true })
      : fs.unlink(targetPath),
  };
}

function createExternalTerminal(cwd) {
  const exec = async (command, options = {}) => {
    try {
      const { stdout, stderr } = await execAsync(String(command || ''), {
        cwd: normalizeString(options.cwd) || cwd || process.cwd(),
        env: { ...process.env, ...(options.env && typeof options.env === 'object' ? options.env : {}) },
        timeout: Number.isFinite(options.timeout) ? options.timeout : undefined,
        maxBuffer: Number.isFinite(options.maxBuffer) ? options.maxBuffer : 1024 * 1024 * 10,
        windowsHide: true,
      });
      return normalizeTerminalResult({ stdout, stderr, exitCode: 0 });
    } catch (error) {
      return normalizeTerminalResult({
        stdout: error?.stdout,
        stderr: error?.stderr || error?.message,
        exitCode: Number.isFinite(error?.code) ? error.code : 1,
      });
    }
  };
  return {
    run: exec,
    exec,
    execCommand: exec,
  };
}

function createApprovalInteraction(session, request) {
  const toolCallId = normalizeString(request?.toolCallId) || `approval-${Date.now()}`;
  const toolName = normalizeString(request?.toolName) || 'tool';
  const approvalTraceId = normalizeString(request?.approvalTraceId) || `${toolName}:${toolCallId}`;
  const actions = Array.isArray(request?.actions) && request.actions.length > 0
    ? request.actions.map(action => ({
      scope: normalizeString(action?.scope) || 'once',
      label: normalizeString(action?.label) || 'Allow',
      ...(normalizeString(action?.description) ? { description: normalizeString(action.description) } : {}),
      ...(normalizeString(action?.tooltip) ? { tooltip: normalizeString(action.tooltip) } : {}),
      ...(Boolean(action?.disabled) ? { disabled: true } : {}),
      ...(Boolean(action?.isSecondary) ? { isSecondary: true } : {}),
      ...(Object.prototype.hasOwnProperty.call(action || {}, 'resolves') ? { resolves: Boolean(action.resolves) } : {}),
    }))
    : [
      { scope: 'once', label: 'Allow once' },
      { scope: 'session', label: 'Allow in this chat' },
    ];
  return {
    approvalTraceId,
    sessionId: session.sessionId,
    id: toolCallId,
    kind: 'approval',
    partId: toolCallId,
    toolCallId,
    toolName,
    data: {
      kind: 'approval',
      approvalTraceId,
      partId: toolCallId,
      toolCallId,
      toolName,
      title: normalizeString(request?.title) || `Allow ${toolName}?`,
      subtitle: normalizeString(request?.subtitle) || toolName,
      message: normalizeString(request?.description) || normalizeString(request?.message) || normalizeString(request?.reason) || '',
      args: request?.input && typeof request.input === 'object' ? request.input : {},
      actions,
      primaryScope: normalizeString(request?.primaryScope) || actions[0]?.scope || 'once',
      ...(request?.approveCombination && typeof request.approveCombination === 'object'
        ? { approveCombination: request.approveCombination }
        : {}),
    },
  };
}

function normalizeApprovalDecision(payload) {
  const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
  const approved = result?.approved !== false;
  return approved
    ? { approved: true }
    : { approved: false, reason: normalizeString(result?.reason) || 'rejected' };
}

function normalizeProtocolTruncation(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const kind = normalizeString(value.kind);
  if (kind === 'clear') {
    return {
      kind,
      retainedTurnIds: [],
      discardedTurnIds: Array.isArray(value.discardedTurnIds)
        ? value.discardedTurnIds.map(normalizeString).filter(Boolean)
        : [],
    };
  }
  if (kind !== 'removeFrom') {
    return null;
  }
  return {
    kind,
    turnId: normalizeString(value.turnId),
    retainedTurnIds: Array.isArray(value.retainedTurnIds)
      ? value.retainedTurnIds.map(normalizeString).filter(Boolean)
      : [],
    discardedTurnIds: Array.isArray(value.discardedTurnIds)
      ? value.discardedTurnIds.map(normalizeString).filter(Boolean)
      : [],
  };
}

function truncateSessionSnapshot(snapshot, truncation) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const sourceTurns = Array.isArray(source.turns) ? source.turns : [];
  const sortedTurns = [...sourceTurns].sort((left, right) => {
    const leftIndex = Number.isFinite(left?.index) ? left.index : sourceTurns.indexOf(left);
    const rightIndex = Number.isFinite(right?.index) ? right.index : sourceTurns.indexOf(right);
    return leftIndex - rightIndex;
  });
  const beforeTurnCount = sortedTurns.length;
  const retainedTurnCount = resolveRetainedTurnCount(sortedTurns, truncation);
  const normalizedRetainedTurnCount = Math.max(0, Math.min(beforeTurnCount, retainedTurnCount));
  const retainedTurns = sortedTurns.slice(0, normalizedRetainedTurnCount);
  const changed = retainedTurns.length !== beforeTurnCount
    || sortedTurns.some((turn, index) => turn !== sourceTurns[index]);

  if (!changed) {
    return {
      changed: false,
      snapshot: source,
      beforeTurnCount,
      afterTurnCount: beforeTurnCount,
    };
  }

  const nextSnapshot = {
    ...source,
    turns: retainedTurns,
    revision: retainedTurns.length,
    updatedAt: Date.now(),
  };
  delete nextSnapshot.requestContext;

  return {
    changed: true,
    snapshot: nextSnapshot,
    beforeTurnCount,
    afterTurnCount: retainedTurns.length,
  };
}

function resolveRetainedTurnCount(turns, truncation) {
  if (truncation.kind === 'clear') {
    return 0;
  }

  const boundaryTurnId = normalizeString(truncation.turnId);
  if (boundaryTurnId) {
    const index = turns.findIndex(turn => isSnapshotTurnId(turn, boundaryTurnId));
    if (index >= 0) {
      return index;
    }
  }

  for (const discardedTurnId of truncation.discardedTurnIds || []) {
    const index = turns.findIndex(turn => isSnapshotTurnId(turn, discardedTurnId));
    if (index >= 0) {
      return index;
    }
  }

  if (Array.isArray(truncation.retainedTurnIds) && truncation.retainedTurnIds.length > 0) {
    return truncation.retainedTurnIds.length;
  }

  return turns.length;
}

function isSnapshotTurnId(turn, turnId) {
  if (!turn || !turnId) {
    return false;
  }
  return normalizeString(turn.id) === turnId
    || normalizeString(turn.turnId) === turnId
    || normalizeString(turn.requestId) === turnId
    || normalizeString(turn.responseModel?.turnId) === turnId
    || normalizeString(turn.responseModel?.requestId) === turnId;
}

function createExternalPlatform(cwd) {
  return {
    type: process.platform,
    os: process.platform,
    pathSep: path.sep,
    separator: path.sep,
    language: process.env.LANG || 'zh-CN',
    cwd: () => cwd || process.cwd(),
    homedir: () => os.homedir(),
    env: key => process.env[key],
  };
}

function createPathExtension() {
  return {
    join: (...parts) => path.join(...parts),
    resolve: (...parts) => path.resolve(...parts),
    dirname: value => path.dirname(value),
    basename: (value, ext) => path.basename(value, ext),
    extname: value => path.extname(value),
    relative: (from, to) => path.relative(from, to),
    isAbsolute: value => path.isAbsolute(value),
    normalize: value => path.normalize(value),
  };
}

function createExternalProject(sessionId, requestResourceOperation, initialProjectInfo) {
  let projectInfo = normalizeProjectInfo(initialProjectInfo);
  return {
    getProjectInfo: async () => {
      projectInfo = await requestProjectInfo(sessionId, requestResourceOperation, 'getProjectInfo');
      return projectInfo;
    },
    getProjectPath: () => normalizeString(projectInfo.path || projectInfo.rootPath),
    getBoard: () => normalizeString(projectInfo.board),
    getBoardConfig: async () => requestProjectInfo(sessionId, requestResourceOperation, 'getBoardJson'),
    getPackageJson: async () => requestProjectInfo(sessionId, requestResourceOperation, 'getPackageJson'),
    getBoardJson: async () => requestProjectInfo(sessionId, requestResourceOperation, 'getBoardJson'),
    getBoardModule: async () => requestProjectInfo(sessionId, requestResourceOperation, 'getBoardModule'),
    getBoardPackageJson: async () => requestProjectInfo(sessionId, requestResourceOperation, 'getBoardPackageJson'),
  };
}

function createExternalBuilder(sessionId, requestResourceOperation, initialProjectInfo) {
  return {
    build: async options => {
      const projectInfo = normalizeProjectInfo(initialProjectInfo);
      const projectPath = normalizeString(options?.projectPath) || normalizeString(projectInfo.path || projectInfo.rootPath);
      const result = await requestResourceOperation({
        sessionId,
        kind: 'project-build',
        payload: {
          adapter: 'builder',
          action: 'build',
          projectPath,
        },
      });
      return normalizeBuildResult(result?.result ?? result);
    },
  };
}

function createExternalBlockly(sessionId, requestResourceOperation) {
  return {
    exportAbs: async () => {
      const result = await requestResourceOperation({
        sessionId,
        kind: 'blockly-workspace',
        payload: { adapter: 'blockly', action: 'getGeneratedCode' },
      });
      return String(result?.result ?? result ?? '');
    },
    getWorkspaceOverview: async () => {
      const result = await requestResourceOperation({
        sessionId,
        kind: 'blockly-workspace',
        payload: { adapter: 'blockly', action: 'getGeneratedCode' },
      });
      const generatedCode = String(result?.result ?? result ?? '');
      return {
        structure: '',
        generatedCode,
        generatedCodeLength: generatedCode.length,
        generatedCodeTruncated: false,
        blockCount: 0,
        complexity: 'unknown',
      };
    },
  };
}

function createExternalConnectionGraph(sessionId, requestResourceOperation) {
  const call = async (action, args) => {
    const result = await requestResourceOperation({
      sessionId,
      kind: 'connection-graph',
      payload: {
        adapter: 'connectionGraph',
        action,
        args,
      },
    });
    return result?.result ?? result;
  };
  return {
    getCurrentSchematic: () => call('getCurrentSchematic'),
    getProjectContext: async () => {
      const context = await call('getCurrentSchematic');
      return { context: typeof context === 'string' ? context : JSON.stringify(context ?? null), components: [] };
    },
    getPinmapSummary: () => call('getPinmapSummary'),
    generatePinmap: componentId => call('generatePinmap', componentId),
    savePinmap: (componentId, pinmap) => call('savePinmap', { componentId, pinmap }),
    validateSchematic: schematic => call('validateConnectionGraph', schematic),
  };
}

async function requestProjectInfo(sessionId, requestResourceOperation, action) {
  if (!requestResourceOperation) {
    return {};
  }
  const result = await requestResourceOperation({
    sessionId,
    kind: 'project-info',
    payload: {
      adapter: 'project',
      action,
    },
  });
  return result?.result ?? result ?? {};
}

function normalizeTerminalResult(value) {
  const record = value && typeof value === 'object' ? value : {};
  return {
    stdout: String(record.stdout ?? record.output ?? ''),
    stderr: String(record.stderr ?? ''),
    exitCode: Number.isFinite(record.exitCode) ? record.exitCode : Number(record.code ?? 0),
  };
}

function normalizeBuildResult(value) {
  const record = value && typeof value === 'object' ? value : {};
  return {
    success: record.success !== false && record.state !== 'error',
    output: String(record.output ?? record.text ?? JSON.stringify(value ?? null)),
    ...(Array.isArray(record.errors) ? { errors: record.errors } : {}),
  };
}

function normalizeProjectInfo(value) {
  return value && typeof value === 'object' ? value : {};
}

function readRuntimeConfig(projectInfo) {
  const runtimeConfig = projectInfo && typeof projectInfo === 'object' && projectInfo.runtimeConfig && typeof projectInfo.runtimeConfig === 'object'
    ? projectInfo.runtimeConfig
    : null;
  return runtimeConfig
    ? {
      apiEndpoint: normalizeString(runtimeConfig.apiEndpoint),
      authToken: normalizeString(runtimeConfig.authToken),
      isLoggedIn: Boolean(runtimeConfig.isLoggedIn),
      userId: normalizeString(runtimeConfig.userId) || null,
      maxRequests: normalizeSoftRoundLimit(runtimeConfig.maxRequests),
    }
    : null;
}

function normalizeSoftRoundLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_INTERACTION_SOFT_ROUND_LIMIT;
  }
  return Math.max(1, Math.min(DEFAULT_INTERACTION_SOFT_ROUND_LIMIT, Math.trunc(value)));
}

function normalizePermissionMode(providerOptions) {
  const mode = normalizeString(providerOptions?.permissionMode);
  return mode || 'default';
}

function normalizeApprovalPolicy(providerOptions) {
  const policy = normalizeString(providerOptions?.approvalPolicy);
  return policy === 'never' ? 'never' : 'on_request';
}

function normalizeSessionId(value) {
  const sessionId = normalizeString(value);
  if (!sessionId) {
    throw new Error('[AilyChat][ExecutionHost] sessionId is required.');
  }
  return sessionId;
}

function normalizeTurnId(value) {
  const turnId = normalizeString(value);
  if (!turnId) {
    throw new Error('[AilyChat][ExecutionHost] turnId is required.');
  }
  return turnId;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toErrorPayload(error) {
  return {
    message: error?.message || String(error || 'Unknown execution host error'),
    code: typeof error?.code === 'string' ? error.code : 'lex_execution_host_turn_failed',
    retryable: Boolean(error?.retryable),
  };
}
