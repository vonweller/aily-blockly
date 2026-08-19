const { EventEmitter } = require('node:events');

class CanmvDriver extends EventEmitter {
  constructor(backend) {
    super();
    if (!backend || typeof backend.request !== 'function') {
      throw new TypeError('CanMV backend is required');
    }
    this.id = 'canmv-k230';
    this.backend = backend;
    this.listeners = [];
    for (const event of ['event', 'frame', 'state', 'stderr']) {
      const listener = payload => this.emit(event, payload);
      backend.on?.(event, listener);
      this.listeners.push([event, listener]);
    }
  }

  status() {
    return this.backend.status();
  }

  detectBoards() {
    return this.backend.request('detectBoards', {});
  }

  async connect(endpoint = {}) {
    const boardInfo = await this.backend.request('connectBoard', {
      port: endpoint.port,
      baudRate: endpoint.baudRate,
    });
    return {
      boardInfo,
      capabilities: {
        platform: 'linux',
        hostname: boardInfo?.name || boardInfo?.port || 'CyberCAM K230',
        architecture: 'k230',
        pythonVersion: 'MicroPython',
        homeDirectory: '/',
        writableWorkspace: '/data',
        pty: true,
        terminalResize: true,
        processGroups: false,
        files: 'agent',
        autostart: 'boot-start-sh',
        preview: { available: true, transports: ['canmv-frame'] },
      },
    };
  }

  request(method, params = {}) {
    return this.backend.request(method, params);
  }

  disconnect() {
    return this.backend.request('disconnectBoard', {});
  }

  stopPreview() {
    return this.backend.request('stopPreview', {});
  }

  stopScript() {
    return this.backend.request('stopScript', {});
  }

  async stop() {
    for (const [event, listener] of this.listeners) {
      this.backend.removeListener?.(event, listener);
    }
    this.listeners = [];
    await this.backend.stop?.();
  }
}

module.exports = {
  CanmvDriver,
};
