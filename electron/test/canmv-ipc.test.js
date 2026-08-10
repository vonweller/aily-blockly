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
  await invoke(PYTHON_RUNTIME_CHANNELS.disconnect);
  await invoke(PYTHON_RUNTIME_CHANNELS.runScript, { script: 'print(1)' });
  await invoke(PYTHON_RUNTIME_CHANNELS.stopScript);
  await invoke(PYTHON_RUNTIME_CHANNELS.scriptRunning);
  await invoke(PYTHON_RUNTIME_CHANNELS.terminalInput, { text: 'help()\n' });
  await invoke(PYTHON_RUNTIME_CHANNELS.terminalResize, { columns: 100, rows: 30 });
  await invoke(PYTHON_RUNTIME_CHANNELS.startPreview, { fps: 15, resolution: { w: 640, h: 480 } });
  await invoke(PYTHON_RUNTIME_CHANNELS.stopPreview);
  await invoke(PYTHON_RUNTIME_CHANNELS.listDir, { path: '/sdcard' });
  await invoke(PYTHON_RUNTIME_CHANNELS.stat, { path: '/sdcard/main.py' });
  await invoke(PYTHON_RUNTIME_CHANNELS.readFile, { path: '/sdcard/main.py' });
  await invoke(PYTHON_RUNTIME_CHANNELS.writeFile, { path: '/sdcard/main.py', dataBase64: 'cGFzcwo=' });
  await invoke(PYTHON_RUNTIME_CHANNELS.deleteFile, { path: '/sdcard/old.py' });
  await invoke(PYTHON_RUNTIME_CHANNELS.renameFile, { oldPath: '/sdcard/a.py', newPath: '/sdcard/b.py' });
  await invoke(PYTHON_RUNTIME_CHANNELS.mkdir, { path: '/sdcard/lib' });
  await invoke(PYTHON_RUNTIME_CHANNELS.rmdir, { path: '/sdcard/lib' });
  await invoke(PYTHON_RUNTIME_CHANNELS.firmwareCommit);
  await invoke(PYTHON_RUNTIME_CHANNELS.fileExec, { path: '/sdcard/main.py' });
  await invoke(PYTHON_RUNTIME_CHANNELS.virtualTouchStatus);
  await invoke(PYTHON_RUNTIME_CHANNELS.virtualTouchEvent, {
    x: 10, y: 20, event: 'down', sourceWidth: 640, sourceHeight: 480, trackId: 1,
  });

  assert.deepEqual(backend.calls, [
    { method: 'detectBoards', params: {} },
    { method: 'connectBoard', params: { port: 'COM8', baudRate: 115200 } },
    { method: 'disconnectBoard', params: {} },
    { method: 'runScript', params: { script: 'print(1)' } },
    { method: 'stopScript', params: {} },
    { method: 'scriptRunning', params: {} },
    { method: 'terminalInput', params: { text: 'help()\n' } },
    { method: 'terminalSetSize', params: { columns: 100, rows: 30 } },
    { method: 'startPreview', params: { fps: 15, resolution: { w: 640, h: 480 } } },
    { method: 'stopPreview', params: {} },
    { method: 'io.listDir', params: { path: '/sdcard' } },
    { method: 'io.queryFileStat', params: { path: '/sdcard/main.py' } },
    { method: 'io.readFile', params: { path: '/sdcard/main.py' } },
    { method: 'io.writeFile', params: { path: '/sdcard/main.py', dataBase64: 'cGFzcwo=' } },
    { method: 'io.deleteFile', params: { path: '/sdcard/old.py' } },
    { method: 'io.renameFile', params: { oldPath: '/sdcard/a.py', newPath: '/sdcard/b.py' } },
    { method: 'io.mkdir', params: { path: '/sdcard/lib' } },
    { method: 'io.rmdir', params: { path: '/sdcard/lib' } },
    { method: 'getFirmwareCommit', params: {} },
    { method: 'io.fileExec', params: { path: '/sdcard/main.py' } },
    { method: 'virtualTouch.status', params: {} },
    {
      method: 'virtualTouch.event',
      params: { x: 10, y: 20, event: 'down', sourceWidth: 640, sourceHeight: 480, trackId: 1 },
    },
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
