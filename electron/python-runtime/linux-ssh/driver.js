const { createHash, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { normalizeCapabilities } = require('../linux-shared/capabilities');
const {
  createLaunchPlan,
  requiredAbsolutePosixPath,
  sanitizeSessionPart,
  shellQuote,
  validateEndpoint,
} = require('../linux-shared/endpoint');
const { JpegStreamParser } = require('../linux-shared/jpeg-stream');
const {
  RUNTIME_ERROR_CODES,
  runtimeError,
} = require('../runtime-errors');

const CAPABILITY_PROBE_MARKER = '__AILY_CAPABILITY_PROBE__';
const SSH_FILE_CHUNK_SIZE = 48 * 1024;
const SSH_FILE_RETRY_LIMIT = 3;
const SSH_FILE_PROTOCOL_TIMEOUT_MS = 10000;
const SSH_FILE_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < SSH_FILE_CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  SSH_FILE_CRC_TABLE[index] = value >>> 0;
}
const DEFAULT_CAPABILITIES = Object.freeze({
  platform: 'linux',
  hostname: '',
  architecture: '',
  pythonVersion: '',
  homeDirectory: '',
  writableWorkspace: '/tmp/aily-runtime',
  pty: true,
  terminalResize: true,
  processGroups: true,
  files: 'none',
  autostart: 'none',
  preview: { available: false, transports: [] },
});

class MemoryKnownHostStore {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  async get(key) {
    return this.entries.get(key) || null;
  }

  async set(key, fingerprint) {
    this.entries.set(key, fingerprint);
  }
}

class JsonKnownHostStore {
  constructor(filePath = defaultKnownHostsPath()) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async get(key) {
    const entries = await this.read();
    return typeof entries[key] === 'string' ? entries[key] : null;
  }

  async set(key, fingerprint) {
    const operation = this.writeQueue.then(() => this.writeEntry(key, fingerprint));
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async writeEntry(key, fingerprint) {
    const entries = await this.read();
    entries[key] = fingerprint;
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      try {
        await fs.promises.rename(temporary, this.filePath);
      } catch (error) {
        if (error?.code !== 'EPERM' && error?.code !== 'EEXIST') throw error;
        await fs.promises.rm(this.filePath, { force: true });
        await fs.promises.rename(temporary, this.filePath);
      }
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async read() {
    try {
      const value = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    }
  }
}

class LinuxSshDriver extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = 'linux-ssh';
    this.clientFactory = options.clientFactory || (() => {
      const { Client } = require('ssh2');
      return new Client();
    });
    this.knownHostStore = options.knownHostStore || new JsonKnownHostStore(options.knownHostsPath);
    this.credentialProvider = options.credentialProvider || null;
    this.readLocalFile = options.readLocalFile || (filePath => fs.promises.readFile(filePath));
    this.hostKey = options.hostKey;
    this.defaultCols = options.defaultCols || 80;
    this.defaultRows = options.defaultRows || 24;
    this.terminationGraceMs = options.terminationGraceMs ?? 2000;
    this.runStartTimeoutMs = options.runStartTimeoutMs ?? 10000;
    this.fileProtocolTimeoutMs = options.fileProtocolTimeoutMs ?? SSH_FILE_PROTOCOL_TIMEOUT_MS;
    this.sessionId = sanitizeSessionPart(options.sessionId || randomUUID());
    this.client = null;
    this.endpoint = null;
    this.state = 'disconnected';
    this.capabilities = normalizeCapabilities(DEFAULT_CAPABILITIES);
    this.activeRun = null;
    this.runStartPromise = null;
    this.preview = null;
    this.previewStartPromise = null;
    this.sftp = undefined;
    this.connectionPromise = null;
  }

  status() {
    const boardInfo = this.endpoint ? {
      host: this.endpoint.host,
      port: this.endpoint.port,
      username: this.endpoint.username,
      hostname: this.capabilities.hostname,
      platform: this.capabilities.platform,
    } : null;
    return {
      state: this.state,
      connected: this.state === 'connected',
      transport: 'ssh',
      endpoint: this.endpoint ? { ...this.endpoint } : null,
      boardInfo,
      capabilities: this.capabilities,
    };
  }

  async connect(endpointValue = {}, credentials = {}) {
    if (this.state === 'connected' && this.client) return this.status();
    if (this.connectionPromise) return this.connectionPromise;

    const endpoint = validateEndpoint({
      kind: 'ssh',
      host: endpointValue.host,
      port: endpointValue.port ?? 22,
      username: endpointValue.username,
      credentialId: endpointValue.credentialId,
      privateKeyPath: endpointValue.privateKeyPath,
    });
    const resolvedCredentials = await this.resolveCredentials(endpoint, credentials);
    const hostId = `${endpoint.host}:${endpoint.port}`;
    const expectedFingerprint = credentials.hostKey
      || this.hostKey
      || await this.knownHostStore.get(hostId);
    let presentedFingerprint = null;
    let hostKeyChanged = false;

    this.state = 'connecting';
    this.emit('state', this.state);
    this.connectionPromise = new Promise((resolve, reject) => {
      const client = this.clientFactory();
      this.client = client;
      let settled = false;
      const fail = error => {
        if (settled) {
          this.emit('stderr', `${safeErrorText(error)}\n`);
          this.handleRemoteDisconnect(error);
          return;
        }
        settled = true;
        this.client = null;
        this.state = 'disconnected';
        this.emit('state', this.state);
        if (hostKeyChanged) {
          reject(runtimeError(
            RUNTIME_ERROR_CODES.HOST_KEY_CHANGED,
            'SSH host key changed',
            { details: { phase: 'host-key' } },
          ));
          return;
        }
        const code = /auth|permission denied|authentication/i.test(safeErrorText(error))
          ? RUNTIME_ERROR_CODES.AUTH_FAILED
          : RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE;
        reject(runtimeError(code, 'SSH connection failed', {
          cause: error,
          details: { phase: 'connect' },
        }));
      };

      client.once?.('ready', async () => {
        if (settled) return;
        try {
          if (!expectedFingerprint && presentedFingerprint) {
            await this.knownHostStore.set(hostId, presentedFingerprint);
          }
          this.endpoint = endpoint;
          this.state = 'connected';
          this.sftp = undefined;
          this.capabilities = await this.probeCapabilities();
          settled = true;
          this.emit('state', this.state);
          resolve(this.status());
        } catch (error) {
          fail(error);
        }
      });
      client.once?.('error', fail);
      client.once?.('end', () => this.handleRemoteDisconnect(
        runtimeError(RUNTIME_ERROR_CODES.SESSION_CLOSED, 'SSH session ended'),
      ));
      client.once?.('close', () => this.handleRemoteDisconnect(
        runtimeError(RUNTIME_ERROR_CODES.SESSION_CLOSED, 'SSH session closed'),
      ));

      try {
        client.connect({
          ...resolvedCredentials,
          host: endpoint.host,
          port: endpoint.port,
          username: endpoint.username,
          hostVerifier: key => {
            presentedFingerprint = fingerprintHostKey(key);
            hostKeyChanged = Boolean(
              expectedFingerprint
              && presentedFingerprint !== expectedFingerprint,
            );
            return !hostKeyChanged;
          },
        });
      } catch (error) {
        fail(error);
      }
    }).finally(() => {
      this.connectionPromise = null;
    });
    return this.connectionPromise;
  }

  async resolveCredentials(endpoint, credentials) {
    let resolved = {};
    const credentialId = credentials.credentialId || endpoint.credentialId;
    if (credentialId && this.credentialProvider?.resolve) {
      resolved = await this.credentialProvider.resolve(credentialId, {
        host: endpoint.host,
        port: endpoint.port,
        username: endpoint.username,
      }) || {};
    }
    resolved = { ...resolved, ...credentials };
    delete resolved.credentialId;
    delete resolved.hostKey;
    if (!resolved.privateKey && endpoint.privateKeyPath) {
      resolved.privateKey = await this.readLocalFile(endpoint.privateKeyPath);
    }
    return Object.fromEntries(
      Object.entries(resolved).filter(([, value]) => value !== undefined && value !== null),
    );
  }

  async probeCapabilities() {
    let probe = {};
    try {
      const output = await this.execCommand(createCapabilityProbeCommand());
      probe = JSON.parse(output.toString('utf8').trim());
    } catch (error) {
      this.emit('stderr', `[capability probe] ${safeErrorText(error)}\n`);
    }
    const pythonExecutable = requiredAbsolutePosixPath(
      probe.pythonExecutable,
      'probed python executable',
    );

    let files = 'agent';
    try {
      await this.getSftp();
      files = 'sftp';
    } catch (error) {
      if (!isSftpUnavailable(error)) throw error;
    }
    const previewBackend = ['rpicam', 'v4l2-ffmpeg', 'opencv'].includes(probe.previewBackend)
      ? probe.previewBackend
      : undefined;
    return {
      ...normalizeCapabilities({
      ...DEFAULT_CAPABILITIES,
      ...probe,
      files,
      pty: true,
      terminalResize: true,
      processGroups: true,
      preview: {
        available: Boolean(previewBackend),
        ...(previewBackend ? { backend: previewBackend } : {}),
        transports: previewBackend ? ['ssh-binary'] : [],
      },
      }),
      pythonExecutable,
    };
  }

  async disconnect() {
    await this.stopPreview().catch(error => this.emit('stderr', `${safeErrorText(error)}\n`));
    await this.stopScript().catch(error => this.emit('stderr', `${safeErrorText(error)}\n`));
    const client = this.client;
    this.client = null;
    this.endpoint = null;
    this.sftp = undefined;
    if (client) client.end?.();
    this.state = 'disconnected';
    this.emit('state', this.state);
  }

  async request(method, params = {}) {
    if (method === 'status') return this.status();
    this.ensureConnected();
    switch (method) {
      case 'runScript':
        return this.runScript(params);
      case 'stopScript':
        return this.stopScript();
      case 'scriptRunning':
        return { running: Boolean(this.activeRun) };
      case 'terminalInput':
        return this.terminalInput(params.text);
      case 'terminalSetSize':
        return this.terminalSetSize(params.columns, params.rows);
      case 'startPreview':
        return this.startPreview(params);
      case 'stopPreview':
        return this.stopPreview();
      case 'installAutostart':
        return this.installAutostart(params);
      case 'autostartStatus':
        return this.autostartStatus(params);
      case 'removeAutostart':
        return this.removeAutostart(params);
      case 'io.listDir':
        return this.fileOperation('listDir', params);
      case 'io.stat':
      case 'io.queryFileStat':
        return this.fileOperation('stat', params);
      case 'io.readFile':
        return this.fileOperation('readFile', params);
      case 'io.writeFile':
        return this.fileOperation('writeFile', params);
      case 'io.deleteFile':
        return this.fileOperation('deleteFile', params);
      case 'io.renameFile':
        return this.fileOperation('renameFile', params);
      case 'io.mkdir':
        return this.fileOperation('mkdir', params);
      case 'io.rmdir':
        return this.fileOperation('rmdir', params);
      case 'io.fileExec':
        return this.executeRemoteFile(params.path);
      default:
        throw runtimeError(
          RUNTIME_ERROR_CODES.CAPABILITY_UNAVAILABLE,
          `Unsupported linux-ssh request: ${method}`,
          { details: { operation: method } },
        );
    }
  }

  runScript(params = {}) {
    if (this.activeRun || this.runStartPromise) {
      throw runtimeError(RUNTIME_ERROR_CODES.RUN_ALREADY_ACTIVE, 'A script is already running');
    }
    const startPromise = this.startRun(params);
    this.runStartPromise = startPromise;
    const clearStartPromise = () => {
      if (this.runStartPromise === startPromise) this.runStartPromise = null;
    };
    startPromise.then(clearStartPromise, clearStartPromise);
    return startPromise;
  }

  async startRun(params = {}) {
    const script = requiredString(params.script, 'script', true);
    const runId = sanitizeSessionPart(params.runId || randomUUID());
    const plan = createLaunchPlan(
      this.sessionId,
      runId,
      this.capabilities.pythonExecutable,
    );
    await this.execCommand(`mkdir -p ${shellQuote(path.posix.dirname(plan.scriptPath))}`);
    await this.writeRemoteFileAtomic(plan.scriptPath, Buffer.from(script, 'utf8'));

    const columns = requiredInteger(params.columns ?? this.defaultCols, 'columns', 1, 1000);
    const rows = requiredInteger(params.rows ?? this.defaultRows, 'rows', 1, 1000);
    const channel = await this.execStream(plan.command, {
      pty: {
        term: 'xterm-256color',
        cols: columns,
        rows,
        width: 0,
        height: 0,
      },
    });
    const run = {
      ...plan,
      channel,
      started: false,
      buffer: '',
      metadata: null,
      stopping: false,
    };
    this.activeRun = run;
    channel.on('data', chunk => this.handleRunData(run, chunk));
    channel.stderr?.on('data', chunk => this.emit('stderr', Buffer.from(chunk).toString('utf8')));
    channel.once?.('error', error => this.finishRun(run, null, null, error));
    channel.once?.('close', (code, signal) => this.finishRun(run, code, signal));

    const metadata = await waitForControlStart(run, this.runStartTimeoutMs).catch(error => {
      if (this.activeRun === run) this.activeRun = null;
      channel.destroy?.();
      throw runtimeError(RUNTIME_ERROR_CODES.RUN_START_FAILED, 'Remote run did not start', {
        cause: error,
        details: { phase: 'start' },
      });
    });
    return { running: true, runId, pid: metadata.pid, pgid: metadata.pgid };
  }

  handleRunData(run, chunk) {
    if (this.activeRun !== run) return;
    if (run.started) {
      this.emitScriptOutput(Buffer.from(chunk).toString('utf8'), run.runId);
      return;
    }
    run.buffer += Buffer.from(chunk).toString('utf8');
    let newline;
    while ((newline = run.buffer.indexOf('\n')) >= 0) {
      const line = run.buffer.slice(0, newline).replace(/\r$/, '');
      run.buffer = run.buffer.slice(newline + 1);
      if (line.startsWith(run.controlNonce)) {
        try {
          const control = JSON.parse(line.slice(run.controlNonce.length));
          if (
            control.type !== 'started'
            || control.runId !== run.runId
            || control.token !== run.token
            || !Number.isInteger(control.pid)
            || !Number.isInteger(control.pgid)
            || typeof control.starttime !== 'string'
          ) {
            throw new Error('invalid run control record');
          }
          run.metadata = control;
          run.started = true;
          run.resolveStarted?.(control);
          if (run.buffer) {
            this.emitScriptOutput(run.buffer, run.runId);
            run.buffer = '';
          }
        } catch (error) {
          run.rejectStarted?.(error);
        }
      } else if (line) {
        this.emitScriptOutput(`${line}\n`, run.runId);
      }
    }
  }

  emitScriptOutput(text, runId) {
    if (!text) return;
    this.emit('output', text);
    this.emit('event', {
      event: 'scriptOutput',
      params: { text, runId },
    });
  }

  finishRun(run, code, signal, error) {
    if (this.activeRun !== run) return;
    if (!run.started) run.rejectStarted?.(error || new Error('run channel closed before start'));
    this.activeRun = null;
    this.emit('event', {
      event: 'scriptExited',
      params: {
        runId: run.runId,
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
      },
    });
    if (error) this.emit('stderr', `${safeErrorText(error)}\n`);
  }

  async terminalInput(text) {
    const value = requiredString(text, 'terminal text', true);
    const run = this.requireRun();
    run.channel.write(value);
    return { accepted: true };
  }

  async terminalSetSize(columns, rows) {
    const width = requiredInteger(columns, 'columns', 1, 1000);
    const height = requiredInteger(rows, 'rows', 1, 1000);
    const run = this.requireRun();
    run.channel.setWindow?.(height, width, 0, 0);
    return { columns: width, rows: height };
  }

  async stopScript() {
    const run = this.activeRun;
    if (!run) return { running: false };
    if (run.stopping) return { running: true, stopping: true };
    if (!run.metadata) {
      throw runtimeError(RUNTIME_ERROR_CODES.RUN_STOP_FAILED, 'Run control state is unavailable');
    }
    run.stopping = true;
    try {
      await this.execCommand(createSafeStopCommand({
        controlPath: run.controlPath,
        token: run.token,
        starttime: run.metadata.starttime,
        graceMs: this.terminationGraceMs,
        label: 'run',
        pythonExecutable: this.capabilities.pythonExecutable,
      }));
      run.channel.end?.();
      run.channel.destroy?.();
      if (this.activeRun === run) this.activeRun = null;
      return { running: false };
    } catch (error) {
      run.stopping = false;
      throw runtimeError(RUNTIME_ERROR_CODES.RUN_STOP_FAILED, 'Run could not be stopped safely', {
        cause: error,
        details: { phase: 'stop' },
      });
    }
  }

  requireRun() {
    if (!this.activeRun || !this.activeRun.started) {
      throw runtimeError(RUNTIME_ERROR_CODES.SESSION_CLOSED, 'No active PTY run');
    }
    return this.activeRun;
  }

  async fileOperation(operation, params = {}) {
    const normalized = normalizeFileParams(operation, params);
    try {
      const sftp = await this.getSftp();
      return await this.sftpOperation(sftp, operation, normalized);
    } catch (error) {
      if (!isSftpUnavailable(error)) {
        throw runtimeError(RUNTIME_ERROR_CODES.FILE_TRANSFER_FAILED, 'SFTP operation failed', {
          cause: error,
          details: { operation },
        });
      }
      return this.standardLibraryOperation(operation, normalized);
    }
  }

  async sftpOperation(sftp, operation, params) {
    switch (operation) {
      case 'listDir': {
        const entries = await callSftp(sftp, 'readdir', params.path);
        return {
          entries: entries.map(entry => ({
            name: entry.filename,
            type: isDirectoryAttrs(entry.attrs) ? 'directory' : 'file',
            size: Number.isFinite(entry.attrs?.size) ? entry.attrs.size : 0,
            mtime: Number.isFinite(entry.attrs?.mtime) ? entry.attrs.mtime : undefined,
          })),
        };
      }
      case 'stat':
        return { stat: normalizeStat(await callSftp(sftp, 'stat', params.path)) };
      case 'readFile':
        return { dataBase64: (await readSftpFile(sftp, params.path)).toString('base64') };
      case 'writeFile':
        await writeSftpFileAtomic(sftp, params.path, Buffer.from(params.dataBase64, 'base64'));
        return { written: true };
      case 'deleteFile':
        await callSftp(sftp, 'unlink', params.path);
        return { deleted: true };
      case 'renameFile':
        await callSftp(sftp, 'rename', params.oldPath, params.newPath);
        return { renamed: true };
      case 'mkdir':
        await this.ensureRemoteDirectory(params.path);
        return { created: true };
      case 'rmdir':
        await callSftp(sftp, 'rmdir', params.path);
        return { removed: true };
      default:
        throw new TypeError(`Unsupported SFTP operation: ${operation}`);
    }
  }

  async writeRemoteFileAtomic(filePath, data) {
    try {
      const sftp = await this.getSftp();
      await this.ensureRemoteDirectory(path.posix.dirname(filePath));
      await writeSftpFileAtomic(sftp, filePath, data);
    } catch (error) {
      if (!isSftpUnavailable(error)) throw error;
      await this.standardLibraryOperation('writeFile', {
        path: filePath,
        dataBase64: data.toString('base64'),
      });
    }
  }

  async ensureRemoteDirectory(directoryPath) {
    await this.execCommand(`mkdir -p ${shellQuote(requiredRemotePath(directoryPath))}`);
  }

  async getSftp() {
    if (this.sftp !== undefined) {
      if (this.sftp === null) throw sftpUnavailableError();
      return this.sftp;
    }
    try {
      this.sftp = await new Promise((resolve, reject) => {
        if (typeof this.client?.sftp !== 'function') {
          reject(sftpUnavailableError());
          return;
        }
        this.client.sftp((error, sftp) => error ? reject(error) : resolve(sftp));
      });
      return this.sftp;
    } catch (error) {
      if (isSftpUnavailable(error)) this.sftp = null;
      throw error;
    }
  }

  async standardLibraryOperation(operation, params) {
    try {
      if (operation === 'writeFile') return await this.standardLibraryWriteFile(params);
      if (operation === 'readFile') return await this.standardLibraryReadFile(params);
      const protocol = await this.openStandardLibraryFileProtocol({ operation, ...params });
      const result = await protocol.readMessage();
      assertFileProtocolMessage(result, 'result');
      await protocol.waitForClose();
      return result;
    } catch (error) {
      throw runtimeError(RUNTIME_ERROR_CODES.FILE_TRANSFER_FAILED, 'Remote file helper failed', {
        cause: error,
        details: { operation },
      });
    }
  }

  async standardLibraryWriteFile(params) {
    const data = Buffer.from(params.dataBase64, 'base64');
    const digest = sha256(data);
    const chunks = Math.ceil(data.length / SSH_FILE_CHUNK_SIZE);
    const transferId = randomUUID();
    const protocol = await this.openStandardLibraryFileProtocol({
      operation: 'writeFile',
      transferId,
      path: params.path,
      length: data.length,
      chunks,
      sha256: digest,
      chunkSize: SSH_FILE_CHUNK_SIZE,
      retryLimit: SSH_FILE_RETRY_LIMIT,
    });
    try {
      const ready = await protocol.readMessage();
      assertFileProtocolMessage(ready, 'ready', 'writeFile');
      if (ready.chunkSize !== SSH_FILE_CHUNK_SIZE || ready.retryLimit !== SSH_FILE_RETRY_LIMIT) {
        throw new Error('remote file helper negotiated unsupported limits');
      }

      for (let sequence = 0; sequence < chunks; sequence += 1) {
        const chunk = data.subarray(
          sequence * SSH_FILE_CHUNK_SIZE,
          Math.min(data.length, (sequence + 1) * SSH_FILE_CHUNK_SIZE),
        );
        const checksum = crc32(chunk);
        const chunkId = fileChunkId(transferId, sequence);
        await retryFileChunk(async attempt => {
          protocol.writeMessage({
            type: 'chunk',
            transferId,
            chunkId,
            attempt,
            sequence,
            length: chunk.length,
            crc32: checksum,
            dataBase64: chunk.toString('base64'),
          });
          const acknowledgement = await readExpectedFileProtocolMessage(
            protocol,
            'ack',
            { transferId, chunkId, attempt },
          );
          assertFileProtocolMessage(acknowledgement, 'ack');
          if (
            acknowledgement.ok !== true
            || acknowledgement.sequence !== sequence
            || acknowledgement.crc32 !== checksum
          ) {
            throw new Error(acknowledgement.reason || `chunk ${sequence} was not acknowledged`);
          }
        });
      }

      protocol.writeMessage({
        type: 'commit',
        length: data.length,
        chunks,
        sha256: digest,
      });
      const result = await readExpectedFileProtocolMessage(protocol, 'result', { transferId });
      assertFileProtocolMessage(result, 'result');
      if (
        result.written !== true
        || result.length !== data.length
        || result.sha256 !== digest
      ) {
        throw new Error('remote file verification failed after commit');
      }
      await protocol.waitForClose();
      return result;
    } catch (error) {
      protocol.destroy();
      throw error;
    }
  }

  async standardLibraryReadFile(params) {
    const transferId = randomUUID();
    const protocol = await this.openStandardLibraryFileProtocol({
      operation: 'readFile',
      transferId,
      path: params.path,
      chunkSize: SSH_FILE_CHUNK_SIZE,
      retryLimit: SSH_FILE_RETRY_LIMIT,
    });
    try {
      const ready = await protocol.readMessage();
      assertFileProtocolMessage(ready, 'ready', 'readFile');
      if (
        !Number.isInteger(ready.length)
        || ready.length < 0
        || !Number.isInteger(ready.chunks)
        || ready.chunks < 0
        || typeof ready.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(ready.sha256)
        || ready.chunkSize !== SSH_FILE_CHUNK_SIZE
        || ready.retryLimit !== SSH_FILE_RETRY_LIMIT
        || ready.chunks !== Math.ceil(ready.length / SSH_FILE_CHUNK_SIZE)
      ) {
        throw new Error('invalid remote file metadata');
      }

      const chunks = [];
      for (let sequence = 0; sequence < ready.chunks; sequence += 1) {
        let accepted = null;
        let lastError;
        const chunkId = fileChunkId(transferId, sequence);
        for (let attempt = 0; attempt <= SSH_FILE_RETRY_LIMIT; attempt += 1) {
          let message;
          try {
            message = await readExpectedFileProtocolMessage(
              protocol,
              'chunk',
              { transferId, chunkId, attempt },
            );
            assertFileProtocolMessage(message, 'chunk');
            if (message.sequence !== sequence || typeof message.dataBase64 !== 'string') {
              throw new Error(`unexpected file chunk sequence ${message.sequence}`);
            }
            const chunk = Buffer.from(message.dataBase64, 'base64');
            if (
              !Number.isInteger(message.length)
              || message.length !== chunk.length
              || chunk.length > SSH_FILE_CHUNK_SIZE
              || message.crc32 !== crc32(chunk)
            ) {
              throw new Error(`file chunk ${sequence} failed length or CRC validation`);
            }
            protocol.writeMessage({
              type: 'ack',
              ok: true,
              transferId,
              chunkId,
              attempt,
              sequence,
              crc32: message.crc32,
            });
            accepted = chunk;
            break;
          } catch (error) {
            lastError = error;
            protocol.writeMessage({
              type: 'ack',
              ok: false,
              transferId,
              chunkId,
              attempt,
              sequence: Number.isInteger(message?.sequence) ? message.sequence : sequence,
              reason: safeErrorText(error),
            });
          }
        }
        if (!accepted) throw lastError || new Error(`file chunk ${sequence} was not received`);
        chunks.push(accepted);
      }

      const result = await readExpectedFileProtocolMessage(protocol, 'result', { transferId });
      assertFileProtocolMessage(result, 'result');
      const data = Buffer.concat(chunks);
      const digest = sha256(data);
      if (
        data.length !== ready.length
        || digest !== ready.sha256
        || result.length !== ready.length
        || result.sha256 !== ready.sha256
      ) {
        throw new Error('remote file length or SHA-256 mismatch');
      }
      await protocol.waitForClose();
      return {
        dataBase64: data.toString('base64'),
        length: data.length,
        sha256: digest,
        chunks: chunks.length,
      };
    } catch (error) {
      protocol.destroy();
      throw error;
    }
  }

  async openStandardLibraryFileProtocol(request) {
    const protocolMarker = `__AILY_FILE_V1_${randomUUID().replace(/-/g, '')}__`;
    const source = createPythonFileHelperSource(request, protocolMarker);
    const command = pythonSourceCommand(
      source,
      '<aily-file-helper>',
      this.capabilities.pythonExecutable,
    );
    const stream = await this.execStream(command, { pty: false });
    return new SshFileProtocol(stream, protocolMarker, this.fileProtocolTimeoutMs);
  }

  async executeRemoteFile(filePath) {
    const remotePath = requiredRemotePath(filePath);
    const run = await this.runScript({
      script: `exec(compile(open(${JSON.stringify(remotePath)}, "rb").read(), ${JSON.stringify(remotePath)}, "exec"))`,
    });
    return { started: true, ...run };
  }

  async installAutostart(params = {}) {
    const projectId = managedProjectId(params.projectId);
    const kind = this.capabilities.autostart;
    if (kind === 'none') {
      throw runtimeError(RUNTIME_ERROR_CODES.CAPABILITY_UNAVAILABLE, 'Autostart is unavailable');
    }
    const locations = this.autostartLocations(projectId);
    const script = params.script === undefined
      ? null
      : requiredString(params.script, 'script', true);
    if (script !== null) {
      await this.execCommand(`mkdir -p ${shellQuote(locations.projectDirectory)}`);
      await this.writeRemoteFileAtomic(locations.scriptPath, Buffer.from(script, 'utf8'));
    }
    if (kind === 'systemd') {
      const unit = renderManagedSystemdUnit(
        projectId,
        locations.scriptPath,
        locations.projectDirectory,
        this.capabilities.pythonExecutable,
      );
      await this.writeRemoteFileAtomic(locations.stagedUnitPath, Buffer.from(unit, 'utf8'));
      try {
        await this.execCommand([
          `sudo -n install -m 0644 ${shellQuote(locations.stagedUnitPath)} ${shellQuote(locations.unitPath)}`,
          'sudo -n systemctl daemon-reload',
          `sudo -n systemctl enable --now ${shellQuote(locations.unitName)}`,
        ].join(' && '));
      } catch (error) {
        await this.rollbackManagedSystemdInstall(locations);
        throw runtimeError(
          RUNTIME_ERROR_CODES.AUTOSTART_PERMISSION_DENIED,
          'systemd autostart installation was denied',
          { cause: error, details: { operation: 'installAutostart' } },
        );
      }
    } else {
      await this.execCommand('mkdir -p /boot/start');
      await this.writeRemoteFileAtomic(
        locations.bootScriptPath,
        Buffer.from(
          renderManagedBootScript(locations, this.capabilities.pythonExecutable),
          'utf8',
        ),
      );
      await this.execCommand(`chmod 0755 ${shellQuote(locations.bootScriptPath)}`);
    }
    return { installed: true, kind, scriptPath: locations.scriptPath };
  }

  async autostartStatus(params = {}) {
    const projectId = managedProjectId(params.projectId);
    const kind = this.capabilities.autostart;
    const locations = this.autostartLocations(projectId);
    if (kind === 'systemd') {
      const output = await this.execCommand(
        `sudo -n systemctl is-enabled ${shellQuote(locations.unitName)} 2>/dev/null; `
        + `sudo -n systemctl is-active ${shellQuote(locations.unitName)} 2>/dev/null`,
        { allowNonZero: true },
      );
      const lines = output.toString('utf8').trim().split(/\r?\n/);
      return {
        kind,
        installed: lines.includes('enabled'),
        running: lines.includes('active'),
        unitName: locations.unitName,
      };
    }
    if (kind === 'boot-start-sh') {
      const output = await this.execCommand(
        `test -f ${shellQuote(locations.bootScriptPath)} && printf installed || printf missing`,
        { allowNonZero: true },
      );
      return {
        kind,
        installed: output.toString('utf8').includes('installed'),
        running: null,
        path: locations.bootScriptPath,
      };
    }
    return { kind: 'none', installed: false, running: false };
  }

  async removeAutostart(params = {}) {
    const projectId = managedProjectId(params.projectId);
    const kind = this.capabilities.autostart;
    const locations = this.autostartLocations(projectId);
    if (kind === 'systemd') {
      await this.execCommand([
        `sudo -n systemctl disable --now ${shellQuote(locations.unitName)} 2>/dev/null || true`,
        `sudo -n rm -f ${shellQuote(locations.unitPath)}`,
        'sudo -n systemctl daemon-reload',
      ].join(' && '));
    } else if (kind === 'boot-start-sh') {
      await this.execCommand(`rm -f ${shellQuote(locations.bootScriptPath)}`);
    }
    return { removed: true, kind };
  }

  async rollbackManagedSystemdInstall(locations) {
    const commands = [
      `sudo -n systemctl disable --now ${shellQuote(locations.unitName)} 2>/dev/null || true`,
      `sudo -n rm -f ${shellQuote(locations.unitPath)}`,
      `rm -f ${shellQuote(locations.stagedUnitPath)}`,
      'sudo -n systemctl daemon-reload',
    ];
    for (const command of commands) {
      try {
        await this.execCommand(command, { allowNonZero: true });
      } catch {
        // Best-effort rollback must continue even if one cleanup step fails.
      }
    }
  }

  autostartLocations(projectId) {
    const workspace = requiredRemotePath(
      this.capabilities.writableWorkspace || '/tmp/aily-runtime',
    );
    const projectDirectory = path.posix.join(workspace, projectId);
    const unitName = `aily-${projectId}.service`;
    return {
      projectDirectory,
      scriptPath: path.posix.join(projectDirectory, 'main.py'),
      logPath: path.posix.join(projectDirectory, 'autostart.log'),
      stagedUnitPath: path.posix.join(projectDirectory, `.${unitName}.tmp`),
      unitName,
      unitPath: `/etc/systemd/system/${unitName}`,
      bootScriptPath: `/boot/start/aily-${projectId}.sh`,
    };
  }

  startPreview(params = {}) {
    if (!this.capabilities.preview.available || !this.capabilities.preview.backend) {
      throw runtimeError(RUNTIME_ERROR_CODES.PREVIEW_UNAVAILABLE, 'Camera preview is unavailable');
    }
    if (this.previewStartPromise) return this.previewStartPromise;
    const startPromise = this.startPreviewProcess(params);
    this.previewStartPromise = startPromise;
    const clearStartPromise = () => {
      if (this.previewStartPromise === startPromise) this.previewStartPromise = null;
    };
    startPromise.then(clearStartPromise, clearStartPromise);
    return startPromise;
  }

  async startPreviewProcess(params = {}) {
    await this.stopPreview();
    const plan = createPreviewLaunchPlan(
      this.sessionId,
      this.capabilities.preview.backend,
      params,
      this.capabilities.pythonExecutable,
    );
    const channel = await this.execStream(plan.command, { pty: false });
    const preview = {
      ...plan,
      channel,
      started: false,
      buffer: Buffer.alloc(0),
      parser: new JpegStreamParser({ maxFrameBytes: params.maxFrameBytes }),
      metadata: null,
    };
    this.preview = preview;
    preview.parser.on('frame', data => this.emit('frame', { data }));
    channel.on('data', chunk => this.handlePreviewData(preview, chunk));
    channel.stderr?.on('data', chunk => this.emit('stderr', Buffer.from(chunk).toString('utf8')));
    channel.once?.('error', error => preview.rejectStarted?.(error));
    channel.once?.('close', () => {
      if (this.preview === preview) {
        this.preview = null;
        this.emit('event', { event: 'previewState', params: { running: false } });
      }
    });
    const metadata = await waitForControlStart(preview, this.runStartTimeoutMs).catch(error => {
      if (this.preview === preview) this.preview = null;
      channel.destroy?.();
      throw runtimeError(RUNTIME_ERROR_CODES.PREVIEW_UNAVAILABLE, 'Preview did not start', {
        cause: error,
        details: { phase: 'start' },
      });
    });
    this.emit('event', { event: 'previewState', params: { running: true } });
    return { running: true, backend: plan.backend, pgid: metadata.pgid };
  }

  handlePreviewData(preview, chunk) {
    if (this.preview !== preview) return;
    const data = Buffer.from(chunk);
    if (preview.started) {
      preview.parser.push(data);
      return;
    }
    preview.buffer = Buffer.concat([preview.buffer, data]);
    const newline = preview.buffer.indexOf(0x0a);
    if (newline < 0) return;
    const line = preview.buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
    const remainder = preview.buffer.subarray(newline + 1);
    if (!line.startsWith(preview.controlNonce)) {
      preview.rejectStarted?.(new Error('invalid preview control record'));
      return;
    }
    try {
      const control = JSON.parse(line.slice(preview.controlNonce.length));
      if (
        control.type !== 'started'
        || control.token !== preview.token
        || control.runId !== preview.runId
        || !Number.isInteger(control.pgid)
        || typeof control.starttime !== 'string'
      ) {
        throw new Error('invalid preview control record');
      }
      preview.metadata = control;
      preview.started = true;
      preview.buffer = Buffer.alloc(0);
      preview.resolveStarted?.(control);
      if (remainder.length) preview.parser.push(remainder);
    } catch (error) {
      preview.rejectStarted?.(error);
    }
  }

  async stopPreview() {
    const preview = this.preview;
    if (!preview) return { running: false };
    this.preview = null;
    try {
      if (preview.metadata) {
        await this.execCommand(createSafeStopCommand({
          controlPath: preview.controlPath,
          token: preview.token,
          starttime: preview.metadata.starttime,
          graceMs: this.terminationGraceMs,
          label: 'preview',
          pythonExecutable: this.capabilities.pythonExecutable,
        }));
      }
    } finally {
      preview.channel.end?.();
      preview.channel.destroy?.();
      this.emit('event', { event: 'previewState', params: { running: false } });
    }
    return { running: false };
  }

  async execStream(command, options = { pty: false }) {
    this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.client.exec(command, options, (error, stream) => {
        if (error) {
          reject(runtimeError(RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE, 'SSH exec failed', {
            cause: error,
            details: { phase: 'exec' },
          }));
          return;
        }
        resolve(stream);
      });
    });
  }

  async execCommand(command, options = {}) {
    const stream = await this.execStream(command, { pty: false });
    return new Promise((resolve, reject) => {
      const stdout = [];
      const stderr = [];
      stream.on('data', chunk => stdout.push(Buffer.from(chunk)));
      stream.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
      stream.once?.('error', reject);
      stream.once?.('close', code => {
        if (!options.allowNonZero && Number.isInteger(code) && code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString('utf8') || `Remote command exited with ${code}`));
          return;
        }
        resolve(Buffer.concat(stdout));
      });
    });
  }

  ensureConnected() {
    if (this.state !== 'connected' || !this.client) {
      throw runtimeError(RUNTIME_ERROR_CODES.SESSION_CLOSED, 'SSH runtime is not connected');
    }
  }

  handleRemoteDisconnect(error) {
    if (this.state === 'disconnected') return;
    this.client = null;
    this.endpoint = null;
    this.sftp = undefined;
    this.activeRun = null;
    this.preview = null;
    this.state = 'disconnected';
    this.emit('state', this.state);
    this.emit('event', {
      event: 'boardDisconnected',
      params: { reason: error?.code || 'SSH_CLOSED' },
    });
  }
}

class SshFileProtocol {
  constructor(stream, marker, timeoutMs) {
    this.stream = stream;
    this.marker = marker;
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.messages = [];
    this.waiters = [];
    this.stderr = [];
    this.failure = null;
    this.closed = false;
    this.closeRecord = null;
    this.closeCompletion = new Promise(resolve => {
      this.resolveClose = resolve;
    });
    stream.on('data', chunk => this.handleData(chunk));
    stream.stderr?.on('data', chunk => this.stderr.push(Buffer.from(chunk)));
    stream.once?.('error', error => this.fail(error));
    stream.once?.('close', code => this.handleClose(code));
  }

  handleData(chunk) {
    if (this.failure) return;
    this.buffer += Buffer.from(chunk).toString('utf8');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      const markerIndex = line.indexOf(this.marker);
      if (markerIndex < 0) continue;
      try {
        const message = JSON.parse(line.slice(markerIndex + this.marker.length));
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          throw new Error('file protocol message must be an object');
        }
        this.enqueue(message);
      } catch (error) {
        this.fail(new Error(`invalid remote file protocol message: ${safeErrorText(error)}`));
        this.stream.destroy?.();
        return;
      }
    }
  }

  enqueue(message) {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      this.messages.push(message);
    }
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(safeErrorText(error));
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
    this.finishClose({ error: this.failure });
  }

  handleClose(code) {
    this.closed = true;
    let error = null;
    if (Number.isInteger(code) && code !== 0) {
      error = new Error(
        Buffer.concat(this.stderr).toString('utf8') || `Remote file helper exited with ${code}`,
      );
      this.failure ||= error;
    }
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(this.failure || new Error('Remote file helper closed before replying'));
    }
    this.finishClose({ code, error: this.failure || error });
  }

  finishClose(record) {
    if (this.closeRecord) return;
    this.closeRecord = record;
    this.resolveClose(record);
  }

  readMessage() {
    if (this.messages.length > 0) return Promise.resolve(this.messages.shift());
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('Remote file helper is closed'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Remote file protocol response timeout'));
      }, this.timeoutMs);
      waiter.timer.unref?.();
      this.waiters.push(waiter);
    });
  }

  writeMessage(message) {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('Remote file helper is closed');
    this.stream.write(`${JSON.stringify(message)}\n`);
  }

  async waitForClose() {
    const record = await promiseWithTimeout(
      this.closeCompletion,
      this.timeoutMs,
      'Remote file helper close timeout',
    );
    if (record.error) throw record.error;
  }

  destroy() {
    this.stream.end?.();
    this.stream.destroy?.();
  }
}

function waitForControlStart(record, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('control start timeout'));
    }, timeoutMs);
    record.resolveStarted = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    record.rejectStarted = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
  });
}

function createCapabilityProbeCommand() {
  const source = [
    'import json,os,platform,shutil,sys',
    'model=""',
    'try:',
    ' model=open("/proc/device-tree/model","r",encoding="utf-8").read().strip("\\x00")',
    'except Exception:',
    ' pass',
    'lower=model.lower()',
    'platform_id="raspberry-pi" if "raspberry pi" in lower else ("walnutpi" if "walnut" in lower else "linux")',
    'home=os.path.expanduser("~")',
    'workspace="/data/aily" if os.path.isdir("/data") and os.access("/data",os.W_OK) else os.path.join(home,".aily")',
    'autostart="boot-start-sh" if os.path.isdir("/boot/start") else ("systemd" if shutil.which("systemctl") and os.path.isdir("/run/systemd/system") else "none")',
    'preview=None',
    'if shutil.which("rpicam-vid") or shutil.which("libcamera-vid"): preview="rpicam"',
    'elif shutil.which("ffmpeg") and os.path.exists("/dev/video0"): preview="v4l2-ffmpeg"',
    'else:',
    ' try:',
    '  import cv2',
    '  preview="opencv"',
    ' except Exception:',
    '  pass',
    `print(${JSON.stringify(CAPABILITY_PROBE_MARKER)},file=sys.stderr)`,
    'print(json.dumps({"platform":platform_id,"hostname":platform.node(),"architecture":platform.machine(),"pythonVersion":platform.python_version(),"pythonExecutable":os.environ["AILY_PYTHON_EXECUTABLE"],"homeDirectory":home,"writableWorkspace":workspace,"autostart":autostart,"previewBackend":preview},separators=(",",":")))',
  ].join('\n');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  const command = shellQuote(
    `import base64;exec(compile(base64.b64decode('${encoded}'),'<aily-capabilities>','exec'))`,
  );
  return `python_executable=$(command -v python3) && case "$python_executable" in /*) ;; *) exit 127 ;; esac && AILY_PYTHON_EXECUTABLE="$python_executable" "$python_executable" -u -c ${command} # ${CAPABILITY_PROBE_MARKER}`;
}

function createSafeStopCommand({
  controlPath,
  token,
  starttime,
  graceMs,
  label,
  pythonExecutable,
}) {
  const source = [
    'import json,os,signal,sys,time',
    `control_path=${JSON.stringify(controlPath)}`,
    `expected_token=${JSON.stringify(token)}`,
    `expected_starttime=${JSON.stringify(String(starttime))}`,
    `grace=${Math.max(0, Number(graceMs) || 0) / 1000}`,
    'with open(control_path,"r",encoding="utf-8") as control_file:',
    ' state=json.load(control_file)',
    'pid=int(state["pid"]); pgid=int(state["pgid"])',
    'if state.get("token")!=expected_token or str(state.get("starttime"))!=expected_starttime:',
    ' raise SystemExit("stale control token")',
    'try:',
    ' current=open("/proc/%d/stat"%pid,"r",encoding="utf-8").read().rsplit(")",1)[1].split()[19]',
    'except Exception:',
    ' print(json.dumps({"ok":True,"alreadyExited":True})); raise SystemExit(0)',
    'if current!=expected_starttime:',
    ' raise SystemExit("stale process starttime")',
    'os.killpg(pgid,signal.SIGTERM)',
    'deadline=time.monotonic()+grace',
    'while time.monotonic()<deadline:',
    ' try:',
    '  os.killpg(pgid,0)',
    ' except ProcessLookupError:',
    '  print(json.dumps({"ok":True,"signal":"SIGTERM"})); raise SystemExit(0)',
    ' time.sleep(0.05)',
    'try:',
    ' os.killpg(pgid,signal.SIGKILL)',
    'except ProcessLookupError:',
    ' pass',
    'print(json.dumps({"ok":True,"signal":"SIGKILL"}))',
  ].join('\n');
  return `${pythonSourceCommand(source, '<aily-stop>', pythonExecutable)} # aily-${label} SIGTERM SIGKILL starttime=${starttime}`;
}

function createPreviewLaunchPlan(sessionId, backend, params = {}, pythonExecutable) {
  const runId = `preview-${sanitizeSessionPart(randomUUID())}`;
  const token = randomUUID();
  const controlNonce = randomUUID();
  const controlPath = `/tmp/aily-runtime/${sanitizeSessionPart(sessionId)}/${runId}.json`;
  const previewCommand = previewBackendCommand(backend, params, pythonExecutable);
  const source = [
    'import json,os,sys',
    `control_path=${JSON.stringify(controlPath)}`,
    `token=${JSON.stringify(token)}`,
    `run_id=${JSON.stringify(runId)}`,
    `control_nonce=${JSON.stringify(controlNonce)}`,
    `preview_command=${JSON.stringify(previewCommand)}`,
    'os.makedirs(os.path.dirname(control_path),exist_ok=True)',
    'try:',
    ' os.setsid()',
    'except PermissionError:',
    ' pass',
    'pid=os.getpid(); pgid=os.getpgid(0)',
    'starttime=open("/proc/%d/stat"%pid,"r",encoding="utf-8").read().rsplit(")",1)[1].split()[19]',
    'state={"pid":pid,"pgid":pgid,"token":token,"starttime":starttime,"runId":run_id}',
    'temporary=control_path+".tmp-"+token',
    'with open(temporary,"w",encoding="utf-8") as control_file:',
    ' json.dump(state,control_file,separators=(",",":")); control_file.flush(); os.fsync(control_file.fileno())',
    'os.replace(temporary,control_path)',
    'print(control_nonce+json.dumps({"type":"started",**state},separators=(",",":")),flush=True)',
    'os.execv("/bin/sh",["sh","-c",preview_command])',
  ].join('\n');
  return {
    backend,
    runId,
    token,
    controlNonce,
    controlPath,
    command: `${pythonSourceCommand(source, '<aily-preview>', pythonExecutable)} # <aily-preview>`,
  };
}

function previewBackendCommand(backend, params, pythonExecutable) {
  const width = requiredInteger(params.resolution?.w ?? params.width ?? 320, 'preview width', 1, 4096);
  const height = requiredInteger(params.resolution?.h ?? params.height ?? 240, 'preview height', 1, 4096);
  const fps = requiredInteger(params.fps ?? 5, 'preview fps', 1, 30);
  if (backend === 'rpicam') {
    return `if command -v rpicam-vid >/dev/null 2>&1; then exec rpicam-vid --codec mjpeg --width ${width} --height ${height} --framerate ${fps} -t 0 -o -; else exec libcamera-vid --codec mjpeg --width ${width} --height ${height} --framerate ${fps} -t 0 -o -; fi`;
  }
  if (backend === 'v4l2-ffmpeg') {
    return `exec ffmpeg -loglevel error -f v4l2 -framerate ${fps} -video_size ${width}x${height} -i /dev/video0 -f image2pipe -vcodec mjpeg -`;
  }
  const source = [
    'import cv2,sys,time',
    'cap=cv2.VideoCapture(0)',
    `cap.set(cv2.CAP_PROP_FRAME_WIDTH,${width})`,
    `cap.set(cv2.CAP_PROP_FRAME_HEIGHT,${height})`,
    `interval=1.0/${fps}`,
    'while True:',
    ' ok,frame=cap.read()',
    ' if not ok: time.sleep(interval); continue',
    ' ok,data=cv2.imencode(".jpg",frame)',
    ' if ok: sys.stdout.buffer.write(data.tobytes()); sys.stdout.buffer.flush()',
    ' time.sleep(interval)',
  ].join('\n');
  return pythonSourceCommand(source, '<aily-opencv-preview>', pythonExecutable);
}

function createPythonFileHelperSource(request, protocolMarker) {
  const payload = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  return [
    'import base64,hashlib,json,os,secrets,stat,sys,zlib',
    `protocol_marker=${JSON.stringify(protocolMarker)}`,
    'file_protocol_version=1',
    `request=json.loads(base64.b64decode(${JSON.stringify(payload)}))`,
    `MAX_CHUNK_SIZE=${SSH_FILE_CHUNK_SIZE}`,
    `MAX_RETRY_LIMIT=${SSH_FILE_RETRY_LIMIT}`,
    'transfer_id=str(request.get("transferId",""))',
    'if not transfer_id:',
    ' raise ValueError("file transfer id is required")',
    '',
    'def send(message):',
    ' sys.stdout.write(protocol_marker+json.dumps(message,separators=(",",":"))+"\\n")',
    ' sys.stdout.flush()',
    '',
    'def receive():',
    ' line=sys.stdin.buffer.readline()',
    ' if not line:',
    '  raise EOFError("file protocol input closed")',
    ' value=json.loads(line.decode("utf-8"))',
    ' if not isinstance(value,dict):',
    '  raise ValueError("file protocol message must be an object")',
    ' return value',
    '',
    'def file_sha256(path):',
    ' digest=hashlib.sha256()',
    ' with open(path,"rb") as input_file:',
    '  while True:',
    '   chunk=input_file.read(MAX_CHUNK_SIZE)',
    '   if not chunk:',
    '    break',
    '   digest.update(chunk)',
    ' return digest.hexdigest()',
    '',
    'def protocol_limits():',
    ' chunk_size=int(request.get("chunkSize",MAX_CHUNK_SIZE))',
    ' retry_limit=int(request.get("retryLimit",MAX_RETRY_LIMIT))',
    ' if chunk_size<1 or chunk_size>MAX_CHUNK_SIZE:',
    '  raise ValueError("invalid file chunk size")',
    ' if retry_limit<0 or retry_limit>MAX_RETRY_LIMIT:',
    '  raise ValueError("invalid file retry limit")',
    ' return chunk_size,retry_limit',
    '',
    'def chunk_id(sequence):',
    ' return transfer_id+":"+str(sequence)',
    '',
    'def write_file():',
    ' path=request["path"]',
    ' expected_length=int(request["length"])',
    ' expected_chunks=int(request["chunks"])',
    ' expected_sha256=str(request["sha256"])',
    ' chunk_size,retry_limit=protocol_limits()',
    ' if expected_length<0 or expected_chunks!=(expected_length+chunk_size-1)//chunk_size:',
    '  raise ValueError("invalid write metadata")',
    ' directory=os.path.dirname(path) or "."',
    ' temporary=os.path.join(directory,"."+os.path.basename(path)+".aily-"+secrets.token_hex(8)+".tmp")',
    ' output=None',
    ' try:',
    '  output=open(temporary,"xb")',
    '  digest=hashlib.sha256()',
    '  written=0',
    '  expected_sequence=0',
    '  last_ack=None',
    '  send({"type":"ready","operation":"writeFile","chunkSize":chunk_size,"retryLimit":retry_limit})',
    '  while True:',
    '   message=receive()',
    '   message_type=message.get("type")',
    '   if message_type=="chunk":',
    '    raw_sequence=message.get("sequence")',
    '    raw_attempt=message.get("attempt")',
    '    response_identity={"transferId":message.get("transferId"),"chunkId":message.get("chunkId"),"attempt":raw_attempt}',
    '    try:',
    '     sequence=int(raw_sequence)',
    '     attempt=int(raw_attempt)',
    '     declared_length=int(message.get("length"))',
    '     checksum=int(message.get("crc32"))',
    '     if message.get("transferId")!=transfer_id or message.get("chunkId")!=chunk_id(sequence):',
    '      raise ValueError("chunk transfer identity mismatch")',
    '     if attempt<0 or attempt>retry_limit:',
    '      raise ValueError("chunk attempt is invalid")',
    '     if last_ack is not None and sequence==expected_sequence-1 and declared_length==last_ack["length"] and checksum==last_ack["crc32"]:',
    '      send(dict({"type":"ack","ok":True,"sequence":sequence,"crc32":checksum,"duplicate":True},**response_identity))',
    '      continue',
    '     if sequence!=expected_sequence:',
    '      raise ValueError("unexpected chunk sequence")',
    '     if declared_length<0 or declared_length>chunk_size:',
    '      raise ValueError("chunk length exceeds limit")',
    '     chunk=base64.b64decode(message.get("dataBase64",""),validate=True)',
    '     if len(chunk)!=declared_length:',
    '      raise ValueError("chunk length mismatch")',
    '     if zlib.crc32(chunk)&0xffffffff!=checksum:',
    '      raise ValueError("chunk CRC mismatch")',
    '     if output.write(chunk)!=len(chunk):',
    '      raise IOError("short file write")',
    '     digest.update(chunk)',
    '     written+=len(chunk)',
    '     last_ack={"sequence":sequence,"length":len(chunk),"crc32":checksum}',
    '     expected_sequence+=1',
    '     send(dict({"type":"ack","ok":True,"sequence":sequence,"crc32":checksum},**response_identity))',
    '    except Exception as error:',
    '     send(dict({"type":"ack","ok":False,"sequence":raw_sequence,"reason":str(error)},**response_identity))',
    '   elif message_type=="commit":',
    '    commit_length=int(message.get("length"))',
    '    commit_chunks=int(message.get("chunks"))',
    '    commit_sha256=str(message.get("sha256"))',
    '    if expected_sequence!=expected_chunks or commit_chunks!=expected_chunks:',
    '     raise ValueError("chunk count mismatch")',
    '    if written!=expected_length or commit_length!=expected_length:',
    '     raise ValueError("file length mismatch")',
    '    if digest.hexdigest()!=expected_sha256 or commit_sha256!=expected_sha256:',
    '     raise ValueError("stream SHA-256 mismatch")',
    '    output.flush()',
    '    os.fsync(output.fileno())',
    '    output.close()',
    '    output=None',
    '    if os.path.getsize(temporary)!=expected_length:',
    '     raise IOError("temporary file length mismatch")',
    '    if file_sha256(temporary)!=expected_sha256:',
    '     raise IOError("temporary file SHA-256 mismatch")',
    '    os.replace(temporary,path)',
    '    temporary=None',
    '    send({"type":"result","written":True,"length":expected_length,"chunks":expected_chunks,"sha256":expected_sha256})',
    '    return',
    '   else:',
    '    raise ValueError("unexpected write protocol message")',
    ' finally:',
    '  if output is not None:',
    '   output.close()',
    '  if temporary is not None and os.path.exists(temporary):',
    '   os.unlink(temporary)',
    '',
    'def read_file():',
    ' path=request["path"]',
    ' chunk_size,retry_limit=protocol_limits()',
    ' length=os.path.getsize(path)',
    ' digest=file_sha256(path)',
    ' chunks=(length+chunk_size-1)//chunk_size',
    ' send({"type":"ready","operation":"readFile","length":length,"chunks":chunks,"sha256":digest,"chunkSize":chunk_size,"retryLimit":retry_limit})',
    ' transferred_length=0',
    ' transferred_digest=hashlib.sha256()',
    ' with open(path,"rb") as input_file:',
    '  for sequence in range(chunks):',
    '   chunk=input_file.read(chunk_size)',
    '   checksum=zlib.crc32(chunk)&0xffffffff',
    '   acknowledged=False',
    '   for attempt in range(retry_limit+1):',
    '    message={"type":"chunk","transferId":transfer_id,"chunkId":chunk_id(sequence),"attempt":attempt,"sequence":sequence,"length":len(chunk),"crc32":checksum,"dataBase64":base64.b64encode(chunk).decode("ascii")}',
    '    send(message)',
    '    response=receive()',
    '    if response.get("type")=="ack" and response.get("ok") is True and response.get("transferId")==transfer_id and response.get("chunkId")==chunk_id(sequence) and int(response.get("attempt",-1))==attempt and int(response.get("sequence",-1))==sequence and int(response.get("crc32",-1))==checksum:',
    '     acknowledged=True',
    '     break',
    '   if not acknowledged:',
    '    raise IOError("chunk acknowledgement retry limit exceeded")',
    '   transferred_length+=len(chunk)',
    '   transferred_digest.update(chunk)',
    ' if transferred_length!=length or transferred_digest.hexdigest()!=digest:',
    '  raise IOError("file changed during transfer")',
    ' send({"type":"result","length":length,"chunks":chunks,"sha256":digest})',
    '',
    'def simple_operation():',
    ' operation=request["operation"]',
    ' path=request.get("path")',
    ' if operation=="listDir":',
    '  entries=[]',
    '  for name in sorted(os.listdir(path)):',
    '   full=os.path.join(path,name); info=os.stat(full)',
    '   entries.append({"name":name,"type":"directory" if stat.S_ISDIR(info.st_mode) else "file","size":info.st_size,"mtime":info.st_mtime})',
    '  result={"entries":entries}',
    ' elif operation=="stat":',
    '  info=os.stat(path); result={"stat":{"size":info.st_size,"mtime":info.st_mtime,"type":"directory" if stat.S_ISDIR(info.st_mode) else "file"}}',
    ' elif operation=="deleteFile":',
    '  os.unlink(path); result={"deleted":True}',
    ' elif operation=="renameFile":',
    '  os.replace(request["oldPath"],request["newPath"]); result={"renamed":True}',
    ' elif operation=="mkdir":',
    '  os.mkdir(path); result={"created":True}',
    ' elif operation=="rmdir":',
    '  os.rmdir(path); result={"removed":True}',
    ' else:',
    '  raise ValueError("unsupported operation")',
    ' send(dict({"type":"result"},**result))',
    '',
    'try:',
    ' operation=request["operation"]',
    ' if operation=="writeFile":',
    '  write_file()',
    ' elif operation=="readFile":',
    '  read_file()',
    ' else:',
    '  simple_operation()',
    'except Exception as error:',
    ' try:',
    '  send({"type":"error","message":str(error)})',
    ' except Exception:',
    '  pass',
    ' raise',
  ].join('\n');
}

function pythonSourceCommand(source, filename, pythonExecutable) {
  const executable = requiredAbsolutePosixPath(pythonExecutable, 'python executable');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `${shellQuote(executable)} -u -c ${shellQuote(`import base64;exec(compile(base64.b64decode('${encoded}'),${JSON.stringify(filename)},'exec'))`)}`;
}

function renderManagedSystemdUnit(projectId, scriptPath, workingDirectory, pythonExecutable) {
  const executable = requiredAbsolutePosixPath(pythonExecutable, 'python executable');
  return `[Unit]
Description=Aily Python project ${projectId}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workingDirectory}
ExecStart=${executable} -u ${scriptPath}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
`;
}

function renderManagedBootScript(locations, pythonExecutable) {
  const executable = requiredAbsolutePosixPath(pythonExecutable, 'python executable');
  return `#!/bin/sh
set -eu
cd ${shellQuote(locations.projectDirectory)}
nohup ${shellQuote(executable)} -u ${shellQuote(locations.scriptPath)} >>${shellQuote(locations.logPath)} 2>&1 </dev/null &
`;
}

function normalizeFileParams(operation, params) {
  if (operation === 'renameFile') {
    return {
      oldPath: requiredRemotePath(params.oldPath),
      newPath: requiredRemotePath(params.newPath),
    };
  }
  const result = { path: requiredRemotePath(params.path) };
  if (operation === 'writeFile') {
    result.dataBase64 = requiredBase64(params.dataBase64);
  }
  return result;
}

function normalizeStat(attrs = {}) {
  return {
    size: Number.isFinite(attrs.size) ? attrs.size : 0,
    mtime: Number.isFinite(attrs.mtime) ? attrs.mtime : undefined,
    type: isDirectoryAttrs(attrs) ? 'directory' : 'file',
  };
}

function isDirectoryAttrs(attrs = {}) {
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory();
  return attrs.mode !== undefined && (attrs.mode & 0o170000) === 0o040000;
}

function assertFileProtocolMessage(message, expectedType, expectedOperation) {
  if (message?.type === 'error') {
    throw new Error(message.message || 'Remote file helper reported an error');
  }
  if (!message || message.type !== expectedType) {
    throw new Error(`Expected remote file ${expectedType} message`);
  }
  if (expectedOperation && message.operation !== expectedOperation) {
    throw new Error(`Remote file helper operation mismatch: expected ${expectedOperation}`);
  }
}

async function readExpectedFileProtocolMessage(protocol, expectedType, identity = {}) {
  while (true) {
    const message = await protocol.readMessage();
    if (
      message?.type === expectedType
      && (!identity.transferId || message.transferId === identity.transferId || expectedType === 'result')
      && (!identity.chunkId || message.chunkId === identity.chunkId)
      && (!Number.isInteger(identity.attempt) || message.attempt === identity.attempt)
    ) {
      return message;
    }
    if (
      identity.transferId
      && ['ack', 'chunk'].includes(message?.type)
      && message.transferId === identity.transferId
    ) {
      continue;
    }
    return message;
  }
}

function fileChunkId(transferId, sequence) {
  return `${transferId}:${sequence}`;
}

async function retryFileChunk(operation) {
  let lastError;
  for (let attempt = 0; attempt <= SSH_FILE_RETRY_LIMIT; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Remote file chunk retry limit exceeded');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function crc32(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let result = 0xffffffff;
  for (const byte of buffer) {
    result = SSH_FILE_CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
  }
  return (result ^ 0xffffffff) >>> 0;
}

function promiseWithTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function callSftp(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    if (typeof sftp?.[method] !== 'function') {
      reject(sftpUnavailableError());
      return;
    }
    sftp[method](...args, (error, ...results) => {
      if (error) reject(error);
      else resolve(results.length <= 1 ? results[0] : results);
    });
  });
}

async function readSftpFile(sftp, filePath) {
  const handle = await callSftp(sftp, 'open', filePath, 'r');
  try {
    const attrs = await callSftp(sftp, 'fstat', handle);
    const size = Number.isFinite(attrs?.size) ? attrs.size : 0;
    const output = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      const result = await callSftp(
        sftp,
        'read',
        handle,
        output,
        position,
        size - position,
        position,
      );
      const bytesRead = Array.isArray(result) ? result[0] : result;
      if (!Number.isInteger(bytesRead) || bytesRead <= 0) break;
      position += bytesRead;
    }
    if (position !== size) throw new Error(`SFTP short read: expected ${size}, got ${position}`);
    return output;
  } finally {
    await callSftp(sftp, 'close', handle).catch(() => undefined);
  }
}

async function writeSftpFileAtomic(sftp, filePath, data) {
  const directory = path.posix.dirname(filePath);
  const name = path.posix.basename(filePath);
  const temporary = path.posix.join(directory, `.${name}.aily-${randomUUID()}`);
  let handle;
  try {
    handle = await callSftp(sftp, 'open', temporary, 'w');
    let position = 0;
    while (position < data.length) {
      const length = Math.min(64 * 1024, data.length - position);
      await callSftp(sftp, 'write', handle, data, position, length, position);
      position += length;
    }
    const attrs = await callSftp(sftp, 'fstat', handle);
    if (attrs?.size !== data.length) {
      throw new Error(`SFTP length mismatch: expected ${data.length}, got ${attrs?.size}`);
    }
    await callSftp(sftp, 'close', handle);
    handle = null;
    try {
      await callSftp(sftp, 'rename', temporary, filePath);
    } catch (error) {
      if (!isSftpReplaceRequired(error)) throw error;
      await callSftp(sftp, 'unlink', filePath);
      await callSftp(sftp, 'rename', temporary, filePath);
    }
  } catch (error) {
    if (handle) await callSftp(sftp, 'close', handle).catch(() => undefined);
    await callSftp(sftp, 'unlink', temporary).catch(() => undefined);
    throw error;
  }
}

function fingerprintHostKey(key) {
  if (typeof key === 'string' && key.startsWith('SHA256:')) return key;
  return `SHA256:${createHash('sha256')
    .update(Buffer.isBuffer(key) ? key : Buffer.from(String(key)))
    .digest('base64')
    .replace(/=+$/g, '')}`;
}

function createHostVerifier(expectedFingerprint) {
  const expected = String(expectedFingerprint || '').trim();
  return key => Boolean(expected) && fingerprintHostKey(key) === expected;
}

function requiredString(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.includes('\0')) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function requiredInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function requiredRemotePath(value) {
  const remotePath = requiredString(value, 'remote path');
  if (
    !remotePath.startsWith('/')
    || remotePath.includes('\\')
    || remotePath.split('/').includes('..')
  ) {
    throw new TypeError('remote path must be an absolute POSIX path without ..');
  }
  return path.posix.normalize(remotePath);
}

function requiredBase64(value) {
  const text = requiredString(value, 'dataBase64', true);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) {
    throw new TypeError('dataBase64 is invalid');
  }
  return text;
}

function managedProjectId(value) {
  const id = sanitizeSessionPart(requiredString(value, 'projectId'));
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new TypeError('projectId is invalid');
  return id;
}

function sftpUnavailableError() {
  const error = new Error('SFTP subsystem is unavailable');
  error.code = 'SFTP_UNAVAILABLE';
  return error;
}

function isSftpUnavailable(error) {
  return error?.code === 'SFTP_UNAVAILABLE'
    || error?.code === 'ENOSYS'
    || /sftp.*unavailable|subsystem.*fail|not provide sftp/i.test(safeErrorText(error));
}

function isSftpReplaceRequired(error) {
  return error?.code === 4
    || error?.code === 11
    || /failure|exists|already exists/i.test(safeErrorText(error));
}

function safeErrorText(error) {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function defaultKnownHostsPath() {
  return process.env.AILY_PYTHON_KNOWN_HOSTS
    || path.join(os.homedir(), '.aily-blockly', 'python-runtime-known-hosts.json');
}

module.exports = {
  JsonKnownHostStore,
  LinuxSshDriver,
  MemoryKnownHostStore,
  createHostVerifier,
  createSafeStopCommand,
  fingerprintHostKey,
};
