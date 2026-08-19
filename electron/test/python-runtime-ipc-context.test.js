const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PYTHON_RUNTIME_CHANNELS,
  registerPythonRuntimeIpc,
} = require('../python-runtime/ipc');

function createHarness() {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const calls = [];
  const broker = {
    attachOwner(owner) {
      calls.push({ method: 'attachOwner', ownerId: owner.id });
    },
    async connect(ownerId, request) {
      calls.push({ method: 'connect', ownerId, request });
      return { adapterId: request.adapterId, sessionId: 'session-1' };
    },
    async request(ownerId, context, method, payload) {
      calls.push({ method: 'request', ownerId, context, operation: method, payload });
      return { ok: true };
    },
    async detectBoards(ownerId, adapterId) {
      calls.push({ method: 'detectBoards', ownerId, adapterId });
      return { boards: [] };
    },
    async disconnect(ownerId, context) {
      calls.push({ method: 'disconnect', ownerId, context });
    },
    async releaseOwner(ownerId) {
      calls.push({ method: 'releaseOwner', ownerId });
    },
  };
  const sent = [];
  const sender = {
    id: 42,
    isDestroyed: () => false,
    send(channel, payload) { sent.push({ channel, payload }); },
    once(event, callback) {
      if (event === 'destroyed') this.onDestroyed = callback;
    },
  };
  const backendListeners = new Map();
  const backend = {
    on(eventName, listener) { backendListeners.set(eventName, listener); },
    removeListener(eventName) { backendListeners.delete(eventName); },
    status: () => ({ state: 'ready', pid: null }),
    async request() {
      throw new Error('legacy backend should not receive context requests');
    },
    async stop() {},
  };
  const registration = registerPythonRuntimeIpc({ ipcMain, backend, broker });
  const invoke = (channel, data) => handlers.get(channel)({ sender }, data);
  return { backendListeners, calls, sent, sender, invoke, registration };
}

test('routes contextual connect, run, resize, files, autostart, and disconnect through the broker', async () => {
  const { calls, invoke } = createHarness();
  const context = { adapterId: 'linux-ssh', sessionId: 'session-1' };
  await invoke(PYTHON_RUNTIME_CHANNELS.connect, {
    context: { adapterId: 'linux-ssh' },
    payload: {
      endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
      credentials: { credentialId: 'pi-key' },
    },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.runScript, {
    context,
    payload: { script: 'print(1)' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.terminalResize, {
    context,
    payload: { columns: 100, rows: 30 },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.listDir, {
    context,
    payload: { path: '/home/pi' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.stat, {
    context,
    payload: { path: '/home/pi/main.py' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.fileExec, {
    context,
    payload: { path: '/home/pi/main.py' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.installAutostart, {
    context,
    payload: { projectId: 'demo', script: 'print(1)' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.autostartStatus, {
    context,
    payload: { projectId: 'demo' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.removeAutostart, {
    context,
    payload: { projectId: 'demo' },
  });
  await invoke(PYTHON_RUNTIME_CHANNELS.disconnect, { context });

  assert.deepEqual(calls, [
    { method: 'attachOwner', ownerId: 42 },
    {
      method: 'connect',
      ownerId: 42,
      request: {
        adapterId: 'linux-ssh',
        endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
        credentials: { credentialId: 'pi-key' },
      },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'runScript',
      payload: { script: 'print(1)' },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'terminalSetSize',
      payload: { columns: 100, rows: 30 },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'io.listDir',
      payload: { path: '/home/pi' },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'io.queryFileStat',
      payload: { path: '/home/pi/main.py' },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'io.fileExec',
      payload: { path: '/home/pi/main.py' },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'installAutostart',
      payload: { projectId: 'demo', script: 'print(1)' },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'autostartStatus',
      payload: { projectId: 'demo' },
    },
    {
      method: 'request',
      ownerId: 42,
      context,
      operation: 'removeAutostart',
      payload: { projectId: 'demo' },
    },
    { method: 'disconnect', ownerId: 42, context },
  ]);
});

test('contextual board detection always uses the invoking renderer identity', async () => {
  const { calls, invoke } = createHarness();

  await invoke(PYTHON_RUNTIME_CHANNELS.detectBoards, {
    context: { adapterId: 'linux-serial-shell', ownerId: 999 },
  });

  assert.deepEqual(calls, [
    { method: 'attachOwner', ownerId: 42 },
    { method: 'detectBoards', ownerId: 42, adapterId: 'linux-serial-shell' },
  ]);
});

test('contextual renderers do not receive legacy backend broadcasts', async () => {
  const { backendListeners, invoke, sent } = createHarness();

  await invoke(PYTHON_RUNTIME_CHANNELS.connect, {
    context: { adapterId: 'linux-ssh' },
    payload: {
      endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
    },
  });
  backendListeners.get('event')?.({ event: 'scriptOutput', params: { text: 'legacy' } });

  assert.deepEqual(sent, []);
});
