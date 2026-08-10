const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

const {
  CanmvFrameDecoder,
  MSG_REQUEST,
  encodeJsonFrame,
} = require('./protocol');

class CanmvBackendError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'CanmvBackendError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

class CanmvBackend extends EventEmitter {
  constructor(options = {}) {
    super();
    this.executable = options.executable;
    this.args = Array.isArray(options.args) ? options.args : [];
    this.cwd = options.cwd;
    this.spawnProcess = options.spawnProcess || ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.requestTimeoutMs = options.requestTimeoutMs || 15000;
    this.child = null;
    this.state = 'stopped';
    this.nextRequestId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.stopping = false;
    this.decoder = new CanmvFrameDecoder({
      onMessage: message => this.handleMessage(message),
      onFrame: (frameId, data) => this.emit('frame', { frameId, data }),
    });
  }

  async start() {
    if (this.state === 'ready' && this.child) return;
    if (this.startPromise) return this.startPromise;
    if (!this.executable) {
      throw new CanmvBackendError(1004, 'CanMV backend executable is not configured');
    }

    this.state = 'starting';
    this.emit('state', this.state);
    this.startPromise = new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawnProcess(this.executable, this.args, {
          cwd: this.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        this.failStart(reject, error);
        return;
      }

      this.child = child;
      this.stopping = false;
      child.stdout?.on('data', chunk => this.decoder.push(chunk));
      child.stderr?.on('data', chunk => this.emit('stderr', Buffer.from(chunk).toString('utf8')));
      child.once('error', error => {
        if (this.state === 'starting') this.failStart(reject, error);
        this.handleUnexpectedExit(error);
      });
      child.once('exit', (code, signal) => {
        if (this.state === 'starting') {
          this.failStart(reject, new Error(`backend exited during startup (${code ?? 'null'}, ${signal ?? 'null'})`));
        }
        this.handleUnexpectedExit(new Error(`backend exited unexpectedly (${code ?? 'null'}, ${signal ?? 'null'})`));
      });

      this.state = 'ready';
      this.emit('state', this.state);
      resolve();
    }).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async stop() {
    const child = this.child;
    if (!child) {
      this.transition('stopped');
      return;
    }
    this.stopping = true;
    this.rejectPending(new CanmvBackendError(1004, 'CanMV backend stopped'));
    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener('exit', finish);
        resolve();
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already exited */ }
        finish();
      }, 1500);
      child.once('exit', finish);
      try {
        child.stdin?.end();
      } catch {
        finish();
      }
    });
    if (this.child === child) this.child = null;
    this.decoder.reset();
    this.stopping = false;
    this.transition('stopped');
  }

  status() {
    return {
      state: this.state,
      pid: this.child?.pid || null,
      executable: this.executable,
    };
  }

  async request(method, params = {}) {
    await this.start();
    const child = this.child;
    if (!child?.stdin?.writable) {
      throw new CanmvBackendError(1004, 'CanMV backend stdin is not writable');
    }

    const id = this.nextRequestId++;
    const frame = encodeJsonFrame(MSG_REQUEST, { id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CanmvBackendError(1002, `CanMV request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        child.stdin.write(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CanmvBackendError(1004, 'Unable to write to CanMV backend', error));
      }
    });
  }

  handleMessage(message) {
    if (message && Number.isInteger(message.id)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new CanmvBackendError(message.error.code, message.error.message, message.error.data));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message?.event) this.emit('event', message);
  }

  failStart(reject, error) {
    const wrapped = error instanceof CanmvBackendError
      ? error
      : new CanmvBackendError(1004, `Unable to start CanMV backend: ${error.message}`, error);
    this.child = null;
    this.transition('stopped');
    reject(wrapped);
  }

  handleUnexpectedExit(error) {
    if (this.stopping) return;
    if (!this.child && this.state === 'stopped') return;
    this.child = null;
    this.decoder.reset();
    this.rejectPending(new CanmvBackendError(1004, error.message, error));
    this.transition('stopped');
    this.emit('exit', error);
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  transition(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
  }
}

module.exports = {
  CanmvBackend,
  CanmvBackendError,
};
