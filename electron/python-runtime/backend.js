const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');

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
    this.unavailableReason = options.unavailableReason;
    this.args = Array.isArray(options.args) ? options.args : [];
    this.cwd = options.cwd;
    this.spawnProcess = options.spawnProcess || ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.requestTimeoutMs = options.requestTimeoutMs || 15000;
    this.terminationGraceMs = options.terminationGraceMs || 1500;
    this.forceKillTimeoutMs = options.forceKillTimeoutMs || 2000;
    this.forceKillProcessTree = options.forceKillProcessTree || forceKillProcessTree;
    this.platform = options.platform || process.platform;
    this.child = null;
    this.state = 'stopped';
    this.nextRequestId = 1;
    this.pending = new Map();
    this.startPromise = null;
    this.terminationPromise = null;
    this.terminationActive = false;
    this.stopping = false;
    this.decoder = new CanmvFrameDecoder({
      onMessage: message => this.handleMessage(message),
      onFrame: (frameId, data) => this.emit('frame', { frameId, data }),
    });
  }

  async start() {
    if (this.terminationPromise) await this.terminationPromise;
    if (this.state === 'ready' && this.child) return;
    if (this.startPromise) return this.startPromise;
    if (this.stopping && this.child) {
      throw new CanmvBackendError(
        1004,
        `CanMV backend process ${this.child.pid || 'unknown'} has not exited`,
      );
    }
    if (!this.executable) {
      throw new CanmvBackendError(
        1004,
        this.unavailableReason || 'CanMV backend executable is not configured',
      );
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
      child.stdout?.on('data', chunk => {
        if (this.child === child) this.decoder.push(chunk);
      });
      child.stderr?.on('data', chunk => {
        if (this.child === child) {
          this.emit('stderr', Buffer.from(chunk).toString('utf8'));
        }
      });
      child.once('error', error => {
        if (this.child !== child) return;
        if (this.state === 'starting') this.failStart(reject, error);
        this.handleUnexpectedExit(error, child);
      });
      child.once('exit', (code, signal) => {
        if (this.child !== child) return;
        if (this.state === 'starting') {
          this.failStart(reject, new Error(`backend exited during startup (${code ?? 'null'}, ${signal ?? 'null'})`));
        }
        this.handleUnexpectedExit(
          new Error(`backend exited unexpectedly (${code ?? 'null'}, ${signal ?? 'null'})`),
          child,
        );
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
    this.rejectPending(new CanmvBackendError(1004, 'CanMV backend stopped'));
    await this.terminateChild(child);
  }

  status() {
    return {
      state: this.state,
      pid: this.child?.pid || null,
      executable: this.executable,
      available: Boolean(this.executable),
      unavailableReason: this.executable ? null : (this.unavailableReason || 'CanMV backend executable is not configured'),
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
        const timeoutError = new CanmvBackendError(1002, `CanMV request timed out: ${method}`);
        void this.invalidate(timeoutError).catch(error => {
          this.emit('stderr', `${error.message}\n`);
        });
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

  handleUnexpectedExit(error, child) {
    if (this.child !== child) return;
    if (this.stopping) {
      if (!this.terminationActive) this.completeStoppedChild(child);
      return;
    }
    this.child = null;
    this.decoder.reset();
    this.rejectPending(new CanmvBackendError(1004, error.message, error));
    this.transition('stopped');
    this.emit('exit', error);
  }

  invalidate(error) {
    this.rejectPending(error);
    const child = this.child;
    if (!child) return;
    return this.terminateChild(child);
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

  terminateChild(child) {
    if (this.terminationPromise) return this.terminationPromise;
    this.stopping = true;
    this.terminationActive = true;
    const exitWaiter = createExitWaiter(child);
    const termination = (async () => {
      let exited;
      if (this.platform === 'win32') {
        await this.forceKillAndValidateProcessTree(child);
        exited = await exitWaiter.wait(this.forceKillTimeoutMs);
      } else {
        this.requestGracefulTermination(child);
        exited = await exitWaiter.wait(this.terminationGraceMs);
        if (!exited) {
          await this.forceKillProcessTree(child);
          exited = await exitWaiter.wait(this.forceKillTimeoutMs);
        }
      }
      if (!exited) {
        throw new CanmvBackendError(
          1004,
          `CanMV backend process ${child.pid || 'unknown'} did not exit after forced termination`,
        );
      }
      this.completeStoppedChild(child);
    })();
    this.terminationPromise = termination.finally(() => {
      exitWaiter.dispose();
      if (this.terminationPromise === wrappedTermination) {
        this.terminationPromise = null;
        this.terminationActive = false;
      }
    });
    const wrappedTermination = this.terminationPromise;
    return wrappedTermination;
  }

  completeStoppedChild(child) {
    if (this.child !== child) return;
    this.child = null;
    this.decoder.reset();
    this.stopping = false;
    this.transition('stopped');
  }

  async forceKillAndValidateProcessTree(child) {
    let result;
    try {
      result = await this.forceKillProcessTree(child);
    } catch (error) {
      throw new CanmvBackendError(
        1004,
        `Unable to terminate CanMV backend process tree ${child.pid || 'unknown'}: ${error.message}`,
        error,
      );
    }
    const failure = getProcessTreeTerminationFailure(result);
    if (failure) {
      throw new CanmvBackendError(
        1004,
        `Unable to terminate CanMV backend process tree ${child.pid || 'unknown'}: ${failure}`,
        result?.error,
      );
    }
  }

  requestGracefulTermination(child) {
    try {
      child.stdin?.end();
    } catch {
      // Continue with the process signal if stdin is already unavailable.
    }
    try {
      child.kill('SIGTERM');
    } catch {
      // The exit waiter still confirms whether the process has actually gone.
    }
  }
}

function createExitWaiter(child) {
  let exited = child.exitCode !== null && child.exitCode !== undefined;
  let resolveExit;
  const exitPromise = new Promise(resolve => {
    resolveExit = resolve;
  });
  const onExit = () => {
    exited = true;
    resolveExit();
  };
  if (!exited) child.once('exit', onExit);
  else resolveExit();
  return {
    async wait(timeoutMs) {
      if (exited) return true;
      let timer;
      const timedOut = new Promise(resolve => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      const result = await Promise.race([
        exitPromise.then(() => true),
        timedOut,
      ]);
      clearTimeout(timer);
      return result;
    },
    dispose() {
      child.removeListener('exit', onExit);
    },
  };
}

function forceKillProcessTree(child) {
  if (!child?.pid) {
    throw new CanmvBackendError(1004, 'CanMV backend PID is unavailable for forced termination');
  }
  if (process.platform === 'win32') {
    return spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  }
  child.kill('SIGKILL');
}

function getProcessTreeTerminationFailure(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.error) return result.error.message || String(result.error);
  if (Number.isInteger(result.status) && result.status !== 0) {
    return `taskkill exited with status ${result.status}`;
  }
  if (result.signal) return `taskkill exited from signal ${result.signal}`;
  return null;
}

module.exports = {
  CanmvBackend,
  CanmvBackendError,
};
