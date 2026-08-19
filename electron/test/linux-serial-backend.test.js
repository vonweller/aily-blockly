const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  LinuxSerialShellBackend,
  LinuxSerialShellDriver,
} = require('../python-runtime/linux-serial-shell/backend');
const {
  FrameDecoder,
  TYPES,
  encodeFrame,
} = require('../python-runtime/linux-serial-shell/protocol');

function createPort() {
  const port = new EventEmitter();
  port.path = 'COM9';
  port.isOpen = false;
  port.writes = [];
  port.open = callback => {
    port.isOpen = true;
    callback();
  };
  port.close = callback => {
    port.isOpen = false;
    callback();
  };
  port.write = (data, callback) => {
    port.writes.push(Buffer.from(data));
    callback?.();
  };
  return port;
}

test('exposes connect/request/disconnect through an adaptable driver', async () => {
  const calls = [];
  const driver = {
    async connect(options) {
      calls.push(['connect', options]);
      return { connected: true, transport: 'serial-shell' };
    },
    async request(method, params) {
      calls.push(['request', method, params]);
      return { method, params };
    },
    async disconnect() {
      calls.push(['disconnect']);
      return { connected: false, transport: 'serial-shell' };
    },
  };
  const backend = new LinuxSerialShellBackend({
    driverFactory: () => driver,
  });

  assert.deepEqual(await backend.connect({ port: 'COM9', baudRate: 115200 }), {
    connected: true,
    transport: 'serial-shell',
  });
  assert.deepEqual(await backend.request('runScript', { script: 'print(1)' }), {
    method: 'runScript',
    params: { script: 'print(1)' },
  });
  await backend.disconnect();
  assert.deepEqual(calls, [
    ['connect', { port: 'COM9', baudRate: 115200 }],
    ['request', 'runScript', { script: 'print(1)' }],
    ['disconnect'],
  ]);
});

test('forwards unified events from an injected driver through the backend boundary', async () => {
  const driver = new EventEmitter();
  driver.connect = async () => ({ connected: true, transport: 'serial-shell' });
  driver.request = async () => ({ ok: true });
  driver.disconnect = async () => ({ connected: false, transport: 'serial-shell' });
  const backend = new LinuxSerialShellBackend({ driver });
  const events = [];
  backend.on('event', event => events.push(event));

  await backend.connect({ port: 'COM9' });
  driver.emit('event', {
    event: 'scriptOutput',
    params: { text: 'hello from board' },
  });

  assert.deepEqual(events, [{
    event: 'scriptOutput',
    params: { text: 'hello from board' },
  }]);
  await backend.disconnect();
});

test('driver maps a login prompt failure to SHELL_NOT_DETECTED with WalnutPi SERIAL-A guidance', async () => {
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    nonce: 'LSS_TEST_NONCE',
    nonceTimeoutMs: 100,
  });

  const connecting = driver.connect({ port: 'COM9', baudRate: 115200 });
  await new Promise(resolve => setImmediate(resolve));
  port.emit('data', Buffer.from('WalnutPi login: '));

  await assert.rejects(connecting, error => {
    assert.equal(error.code, 'SHELL_NOT_DETECTED');
    assert.match(error.message, /WalnutPi SERIAL-A/i);
    return true;
  });
  assert.equal(port.isOpen, false);
});

test('unexpected serial close rejects pending work and clears the connected session', async () => {
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    requestTimeoutMs: 50,
  });
  const events = [];
  driver.on('disconnected', () => events.push('disconnected'));
  driver.on('state', state => events.push(state));

  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  driver.activeRun = {
    runId: 'run-unplugged',
    token: 'token-unplugged',
    pid: 101,
    pgid: 101,
    starttime: '12345',
  };
  driver.previewRunning = true;
  const pending = driver.requestFramed('status');

  port.isOpen = false;
  port.emit('close');

  await assert.rejects(pending, error => error.code === 'SESSION_CLOSED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(driver.connected, false);
  assert.equal(driver.port, null);
  assert.equal(driver.endpoint, null);
  assert.equal(driver.mode, 'closed');
  assert.equal(driver.activeRun, null);
  assert.equal(driver.previewRunning, false);
  assert.deepEqual(events.slice(-2), ['disconnected', 'disconnected']);
});

test('serial error performs the same remote-disconnect cleanup without waiting for close', async () => {
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    requestTimeoutMs: 50,
  });
  const runtimeErrors = [];
  const disconnected = [];
  driver.on('runtimeError', error => runtimeErrors.push(error));
  driver.on('disconnected', () => disconnected.push(true));

  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  driver.activeRun = {
    runId: 'run-error',
    token: 'token-error',
    pid: 202,
    pgid: 202,
    starttime: '67890',
  };
  driver.previewRunning = true;
  const pending = driver.requestFramed('status');

  port.emit('error', new Error('USB device removed'));

  await assert.rejects(pending, error => error.code === 'SESSION_CLOSED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(driver.connected, false);
  assert.equal(driver.port, null);
  assert.equal(driver.activeRun, null);
  assert.equal(driver.previewRunning, false);
  assert.equal(disconnected.length, 1);
  assert.equal(runtimeErrors.length, 1);
  assert.equal(runtimeErrors[0].code, 'SESSION_CLOSED');
});

test('probes and bootstraps CR-only serial shells with carriage-return command terminators', async () => {
  const nonce = 'LSS_CR_ONLY_NONCE';
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async () => ({ ok: true }),
    nonce,
    nonceTimeoutMs: 100,
  });

  const connecting = driver.connect({
    port: 'COM9',
    skipBootstrap: true,
  });
  await new Promise(resolve => setImmediate(resolve));
  const initialProbe = port.writes[0].toString();
  port.emit('data', Buffer.from('booting\rroot@WalnutPi:~# '));
  await new Promise(resolve => setImmediate(resolve));
  const nonceCommand = port.writes.at(-1).toString();
  port.emit('data', Buffer.from(`noise\r${nonce}\rroot@WalnutPi:~# `));
  const connectError = await connecting.then(() => null, error => error);
  if (!connectError) await driver.disconnect();

  assert.equal(connectError, null);
  assert.equal(initialProbe, '\r');
  assert.match(nonceCommand, /LSS_CR_ONLY_NONCE/);
  assert.match(nonceCommand, /\r$/);

  const bootstrapWrites = [];
  const bootstrapDriver = new LinuxSerialShellDriver({
    protocolMagic: Buffer.alloc(16, 0x41),
    helperSource: 'print("helper")',
  });
  bootstrapDriver.mode = 'shell';
  bootstrapDriver.writeRaw = async data => {
    const text = String(data);
    bootstrapWrites.push(text);
    if (text.includes('__AILY_HELPER_SHA__')) {
      queueMicrotask(() => bootstrapDriver._bootstrapWaiter?.resolve());
    }
    if (text.includes('exec python3 -u')) {
      queueMicrotask(() => bootstrapDriver._readyWaiter?.resolve());
    }
  };

  await bootstrapDriver.bootstrapHelper();
  assert.ok(bootstrapWrites.length > 3);
  assert.ok(bootstrapWrites.every(command => command.endsWith('\r')));
  assert.equal(bootstrapDriver.mode, 'framed');
});

test('terminal input and resize use helper frames and output uses unified runtime events', async () => {
  const magic = Buffer.alloc(16, 0x55);
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    protocolMagic: magic,
    agentRequest: async () => ({ ok: true }),
  });
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  const events = [];
  driver.on('event', event => events.push(event));

  await driver.request('terminalInput', { text: 'hello\n' });
  await driver.request('terminalSetSize', { columns: 100, rows: 30 });
  port.emit('data', encodeFrame(TYPES.TERMINAL, 'board output', {
    magic,
    sequence: 9,
  }));

  const decoder = new FrameDecoder({ magic });
  const frames = port.writes.flatMap(write => decoder.push(write));
  assert.equal(frames[0].type, TYPES.TERMINAL);
  assert.equal(frames[0].payload.toString(), 'hello\n');
  assert.equal(frames[1].type, TYPES.CONTROL);
  assert.deepEqual(JSON.parse(frames[1].payload), {
    action: 'resize',
    columns: 100,
    rows: 30,
  });
  assert.deepEqual(events, [{
    event: 'scriptOutput',
    params: { text: 'board output' },
  }]);

  await driver.disconnect();
  assert.equal(port.isOpen, false);
});

test('stores the active run, stops without a renderer token, and cleans run/preview/helper on disconnect', async () => {
  const calls = [];
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async (action, params) => {
      calls.push([action, params]);
      if (action === 'file.write.chunk') {
        return { ack: true, sequence: params.sequence, crc32: params.crc32 };
      }
      if (action === 'file.write.commit') return { sha256: params.sha256 };
      if (action === 'run') {
        return {
          runId: params.runId,
          token: params.token,
          starttime: '12345',
          pid: 101,
          pgid: 101,
        };
      }
      return { ok: true };
    },
  });
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  const states = [];
  driver.on('event', event => {
    if (event.event === 'scriptState') states.push(event.params);
  });

  const run = await driver.request('runScript', { script: 'print("ok")' });
  assert.equal(driver.activeRun.token, run.token);
  assert.equal(driver.activeRun.starttime, '12345');
  await driver.request('stopScript', {});
  const stopCall = calls.find(([action]) => action === 'stop');
  assert.equal(stopCall[1].token, run.token);
  assert.equal(stopCall[1].starttime, '12345');

  driver.activeRun = { ...run, starttime: '12345' };
  driver.previewRunning = true;
  await driver.disconnect();

  assert.ok(calls.some(([action]) => action === 'preview.stop'));
  assert.ok(calls.filter(([action]) => action === 'stop').length >= 2);
  assert.ok(calls.some(([action]) => action === 'helper.shutdown'));
  assert.equal(port.isOpen, false);
  assert.ok(states.some(state => state.state === 'started'));
  assert.ok(states.some(state => state.state === 'stopped'));
});

test('keeps helper lifecycle ordering authoritative for fast scripts and preserves output runId', async () => {
  const port = createPort();
  let driver;
  driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async (action, params) => {
      if (action === 'file.write.chunk') {
        return { ack: true, sequence: params.sequence, crc32: params.crc32 };
      }
      if (action === 'file.write.commit') return { sha256: params.sha256 };
      if (action === 'run') {
        const metadata = {
          runId: params.runId,
          token: params.token,
          starttime: '4321',
          pid: 202,
          pgid: 202,
        };
        driver.handleHelperEvent({ event: 'started', ...metadata });
        driver.handleHelperEvent({
          event: 'output',
          runId: params.runId,
          text: 'fast output',
        });
        driver.handleHelperEvent({
          event: 'exited',
          runId: params.runId,
          exitCode: 0,
        });
        return metadata;
      }
      return { ok: true };
    },
  });
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  const events = [];
  driver.on('event', event => events.push(event));

  const result = await driver.request('runScript', { script: 'print("fast")' });

  assert.equal(result.runId.length > 0, true);
  assert.equal(driver.activeRun, null);
  assert.deepEqual(
    events.filter(event => event.event === 'scriptState').map(event => event.params.state),
    ['started', 'finished'],
  );
  assert.deepEqual(
    events.find(event => event.event === 'scriptOutput'),
    {
      event: 'scriptOutput',
      params: {
        text: 'fast output',
        runId: result.runId,
      },
    },
  );
  await driver.disconnect();
});

test('maps non-zero helper exits to Angular-compatible scriptState error', async () => {
  const driver = new LinuxSerialShellDriver({
    protocolMagic: Buffer.alloc(16, 0x21),
    agentRequest: async () => ({ ok: true }),
  });
  const states = [];
  driver.on('event', event => {
    if (event.event === 'scriptState') states.push(event.params);
  });

  driver.handleHelperEvent({
    event: 'started',
    runId: 'run-error',
    token: 'token',
    pid: 303,
    pgid: 303,
    starttime: '999',
  });
  driver.handleHelperEvent({
    event: 'exited',
    runId: 'run-error',
    exitCode: 2,
  });

  assert.deepEqual(states.map(state => state.state), ['started', 'error']);
  assert.equal(states[1].runId, 'run-error');
  assert.equal(states[1].exitCode, 2);
  assert.match(states[1].message, /exit code 2/i);
});

test('executes an existing absolute board file through io.fileExec without uploading it', async () => {
  const calls = [];
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async (action, params) => {
      calls.push([action, params]);
      if (action === 'run') {
        return {
          runId: params.runId,
          token: params.token,
          starttime: '2468',
          pid: 404,
          pgid: 404,
        };
      }
      return { ok: true };
    },
  });
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });

  await assert.rejects(
    driver.request('io.fileExec', { path: '../demo.py' }),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  const result = await driver.request('io.fileExec', { path: '/home/pi/demo.py' });

  assert.equal(calls.some(([action]) => action === 'file.write.begin'), false);
  const runCall = calls.find(([action]) => action === 'run');
  assert.equal(runCall[1].scriptPath, '/home/pi/demo.py');
  assert.equal(result.scriptPath, '/home/pi/demo.py');
  assert.equal(result.runId, runCall[1].runId);

  driver.activeRun = null;
  await driver.disconnect();
});

test('uses a 2 FPS preview default and clears pending preview work when stopped', async () => {
  const port = createPort();
  const calls = [];
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async action => {
      calls.push(action);
      return { running: false };
    },
  });
  assert.equal(driver.previewLimiter.intervalMs, 500);
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  let clearCalls = 0;
  driver.previewLimiter.clearPending = () => {
    clearCalls += 1;
  };
  driver.previewRunning = true;

  await driver.stopPreview();

  assert.equal(clearCalls, 1);
  assert.ok(calls.includes('preview.stop'));
  await driver.disconnect();
});

test('drops preview frames that arrive after preview stop completes', async () => {
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async () => ({ running: false }),
  });
  const frames = [];
  driver.on('frame', frame => frames.push(frame));
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  driver.previewRunning = true;

  await driver.stopPreview();
  driver.handleFrame({
    type: TYPES.PREVIEW,
    payload: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
  });

  assert.equal(driver.previewRunning, false);
  assert.equal(driver.previewLimiter.pending, null);
  assert.deepEqual(frames, []);
  await driver.disconnect();
});

test('reports complete serial Linux capabilities', async () => {
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async () => ({ ok: true }),
  });
  const status = await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });

  assert.deepEqual(Object.keys(status.capabilities).sort(), [
    'architecture',
    'autostart',
    'files',
    'homeDirectory',
    'hostname',
    'platform',
    'preview',
    'processGroups',
    'pty',
    'pythonVersion',
    'terminalResize',
    'writableWorkspace',
  ]);
  assert.equal(status.capabilities.files, 'agent');
  assert.equal(status.capabilities.preview.transports[0], 'serial-framed');
  await driver.disconnect();
});

test('deploys autostart source to a persistent managed project path before installing boot-start script', async () => {
  const calls = [];
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async (action, params) => {
      calls.push([action, params]);
      if (action === 'file.write.chunk') {
        return { ack: true, sequence: params.sequence, crc32: params.crc32 };
      }
      if (action === 'file.write.commit') return { sha256: params.sha256 };
      if (action === 'autostart.install') {
        return { installed: true, path: '/boot/start/aily-demo.sh' };
      }
      return { ack: true };
    },
  });
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  driver.capabilities = {
    ...driver.capabilities,
    homeDirectory: '/home/pi',
    autostart: 'boot-start-sh',
  };

  const result = await driver.request('installAutostart', {
    projectId: 'demo',
    script: 'print("boot")',
  });

  const mkdir = calls.find(([action]) => action === 'file.mkdir');
  assert.deepEqual(mkdir[1], {
    path: '/home/pi/.aily-runtime/projects/demo',
    recursive: true,
  });
  const writeBegin = calls.find(([action]) => action === 'file.write.begin');
  assert.equal(
    writeBegin[1].path,
    '/home/pi/.aily-runtime/projects/demo/main.py',
  );
  assert.ok(calls.indexOf(mkdir) < calls.indexOf(writeBegin));
  const install = calls.find(([action]) => action === 'autostart.install');
  const managedScript = Buffer.from(install[1].dataBase64, 'base64').toString('utf8');
  assert.match(
    managedScript,
    /python3 -u '\/home\/pi\/\.aily-runtime\/projects\/demo\/main\.py'/,
  );
  assert.equal(result.scriptPath, '/home/pi/.aily-runtime/projects/demo/main.py');

  await driver.disconnect();
});

test('starts preview from normalized UI options and stops it independently of the active run', async () => {
  const calls = [];
  const port = createPort();
  const driver = new LinuxSerialShellDriver({
    portFactory: () => port,
    agentRequest: async (action, params) => {
      calls.push([action, params]);
      if (action === 'preview.start') {
        return { running: true, backend: 'rpicam', width: 320, height: 240, fps: 7 };
      }
      return { running: false };
    },
  });
  await driver.connect({
    port: 'COM9',
    skipProbe: true,
    skipBootstrap: true,
  });
  driver.capabilities = {
    ...driver.capabilities,
    preview: {
      available: true,
      backend: 'rpicam',
      transports: ['serial-framed'],
    },
  };
  const run = {
    runId: 'run-preview',
    token: 'token',
    starttime: '123',
    pid: 10,
    pgid: 10,
  };
  driver.activeRun = run;

  const started = await driver.request('startPreview', {
    fps: 7,
    resolution: { w: 320, h: 240 },
  });
  await driver.request('stopPreview');

  const startCall = calls.find(([action]) => action === 'preview.start');
  assert.deepEqual(startCall[1], {
    fps: 7,
    resolution: { w: 320, h: 240 },
  });
  assert.equal(started.backend, 'rpicam');
  assert.equal(driver.activeRun, run);
  assert.ok(calls.some(([action]) => action === 'preview.stop'));

  driver.activeRun = null;
  await driver.disconnect();
});
