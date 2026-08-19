'use strict';

const { EventEmitter } = require('node:events');
const { randomBytes, randomUUID } = require('node:crypto');

const {
  RUNTIME_ERROR_CODES,
  RuntimeError,
  runtimeError,
} = require('../runtime-errors');
const { normalizeCapabilities } = require('../linux-shared/capabilities');
const {
  buildBase64HelperBootstrap,
  buildHelperStartCommand,
} = require('./bootstrap');
const {
  getBootStartScriptPath,
  getManagedAutostartPaths,
  renderBootStartScript,
} = require('./autostart');
const { ChunkedFileTransfer } = require('./file-transfer');
const { buildHelperSource } = require('./helper-source');
const { JpegPreviewLimiter } = require('./preview');
const {
  FrameDecoder,
  TYPES,
  createProtocolMagic,
  encodeFrame,
} = require('./protocol');
const {
  buildShellNonceCommand,
  createShellNonce,
  createShellNotDetectedError,
  detectShellPrompt,
  ShellNonceDetector,
} = require('./shell');

function defaultPortFactory(options) {
  return require('../../serial').createRawSerialPort(options);
}

function callPort(port, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!port || typeof port[method] !== 'function') {
      reject(new Error(`serial port does not implement ${method}`));
      return;
    }
    port[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
}

function waitWithTimeout(promise, timeoutMs, createError) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(createError()), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function requiredInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function defaultCapabilities(sessionDirectory) {
  return normalizeCapabilities({
    platform: 'linux',
    hostname: '',
    architecture: '',
    pythonVersion: '',
    homeDirectory: '',
    writableWorkspace: sessionDirectory,
    pty: true,
    terminalResize: true,
    processGroups: true,
    files: 'agent',
    autostart: 'none',
    preview: {
      available: false,
      transports: ['serial-framed'],
    },
  });
}

function normalizeRuntimeError(error, fallbackCode, message, details = {}) {
  if (error instanceof RuntimeError) return error;
  return runtimeError(fallbackCode, message, {
    cause: error,
    details,
  });
}

const SHELL_COMMAND_TERMINATOR = '\r';

class LinuxSerialShellDriver extends EventEmitter {
  constructor({
    portFactory = defaultPortFactory,
    agentRequest,
    nonce = createShellNonce(),
    nonceTimeoutMs = 1500,
    bootstrapTimeoutMs = 5000,
    requestTimeoutMs = 5000,
    protocolMagic = createProtocolMagic(),
    helperPath,
    sessionDirectory,
    helperSource,
    fileChunkSize,
    maxFileSize,
    previewFps = 2,
    previewBytesPerSecond,
  } = {}) {
    super();
    this.id = 'linux-serial-shell';
    this.portFactory = portFactory;
    this.agentRequest = agentRequest;
    this.nonce = nonce;
    this.nonceTimeoutMs = nonceTimeoutMs;
    this.bootstrapTimeoutMs = bootstrapTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.protocolMagic = Buffer.from(protocolMagic);
    this.sessionId = randomBytes(8).toString('hex');
    this.helperPath = helperPath || `/tmp/aily-serial-helper-${this.sessionId}.py`;
    this.sessionDirectory = sessionDirectory || `/tmp/aily-runtime/${this.sessionId}`;
    this.helperSource = helperSource || buildHelperSource({
      magic: this.protocolMagic,
      helperPath: this.helperPath,
      sessionDirectory: this.sessionDirectory,
      ...(maxFileSize === undefined ? {} : { maxFileSize }),
      ...(previewBytesPerSecond === undefined ? {} : { previewBytesPerSecond }),
    });
    this.port = null;
    this.connected = false;
    this.connecting = false;
    this.disconnecting = false;
    this._remoteDisconnectHandled = false;
    this.mode = 'closed';
    this.endpoint = null;
    this.activeRun = null;
    this.completedRunIds = new Set();
    this.previewRunning = false;
    this.capabilities = defaultCapabilities(this.sessionDirectory);
    this.lastHeartbeatAt = null;
    this._onData = null;
    this._onPortError = null;
    this._onPortClose = null;
    this._shellBuffer = '';
    this._nonceDetector = new ShellNonceDetector(this.nonce);
    this._probeWaiter = null;
    this._bootstrapWaiter = null;
    this._readyWaiter = null;
    this._requestSequence = 1;
    this._pendingRequests = new Map();
    this._writeChain = Promise.resolve();
    this.decoder = new FrameDecoder({
      magic: this.protocolMagic,
      onDesync: info => {
        if (info.reason !== 'noise') this.emit('protocolDesync', info);
      },
    });
    this.previewLimiter = new JpegPreviewLimiter({
      fps: previewFps,
      ...(previewBytesPerSecond === undefined ? {} : { bytesPerSecond: previewBytesPerSecond }),
      onFrame: data => this.emit('frame', { data }),
    });
    this.fileTransfer = new ChunkedFileTransfer({
      request: (action, params) => this.requestAgent(action, params),
      ...(fileChunkSize === undefined ? {} : { chunkSize: fileChunkSize }),
      ...(maxFileSize === undefined ? {} : { maxFileSize }),
    });
  }

  async connect({
    port,
    baudRate = 115200,
    skipProbe = false,
    skipBootstrap = false,
  } = {}) {
    if (typeof port !== 'string' || !port.trim()) {
      throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, 'serial port path is required');
    }
    if (this.connected) return this.status();
    if (this.connecting) {
      throw runtimeError(RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE, 'serial connection is already in progress');
    }

    this.connecting = true;
    this._remoteDisconnectHandled = false;
    this.endpoint = { port, baudRate };
    this.port = this.portFactory({ path: port, baudRate, autoOpen: false });
    this.installPortListeners();
    try {
      await callPort(this.port, 'open');
      if (!skipProbe) await this.probeShell();
      if (!skipBootstrap) {
        await this.bootstrapHelper();
      } else {
        this.mode = 'framed';
      }
      this.connected = true;
      this.emit('state', 'connected');
      return this.status();
    } catch (error) {
      await this.closePort();
      this.endpoint = null;
      this.mode = 'closed';
      throw normalizeRuntimeError(
        error,
        RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE,
        'Unable to initialize the Linux serial shell runtime',
        { phase: 'connect', retryable: true },
      );
    } finally {
      this.connecting = false;
    }
  }

  installPortListeners() {
    this._onData = chunk => this.handlePortData(Buffer.from(chunk));
    this._onPortError = error => this.handleRemoteDisconnect(error);
    this._onPortClose = () => this.handleRemoteDisconnect();
    this.port.on?.('data', this._onData);
    this.port.on?.('error', this._onPortError);
    this.port.on?.('close', this._onPortClose);
  }

  handleRemoteDisconnect(error) {
    if (this.disconnecting || this._remoteDisconnectHandled) return;
    this._remoteDisconnectHandled = true;
    const sessionError = normalizeRuntimeError(
      error,
      RUNTIME_ERROR_CODES.SESSION_CLOSED,
      'The serial device disconnected unexpectedly',
      { phase: 'serial-port', retryable: true },
    );
    this.rejectPendingWork(sessionError);
    this.clearRemoteSession();
    this.emit('runtimeError', sessionError);
    this.emit('disconnected');
    this.emit('state', 'disconnected');
  }

  rejectPendingWork(error) {
    this.rejectPendingRequests(error);
    for (const waiter of [this._probeWaiter, this._bootstrapWaiter, this._readyWaiter]) {
      waiter?.reject?.(error);
    }
    this._probeWaiter = null;
    this._bootstrapWaiter = null;
    this._readyWaiter = null;
  }

  clearRemoteSession() {
    this.connected = false;
    this.connecting = false;
    this.endpoint = null;
    this.mode = 'closed';
    this.activeRun = null;
    this.previewRunning = false;
    this.previewLimiter.clearPending();
    this.detachPort();
  }

  detachPort() {
    const port = this.port;
    if (!port) return;
    if (this._onData) port.off?.('data', this._onData);
    if (this._onPortError) port.off?.('error', this._onPortError);
    if (this._onPortClose) port.off?.('close', this._onPortClose);
    this.port = null;
    this._onData = null;
    this._onPortError = null;
    this._onPortClose = null;
  }

  async probeShell() {
    this.mode = 'shell';
    this._shellBuffer = '';
    this._nonceDetector = new ShellNonceDetector(this.nonce);
    this._probeWaiter = {
      ...deferred(),
      nonceSent: false,
    };
    await this.writeRaw(SHELL_COMMAND_TERMINATOR);
    try {
      await waitWithTimeout(
        this._probeWaiter.promise,
        this.nonceTimeoutMs,
        () => createShellNotDetectedError(),
      );
    } finally {
      this._probeWaiter = null;
    }
  }

  async bootstrapHelper() {
    const bootstrap = buildBase64HelperBootstrap(this.helperSource, this.helperPath);
    this._bootstrapWaiter = deferred();
    this._bootstrapWaiter.marker = bootstrap.shaMarker;
    for (const command of bootstrap.commands) {
      await this.writeRaw(`${command}${SHELL_COMMAND_TERMINATOR}`);
    }
    try {
      await waitWithTimeout(
        this._bootstrapWaiter.promise,
        this.bootstrapTimeoutMs,
        () => runtimeError(
          RUNTIME_ERROR_CODES.PYTHON3_NOT_FOUND,
          'The helper could not be verified with python3 on the board',
          {
            details: {
              phase: 'helper-upload',
              suggestion: 'Verify that python3 and base64 are available on WalnutPi.',
              retryable: true,
            },
          },
        ),
      );
    } finally {
      this._bootstrapWaiter = null;
    }

    this.mode = 'framed';
    this.decoder.reset();
    this._readyWaiter = deferred();
    await this.writeRaw(`${buildHelperStartCommand(this.helperPath)}${SHELL_COMMAND_TERMINATOR}`);
    try {
      await waitWithTimeout(
        this._readyWaiter.promise,
        this.bootstrapTimeoutMs,
        () => runtimeError(
          RUNTIME_ERROR_CODES.PROTOCOL_DESYNC,
          'The serial helper did not enter framed mode',
          {
            details: {
              phase: 'helper-start',
              retryable: true,
            },
          },
        ),
      );
    } finally {
      this._readyWaiter = null;
    }
  }

  handlePortData(data) {
    if (this.mode === 'shell') {
      this.handleShellData(data);
      return;
    }
    if (this.mode !== 'framed') return;
    for (const frame of this.decoder.push(data)) this.handleFrame(frame);
  }

  handleShellData(data) {
    const text = data.toString('utf8');
    this._shellBuffer = `${this._shellBuffer}${text}`.slice(-8192);
    this.emit('output', text);

    if (this._bootstrapWaiter && this._shellBuffer.includes(this._bootstrapWaiter.marker)) {
      this._bootstrapWaiter.resolve();
    }

    const waiter = this._probeWaiter;
    if (!waiter) return;
    if (this._nonceDetector.push(data)) {
      waiter.resolve();
      return;
    }
    const prompt = detectShellPrompt(this._shellBuffer);
    if (prompt === 'login') {
      waiter.reject(createShellNotDetectedError(
        'A login prompt was found instead of an authenticated shell. Connect the WalnutPi SERIAL-A port and log in before retrying.',
      ));
      return;
    }
    if (prompt === 'shell' && !waiter.nonceSent) {
      waiter.nonceSent = true;
      this.writeRaw(`${buildShellNonceCommand(this.nonce)}${SHELL_COMMAND_TERMINATOR}`).catch(waiter.reject);
    }
  }

  handleFrame(frame) {
    this.emit('protocolFrame', frame);
    if (frame.type === TYPES.HEARTBEAT) {
      this.lastHeartbeatAt = Date.now();
      return;
    }
    if (frame.type === TYPES.PREVIEW) {
      if (!this.previewRunning) return;
      try {
        this.previewLimiter.push(frame.payload);
      } catch (error) {
        this.emit('runtimeError', normalizeRuntimeError(
          error,
          RUNTIME_ERROR_CODES.PROTOCOL_DESYNC,
          'Invalid preview frame received from the board',
          { phase: 'preview-frame', retryable: true },
        ));
      }
      return;
    }
    if (frame.type === TYPES.TERMINAL) {
      this.emitScriptOutput(frame.payload.toString('utf8'), this.activeRun?.runId);
      return;
    }
    if (![TYPES.CONTROL, TYPES.FILE, TYPES.ACK, TYPES.ERROR].includes(frame.type)) return;

    let message;
    try {
      message = JSON.parse(frame.payload.toString('utf8'));
    } catch (error) {
      this.emit('runtimeError', runtimeError(
        RUNTIME_ERROR_CODES.PROTOCOL_DESYNC,
        'The serial helper sent invalid JSON',
        {
          cause: error,
          details: { phase: 'frame-json', retryable: true },
        },
      ));
      return;
    }

    if (message.replyTo !== undefined && message.replyTo !== null) {
      const pending = this._pendingRequests.get(String(message.replyTo));
      if (pending) {
        this._pendingRequests.delete(String(message.replyTo));
        clearTimeout(pending.timer);
        if (frame.type === TYPES.ERROR) {
          pending.reject(runtimeError(
            message.code || RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE,
            message.message || 'The serial helper rejected the request',
          ));
        } else {
          pending.resolve(message.result ?? message);
        }
      }
      return;
    }

    if (frame.type === TYPES.ERROR) {
      this.emit('runtimeError', runtimeError(
        message.code || RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE,
        message.message || 'The serial helper reported an error',
      ));
      return;
    }
    this.handleHelperEvent(message);
  }

  handleHelperEvent(message) {
    if (message.event === 'ready') {
      this.capabilities = normalizeCapabilities(message.capabilities || {});
      this._readyWaiter?.resolve(this.capabilities);
      return;
    }
    if (message.event === 'started') {
      if (this.completedRunIds.has(message.runId)) return;
      const metadata = {
        runId: message.runId,
        token: message.token,
        pid: message.pid,
        pgid: message.pgid,
        starttime: String(message.starttime),
      };
      if (this.activeRun?.runId === message.runId) {
        Object.assign(this.activeRun, metadata, { lifecycle: 'started' });
      } else {
        this.activeRun = { ...metadata, lifecycle: 'started' };
      }
      this.emitScriptState({ state: 'started', ...metadata });
      return;
    }
    if (message.event === 'output') {
      const text = message.dataBase64
        ? Buffer.from(message.dataBase64, 'base64').toString('utf8')
        : String(message.text || '');
      this.emitScriptOutput(text, message.runId);
      return;
    }
    if (message.event === 'exited') {
      if (this.completedRunIds.has(message.runId)) return;
      const run = this.activeRun?.runId === message.runId ? this.activeRun : null;
      const wasStopping = run?.lifecycle === 'stopping';
      if (run) this.activeRun = null;
      this.rememberCompletedRun(message.runId);
      if (wasStopping) return;
      const exitCode = message.exitCode ?? null;
      const failed = exitCode !== 0;
      this.emitScriptState({
        state: failed ? 'error' : 'finished',
        runId: message.runId,
        exitCode,
        ...(message.signal ? { signal: message.signal } : {}),
        ...(failed ? {
          message: message.signal
            ? `Script exited after signal ${message.signal}`
            : `Script exited with exit code ${exitCode}`,
        } : {}),
      });
    }
  }

  rememberCompletedRun(runId) {
    if (!runId) return;
    this.completedRunIds.add(runId);
    if (this.completedRunIds.size > 64) {
      this.completedRunIds.delete(this.completedRunIds.values().next().value);
    }
  }

  emitScriptOutput(text, runId = this.activeRun?.runId) {
    if (!text) return;
    this.emit('output', text);
    this.emit('event', {
      event: 'scriptOutput',
      params: {
        text,
        ...(runId ? { runId } : {}),
      },
    });
  }

  emitScriptState(params) {
    this.emit('state', params.state);
    this.emit('event', {
      event: 'scriptState',
      params,
    });
  }

  status() {
    const boardInfo = this.endpoint ? { ...this.endpoint } : null;
    return {
      state: this.connected ? 'connected' : (this.connecting ? 'connecting' : 'disconnected'),
      connected: this.connected,
      transport: 'serial-shell',
      port: this.endpoint?.port || this.port?.path || null,
      endpoint: boardInfo,
      boardInfo,
      capabilities: this.capabilities,
      activeRun: this.activeRun ? {
        runId: this.activeRun.runId,
        pid: this.activeRun.pid,
        pgid: this.activeRun.pgid,
      } : null,
      previewRunning: this.previewRunning,
    };
  }

  async request(method, params = {}) {
    if (method === 'status') return this.status();
    this.ensureConnected();
    switch (method) {
      case 'terminalInput':
        return this.terminalInput(params.text);
      case 'terminalSetSize':
        return this.resizeTerminal(params.columns, params.rows);
      case 'runScript':
        return this.runScript(params);
      case 'io.fileExec':
        return this.fileExec(params);
      case 'stopScript':
        return this.stopScript();
      case 'writeFile':
      case 'io.writeFile':
        return this.fileTransfer.writeFile(
          params.path,
          Buffer.from(params.dataBase64 || '', 'base64'),
          params,
        );
      case 'readFile':
      case 'io.readFile': {
        const result = await this.fileTransfer.readFile(params.path);
        return { ...result, dataBase64: result.data.toString('base64') };
      }
      case 'io.listDir':
        return this.fileTransfer.list(params.path);
      case 'io.stat':
      case 'io.queryFileStat':
        return this.fileTransfer.stat(params.path);
      case 'io.deleteFile':
        return this.fileTransfer.delete(params.path);
      case 'io.renameFile':
        return this.fileTransfer.rename(params.oldPath, params.newPath);
      case 'io.mkdir':
        return this.fileTransfer.mkdir(params.path);
      case 'io.rmdir':
        return this.fileTransfer.rmdir(params.path);
      case 'installAutostart':
        return this.installAutostart(params, 'autostart.install');
      case 'updateAutostart':
        return this.installAutostart(params, 'autostart.update');
      case 'autostartStatus':
      case 'statusAutostart':
        return this.autostartStatus(params);
      case 'removeAutostart':
        return this.removeAutostart(params);
      case 'startPreview':
        return this.startPreview(params);
      case 'stopPreview':
        return this.stopPreview();
      case 'getCapabilities':
        return this.capabilities;
      default:
        return this.requestAgent(method, params);
    }
  }

  ensureConnected() {
    if (!this.connected || !this.port || !this.port.isOpen || this.mode !== 'framed') {
      throw runtimeError(
        RUNTIME_ERROR_CODES.SESSION_CLOSED,
        'The linux-serial-shell session is closed',
      );
    }
  }

  async terminalInput(text = '') {
    if (typeof text !== 'string') throw new TypeError('terminal input must be a string');
    await this.sendFrame(TYPES.TERMINAL, Buffer.from(text, 'utf8'));
    return { accepted: true };
  }

  async resizeTerminal(columns, rows) {
    const params = {
      columns: requiredInteger(columns, 'columns', 1, 1000),
      rows: requiredInteger(rows, 'rows', 1, 1000),
    };
    return this.requestAgent('resize', params, { emitInjectedFrame: true });
  }

  async runScript({ script } = {}) {
    if (typeof script !== 'string') throw new TypeError('script must be a string');
    const scriptPath = `${this.sessionDirectory}/main.py`;
    return this.startRun(scriptPath, async () => {
      await this.fileTransfer.writeFile(scriptPath, Buffer.from(script, 'utf8'));
    });
  }

  async fileExec({ path } = {}) {
    const scriptPath = this.fileTransfer.validatePath(path);
    return this.startRun(scriptPath);
  }

  async startRun(scriptPath, prepare) {
    if (this.activeRun) {
      throw runtimeError(
        RUNTIME_ERROR_CODES.RUN_ALREADY_ACTIVE,
        'A script is already running on this serial session',
      );
    }
    const runId = randomUUID();
    const token = randomBytes(16).toString('hex');
    const run = {
      runId,
      token,
      starttime: null,
      lifecycle: 'starting',
    };
    this.activeRun = run;
    try {
      await prepare?.();
      const started = await this.requestAgent('run', {
        runId,
        token,
        scriptPath,
      });
      const metadata = {
        runId,
        token,
        pid: started.pid,
        pgid: started.pgid,
        starttime: String(started.starttime),
      };
      if (this.activeRun?.runId === runId) {
        Object.assign(this.activeRun, metadata);
        if (this.activeRun.lifecycle !== 'started') {
          this.activeRun.lifecycle = 'started';
          this.emitScriptState({ state: 'started', ...metadata });
        }
      }
      return {
        started: true,
        running: this.activeRun?.runId === runId,
        scriptPath,
        ...metadata,
      };
    } catch (error) {
      if (this.activeRun?.runId === runId) this.activeRun = null;
      throw normalizeRuntimeError(
        error,
        RUNTIME_ERROR_CODES.RUN_START_FAILED,
        'The script could not be started by the serial helper',
        { phase: 'run-start', retryable: true },
      );
    }
  }

  async stopScript() {
    const run = this.activeRun;
    if (!run) return { stopped: true, running: false };
    if (!run.starttime) {
      throw runtimeError(
        RUNTIME_ERROR_CODES.RUN_STOP_FAILED,
        'The active run has not reported a process start time',
      );
    }
    try {
      run.lifecycle = 'stopping';
      const result = await this.requestAgent('stop', {
        runId: run.runId,
        token: run.token,
        starttime: run.starttime,
      });
      if (this.activeRun?.runId === run.runId) this.activeRun = null;
      this.rememberCompletedRun(run.runId);
      this.emitScriptState({ state: 'stopped', runId: run.runId });
      return { stopped: true, running: false, runId: run.runId, ...result };
    } catch (error) {
      if (this.activeRun?.runId === run.runId) run.lifecycle = 'started';
      throw normalizeRuntimeError(
        error,
        RUNTIME_ERROR_CODES.RUN_STOP_FAILED,
        'The running process group could not be stopped safely',
        { phase: 'run-stop', retryable: true },
      );
    }
  }

  async installAutostart(params, action) {
    const project = params.project || params.projectId || 'project';
    if (this.capabilities.autostart !== 'boot-start-sh') {
      throw runtimeError(
        RUNTIME_ERROR_CODES.CAPABILITY_UNAVAILABLE,
        'The board does not expose the /boot/start autostart convention',
      );
    }
    const managed = getManagedAutostartPaths(project, this.capabilities.homeDirectory);
    const hasSource = params.script !== undefined;
    if (hasSource && typeof params.script !== 'string') {
      throw new TypeError('autostart script must be a string');
    }
    const scriptPath = hasSource
      ? managed.scriptPath
      : (params.scriptPath || managed.scriptPath);
    if (hasSource) {
      await this.requestAgent('file.mkdir', {
        path: managed.projectDirectory,
        recursive: true,
      });
      await this.fileTransfer.writeFile(scriptPath, Buffer.from(params.script, 'utf8'));
    }
    const content = renderBootStartScript({
      scriptPath,
      logPath: params.logPath || (scriptPath === managed.scriptPath ? managed.logPath : undefined),
      workingDirectory: params.workingDirectory
        || (scriptPath === managed.scriptPath ? managed.projectDirectory : undefined),
    });
    const result = await this.requestAgent(action, {
      project,
      dataBase64: Buffer.from(content, 'utf8').toString('base64'),
    });
    return {
      ...result,
      kind: 'boot-start-sh',
      scriptPath,
      path: result?.path || managed.bootScriptPath,
    };
  }

  autostartStatus(params) {
    const project = params.project || params.projectId || 'project';
    return this.requestAgent('autostart.status', { project });
  }

  removeAutostart(params) {
    const project = params.project || params.projectId || 'project';
    return this.requestAgent('autostart.remove', {
      project,
      path: getBootStartScriptPath(project),
    });
  }

  async startPreview(params = {}) {
    if (this.previewRunning) return { running: true };
    try {
      if (this.capabilities.preview.available !== true) {
        throw runtimeError(
          RUNTIME_ERROR_CODES.PREVIEW_UNAVAILABLE,
          'Camera preview is unavailable on this board',
          { details: { phase: 'preview-capability', retryable: false } },
        );
      }
      const result = await this.requestAgent('preview.start', {
        fps: params.fps,
        resolution: params.resolution,
      });
      this.previewRunning = true;
      this.emit('previewState', { running: true });
      return { running: true, ...result };
    } catch (error) {
      throw normalizeRuntimeError(
        error,
        RUNTIME_ERROR_CODES.PREVIEW_UNAVAILABLE,
        'Camera preview is unavailable through the serial helper',
        { phase: 'preview-start', retryable: false },
      );
    }
  }

  async stopPreview() {
    if (!this.previewRunning) {
      this.previewLimiter.clearPending();
      return { running: false };
    }
    try {
      await this.requestAgent('preview.stop', {});
    } finally {
      this.previewRunning = false;
      this.previewLimiter.clearPending();
      this.emit('previewState', { running: false });
    }
    return { running: false };
  }

  async requestAgent(action, params = {}, { emitInjectedFrame = false } = {}) {
    if (this.agentRequest) {
      if (emitInjectedFrame) {
        await this.sendJsonFrame(TYPES.CONTROL, { action, ...params });
      }
      return this.agentRequest(action, params);
    }
    return this.requestFramed(action, params);
  }

  async requestFramed(action, params = {}) {
    const id = String(this._requestSequence);
    const sequence = this._requestSequence;
    this._requestSequence = (this._requestSequence + 1) >>> 0 || 1;
    const pending = deferred();
    pending.timer = setTimeout(() => {
      this._pendingRequests.delete(id);
      pending.reject(runtimeError(
        RUNTIME_ERROR_CODES.PROTOCOL_DESYNC,
        `Serial helper request timed out: ${action}`,
        {
          details: {
            phase: action,
            retryable: true,
          },
        },
      ));
    }, this.requestTimeoutMs);
    this._pendingRequests.set(id, pending);
    const type = action.startsWith('file.') ? TYPES.FILE : TYPES.CONTROL;
    try {
      await this.sendJsonFrame(type, { id, action, ...params }, {
        sequence: Number.isInteger(params.sequence) ? params.sequence : sequence,
      });
    } catch (error) {
      clearTimeout(pending.timer);
      this._pendingRequests.delete(id);
      pending.reject(error);
    }
    return pending.promise;
  }

  sendJsonFrame(type, value, options) {
    return this.sendFrame(type, Buffer.from(JSON.stringify(value), 'utf8'), options);
  }

  sendFrame(type, payload, options = {}) {
    const frame = encodeFrame(type, payload, {
      magic: this.protocolMagic,
      flags: options.flags || 0,
      sequence: options.sequence || 0,
    });
    this._writeChain = this._writeChain.then(async () => {
      await callPort(this.port, 'write', frame);
      if (typeof this.port.drain === 'function') await callPort(this.port, 'drain');
    });
    return this._writeChain;
  }

  async writeRaw(data) {
    await callPort(this.port, 'write', Buffer.from(data));
    if (typeof this.port.drain === 'function') await callPort(this.port, 'drain');
  }

  async disconnect() {
    if (this._remoteDisconnectHandled || !this.port) {
      this.connected = false;
      this.connecting = false;
      return { connected: false, transport: 'serial-shell' };
    }
    this.disconnecting = true;
    this._remoteDisconnectHandled = true;
    const cleanupErrors = [];
    if (this.mode === 'framed' && this.port.isOpen) {
      if (this.previewRunning) {
        await this.stopPreview().catch(error => cleanupErrors.push(error));
      }
      if (this.activeRun) {
        await this.stopScript().catch(error => cleanupErrors.push(error));
      }
      await this.requestAgent('helper.shutdown', {}).catch(error => cleanupErrors.push(error));
    }
    this.rejectPendingWork(runtimeError(
      RUNTIME_ERROR_CODES.SESSION_CLOSED,
      'The linux-serial-shell session was closed',
    ));
    await this.closePort();
    this.connected = false;
    this.connecting = false;
    this.disconnecting = false;
    this.endpoint = null;
    this.mode = 'closed';
    this.activeRun = null;
    this.previewRunning = false;
    this.previewLimiter.clearPending();
    this.emit('disconnected');
    this.emit('state', 'disconnected');
    if (cleanupErrors.length > 0) this.emit('cleanupErrors', cleanupErrors);
    return { connected: false, transport: 'serial-shell' };
  }

  rejectPendingRequests(error) {
    for (const pending of this._pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pendingRequests.clear();
  }

  async closePort() {
    const port = this.port;
    this.detachPort();
    if (!port) return;
    if (port.isOpen) {
      try {
        await callPort(port, 'close');
      } catch {
        // USB removal can make close fail; local listener/state cleanup still completes.
      }
    }
  }
}

class LinuxSerialShellBackend extends EventEmitter {
  constructor({
    driver,
    driverFactory = options => new LinuxSerialShellDriver(options),
    ...driverOptions
  } = {}) {
    super();
    this.driver = driver || null;
    this.driverFactory = driverFactory;
    this.driverOptions = driverOptions;
    this._forwardedEvents = [];
    if (this.driver) this.forwardDriverEvents();
  }

  ensureDriver() {
    if (!this.driver) {
      this.driver = this.driverFactory(this.driverOptions);
      this.forwardDriverEvents();
    }
    return this.driver;
  }

  forwardDriverEvents() {
    for (const event of [
      'output',
      'frame',
      'state',
      'event',
      'previewState',
      'runtimeError',
      'disconnected',
    ]) {
      const listener = payload => this.emit(event, payload);
      this.driver.on?.(event, listener);
      this._forwardedEvents.push([event, listener]);
    }
  }

  async connect(options) {
    return this.ensureDriver().connect(options);
  }

  async request(method, params) {
    return this.ensureDriver().request(method, params);
  }

  async disconnect() {
    if (!this.driver) return { connected: false, transport: 'serial-shell' };
    const driver = this.driver;
    const result = await driver.disconnect();
    for (const [event, listener] of this._forwardedEvents) driver.off?.(event, listener);
    this._forwardedEvents = [];
    this.driver = null;
    return result;
  }
}

module.exports = {
  LinuxSerialShellBackend,
  LinuxSerialShellDriver,
};
