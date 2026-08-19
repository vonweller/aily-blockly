const PYTHON_RUNTIME_CHANNELS = Object.freeze({
  status: 'python-runtime-status',
  detectBoards: 'python-runtime-detect-boards',
  connect: 'python-runtime-connect',
  disconnect: 'python-runtime-disconnect',
  runScript: 'python-runtime-run-script',
  stopScript: 'python-runtime-stop-script',
  scriptRunning: 'python-runtime-script-running',
  terminalInput: 'python-runtime-terminal-input',
  terminalResize: 'python-runtime-terminal-resize',
  startPreview: 'python-runtime-start-preview',
  stopPreview: 'python-runtime-stop-preview',
  listDir: 'python-runtime-list-dir',
  stat: 'python-runtime-stat',
  readFile: 'python-runtime-read-file',
  writeFile: 'python-runtime-write-file',
  deleteFile: 'python-runtime-delete-file',
  renameFile: 'python-runtime-rename-file',
  mkdir: 'python-runtime-mkdir',
  rmdir: 'python-runtime-rmdir',
  firmwareCommit: 'python-runtime-firmware-commit',
  fileExec: 'python-runtime-file-exec',
  virtualTouchStatus: 'python-runtime-virtual-touch-status',
  virtualTouchEvent: 'python-runtime-virtual-touch-event',
  installAutostart: 'python-runtime-install-autostart',
  autostartStatus: 'python-runtime-autostart-status',
  removeAutostart: 'python-runtime-remove-autostart',
});

const PYTHON_RUNTIME_EVENTS = Object.freeze({
  event: 'python-runtime-event',
  frame: 'python-runtime-frame',
  state: 'python-runtime-state',
  stderr: 'python-runtime-stderr',
});

function registerPythonRuntimeIpc({ ipcMain, backend, broker }) {
  const legacySubscribers = new Map();
  const owners = new Set();
  const registrations = [];

  const rememberSender = (event, legacy) => {
    const sender = event?.sender;
    if (!sender || typeof sender.send !== 'function') return;
    if (!owners.has(sender.id)) {
      broker?.attachOwner?.(sender);
      owners.add(sender.id);
      sender.once?.('destroyed', () => {
        owners.delete(sender.id);
        legacySubscribers.delete(sender.id);
        void broker?.releaseOwner?.(sender.id);
      });
    }
    if (legacy) legacySubscribers.set(sender.id, sender);
    else legacySubscribers.delete(sender.id);
  };

  const handle = (channel, callback) => {
    ipcMain.handle(channel, async (event, data) => {
      rememberSender(event, !data?.context);
      return callback(data || {}, event);
    });
    registrations.push(channel);
  };

  const contextual = (event, data, operation, payload) => {
    if (!data?.context || !broker) return null;
    const context = runtimeContext(data.context);
    return broker.request(event.sender.id, context, operation, payload);
  };
  const contextualDisconnect = (event, data) => {
    if (!data?.context || !broker) return null;
    return broker.disconnect(event.sender.id, runtimeContext(data.context));
  };

  handle(PYTHON_RUNTIME_CHANNELS.status, (data) => {
    if (data?.context && broker) {
      return broker.status(runtimeAdapterContext(data.context).adapterId);
    }
    return backend?.status?.() || broker?.status?.();
  });
  handle(PYTHON_RUNTIME_CHANNELS.detectBoards, (data, event) => {
    if (data?.context && broker) {
      return broker.detectBoards(
        event.sender.id,
        runtimeAdapterContext(data.context).adapterId,
      );
    }
    return backend.request('detectBoards', {});
  });
  handle(PYTHON_RUNTIME_CHANNELS.connect, (data, event) => {
    if (data?.context && broker) {
      const context = runtimeAdapterContext(data.context);
      return broker.connect(event.sender.id, {
        adapterId: context.adapterId,
        endpoint: data.payload?.endpoint,
        credentials: data.payload?.credentials,
      });
    }
    return backend.request('connectBoard', {
      port: requiredString(data.port, 'port', 512),
      baudRate: optionalInteger(data.baudRate, 'baudRate', 1200, 12000000),
    });
  });
  handle(PYTHON_RUNTIME_CHANNELS.disconnect, (data, event) => (
    contextualDisconnect(event, data) || backend.request('disconnectBoard', {})
  ));
  handle(PYTHON_RUNTIME_CHANNELS.runScript, (data, event) => (
    contextual(event, data, 'runScript', {
      script: requiredString(data.payload?.script ?? data.script, 'script', 16 * 1024 * 1024, true),
    }) || backend.request('runScript', {
      script: requiredString(data.script, 'script', 16 * 1024 * 1024, true),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.stopScript, (data, event) => (
    contextual(event, data, 'stopScript', {}) || backend.request('stopScript', {})
  ));
  handle(PYTHON_RUNTIME_CHANNELS.scriptRunning, (data, event) => (
    contextual(event, data, 'scriptRunning', {}) || backend.request('scriptRunning', {})
  ));
  handle(PYTHON_RUNTIME_CHANNELS.terminalInput, (data, event) => (
    contextual(event, data, 'terminalInput', {
      text: requiredString(data.payload?.text ?? data.text, 'terminal text', 1024 * 1024, true),
    }) || backend.request('terminalInput', {
      text: requiredString(data.text, 'terminal text', 1024 * 1024, true),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.terminalResize, (data, event) => (
    contextual(event, data, 'terminalSetSize', {
      columns: requiredInteger(data.payload?.columns ?? data.columns, 'columns', 1, 1000),
      rows: requiredInteger(data.payload?.rows ?? data.rows, 'rows', 1, 1000),
    }) || backend.request('terminalSetSize', {
      columns: requiredInteger(data.columns, 'columns', 1, 1000),
      rows: requiredInteger(data.rows, 'rows', 1, 1000),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.startPreview, (data, event) => (
    contextual(event, data, 'startPreview', previewParams(data.payload || data)) || backend.request('startPreview', previewParams(data))
  ));
  handle(PYTHON_RUNTIME_CHANNELS.stopPreview, (data, event) => (
    contextual(event, data, 'stopPreview', {}) || backend.request('stopPreview', {})
  ));
  handle(PYTHON_RUNTIME_CHANNELS.listDir, (data, event) => (
    contextual(event, data, 'io.listDir', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.listDir', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.stat, (data, event) => (
    contextual(event, data, 'io.queryFileStat', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.queryFileStat', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.readFile, (data, event) => (
    contextual(event, data, 'io.readFile', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.readFile', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.writeFile, (data, event) => (
    contextual(event, data, 'io.writeFile', {
      path: boardPath(data.payload?.path ?? data.path),
      dataBase64: requiredBase64(data.payload?.dataBase64 ?? data.dataBase64),
    }) || backend.request('io.writeFile', {
      path: boardPath(data.path),
      dataBase64: requiredBase64(data.dataBase64),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.deleteFile, (data, event) => (
    contextual(event, data, 'io.deleteFile', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.deleteFile', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.renameFile, (data, event) => (
    contextual(event, data, 'io.renameFile', {
      oldPath: boardPath(data.payload?.oldPath ?? data.oldPath),
      newPath: boardPath(data.payload?.newPath ?? data.newPath),
    }) || backend.request('io.renameFile', {
      oldPath: boardPath(data.oldPath),
      newPath: boardPath(data.newPath),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.mkdir, (data, event) => (
    contextual(event, data, 'io.mkdir', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.mkdir', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.rmdir, (data, event) => (
    contextual(event, data, 'io.rmdir', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.rmdir', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.firmwareCommit, (data, event) => (
    contextual(event, data, 'firmwareCommit', {}) || backend.request('getFirmwareCommit', {})
  ));
  handle(PYTHON_RUNTIME_CHANNELS.fileExec, (data, event) => (
    contextual(event, data, 'io.fileExec', { path: boardPath(data.payload?.path ?? data.path) }) || backend.request('io.fileExec', {
      path: boardPath(data.path),
    })
  ));
  handle(PYTHON_RUNTIME_CHANNELS.virtualTouchStatus, (data, event) => (
    contextual(event, data, 'virtualTouchStatus', {}) || backend.request('virtualTouch.status', {})
  ));
  handle(PYTHON_RUNTIME_CHANNELS.virtualTouchEvent, (data, event) => (
    contextual(event, data, 'virtualTouchEvent', touchParams(data.payload || data)) || backend.request('virtualTouch.event', touchParams(data))
  ));
  handle(PYTHON_RUNTIME_CHANNELS.installAutostart, (data, event) => (
    contextual(event, data, 'installAutostart', autostartParams(data.payload || data))
  ));
  handle(PYTHON_RUNTIME_CHANNELS.autostartStatus, (data, event) => (
    contextual(event, data, 'autostartStatus', autostartParams(data.payload || data))
  ));
  handle(PYTHON_RUNTIME_CHANNELS.removeAutostart, (data, event) => (
    contextual(event, data, 'removeAutostart', autostartParams(data.payload || data))
  ));

  const send = (channel, payload) => {
    for (const [id, sender] of legacySubscribers) {
      if (sender.isDestroyed?.()) {
        legacySubscribers.delete(id);
        continue;
      }
      sender.send(channel, payload);
    }
  };
  const listeners = {
    event: payload => send(PYTHON_RUNTIME_EVENTS.event, payload),
    frame: payload => send(PYTHON_RUNTIME_EVENTS.frame, payload),
    state: payload => send(PYTHON_RUNTIME_EVENTS.state, payload),
    stderr: payload => send(PYTHON_RUNTIME_EVENTS.stderr, payload),
  };
  for (const [eventName, listener] of Object.entries(listeners)) {
    backend.on(eventName, listener);
  }

  return {
    dispose: async () => {
      for (const channel of registrations) ipcMain.removeHandler(channel);
      for (const [eventName, listener] of Object.entries(listeners)) {
        backend.removeListener(eventName, listener);
      }
      legacySubscribers.clear();
      owners.clear();
      await broker?.stop?.();
      await backend?.stop?.();
    },
  };
}

function runtimeContext(value) {
  const context = runtimeAdapterContext(value);
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim()) {
    throw new TypeError('sessionId is required');
  }
  return { ...context, sessionId: value.sessionId };
}

function runtimeAdapterContext(value) {
  if (!value || typeof value.adapterId !== 'string' || !value.adapterId.trim()) {
    throw new TypeError('adapterId is required');
  }
  return { adapterId: value.adapterId };
}

function requiredString(value, label, maxLength, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${label} is required`);
  }
  if (value.length > maxLength || value.includes('\0')) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requiredInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalInteger(value, label, min, max) {
  if (value === undefined || value === null) return undefined;
  return requiredInteger(value, label, min, max);
}

function boardPath(value) {
  const path = requiredString(value, 'board path', 4096);
  if (!path.startsWith('/')) throw new TypeError('board path must be an absolute board path');
  if (path.includes('\\') || path.split('/').some(segment => segment === '..')) throw new TypeError('invalid board path');
  return path;
}

function requiredBase64(value) {
  const text = requiredString(value, 'dataBase64', 64 * 1024 * 1024, true);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) {
    throw new TypeError('dataBase64 is invalid');
  }
  return text;
}

function previewParams(data) {
  const result = {};
  if (data.fps !== undefined) result.fps = requiredInteger(data.fps, 'fps', 1, 120);
  if (data.resolution !== undefined) {
    result.resolution = {
      w: requiredInteger(data.resolution?.w, 'resolution width', 1, 8192),
      h: requiredInteger(data.resolution?.h, 'resolution height', 1, 8192),
    };
  }
  return result;
}

function touchParams(data) {
  if (!['down', 'up', 'move'].includes(data.event)) {
    throw new TypeError('touch event must be down, up, or move');
  }
  return {
    x: requiredInteger(data.x, 'x', 0, 65535),
    y: requiredInteger(data.y, 'y', 0, 65535),
    event: data.event,
    sourceWidth: requiredInteger(data.sourceWidth, 'sourceWidth', 1, 65535),
    sourceHeight: requiredInteger(data.sourceHeight, 'sourceHeight', 1, 65535),
    ...(data.trackId === undefined ? {} : { trackId: requiredInteger(data.trackId, 'trackId', 0, 65535) }),
    ...(data.width === undefined ? {} : { width: requiredInteger(data.width, 'width', 1, 65535) }),
  };
}

function autostartParams(data) {
  const result = {
    projectId: requiredString(data.projectId, 'projectId', 128),
  };
  if (data.script !== undefined) {
    result.script = requiredString(data.script, 'script', 16 * 1024 * 1024, true);
  }
  if (data.scriptPath !== undefined) {
    result.scriptPath = boardPath(data.scriptPath);
  }
  return result;
}

module.exports = {
  PYTHON_RUNTIME_CHANNELS,
  PYTHON_RUNTIME_EVENTS,
  registerPythonRuntimeIpc,
};
