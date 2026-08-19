'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path').posix;

const SSH_JPEG_FRAMES = Object.freeze([
  Buffer.from([0xff, 0xd8, 0x11, 0xff, 0xd9]),
  Buffer.from([0xff, 0xd8, 0x22, 0xff, 0xd9]),
]);

class FakeSshStream extends EventEmitter {
  constructor() {
    super();
    this.stderr = new EventEmitter();
    this.writes = [];
    this.windowSizes = [];
  }

  write(value) {
    this.writes.push(Buffer.isBuffer(value) ? Buffer.from(value) : String(value));
    return true;
  }

  setWindow(rows, columns, height, width) {
    this.windowSizes.push([rows, columns, height, width]);
  }

  end() {
    this.ended = true;
  }

  destroy() {
    this.destroyed = true;
  }
}

class FakeSftp {
  constructor(evidence) {
    this.evidence = evidence;
    this.calls = evidence.sftpCalls;
    this.files = new Map();
    this.directories = new Set(['/', '/home', '/home/pi', '/home/pi/.aily']);
    this.handles = new Map();
    this.nextHandle = 1;
  }

  open(filePath, flags, callback) {
    this.calls.push(['open', filePath, flags]);
    if (flags === 'r' && !this.files.has(filePath)) {
      callback(sftpError(2, `No such file: ${filePath}`));
      return;
    }
    if (flags !== 'r') this.files.set(filePath, Buffer.alloc(0));
    const handle = Buffer.from(`fake-handle-${this.nextHandle++}`);
    this.handles.set(handle.toString('hex'), { path: filePath, flags });
    callback(null, handle);
  }

  fstat(handle, callback) {
    const record = this.handleRecord(handle, callback);
    if (!record) return;
    this.calls.push(['fstat', Buffer.from(handle)]);
    callback(null, fileAttrs(this.files.get(record.path)?.length || 0));
  }

  read(handle, buffer, offset, length, position, callback) {
    const record = this.handleRecord(handle, callback);
    if (!record) return;
    const value = this.files.get(record.path) || Buffer.alloc(0);
    const bytesRead = value.copy(buffer, offset, position, position + length);
    this.calls.push(['read', Buffer.from(handle), offset, length, position]);
    callback(null, bytesRead, buffer);
  }

  write(handle, buffer, offset, length, position, callback) {
    const record = this.handleRecord(handle, callback);
    if (!record) return;
    const previous = this.files.get(record.path) || Buffer.alloc(0);
    const value = Buffer.alloc(Math.max(previous.length, position + length));
    previous.copy(value);
    buffer.copy(value, position, offset, offset + length);
    this.files.set(record.path, value);
    this.calls.push(['write', Buffer.from(handle), offset, length, position]);
    callback(null);
  }

  close(handle, callback) {
    this.calls.push(['close', Buffer.from(handle)]);
    this.handles.delete(handle.toString('hex'));
    callback(null);
  }

  rename(oldPath, newPath, callback) {
    this.calls.push(['rename', oldPath, newPath]);
    if (!this.files.has(oldPath)) {
      callback(sftpError(2, `No such file: ${oldPath}`));
      return;
    }
    if (this.files.has(newPath)) {
      callback(sftpError(4, `Failure: ${newPath} exists`));
      return;
    }
    this.files.set(newPath, this.files.get(oldPath));
    this.files.delete(oldPath);
    callback(null);
  }

  unlink(filePath, callback) {
    this.calls.push(['unlink', filePath]);
    this.files.delete(filePath);
    callback(null);
  }

  readdir(directoryPath, callback) {
    this.calls.push(['readdir', directoryPath]);
    const prefix = directoryPath === '/' ? '/' : `${directoryPath}/`;
    const entries = new Map();
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === directoryPath) continue;
      const relative = directory.slice(prefix.length);
      if (!relative || relative.includes('/')) continue;
      entries.set(relative, {
        filename: relative,
        attrs: directoryAttrs(),
      });
    }
    for (const [filePath, data] of this.files) {
      if (!filePath.startsWith(prefix)) continue;
      const relative = filePath.slice(prefix.length);
      if (!relative || relative.includes('/')) continue;
      entries.set(relative, {
        filename: relative,
        attrs: fileAttrs(data.length),
      });
    }
    callback(null, [...entries.values()].sort((left, right) => (
      left.filename.localeCompare(right.filename)
    )));
  }

  stat(targetPath, callback) {
    this.calls.push(['stat', targetPath]);
    if (this.directories.has(targetPath)) {
      callback(null, directoryAttrs());
      return;
    }
    if (this.files.has(targetPath)) {
      callback(null, fileAttrs(this.files.get(targetPath).length));
      return;
    }
    callback(sftpError(2, `No such path: ${targetPath}`));
  }

  mkdir(directoryPath, callback) {
    this.calls.push(['mkdir', directoryPath]);
    this.directories.add(directoryPath);
    callback(null);
  }

  rmdir(directoryPath, callback) {
    this.calls.push(['rmdir', directoryPath]);
    this.directories.delete(directoryPath);
    callback(null);
  }

  handleRecord(handle, callback) {
    const record = this.handles.get(handle.toString('hex'));
    if (!record) callback(sftpError(4, 'Invalid handle'));
    return record;
  }
}

class FakeSshClient extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
  }

  connect(config) {
    this.config = config;
    this.server.evidence.connectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
    };
    const accepted = config.hostVerifier(this.server.hostKey);
    this.server.evidence.hostVerifierAccepted = accepted;
    setImmediate(() => {
      if (accepted) this.emit('ready');
      else this.emit('error', new Error('Fake SSH host key rejected'));
    });
  }

  sftp(callback) {
    callback(null, this.server.sftp);
  }

  exec(command, options, callback) {
    const stream = new FakeSshStream();
    this.server.evidence.execCalls.push({ command, options, stream });
    callback(null, stream);
    setImmediate(() => this.server.handleExec(command, options, stream));
  }

  end() {
    this.server.evidence.clientEnded = true;
  }
}

class FakeSshRuntimeServer {
  constructor({
    hostKey = Buffer.from('aily-fake-ssh-host-key'),
    capabilities,
  } = {}) {
    this.hostKey = Buffer.from(hostKey);
    this.capabilities = {
      platform: 'raspberry-pi',
      hostname: 'raspberrypi-fixture',
      architecture: 'aarch64',
      pythonVersion: '3.11.9',
      pythonExecutable: '/usr/bin/python3',
      homeDirectory: '/home/pi',
      writableWorkspace: '/home/pi/.aily',
      autostart: 'systemd',
      previewBackend: 'opencv',
      ...capabilities,
    };
    this.evidence = {
      boundary: 'real LinuxSshDriver clientFactory/SFTP seam; no network listener',
      clientEnded: false,
      connectConfig: null,
      execCalls: [],
      hostVerifierAccepted: false,
      run: null,
      preview: null,
      safeStopCommands: [],
      sftpCalls: [],
      systemdCommands: [],
    };
    this.sftp = new FakeSftp(this.evidence);
    this.clients = [];
  }

  createClient() {
    const client = new FakeSshClient(this);
    this.clients.push(client);
    return client;
  }

  handleExec(command, options, stream) {
    if (command.includes('__AILY_CAPABILITY_PROBE__')) {
      stream.emit('data', Buffer.from(`${JSON.stringify(this.capabilities)}\n`));
      stream.emit('close', 0);
      return;
    }

    if (options?.pty) {
      const source = decodeLongestBase64(command);
      const metadata = launcherMetadata(source, {
        pid: 4101,
        pgid: 4101,
        starttime: '90101',
      });
      this.evidence.run = {
        command,
        launcherSource: source,
        pty: { ...options.pty },
        input: stream.writes,
        resize: stream.windowSizes,
        metadata,
      };
      stream.emit(
        'data',
        Buffer.from(`${metadata.controlNonce}${JSON.stringify(metadata.control)}\n`),
      );
      setImmediate(() => stream.emit('data', Buffer.from('ssh fake output\r\n')));
      return;
    }

    if (command.includes('<aily-preview>')) {
      const source = decodeLongestBase64(command);
      const metadata = launcherMetadata(source, {
        pid: 4202,
        pgid: 4202,
        starttime: '90202',
      });
      this.evidence.preview = {
        command,
        launcherSource: source,
        metadata,
      };
      stream.emit('data', Buffer.concat([
        Buffer.from(`${metadata.controlNonce}${JSON.stringify(metadata.control)}\n`),
        ...SSH_JPEG_FRAMES,
      ]));
      return;
    }

    if (command.includes('SIGTERM') && command.includes('SIGKILL')) {
      this.evidence.safeStopCommands.push(command);
      stream.emit('data', Buffer.from('{"ok":true,"signal":"SIGTERM"}\n'));
      stream.emit('close', 0);
      return;
    }

    if (command.includes('systemctl')) {
      this.evidence.systemdCommands.push(command);
      if (command.includes('is-enabled')) {
        stream.emit('data', Buffer.from('enabled\nactive\n'));
      }
      stream.emit('close', 0);
      return;
    }

    stream.emit('close', 0);
  }
}

function decodeLongestBase64(command) {
  const candidates = command.match(/[A-Za-z0-9+/=]{100,}/g) || [];
  const encoded = candidates.sort((left, right) => right.length - left.length)[0];
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
}

function launcherMetadata(source, { pid, pgid, starttime }) {
  const controlNonce = sourceString(source, 'control_nonce');
  const token = sourceString(source, 'token');
  const runId = sourceString(source, 'run_id');
  return {
    controlNonce,
    control: {
      type: 'started',
      pid,
      pgid,
      token,
      starttime,
      runId,
    },
  };
}

function sourceString(source, name) {
  const match = source.match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match ? JSON.parse(match[1]) : '';
}

function fileAttrs(size) {
  return {
    size,
    mtime: 1_786_970_000,
    mode: 0o100644,
    isDirectory: () => false,
  };
}

function directoryAttrs() {
  return {
    size: 0,
    mtime: 1_786_970_000,
    mode: 0o040755,
    isDirectory: () => true,
  };
}

function sftpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  FakeSftp,
  FakeSshClient,
  FakeSshRuntimeServer,
  FakeSshStream,
  SSH_JPEG_FRAMES,
  decodeLongestBase64,
};
