const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { RuntimeBroker } = require('../python-runtime/runtime-broker');
const {
  RUNTIME_ERROR_CODES,
  runtimeError,
} = require('../python-runtime/runtime-errors');

class FakeConnection extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.connectCalls = [];
    this.requestCalls = [];
    this.disconnectCalls = 0;
    this.stopPreviewCalls = 0;
    this.stopScriptCalls = 0;
  }

  async connect(endpoint) {
    this.connectCalls.push(endpoint);
    return {
      capabilities: {
        platform: 'linux',
        hostname: 'fake',
        architecture: 'x64',
        pythonVersion: '3.11',
        homeDirectory: '/home/pi',
        writableWorkspace: '/tmp/aily-runtime',
        pty: true,
        terminalResize: true,
        processGroups: true,
        files: 'sftp',
        autostart: 'systemd',
        preview: { available: true, backend: 'opencv', transports: ['ssh-binary'] },
      },
    };
  }

  async request(method, payload) {
    this.requestCalls.push({ method, payload });
    return { method, payload };
  }

  async disconnect() {
    this.disconnectCalls += 1;
  }

  async stopPreview() {
    this.stopPreviewCalls += 1;
  }

  async stopScript() {
    this.stopScriptCalls += 1;
  }
}

class FakeDriverFactory {
  constructor(id) {
    this.id = id;
    this.connections = [];
    this.stopCalls = 0;
  }

  createSession() {
    const connection = new FakeConnection(`${this.id}-${this.connections.length + 1}`);
    this.connections.push(connection);
    return connection;
  }

  async stop() {
    this.stopCalls += 1;
  }
}

function createSender(id) {
  const sent = [];
  return {
    id,
    sent,
    isDestroyed: () => false,
    send(channel, payload) {
      sent.push({ channel, payload });
    },
    once() {},
  };
}

function createDriver(id) {
  return new FakeDriverFactory(id);
}

test('routes events only to the renderer that owns the session', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const senderA = createSender(1);
  const senderB = createSender(2);
  broker.attachOwner(senderA);
  broker.attachOwner(senderB);

  const connection = await broker.connect(senderA.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });

  broker.emitSessionEvent(connection.sessionId, 'event', { type: 'output', data: 'hello' });

  assert.equal(senderA.sent.length, 1);
  assert.equal(senderB.sent.length, 0);
  assert.deepEqual(senderA.sent[0], {
    channel: 'python-runtime-event',
    payload: {
      adapterId: 'linux-ssh',
      sessionId: connection.sessionId,
      payload: { type: 'output', data: 'hello' },
    },
  });
});

test('destroying a renderer closes every session it owns', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const sender = createSender(7);
  broker.attachOwner(sender);
  await broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });

  await broker.releaseOwner(sender.id);

  assert.equal(driver.connections[0].stopPreviewCalls, 1);
  assert.equal(driver.connections[0].stopScriptCalls, 1);
  assert.equal(driver.connections[0].disconnectCalls, 1);
  assert.equal(broker.sessionCount(), 0);
});

test('rejects requests from another renderer and invalid adapters', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const senderA = createSender(1);
  const senderB = createSender(2);
  broker.attachOwner(senderA);
  broker.attachOwner(senderB);
  const { sessionId } = await broker.connect(senderA.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });

  await assert.rejects(
    broker.request(senderB.id, { adapterId: 'linux-ssh', sessionId }, 'runScript', { script: 'pass' }),
    error => error.code === 'SESSION_CLOSED',
  );
  await assert.rejects(
    broker.connect(senderA.id, { adapterId: 'missing', endpoint: { kind: 'ssh' } }),
    error => error.code === 'RUNTIME_UNAVAILABLE',
  );
});

test('forwards frames, state, and stderr with session context', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const sender = createSender(1);
  broker.attachOwner(sender);
  const { sessionId } = await broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });

  broker.emitSessionEvent(sessionId, 'frame', { frameId: 3, data: Buffer.from([1, 2]) });
  broker.emitSessionEvent(sessionId, 'state', 'ready');
  broker.emitSessionEvent(sessionId, 'stderr', 'warning\n');

  assert.deepEqual(sender.sent.map(item => item.channel), [
    'python-runtime-frame',
    'python-runtime-state',
    'python-runtime-stderr',
  ]);
  assert.equal(sender.sent[0].payload.sessionId, sessionId);
  assert.equal(sender.sent[2].payload.payload, 'warning\n');
});

test('forwards sanitized driver runtime errors to the owning renderer event stream', async () => {
  const driver = createDriver('linux-serial-shell');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const senderA = createSender(1);
  const senderB = createSender(2);
  const forwardedErrors = [];
  broker.on('runtimeError', error => forwardedErrors.push(error));
  broker.attachOwner(senderA);
  broker.attachOwner(senderB);
  const { sessionId } = await broker.connect(senderA.id, {
    adapterId: 'linux-serial-shell',
    endpoint: { kind: 'serial-shell', port: 'COM9', baudRate: 115200 },
  });
  senderA.sent.length = 0;

  driver.connections[0].emit('runtimeError', runtimeError(
    RUNTIME_ERROR_CODES.RUN_STOP_FAILED,
    'secret process details',
    {
      cause: new Error('secret cause'),
      details: {
        phase: 'run-stop',
        retryable: true,
        secret: 'must not cross IPC',
      },
    },
  ));

  assert.equal(senderB.sent.length, 0);
  assert.equal(senderA.sent.length, 1);
  assert.equal(senderA.sent[0].channel, 'python-runtime-event');
  assert.equal(senderA.sent[0].payload.adapterId, 'linux-serial-shell');
  assert.equal(senderA.sent[0].payload.sessionId, sessionId);
  assert.deepEqual(senderA.sent[0].payload.payload, {
    event: 'runtimeError',
    params: {
      code: 'RUN_STOP_FAILED',
      message: 'The running script could not be stopped safely.',
      details: {
        phase: 'run-stop',
        retryable: true,
      },
    },
  });
  assert.equal(forwardedErrors.length, 1);
  assert.equal(forwardedErrors[0].code, 'RUN_STOP_FAILED');
  assert.doesNotMatch(JSON.stringify(senderA.sent[0]), /secret/i);
});

test('creates an independent driver connection for each session using the same adapter', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const senderA = createSender(1);
  const senderB = createSender(2);
  broker.attachOwner(senderA);
  broker.attachOwner(senderB);

  const sessionA = await broker.connect(senderA.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi-a.local', port: 22, username: 'pi' },
  });
  const sessionB = await broker.connect(senderB.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi-b.local', port: 22, username: 'pi' },
  });

  assert.equal(driver.connections.length, 2);
  driver.connections[0].emit('event', { type: 'output', data: 'A' });
  driver.connections[1].emit('event', { type: 'output', data: 'B' });
  assert.equal(senderA.sent.at(-1).payload.sessionId, sessionA.sessionId);
  assert.equal(senderA.sent.at(-1).payload.payload.data, 'A');
  assert.equal(senderB.sent.at(-1).payload.sessionId, sessionB.sessionId);
  assert.equal(senderB.sent.at(-1).payload.payload.data, 'B');

  await broker.disconnect(senderA.id, sessionA);
  assert.equal(driver.connections[0].disconnectCalls, 1);
  assert.equal(driver.connections[1].disconnectCalls, 0);
  await broker.request(senderB.id, sessionB, 'runScript', { script: 'print(2)' });
  assert.deepEqual(driver.connections[1].requestCalls.at(-1), {
    method: 'runScript',
    payload: { script: 'print(2)' },
  });
});

test('attaching the same renderer twice preserves its existing sessions', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const sender = createSender(9);
  broker.attachOwner(sender);
  const session = await broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });

  broker.attachOwner(sender);

  await broker.request(sender.id, session, 'runScript', { script: 'pass' });
  assert.equal(broker.sessionCount(), 1);
});

test('drops delayed events from a closed session after reconnect', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const sender = createSender(5);
  broker.attachOwner(sender);
  const oldSession = await broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'old.local', port: 22, username: 'pi' },
  });
  const oldConnection = driver.connections[0];
  const delayedListener = oldConnection.listeners('event')[0];
  await broker.disconnect(sender.id, oldSession);
  const newSession = await broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'new.local', port: 22, username: 'pi' },
  });
  sender.sent.length = 0;

  delayedListener({ type: 'output', data: 'stale' });
  driver.connections[1].emit('event', { type: 'output', data: 'fresh' });

  assert.equal(sender.sent.length, 1);
  assert.equal(sender.sent[0].payload.sessionId, newSession.sessionId);
  assert.equal(sender.sent[0].payload.payload.data, 'fresh');
});

test('reports disconnect cleanup failures without throwing an unhandled error event', async () => {
  const driver = createDriver('linux-ssh');
  const broker = new RuntimeBroker({ drivers: [driver] });
  const sender = createSender(3);
  broker.attachOwner(sender);
  const session = await broker.connect(sender.id, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });
  driver.connections[0].disconnect = async () => {
    throw new Error('disconnect failed');
  };
  const errors = [];
  broker.on('runtimeError', error => errors.push(error));

  await broker.disconnect(sender.id, session);

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'RUNTIME_UNAVAILABLE');
});
