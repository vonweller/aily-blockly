const assert = require('node:assert/strict');
const test = require('node:test');

const { createPythonRuntimeRegistration } = require('../python-runtime/bootstrap');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

test('read-only startup registers runtime IPC without spawning the backend', async () => {
  let spawnCalls = 0;
  const ipcMain = createIpcMain();
  const runtime = createPythonRuntimeRegistration({
    ipcMain,
    override: 'C:/tools/canmv-backend.exe',
    isPackaged: false,
    moduleDir: 'C:/app/electron/python-runtime',
    fileSystem: { existsSync: () => true, accessSync: () => undefined, constants: { X_OK: 1 } },
    backendOptions: { spawnProcess: () => { spawnCalls++; throw new Error('must stay lazy'); } },
  });

  const status = await ipcMain.handlers.get('python-runtime-status')({}, {});
  assert.equal(runtime.available, true);
  assert.equal(status.state, 'stopped');
  assert.equal(spawnCalls, 0);
  await runtime.registration.dispose();
});

test('a missing packaged backend is reported as unavailable before first request', async () => {
  const ipcMain = createIpcMain();
  const runtime = createPythonRuntimeRegistration({
    ipcMain,
    platform: 'linux',
    arch: 'x64',
    isPackaged: true,
    resourcesPath: '/opt/aily/resources',
    fileSystem: { existsSync: () => false, accessSync: () => undefined, constants: { X_OK: 1 } },
  });

  assert.equal(runtime.available, false);
  assert.match(runtime.unavailableReason, /backend executable was not found/);
  const status = await ipcMain.handlers.get('python-runtime-status')({}, {});
  assert.equal(status.available, false);
  assert.match(status.unavailableReason, /backend executable was not found/);
  await runtime.registration.dispose();
});

test('unsupported hosts expose a recoverable unavailable runtime', async () => {
  const ipcMain = createIpcMain();
  const runtime = createPythonRuntimeRegistration({
    ipcMain,
    platform: 'freebsd',
    arch: 'riscv64',
    isPackaged: false,
    moduleDir: 'C:/app/electron/python-runtime',
  });

  assert.equal(runtime.available, false);
  assert.match(runtime.unavailableReason, /not available for freebsd-riscv64/);
  await assert.rejects(
    ipcMain.handlers.get('python-runtime-detect-boards')({}, {}),
    /not available for freebsd-riscv64/,
  );
  await runtime.registration.dispose();
});
