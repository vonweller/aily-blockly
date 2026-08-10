const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { CanmvBackend } = require('../python-runtime/backend');
const {
  MSG_RESPONSE,
  encodeJsonFrame,
} = require('../python-runtime/protocol');

function createFakeChild() {
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
    child.emit('exit', null, signal);
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
