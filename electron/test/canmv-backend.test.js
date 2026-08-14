const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');

const { CanmvBackend } = require('../python-runtime/backend');
const {
  MSG_RESPONSE,
  encodeJsonFrame,
} = require('../python-runtime/protocol');

function createFakeChild(options = {}) {
  const child = new EventEmitter();
  child.pid = 1234;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.stdin = {
    writable: true,
    write(data) { child.writes.push(Buffer.from(data)); },
    end() { this.writable = false; },
  };
  child.kill = signal => {
    child.signalCode = signal;
    if (options.emitExitOnKill !== false) child.emit('exit', null, signal);
  };
  child.unref = () => {};
  return child;
}

function decodeWrittenRequest(child) {
  const frame = Buffer.concat(child.writes);
  return JSON.parse(frame.subarray(7).toString('utf8'));
}

async function waitForRequestWrite(child, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (child.writes.length === 0) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for backend request write');
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function waitForRequestWrites(child, count, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (child.writes.length < count) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${count} backend request writes`);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('starts one backend process and resolves requests by ID', async () => {
  const child = createFakeChild();
  let spawnCalls = 0;
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => { spawnCalls++; return child; },
  });

  await Promise.all([backend.start(), backend.start()]);
  const response = backend.request('detectBoards', {});
  await waitForRequestWrite(child);
  const request = decodeWrittenRequest(child);
  child.stdout.emit('data', encodeJsonFrame(MSG_RESPONSE, {
    id: request.id,
    result: { boards: [{ port: 'COM8', name: 'CyberCam' }] },
  }));

  assert.equal(spawnCalls, 1);
  assert.equal(request.method, 'detectBoards');
  assert.deepEqual(await response, {
    boards: [{ port: 'COM8', name: 'CyberCam' }],
  });
  assert.equal(backend.status().state, 'ready');
});

test('turns protocol errors into typed backend errors', async () => {
  const child = createFakeChild();
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
  });
  await backend.start();

  const response = backend.request('connectBoard', { port: 'COM404' });
  await waitForRequestWrite(child);
  const request = decodeWrittenRequest(child);
  child.stdout.emit('data', encodeJsonFrame(MSG_RESPONSE, {
    id: request.id,
    error: { code: 1001, message: 'Board not found' },
  }));

  await assert.rejects(response, error => {
    assert.equal(error.name, 'CanmvBackendError');
    assert.equal(error.code, 1001);
    assert.equal(error.message, 'Board not found');
    return true;
  });
});

test('rejects pending requests when the native process exits', async () => {
  const child = createFakeChild();
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
  });
  await backend.start();

  const response = backend.request('scriptRunning', {});
  await waitForRequestWrite(child);
  child.emit('exit', 2, null);

  await assert.rejects(response, /exited unexpectedly/);
  assert.equal(backend.status().state, 'stopped');
});

test('starts lazily on the first request and shares startup', async () => {
  const child = createFakeChild();
  let spawnCalls = 0;
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => { spawnCalls++; return child; },
  });
  assert.equal(spawnCalls, 0);

  const firstResponse = backend.request('getFirmwareCommit', {});
  const secondResponse = backend.request('scriptRunning', {});
  await waitForRequestWrites(child, 2);
  const requests = child.writes.map(frame => JSON.parse(frame.subarray(7).toString('utf8')));
  for (const request of requests) {
    child.stdout.emit('data', encodeJsonFrame(MSG_RESPONSE, {
      id: request.id,
      result: { method: request.method },
    }));
  }

  assert.deepEqual(await Promise.all([firstResponse, secondResponse]), [
    { method: 'getFirmwareCommit' },
    { method: 'scriptRunning' },
  ]);
  assert.equal(spawnCalls, 1);
});

test('times out unanswered requests and clears pending state', async () => {
  const child = createFakeChild();
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    platform: 'linux',
    requestTimeoutMs: 10,
  });

  await assert.rejects(backend.request('scriptRunning', {}), error => {
    assert.equal(error.name, 'CanmvBackendError');
    assert.equal(error.code, 1002);
    return true;
  });
  assert.equal(backend.pending.size, 0);
});

test('invalidates a timed-out backend process so the next request starts a fresh process', async () => {
  const firstChild = createFakeChild();
  firstChild.pid = 1001;
  const secondChild = createFakeChild();
  secondChild.pid = 1002;
  const children = [firstChild, secondChild];
  let spawnCalls = 0;
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => children[spawnCalls++],
    platform: 'linux',
    requestTimeoutMs: 10,
  });

  await assert.rejects(backend.request('runScript', { script: 'while True: pass' }), error => {
    assert.equal(error.name, 'CanmvBackendError');
    assert.equal(error.code, 1002);
    return true;
  });

  assert.equal(firstChild.signalCode, 'SIGTERM');
  assert.equal(backend.status().state, 'stopped');
  assert.equal(backend.status().pid, null);

  const response = backend.request('detectBoards', {});
  await waitForRequestWrite(secondChild);
  const request = decodeWrittenRequest(secondChild);
  secondChild.stdout.emit('data', encodeJsonFrame(MSG_RESPONSE, {
    id: request.id,
    result: { boards: [{ port: 'COM9', name: 'CyberCAM K230' }] },
  }));

  assert.equal(spawnCalls, 2);
  assert.deepEqual(await response, {
    boards: [{ port: 'COM9', name: 'CyberCAM K230' }],
  });
});

test('keeps a timed-out child registered until its exit is confirmed', async () => {
  const child = createFakeChild({ emitExitOnKill: false });
  child.pid = 1001;
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    platform: 'linux',
    requestTimeoutMs: 10,
    terminationGraceMs: 10,
    forceKillTimeoutMs: 100,
    forceKillProcessTree: () => undefined,
  });

  await assert.rejects(
    backend.request('runScript', { script: 'while True: pass' }),
    /timed out/i,
  );

  assert.equal(backend.status().pid, 1001);
  assert.notEqual(backend.status().state, 'stopped');

  child.emit('exit', null, 'SIGKILL');
  await waitFor(() => backend.status().state === 'stopped');
  assert.equal(backend.status().pid, null);
});

test('waits for a timed-out child to exit before starting a replacement backend', async () => {
  const firstChild = createFakeChild({ emitExitOnKill: false });
  firstChild.pid = 1001;
  const secondChild = createFakeChild();
  secondChild.pid = 1002;
  const children = [firstChild, secondChild];
  let spawnCalls = 0;
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => children[spawnCalls++],
    platform: 'linux',
    requestTimeoutMs: 10,
    terminationGraceMs: 1_000,
  });

  await assert.rejects(
    backend.request('runScript', { script: 'while True: pass' }),
    /timed out/i,
  );

  const response = backend.request('detectBoards', {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spawnCalls, 1);
  assert.equal(backend.status().pid, 1001);

  firstChild.emit('exit', null, 'SIGTERM');
  await waitForRequestWrite(secondChild);
  const request = decodeWrittenRequest(secondChild);

  assert.equal(backend.status().state, 'ready');
  assert.equal(backend.status().pid, 1002);

  secondChild.stdout.emit('data', encodeJsonFrame(MSG_RESPONSE, {
    id: request.id,
    result: { boards: [{ port: 'COM9', name: 'CyberCAM K230' }] },
  }));

  assert.deepEqual(await response, {
    boards: [{ port: 'COM9', name: 'CyberCAM K230' }],
  });
});

test('stops idempotently after the backend has exited', async () => {
  const child = createFakeChild();
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    platform: 'linux',
  });
  await backend.start();

  await backend.stop();
  await backend.stop();

  assert.equal(backend.status().state, 'stopped');
  assert.equal(backend.pending.size, 0);
});

test('force-terminates a child that ignores stdin EOF and graceful termination', async () => {
  const child = createFakeChild({ emitExitOnKill: false });
  const forceKillCalls = [];
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    platform: 'linux',
    terminationGraceMs: 10,
    forceKillTimeoutMs: 100,
    forceKillProcessTree: target => {
      forceKillCalls.push(target.pid);
      target.emit('exit', null, 'SIGKILL');
    },
  });
  await backend.start();

  await backend.stop();

  assert.deepEqual(forceKillCalls, [1234]);
  assert.equal(backend.status().state, 'stopped');
  assert.equal(backend.status().pid, null);
});

test('terminates the Windows process tree even when the parent exits during graceful shutdown', async () => {
  const child = createFakeChild();
  const forceKillCalls = [];
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    platform: 'win32',
    forceKillProcessTree: target => {
      forceKillCalls.push(target.pid);
      target.emit('exit', null, 'SIGKILL');
    },
  });
  await backend.start();

  await backend.stop();

  assert.deepEqual(forceKillCalls, [1234]);
  assert.equal(backend.status().state, 'stopped');
});

test('does not report stopped when Windows process-tree termination reports failure', async () => {
  const child = createFakeChild({ emitExitOnKill: false });
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    platform: 'win32',
    forceKillProcessTree: target => {
      target.emit('exit', 0, null);
      return {
        status: 1,
        error: new Error('Access is denied'),
      };
    },
  });
  await backend.start();

  await assert.rejects(
    backend.stop(),
    /Unable to terminate CanMV backend process tree.*Access is denied/,
  );

  assert.notEqual(backend.status().state, 'stopped');
  assert.equal(backend.status().pid, 1234);
});

test('uses the host Windows platform to validate process-tree termination by default', {
  skip: process.platform !== 'win32',
}, async () => {
  const child = createFakeChild({ emitExitOnKill: false });
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => child,
    forceKillProcessTree: target => {
      target.emit('exit', 0, null);
      return {
        status: 1,
        error: new Error('Access is denied'),
      };
    },
  });
  await backend.start();

  await assert.rejects(
    backend.stop(),
    /Unable to terminate CanMV backend process tree.*Access is denied/,
  );

  assert.notEqual(backend.status().state, 'stopped');
  assert.equal(backend.status().pid, 1234);
});

test('cleans up a timed-out forced termination when the child exits later', async () => {
  const firstChild = createFakeChild({ emitExitOnKill: false });
  firstChild.pid = 1001;
  const secondChild = createFakeChild();
  secondChild.pid = 1002;
  const children = [firstChild, secondChild];
  let spawnCalls = 0;
  const backend = new CanmvBackend({
    executable: 'C:/app/canmv-backend.exe',
    spawnProcess: () => children[spawnCalls++],
    platform: 'win32',
    forceKillTimeoutMs: 10,
    forceKillProcessTree: () => ({ status: 0 }),
  });
  await backend.start();

  await assert.rejects(
    backend.stop(),
    /did not exit after forced termination/,
  );
  assert.equal(backend.status().pid, 1001);
  assert.notEqual(backend.status().state, 'stopped');

  firstChild.emit('exit', null, 'SIGKILL');
  await waitFor(() => backend.status().state === 'stopped');

  await backend.start();
  assert.equal(spawnCalls, 2);
  assert.equal(backend.status().pid, 1002);
  assert.equal(backend.status().state, 'ready');
});

test('stops a real helper process that ignores stdin EOF and SIGTERM without leaving it alive', async (t) => {
  const helperPath = path.join(__dirname, 'fixtures', 'stubborn-canmv-backend.js');
  const backend = new CanmvBackend({
    executable: process.execPath,
    args: [helperPath],
    spawnProcess: (command, args, options) => spawn(command, args, options),
    terminationGraceMs: 50,
    forceKillTimeoutMs: 2_000,
  });
  await backend.start();
  const pid = backend.status().pid;
  t.after(() => {
    if (!pid || !isProcessAlive(pid)) return;
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  });

  await backend.stop();

  assert.equal(backend.status().state, 'stopped');
  assert.equal(backend.status().pid, null);
  assert.equal(isProcessAlive(pid), false);
});

async function waitFor(predicate, timeoutMs = 1_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setImmediate(resolve));
  }
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
