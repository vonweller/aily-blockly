import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  parseArguments,
  runCybercamHardwareSmoke,
} from './run-cybercam-hardware-smoke.mjs';

const TEST_MARKER = 'AILY_CYBERCAM_SMOKE_TEST_MARKER';

class FakeBackend extends EventEmitter {
  constructor({
    boards,
    failMethod,
    runScriptDelayMs = 0,
    emitScriptEvidence = true,
    scriptRunning = false,
  } = {}) {
    super();
    this.boards = boards || [];
    this.failMethod = failMethod;
    this.runScriptDelayMs = runScriptDelayMs;
    this.emitScriptEvidence = emitScriptEvidence;
    this.scriptRunning = scriptRunning;
    this.calls = [];
    this.stopCalls = 0;
  }

  async request(method, params) {
    this.calls.push({ method, params });
    if (method === this.failMethod) {
      throw new Error(`forced ${method} failure`);
    }

    switch (method) {
      case 'detectBoards':
        return { boards: this.boards };
      case 'connectBoard':
        return {
          port: params.port,
          boardType: 'K230',
          fwVersion: 'v1.1.0',
        };
      case 'runScript': {
        const marker = extractPrintedMarker(params.script);
        if (this.emitScriptEvidence) {
          queueMicrotask(() => {
            this.emit('event', {
              event: 'scriptState',
              params: { state: 'started' },
            });
            this.emit('event', {
              event: 'scriptOutput',
              params: { text: `${marker}\r\n` },
            });
            this.emit('event', {
              event: 'scriptState',
              params: { state: 'finished' },
            });
          });
        }
        if (this.runScriptDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, this.runScriptDelayMs));
        }
        return { accepted: true };
      }
      case 'scriptRunning':
        return { running: this.scriptRunning };
      case 'io.listDir':
        return { entries: [{ name: 'boot' }, { name: 'data' }] };
      case 'getFirmwareCommit':
        return { commit: 'v1.1.0' };
      case 'stopScript':
      case 'disconnectBoard':
        return { ok: true };
      default:
        throw new Error(`unexpected method: ${method}`);
    }
  }

  async stop() {
    this.stopCalls += 1;
  }
}

test('runs the safe smoke sequence on the first detected CyberCAM', async () => {
  const backend = new FakeBackend({
    boards: [
      { port: 'COM4', name: 'Other Python board' },
      {
        port: 'COM9',
        name: 'CyberCAM K230',
        vid: '1209',
        pid: 'abd1',
      },
    ],
  });

  const result = await runCybercamHardwareSmoke({
    backend,
    marker: TEST_MARKER,
    timeoutMs: 100,
  });

  assert.deepEqual(backend.calls, [
    { method: 'detectBoards', params: {} },
    {
      method: 'connectBoard',
      params: { port: 'COM9', baudRate: 115200 },
    },
    {
      method: 'runScript',
      params: { script: `print("${TEST_MARKER}")\n` },
    },
    { method: 'scriptRunning', params: {} },
    { method: 'io.listDir', params: { path: '/' } },
    { method: 'getFirmwareCommit', params: {} },
    { method: 'stopScript', params: {} },
    { method: 'disconnectBoard', params: {} },
  ]);
  assert.equal(backend.stopCalls, 1);
  assert.equal(result.status, 'passed');
  assert.equal(result.board.port, 'COM9');
  assert.equal(result.marker, TEST_MARKER);
  assert.equal(result.output.includes(TEST_MARKER), true);
  assert.deepEqual(result.scriptStates, ['started', 'finished']);
  assert.deepEqual(result.scriptRunning, { running: false });
  assert.deepEqual(result.rootDirectory, {
    entries: [{ name: 'boot' }, { name: 'data' }],
  });
  assert.deepEqual(result.firmware, { commit: 'v1.1.0' });
});

test('uses an explicitly selected detected port', async () => {
  const backend = new FakeBackend({
    boards: [
      { port: 'COM8', name: 'CyberCAM K230 A' },
      { port: 'COM9', name: 'CyberCAM K230 B' },
    ],
  });

  const result = await runCybercamHardwareSmoke({
    backend,
    port: 'com9',
    marker: TEST_MARKER,
    timeoutMs: 100,
  });

  assert.equal(result.board.port, 'COM9');
  assert.deepEqual(backend.calls[1], {
    method: 'connectBoard',
    params: { port: 'COM9', baudRate: 115200 },
  });
});

test('refuses to connect when no CyberCAM is detected by default', async () => {
  const backend = new FakeBackend({
    boards: [{ port: 'COM4', name: 'Other Python board' }],
  });

  await assert.rejects(
    runCybercamHardwareSmoke({
      backend,
      marker: TEST_MARKER,
      timeoutMs: 100,
    }),
    /no CyberCAM/i,
  );

  assert.deepEqual(backend.calls, [
    { method: 'detectBoards', params: {} },
  ]);
  assert.equal(backend.stopCalls, 1);
});

test('stops and disconnects after a failure once connected', async () => {
  const backend = new FakeBackend({
    boards: [{ port: 'COM9', name: 'CyberCAM K230' }],
    failMethod: 'io.listDir',
  });

  await assert.rejects(
    runCybercamHardwareSmoke({
      backend,
      marker: TEST_MARKER,
      timeoutMs: 100,
    }),
    /forced io\.listDir failure/,
  );

  assert.deepEqual(
    backend.calls.slice(-3),
    [
      { method: 'io.listDir', params: { path: '/' } },
      { method: 'stopScript', params: {} },
      { method: 'disconnectBoard', params: {} },
    ],
  );
  assert.equal(backend.stopCalls, 1);
});

test('handles an evidence timeout while runScript is still pending and still cleans up', async () => {
  const backend = new FakeBackend({
    boards: [{ port: 'COM9', name: 'CyberCAM K230' }],
    runScriptDelayMs: 30,
    emitScriptEvidence: false,
  });

  await assert.rejects(
    runCybercamHardwareSmoke({
      backend,
      marker: TEST_MARKER,
      timeoutMs: 10,
    }),
    /timed out waiting for CyberCAM script output/i,
  );

  assert.deepEqual(
    backend.calls.slice(-2),
    [
      { method: 'stopScript', params: {} },
      { method: 'disconnectBoard', params: {} },
    ],
  );
  assert.equal(backend.stopCalls, 1);
});

test('fails instead of reporting passed while the script is still running', async () => {
  const backend = new FakeBackend({
    boards: [{ port: 'COM9', name: 'CyberCAM K230' }],
    scriptRunning: true,
  });

  await assert.rejects(
    runCybercamHardwareSmoke({
      backend,
      marker: TEST_MARKER,
      timeoutMs: 100,
    }),
    /script is still running/i,
  );

  assert.deepEqual(
    backend.calls.slice(-2),
    [
      { method: 'stopScript', params: {} },
      { method: 'disconnectBoard', params: {} },
    ],
  );
  assert.equal(backend.stopCalls, 1);
});

test('parses an optional port argument without accepting unknown options', () => {
  assert.deepEqual(parseArguments([]), { port: undefined, help: false });
  assert.deepEqual(parseArguments(['--port', 'COM9']), {
    port: 'COM9',
    help: false,
  });
  assert.deepEqual(parseArguments(['--help']), {
    port: undefined,
    help: true,
  });
  assert.throws(() => parseArguments(['--port']), /requires a value/i);
  assert.throws(() => parseArguments(['--unknown']), /unknown argument/i);
});

function extractPrintedMarker(script) {
  const match = /^print\("([A-Z0-9_]+)"\)\n$/.exec(script);
  assert.ok(match, `unsafe smoke script: ${JSON.stringify(script)}`);
  return match[1];
}
