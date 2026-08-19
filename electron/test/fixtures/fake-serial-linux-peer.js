'use strict';

const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const path = require('node:path').posix;

const {
  FrameDecoder,
  TYPES,
  crc32,
  encodeFrame,
} = require('../../python-runtime/linux-serial-shell/protocol');

const SERIAL_JPEG_FRAMES = Object.freeze([
  Buffer.from([0xff, 0xd8, 0x31, 0xff, 0xd9]),
  Buffer.from([0xff, 0xd8, 0x33, 0xff, 0xd9]),
]);
const SERIAL_JPEG_MIDDLE_FRAME = Buffer.from([0xff, 0xd8, 0x32, 0xff, 0xd9]);

class FakeSerialPort extends EventEmitter {
  constructor(peer, options) {
    super();
    this.peer = peer;
    this.path = options.path;
    this.baudRate = options.baudRate;
    this.isOpen = false;
    this.writes = [];
  }

  open(callback) {
    this.isOpen = true;
    callback?.();
  }

  write(value, callback) {
    const data = Buffer.from(value);
    this.writes.push(data);
    this.peer.receive(data);
    callback?.();
  }

  drain(callback) {
    callback?.();
  }

  close(callback) {
    this.isOpen = false;
    callback?.();
  }
}

class FakeSerialLinuxPeer {
  constructor({ magic } = {}) {
    this.magic = Buffer.from(magic || Buffer.alloc(16, 0x6a));
    this.decoder = new FrameDecoder({ magic: this.magic });
    this.port = null;
    this.mode = 'shell';
    this.sequence = 1;
    this.files = new Map();
    this.directories = new Set([
      '/',
      '/boot',
      '/boot/start',
      '/data',
      '/home',
      '/home/walnut',
      '/home/walnut/.aily-runtime',
      '/tmp',
    ]);
    this.pendingWrites = new Map();
    this.pendingReads = new Map();
    this.evidence = {
      actions: [],
      atomicTransfers: new Map(),
      autostartScripts: new Map(),
      bootstrapCommands: [],
      fileChunkAttempts: new Map(),
      fragmentedFrames: 0,
      helperRemoved: false,
      helperShutdown: false,
      helperStartCommand: '',
      noisyFrames: 0,
      previewStops: 0,
      resize: [],
      run: null,
      shellPromptSent: false,
      shellVerificationCommand: '',
      stopRequests: [],
      terminalInput: [],
    };
  }

  createPort(options) {
    this.port = new FakeSerialPort(this, options);
    return this.port;
  }

  receive(data) {
    if (this.mode === 'framed') {
      for (const frame of this.decoder.push(data)) this.handleFrame(frame);
      return;
    }
    const command = data.toString('utf8').replace(/[\r\n]+$/, '');
    this.handleShellCommand(command);
  }

  handleShellCommand(command) {
    if (!command) {
      this.evidence.shellPromptSent = true;
      this.emitRawFragmented(Buffer.from('root@WalnutPi:~# '));
      return;
    }
    if (command.includes('printf') && command.includes('AILY_SERIAL_INTEGRATION_NONCE')) {
      this.evidence.shellVerificationCommand = command;
      this.emitRawFragmented(Buffer.from('\nAILY_SERIAL_INTEGRATION_NONCE\n'));
      return;
    }

    this.evidence.bootstrapCommands.push(command);
    const expected = command.match(/expected=(?:"|\\?")([a-f0-9]{64})(?:"|\\?")/);
    if (command.includes('__AILY_HELPER_SHA__') && expected) {
      this.emitRawFragmented(Buffer.from(`__AILY_HELPER_SHA__${expected[1]}\nroot@WalnutPi:~# `));
      return;
    }

    if (/^exec python3 -u /.test(command)) {
      this.evidence.helperStartCommand = command;
      this.mode = 'framed';
      this.sendJson(TYPES.CONTROL, {
        event: 'ready',
        capabilities: {
          platform: 'walnutpi',
          hostname: 'walnutpi-fixture',
          architecture: 'aarch64',
          pythonVersion: '3.11.2',
          homeDirectory: '/home/walnut',
          writableWorkspace: '/tmp/aily-runtime/fake-serial',
          pty: true,
          terminalResize: true,
          processGroups: true,
          files: 'agent',
          autostart: 'boot-start-sh',
          preview: {
            available: true,
            backend: 'opencv',
            transports: ['serial-framed'],
          },
        },
      });
    }
  }

  handleFrame(frame) {
    if (frame.type === TYPES.TERMINAL) {
      this.evidence.terminalInput.push(frame.payload.toString('utf8'));
      return;
    }
    if (![TYPES.CONTROL, TYPES.FILE].includes(frame.type)) return;
    const request = JSON.parse(frame.payload.toString('utf8'));
    this.evidence.actions.push(request.action);
    void this.handleRequest(request);
  }

  handleRequest(request) {
    const { action } = request;
    switch (action) {
      case 'file.write.begin':
        this.pendingWrites.set(request.path, {
          chunks: new Map(),
          sha256: request.sha256,
          size: request.size,
        });
        this.reply(request, { ack: true });
        return;
      case 'file.write.chunk': {
        const key = `${request.path}:${request.sequence}`;
        const attempts = (this.evidence.fileChunkAttempts.get(key) || 0) + 1;
        this.evidence.fileChunkAttempts.set(key, attempts);
        if (request.sequence === 0 && attempts === 1) {
          this.reply(request, { ack: false, reason: 'deterministic retry' }, TYPES.ACK);
          return;
        }
        const data = Buffer.from(request.dataBase64, 'base64');
        if (crc32(data) !== request.crc32) {
          this.replyError(request, 'FILE_TRANSFER_FAILED', 'chunk CRC mismatch');
          return;
        }
        this.pendingWrites.get(request.path)?.chunks.set(request.sequence, data);
        this.reply(request, {
          ack: true,
          sequence: request.sequence,
          crc32: request.crc32,
        }, TYPES.ACK);
        return;
      }
      case 'file.write.commit': {
        const transfer = this.pendingWrites.get(request.path);
        const data = Buffer.concat([...transfer.chunks.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, chunk]) => chunk));
        const digest = sha256(data);
        if (digest !== request.sha256 || digest !== transfer.sha256 || data.length !== transfer.size) {
          this.replyError(request, 'FILE_TRANSFER_FAILED', 'commit verification failed');
          return;
        }
        this.files.set(request.path, data);
        this.pendingWrites.delete(request.path);
        this.evidence.atomicTransfers.set(request.path, true);
        this.reply(request, { sha256: digest });
        return;
      }
      case 'file.write.abort':
        this.pendingWrites.delete(request.path);
        this.reply(request, { aborted: true });
        return;
      case 'file.read.begin': {
        const data = this.files.get(request.path) || Buffer.alloc(0);
        this.pendingReads.set(request.path, data);
        this.reply(request, {
          size: data.length,
          chunks: data.length === 0 ? 0 : 1,
          sha256: sha256(data),
        }, TYPES.FILE);
        return;
      }
      case 'file.read.chunk': {
        const data = this.pendingReads.get(request.path) || Buffer.alloc(0);
        this.reply(request, {
          sequence: request.sequence,
          crc32: crc32(data),
          dataBase64: data.toString('base64'),
        }, TYPES.FILE);
        return;
      }
      case 'file.read.ack':
        this.reply(request, { ack: true }, TYPES.ACK);
        return;
      case 'file.read.end':
        this.pendingReads.delete(request.path);
        this.reply(request, { ended: true });
        return;
      case 'file.list':
        this.reply(request, { entries: this.listEntries(request.path) }, TYPES.FILE);
        return;
      case 'file.stat':
        this.reply(request, this.stat(request.path), TYPES.FILE);
        return;
      case 'file.delete':
        this.files.delete(request.path);
        this.reply(request, { deleted: true }, TYPES.FILE);
        return;
      case 'file.rename':
        this.files.set(request.newPath, this.files.get(request.oldPath) || Buffer.alloc(0));
        this.files.delete(request.oldPath);
        this.reply(request, { renamed: true }, TYPES.FILE);
        return;
      case 'file.mkdir':
        this.directories.add(request.path);
        this.reply(request, { created: true }, TYPES.FILE);
        return;
      case 'file.rmdir':
        this.directories.delete(request.path);
        this.reply(request, { removed: true }, TYPES.FILE);
        return;
      case 'run': {
        const run = {
          runId: request.runId,
          token: request.token,
          pid: 5101,
          pgid: 5101,
          starttime: '120001',
        };
        this.evidence.run = {
          ...run,
          scriptPath: request.scriptPath,
          pythonCommand: `python3 -u ${request.scriptPath}`,
        };
        this.reply(request, run);
        setImmediate(() => this.sendJson(TYPES.CONTROL, {
          event: 'output',
          runId: run.runId,
          dataBase64: Buffer.from('serial fake output\r\n').toString('base64'),
        }));
        return;
      }
      case 'resize':
        this.evidence.resize.push({
          columns: request.columns,
          rows: request.rows,
        });
        this.reply(request, {
          columns: request.columns,
          rows: request.rows,
        });
        return;
      case 'stop':
        this.evidence.stopRequests.push({
          runId: request.runId,
          token: request.token,
          starttime: request.starttime,
        });
        this.reply(request, { stopped: true, signal: 'SIGTERM' });
        return;
      case 'autostart.install':
      case 'autostart.update': {
        const target = `/boot/start/aily-${request.project}.sh`;
        this.evidence.autostartScripts.set(
          target,
          Buffer.from(request.dataBase64, 'base64').toString('utf8'),
        );
        this.reply(request, { installed: true, path: target });
        return;
      }
      case 'autostart.status': {
        const target = `/boot/start/aily-${request.project}.sh`;
        this.reply(request, {
          kind: 'boot-start-sh',
          installed: this.evidence.autostartScripts.has(target),
          running: null,
          path: target,
        });
        return;
      }
      case 'autostart.remove':
        this.evidence.autostartScripts.delete(request.path);
        this.reply(request, {
          kind: 'boot-start-sh',
          removed: true,
          path: request.path,
        });
        return;
      case 'preview.start':
        this.reply(request, {
          running: true,
          backend: 'opencv',
          width: request.resolution?.w || 320,
          height: request.resolution?.h || 240,
          fps: request.fps || 5,
        });
        setImmediate(() => {
          this.sendFrame(TYPES.PREVIEW, SERIAL_JPEG_FRAMES[0]);
          this.sendFrame(TYPES.PREVIEW, SERIAL_JPEG_MIDDLE_FRAME);
          this.sendFrame(TYPES.PREVIEW, SERIAL_JPEG_FRAMES[1]);
        });
        return;
      case 'preview.stop':
        this.evidence.previewStops += 1;
        this.reply(request, { running: false });
        return;
      case 'helper.shutdown':
        this.evidence.helperShutdown = true;
        this.evidence.helperRemoved = true;
        this.reply(request, { stopped: true, helperRemoved: true });
        return;
      default:
        this.replyError(request, 'CAPABILITY_UNAVAILABLE', `Unhandled action: ${action}`);
    }
  }

  listEntries(directoryPath) {
    const prefix = directoryPath === '/' ? '/' : `${directoryPath}/`;
    const entries = new Map();
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === directoryPath) continue;
      const relative = directory.slice(prefix.length);
      if (relative && !relative.includes('/')) {
        entries.set(relative, { name: relative, type: 'directory', size: 0 });
      }
    }
    for (const [filePath, data] of this.files) {
      if (!filePath.startsWith(prefix)) continue;
      const relative = filePath.slice(prefix.length);
      if (relative && !relative.includes('/')) {
        entries.set(relative, { name: relative, type: 'file', size: data.length });
      }
    }
    return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  stat(targetPath) {
    if (this.directories.has(targetPath)) {
      return { path: targetPath, type: 'directory', size: 0 };
    }
    const data = this.files.get(targetPath);
    return { path: targetPath, type: 'file', size: data?.length || 0 };
  }

  reply(request, result, type = requestType(request.action)) {
    this.sendJson(type, { replyTo: request.id, result });
  }

  replyError(request, code, message) {
    this.sendJson(TYPES.ERROR, { replyTo: request.id, code, message });
  }

  sendJson(type, value) {
    this.sendFrame(type, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  sendFrame(type, payload) {
    const frame = encodeFrame(type, payload, {
      magic: this.magic,
      sequence: this.sequence++,
    });
    const first = Math.min(7, frame.length);
    const second = Math.min(first + 11, frame.length);
    this.evidence.noisyFrames += 1;
    this.evidence.fragmentedFrames += 1;
    this.emitData(Buffer.concat([Buffer.from('serial-noise:'), frame.subarray(0, first)]));
    this.emitData(frame.subarray(first, second));
    this.emitData(frame.subarray(second));
  }

  emitRawFragmented(data) {
    const split = Math.max(1, Math.floor(data.length / 2));
    this.emitData(data.subarray(0, split));
    this.emitData(data.subarray(split));
  }

  emitData(data) {
    setImmediate(() => {
      if (this.port?.isOpen) this.port.emit('data', Buffer.from(data));
    });
  }
}

function requestType(action) {
  return action?.startsWith('file.') ? TYPES.FILE : TYPES.CONTROL;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

module.exports = {
  FakeSerialLinuxPeer,
  FakeSerialPort,
  SERIAL_JPEG_FRAMES,
};
