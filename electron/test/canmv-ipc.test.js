const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  PYTHON_RUNTIME_CHANNELS,
  registerPythonRuntimeIpc,
} = require('../python-runtime/ipc');

class FakeBackend extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
  }

  status() { return { state: 'ready', pid: 1234 }; }
  async request(method, params) {
    this.calls.push({ method, params });
    return { method, params };
  }
  async stop() {}
}

function createHarness() {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const sent = [];
  const sender = {
    id: 99,
    isDestroyed: () => false,
    send: (channel, payload) => sent.push({ channel, payload }),
  };
  const backend = new FakeBackend();
  const registration = registerPythonRuntimeIpc({ ipcMain, backend });
  const invoke = (channel, data) => handlers.get(channel)({ sender }, data);
  return { backend, handlers, invoke, registration, sent };
}

test('registers explicit runtime commands and maps them to backend methods', async () => {
  const { backend, handlers, invoke } = createHarness();

  assert.equal(handlers.has('python-runtime-request'), false);
  assert.deepEqual(Array.from(handlers.keys()).sort(), Object.values(PYTHON_RUNTIME_CHANNELS).sort());
  await invoke(PYTHON_RUNTIME_CHANNELS.detectBoards);
  await invoke(PYTHON_RUNTIME_CHANNELS.connect, { port: 'COM8', baudRate: 115200 });
  await invoke(PYTHON_RUNTIME_CHANNELS.runScript, { script: 'print(1)' });
  await invoke(PYTHON_RUNTIME_CHANNELS.listDir, { path: '/sdcard' });

  assert.deepEqual(backend.calls, [
    { method: 'detectBoards', params: {} },
    { method: 'connectBoard', params: { port: 'COM8', baudRate: 115200 } },
    { method: 'runScript', params: { script: 'print(1)' } },
    { method: 'io.listDir', params: { path: '/sdcard' } },
  ]);
});

test('rejects invalid renderer input before it reaches the native backend', async () => {
  const { backend, invoke } = createHarness();

  await assert.rejects(
    invoke(PYTHON_RUNTIME_CHANNELS.connect, { port: '', baudRate: -1 }),
    /port is required/,
  );
  await assert.rejects(
    invoke(PYTHON_RUNTIME_CHANNELS.readFile, { path: 'relative.py' }),
    /absolute board path/,
  );
  await assert.rejects(
    invoke(PYTHON_RUNTIME_CHANNELS.readFile, { path: '/../secrets.py' }),
    /invalid board path/,
  );
  assert.deepEqual(backend.calls, []);
});

test('forwards backend events and frames to participating renderer windows', async () => {
  const { backend, invoke, sent } = createHarness();
  await invoke(PYTHON_RUNTIME_CHANNELS.status);

  backend.emit('event', { event: 'scriptOutput', params: { text: 'hello' } });
  backend.emit('frame', { frameId: 5, data: Buffer.from([1, 2, 3]) });
  backend.emit('state', 'ready');

  assert.deepEqual(sent.map(item => item.channel), [
    'python-runtime-event',
    'python-runtime-frame',
    'python-runtime-state',
  ]);
  assert.deepEqual(sent[1].payload, { frameId: 5, data: Buffer.from([1, 2, 3]) });
});
