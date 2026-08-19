const { EventEmitter } = require('node:events');
const { RUNTIME_ERROR_CODES, runtimeError, toPublicRuntimeError } = require('./runtime-errors');
const { validateEndpoint } = require('./linux-shared/endpoint');

const EVENT_CHANNELS = Object.freeze({
  event: 'python-runtime-event',
  frame: 'python-runtime-frame',
  state: 'python-runtime-state',
  stderr: 'python-runtime-stderr',
});

class RuntimeBroker extends EventEmitter {
  constructor({ drivers = [] } = {}) {
    super();
    this.drivers = new Map();
    this.owners = new Map();
    this.sessions = new Map();
    for (const driver of drivers) this.registerDriver(driver);
  }

  registerDriver(driver) {
    if (!driver || typeof driver.id !== 'string' || !driver.id) {
      throw new TypeError('runtime driver id is required');
    }
    if (this.drivers.has(driver.id)) throw new TypeError(`Duplicate runtime driver: ${driver.id}`);
    this.drivers.set(driver.id, driver);
  }

  adapterIds() {
    return Array.from(this.drivers.keys()).sort();
  }

  async status(adapterId) {
    if (!adapterId) {
      return { adapters: this.adapterIds() };
    }
    const driver = this.requireDriver(adapterId);
    return typeof driver.status === 'function'
      ? driver.status()
      : { adapterId, available: true, state: 'stopped' };
  }

  async detectBoards(ownerId, adapterId) {
    this.requireOwner(ownerId);
    const driver = this.requireDriver(adapterId);
    if (typeof driver.detectBoards !== 'function') return { boards: [] };
    try {
      return await driver.detectBoards();
    } catch (error) {
      throw toPublicRuntimeError(error);
    }
  }

  attachOwner(sender) {
    if (!sender || !Number.isInteger(sender.id)) throw new TypeError('runtime owner sender is required');
    const existing = this.owners.get(sender.id);
    if (existing) {
      existing.sender = sender;
      return sender.id;
    }
    this.owners.set(sender.id, { sender, sessions: new Set() });
    return sender.id;
  }

  async connect(ownerId, request = {}) {
    const owner = this.requireOwner(ownerId);
    const adapterId = request.adapterId;
    const driverFactory = this.drivers.get(adapterId);
    if (!driverFactory) throw runtimeError(RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE, `Runtime adapter is unavailable: ${adapterId}`);
    const sessionId = cryptoRandomId();
    const endpoint = request.endpoint ? validateEndpoint(request.endpoint) : undefined;
    const connection = createSessionConnection(driverFactory, this.sessions, adapterId);
    const session = {
      id: sessionId,
      ownerId,
      adapterId,
      driver: connection,
      listeners: [],
      closed: false,
      generation: cryptoRandomId(),
    };
    this.sessions.set(sessionId, session);
    owner.sessions.add(sessionId);
    this.bindDriverEvents(session);
    try {
      const result = await connection.connect?.(endpoint, request.credentials);
      return {
        adapterId,
        sessionId,
        capabilities: result?.capabilities || null,
        boardInfo: result?.boardInfo || null,
      };
    } catch (error) {
      await this.closeSession(sessionId);
      throw toPublicRuntimeError(error);
    }
  }

  async request(ownerId, context, method, payload = {}) {
    const session = this.requireSession(ownerId, context);
    try {
      return await session.driver.request(method, payload);
    } catch (error) {
      throw toPublicRuntimeError(error);
    }
  }

  async disconnect(ownerId, context) {
    const session = this.requireSession(ownerId, context);
    await this.closeSession(session.id);
  }

  emitSessionEvent(sessionId, type, payload) {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;
    this.send(session, type, payload);
  }

  async releaseOwner(ownerId) {
    const owner = this.owners.get(ownerId);
    if (!owner) return;
    for (const sessionId of Array.from(owner.sessions)) await this.closeSession(sessionId);
    this.owners.delete(ownerId);
  }

  sessionCount() {
    return this.sessions.size;
  }

  async stop() {
    for (const sessionId of Array.from(this.sessions.keys())) await this.closeSession(sessionId);
    for (const driver of this.drivers.values()) {
      await driver.stop?.();
    }
  }

  requireOwner(ownerId) {
    const owner = this.owners.get(ownerId);
    if (!owner) throw runtimeError(RUNTIME_ERROR_CODES.SESSION_CLOSED, 'Runtime renderer owner is closed');
    return owner;
  }

  requireDriver(adapterId) {
    const driver = this.drivers.get(adapterId);
    if (!driver) {
      throw runtimeError(
        RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE,
        `Runtime adapter is unavailable: ${adapterId}`,
      );
    }
    return driver;
  }

  requireSession(ownerId, context = {}) {
    const session = this.sessions.get(context.sessionId);
    if (
      !session
      || session.closed
      || session.ownerId !== ownerId
      || session.adapterId !== context.adapterId
    ) {
      throw runtimeError(RUNTIME_ERROR_CODES.SESSION_CLOSED, 'Runtime session is closed or owned by another renderer');
    }
    return session;
  }

  bindDriverEvents(session) {
    for (const type of ['event', 'frame', 'state', 'stderr', 'runtimeError']) {
      const generation = session.generation;
      const listener = payload => {
        if (session.closed || this.sessions.get(session.id) !== session || session.generation !== generation) return;
        if (type === 'runtimeError') {
          const error = toPublicRuntimeError(payload);
          this.send(session, 'event', {
            event: 'runtimeError',
            params: {
              code: error.code,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            },
          });
          this.emit('runtimeError', error);
          return;
        }
        this.send(session, type, payload);
      };
      session.driver.on?.(type, listener);
      session.listeners.push({ type, listener });
    }
  }

  send(session, type, payload) {
    const owner = this.owners.get(session.ownerId);
    const sender = owner?.sender;
    if (!sender || sender.isDestroyed?.()) return;
    const channel = EVENT_CHANNELS[type];
    if (!channel) return;
    const envelope = { adapterId: session.adapterId, sessionId: session.id, payload };
    sender.send(channel, envelope);
    this.emit(type, envelope);
  }

  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;
    session.closed = true;
    this.sessions.delete(sessionId);
    const owner = this.owners.get(session.ownerId);
    owner?.sessions.delete(sessionId);
    for (const { type, listener } of session.listeners) session.driver.removeListener?.(type, listener);
    session.listeners = [];
    const cleanup = [
      ['stopPreview', () => session.driver.stopPreview?.()],
      ['stopScript', () => session.driver.stopScript?.()],
      ['stopRun', () => session.driver.stopRun?.()],
      ['disconnect', () => session.driver.disconnect?.()],
    ];
    for (const [operation, action] of cleanup) {
      try {
        await action();
      } catch (error) {
        this.emit('runtimeError', toPublicRuntimeError(error));
        this.emit('cleanupError', {
          sessionId,
          adapterId: session.adapterId,
          operation,
          error: toPublicRuntimeError(error),
        });
      }
    }
  }
}

function createSessionConnection(driverFactory, sessions, adapterId) {
  let connection;
  if (typeof driverFactory.createSession === 'function') {
    connection = driverFactory.createSession();
  } else if (typeof driverFactory.createConnection === 'function') {
    connection = driverFactory.createConnection();
  } else if (typeof driverFactory.connect === 'function') {
    const active = Array.from(sessions.values()).some(session => session.adapterId === adapterId && !session.closed);
    if (active) {
      throw runtimeError(
        RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE,
        `Runtime adapter does not support multiple sessions: ${adapterId}`,
      );
    }
    connection = driverFactory;
  } else {
    throw runtimeError(RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE, `Runtime adapter is unavailable: ${adapterId}`);
  }
  if (!connection || typeof connection.connect !== 'function' || typeof connection.request !== 'function') {
    throw runtimeError(RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE, `Runtime adapter is unavailable: ${adapterId}`);
  }
  return connection;
}

function cryptoRandomId() {
  return require('node:crypto').randomUUID();
}

module.exports = {
  EVENT_CHANNELS,
  RuntimeBroker,
};
