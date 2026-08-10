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
});

const PYTHON_RUNTIME_EVENTS = Object.freeze({
  event: 'python-runtime-event',
  frame: 'python-runtime-frame',
  state: 'python-runtime-state',
  stderr: 'python-runtime-stderr',
});

function registerPythonRuntimeIpc({ ipcMain, backend }) {
  const subscribers = new Map();
  const registrations = [];

  const rememberSender = event => {
    const sender = event?.sender;
    if (!sender || typeof sender.send !== 'function') return;
    if (!subscribers.has(sender.id)) {
      subscribers.set(sender.id, sender);
      sender.once?.('destroyed', () => subscribers.delete(sender.id));
    }
  };

  const handle = (channel, callback) => {
    ipcMain.handle(channel, async (event, data) => {
      rememberSender(event);
      return callback(data || {});
    });
    registrations.push(channel);
  };

  handle(PYTHON_RUNTIME_CHANNELS.status, () => backend.status());
  handle(PYTHON_RUNTIME_CHANNELS.detectBoards, () => backend.request('detectBoards', {}));
  handle(PYTHON_RUNTIME_CHANNELS.connect, data => backend.request('connectBoard', {
    port: requiredString(data.port, 'port', 512),
    baudRate: optionalInteger(data.baudRate, 'baudRate', 1200, 12000000),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.disconnect, () => backend.request('disconnectBoard', {}));
  handle(PYTHON_RUNTIME_CHANNELS.runScript, data => backend.request('runScript', {
    script: requiredString(data.script, 'script', 16 * 1024 * 1024, true),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.stopScript, () => backend.request('stopScript', {}));
  handle(PYTHON_RUNTIME_CHANNELS.scriptRunning, () => backend.request('scriptRunning', {}));
  handle(PYTHON_RUNTIME_CHANNELS.terminalInput, data => backend.request('terminalInput', {
    text: requiredString(data.text, 'terminal text', 1024 * 1024, true),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.terminalResize, data => backend.request('terminalSetSize', {
    columns: requiredInteger(data.columns, 'columns', 1, 1000),
    rows: requiredInteger(data.rows, 'rows', 1, 1000),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.startPreview, data => backend.request('startPreview', previewParams(data)));
  handle(PYTHON_RUNTIME_CHANNELS.stopPreview, () => backend.request('stopPreview', {}));
  handle(PYTHON_RUNTIME_CHANNELS.listDir, data => backend.request('io.listDir', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.stat, data => backend.request('io.queryFileStat', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.readFile, data => backend.request('io.readFile', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.writeFile, data => backend.request('io.writeFile', {
    path: boardPath(data.path),
    dataBase64: requiredBase64(data.dataBase64),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.deleteFile, data => backend.request('io.deleteFile', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.renameFile, data => backend.request('io.renameFile', {
    oldPath: boardPath(data.oldPath),
    newPath: boardPath(data.newPath),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.mkdir, data => backend.request('io.mkdir', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.rmdir, data => backend.request('io.rmdir', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.firmwareCommit, () => backend.request('getFirmwareCommit', {}));
  handle(PYTHON_RUNTIME_CHANNELS.fileExec, data => backend.request('io.fileExec', {
    path: boardPath(data.path),
  }));
  handle(PYTHON_RUNTIME_CHANNELS.virtualTouchStatus, () => backend.request('virtualTouch.status', {}));
  handle(PYTHON_RUNTIME_CHANNELS.virtualTouchEvent, data => backend.request('virtualTouch.event', touchParams(data)));

  const send = (channel, payload) => {
    for (const [id, sender] of subscribers) {
      if (sender.isDestroyed?.()) {
        subscribers.delete(id);
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
      subscribers.clear();
      await backend.stop();
    },
  };
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

module.exports = {
  PYTHON_RUNTIME_CHANNELS,
  PYTHON_RUNTIME_EVENTS,
  registerPythonRuntimeIpc,
};
