const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

test('registers canmv-k230, linux-ssh, and linux-serial-shell without opening Linux transports', async () => {
  let sshSessionCreates = 0;
  let serialSessionCreates = 0;
  const ipcMain = createIpcMain();
  const createConnection = transport => {
    const connection = new EventEmitter();
    connection.connect = async () => ({
      capabilities: {
        platform: 'linux',
        hostname: transport,
        architecture: 'x64',
        pythonVersion: '3.11',
        homeDirectory: '/home/aily',
        writableWorkspace: '/tmp/aily-runtime',
        pty: true,
        terminalResize: true,
        processGroups: true,
        files: 'none',
        autostart: 'none',
        preview: { available: false, transports: [] },
      },
    });
    connection.request = async () => ({ ok: true });
    connection.disconnect = async () => undefined;
    return connection;
  };
  const runtime = createPythonRuntimeRegistration({
    ipcMain,
    override: 'C:/tools/canmv-backend.exe',
    isPackaged: false,
    moduleDir: 'C:/app/electron/python-runtime',
    fileSystem: { existsSync: () => true, accessSync: () => undefined, constants: { X_OK: 1 } },
    sshSessionFactory: () => {
      sshSessionCreates += 1;
      return createConnection('ssh');
    },
    serialSessionFactory: () => {
      serialSessionCreates += 1;
      return createConnection('serial-shell');
    },
  });

  assert.deepEqual(runtime.broker.adapterIds(), [
    'canmv-k230',
    'linux-serial-shell',
    'linux-ssh',
  ]);
  assert.equal(sshSessionCreates, 0);
  assert.equal(serialSessionCreates, 0);

  const sender = { id: 77, send() {}, isDestroyed: () => false, once() {} };
  runtime.broker.attachOwner(sender);
  await runtime.broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });
  assert.equal(sshSessionCreates, 1);
  assert.equal(serialSessionCreates, 0);
  await runtime.registration.dispose();
});
