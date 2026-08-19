const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  JsonKnownHostStore,
  LinuxSshDriver,
  MemoryKnownHostStore,
  fingerprintHostKey,
} = require('../python-runtime/linux-ssh/driver');

class FakeStream extends EventEmitter {
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
  constructor() {
    this.calls = [];
    this.files = new Map();
    this.handles = new Map();
    this.nextHandle = 1;
  }

  open(path, flags, callback) {
    this.calls.push(['open', path, flags]);
    if (!this.files.has(path) && flags === 'r') {
      const error = new Error('missing');
      error.code = 2;
      callback(error);
      return;
    }
    if (flags !== 'r') this.files.set(path, Buffer.alloc(0));
    const handle = Buffer.from(`h${this.nextHandle++}`);
    this.handles.set(handle.toString('hex'), { path, flags });
    callback(null, handle);
  }

  fstat(handle, callback) {
    const record = this.handles.get(handle.toString('hex'));
    this.calls.push(['fstat', Buffer.from(handle)]);
    callback(null, { size: this.files.get(record.path)?.length || 0, mode: 0o100644 });
  }

  read(handle, buffer, offset, length, position, callback) {
    const record = this.handles.get(handle.toString('hex'));
    const file = this.files.get(record.path) || Buffer.alloc(0);
    const bytesRead = file.copy(buffer, offset, position, position + length);
    this.calls.push(['read', Buffer.from(handle), offset, length, position]);
    callback(null, bytesRead, buffer);
  }

  write(handle, buffer, offset, length, position, callback) {
    const record = this.handles.get(handle.toString('hex'));
    const previous = this.files.get(record.path) || Buffer.alloc(0);
    const next = Buffer.alloc(Math.max(previous.length, position + length));
    previous.copy(next);
    buffer.copy(next, position, offset, offset + length);
    this.files.set(record.path, next);
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
    if (this.files.has(newPath)) {
      const error = new Error('Failure');
      error.code = 4;
      callback(error);
      return;
    }
    this.files.set(newPath, this.files.get(oldPath) || Buffer.alloc(0));
    this.files.delete(oldPath);
    callback(null);
  }

  unlink(path, callback) {
    this.calls.push(['unlink', path]);
    this.files.delete(path);
    callback(null);
  }

  readdir(path, callback) {
    this.calls.push(['readdir', path]);
    callback(null, [{ filename: 'main.py', attrs: { size: 8, mtime: 123, mode: 0o100644 } }]);
  }

  stat(path, callback) {
    this.calls.push(['stat', path]);
    callback(null, { size: this.files.get(path)?.length || 0, mode: 0o100644 });
  }

  mkdir(path, callback) {
    this.calls.push(['mkdir', path]);
    callback(null);
  }

  rmdir(path, callback) {
    this.calls.push(['rmdir', path]);
    callback(null);
  }
}

class FakeClient extends EventEmitter {
  constructor({
    hostKey = Buffer.from('host-key'),
    sftp = new FakeSftp(),
    probe,
    runStartFailures = 0,
    previewStartFailures = 0,
    failCommands = [],
  } = {}) {
    super();
    this.hostKey = hostKey;
    this.sftpInstance = sftp;
    this.runStartFailures = runStartFailures;
    this.previewStartFailures = previewStartFailures;
    this.failCommands = failCommands;
    this.probe = probe || {
      platform: 'raspberry-pi',
      hostname: 'raspberrypi',
      architecture: 'aarch64',
      pythonVersion: '3.11.2',
      pythonExecutable: '/usr/bin/python3',
      homeDirectory: '/home/pi',
      writableWorkspace: '/home/pi/.aily',
      autostart: 'systemd',
      previewBackend: 'opencv',
    };
    this.execCalls = [];
  }

  connect(config) {
    this.config = config;
    const accepted = config.hostVerifier(this.hostKey);
    setImmediate(() => {
      if (accepted) this.emit('ready');
      else this.emit('error', new Error('Host key verification failed'));
    });
  }

  end() {
    this.ended = true;
  }

  sftp(callback) {
    if (this.sftpInstance instanceof Error) {
      callback(this.sftpInstance);
      return;
    }
    callback(null, this.sftpInstance);
  }

  exec(command, options, callback) {
    const stream = new FakeStream();
    this.execCalls.push({ command, options, stream });
    callback(null, stream);
    setImmediate(() => {
      if (command.includes('__AILY_CAPABILITY_PROBE__')) {
        stream.emit('data', Buffer.from(`${JSON.stringify(this.probe)}\n`));
        stream.emit('close', 0);
        return;
      }
      if (this.shouldFailCommand(command)) {
        stream.stderr.emit('data', Buffer.from('Permission denied\n'));
        stream.emit('close', 1);
        return;
      }
      const launcher = decodeLauncher(command);
      if (launcher?.includes('control_nonce=')) {
        if (options?.pty && this.runStartFailures > 0) {
          this.runStartFailures -= 1;
          stream.emit('close', 1);
          return;
        }
        if (command.includes('# <aily-preview>') && this.previewStartFailures > 0) {
          this.previewStartFailures -= 1;
          stream.emit('close', 1);
          return;
        }
        const nonce = sourceString(launcher, 'control_nonce');
        const token = sourceString(launcher, 'token');
        const runId = sourceString(launcher, 'run_id');
        stream.emit('data', Buffer.from(`${nonce}${JSON.stringify({
          type: 'started',
          pid: 321,
          pgid: 321,
          token,
          starttime: '777',
          runId,
        })}\n`));
        return;
      }
      stream.emit('data', Buffer.from('{"ok":true,"stopped":true}\n'));
      stream.emit('close', 0);
    });
  }

  shouldFailCommand(command) {
    return this.failCommands.some(pattern => {
      if (typeof pattern === 'function') return pattern(command);
      if (pattern instanceof RegExp) return pattern.test(command);
      return String(command).includes(String(pattern));
    });
  }
}

class ChunkedFallbackClient extends EventEmitter {
  constructor({ alwaysRejectChunks = false, probe } = {}) {
    super();
    this.hostKey = Buffer.from('chunked-fallback-host-key');
    this.alwaysRejectChunks = alwaysRejectChunks;
    this.probe = probe || {
      platform: 'walnutpi',
      hostname: 'walnutpi',
      architecture: 'aarch64',
      pythonVersion: '3.11.2',
      pythonExecutable: '/usr/bin/python3',
      homeDirectory: '/root',
      writableWorkspace: '/data/aily',
      autostart: 'boot-start-sh',
      previewBackend: null,
    };
    this.execCalls = [];
    this.chunkAttempts = new Map();
    this.acceptedChunks = [];
    this.maxChunkLength = 0;
    this.commit = null;
  }

  connect(config) {
    this.config = config;
    const accepted = config.hostVerifier(this.hostKey);
    setImmediate(() => {
      if (accepted) this.emit('ready');
      else this.emit('error', new Error('Host key verification failed'));
    });
  }

  end() {
    this.ended = true;
  }

  sftp(callback) {
    const error = new Error('SFTP subsystem unavailable');
    error.code = 'SFTP_UNAVAILABLE';
    callback(error);
  }

  exec(command, options, callback) {
    const stream = new FakeStream();
    this.execCalls.push({ command, options, stream });
    callback(null, stream);
    setImmediate(() => {
      if (command.includes('__AILY_CAPABILITY_PROBE__')) {
        stream.emit('data', Buffer.from(`${JSON.stringify(this.probe)}\n`));
        stream.emit('close', 0);
        return;
      }

      if (command.length >= 100_000) {
        stream.stderr.emit('data', Buffer.from('file content was embedded in one SSH command'));
        stream.emit('close', 1);
        return;
      }
      const source = decodeLauncher(command);
      const marker = sourceString(source || '', 'protocol_marker');
      if (!marker || !source?.includes('file_protocol_version=1')) {
        stream.stderr.emit('data', Buffer.from('missing chunked file protocol'));
        stream.emit('close', 1);
        return;
      }

      let input = '';
      stream.write = value => {
        stream.writes.push(Buffer.isBuffer(value) ? Buffer.from(value) : String(value));
        input += Buffer.from(value).toString('utf8');
        let newline;
        while ((newline = input.indexOf('\n')) >= 0) {
          const line = input.slice(0, newline);
          input = input.slice(newline + 1);
          if (line) this.handleProtocolMessage(stream, marker, JSON.parse(line));
        }
        return true;
      };
      stream.emit('data', Buffer.from(`${marker}${JSON.stringify({
        type: 'ready',
        operation: 'writeFile',
        chunkSize: 48 * 1024,
        retryLimit: 3,
      })}\n`));
    });
  }

  handleProtocolMessage(stream, marker, message) {
    if (message.type === 'chunk') {
      const attempts = (this.chunkAttempts.get(message.sequence) || 0) + 1;
      this.chunkAttempts.set(message.sequence, attempts);
      const chunk = Buffer.from(message.dataBase64, 'base64');
      this.maxChunkLength = Math.max(this.maxChunkLength, chunk.length);
      const shouldReject = this.alwaysRejectChunks
        || (message.sequence === 0 && attempts === 1);
      if (shouldReject) {
        stream.emit('data', Buffer.from(`${marker}${JSON.stringify({
          type: 'ack',
          ok: false,
          transferId: message.transferId,
          chunkId: message.chunkId,
          attempt: message.attempt,
          sequence: message.sequence,
          reason: 'injected retry',
        })}\n`));
        return;
      }
      assert.equal(message.length, chunk.length);
      assert.equal(message.crc32, testCrc32(chunk));
      assert.equal(message.sequence, this.acceptedChunks.length);
      this.acceptedChunks.push(chunk);
      stream.emit('data', Buffer.from(`${marker}${JSON.stringify({
        type: 'ack',
        ok: true,
        transferId: message.transferId,
        chunkId: message.chunkId,
        attempt: message.attempt,
        sequence: message.sequence,
        crc32: message.crc32,
      })}\n`));
      return;
    }

    if (message.type === 'commit') {
      const data = Buffer.concat(this.acceptedChunks);
      this.commit = message;
      assert.equal(message.length, data.length);
      assert.equal(message.sha256, createHash('sha256').update(data).digest('hex'));
      stream.emit('data', Buffer.from(`${marker}${JSON.stringify({
        type: 'result',
        written: true,
        length: data.length,
        sha256: message.sha256,
      })}\n`));
      stream.emit('close', 0);
    }
  }
}

class DelayedAckFallbackClient extends ChunkedFallbackClient {
  constructor(mode) {
    super();
    this.mode = mode;
    this.acceptedBySequence = new Map();
    this.protocolMessages = [];
  }

  handleProtocolMessage(stream, marker, message) {
    this.protocolMessages.push(message);
    if (message.type === 'chunk') {
      const attempts = (this.chunkAttempts.get(message.sequence) || 0) + 1;
      this.chunkAttempts.set(message.sequence, attempts);
      const chunk = Buffer.from(message.dataBase64, 'base64');
      this.maxChunkLength = Math.max(this.maxChunkLength, chunk.length);
      const emitAck = (ok, delay) => {
        setTimeout(() => {
          stream.emit('data', Buffer.from(`${marker}${JSON.stringify({
            type: 'ack',
            ok,
            transferId: message.transferId,
            chunkId: message.chunkId,
            attempt: message.attempt,
            sequence: message.sequence,
            crc32: message.crc32,
            ...(ok ? {} : { reason: 'injected delayed retry' }),
          })}\n`));
        }, delay);
      };
      const accept = () => {
        if (!this.acceptedBySequence.has(message.sequence)) {
          this.acceptedBySequence.set(message.sequence, chunk);
        }
      };

      if (this.mode === 'late-nack') {
        if (attempts === 1) {
          emitAck(false, 40);
        } else if (attempts === 2) {
          accept();
          emitAck(true, 25);
        }
        return;
      }

      if (this.mode === 'consecutive-late-acks') {
        accept();
        if (attempts === 1) {
          emitAck(true, 40);
          emitAck(true, 45);
        } else if (attempts === 2) {
          emitAck(true, 25);
        }
        return;
      }

      if (this.mode === 'cross-chunk') {
        accept();
        if (message.sequence === 0 && attempts === 1) {
          emitAck(true, 0);
          emitAck(true, 10);
        } else if (message.sequence === 1 && attempts === 1) {
          emitAck(true, 20);
        } else {
          emitAck(true, 20);
        }
      }
      return;
    }

    if (message.type === 'commit') {
      const data = Buffer.concat(
        Array.from(this.acceptedBySequence.entries())
          .sort(([left], [right]) => left - right)
          .map(([, chunk]) => chunk),
      );
      this.commit = message;
      const emitResult = () => {
        stream.emit('data', Buffer.from(`${marker}${JSON.stringify({
          type: 'result',
          written: true,
          length: data.length,
          sha256: message.sha256,
        })}\n`));
        stream.emit('close', 0);
      };
      if (this.mode === 'consecutive-late-acks') setTimeout(emitResult, 20);
      else emitResult();
    }
  }
}

test('resolves credentials and records the first host key using TOFU', async () => {
  const client = new FakeClient();
  const knownHosts = new MemoryKnownHostStore();
  const credentialCalls = [];
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: knownHosts,
    credentialProvider: {
      async resolve(id) {
        credentialCalls.push(id);
        return { password: 'secret' };
      },
    },
  });

  const result = await driver.connect(
    { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi', credentialId: 'pi-login' },
    {},
  );

  assert.deepEqual(credentialCalls, ['pi-login']);
  assert.equal(client.config.password, 'secret');
  assert.equal(result.connected, true);
  assert.equal(result.capabilities.pty, true);
  assert.equal(
    await knownHosts.get('pi.local:22'),
    fingerprintHostKey(client.hostKey),
  );
});

test('rejects a changed host key with a stable error code', async () => {
  const knownHosts = new MemoryKnownHostStore({
    'pi.local:22': fingerprintHostKey(Buffer.from('old-key')),
  });
  const driver = new LinuxSshDriver({
    clientFactory: () => new FakeClient({ hostKey: Buffer.from('new-key') }),
    knownHostStore: knownHosts,
  });

  await assert.rejects(
    driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' }),
    error => error.code === 'HOST_KEY_CHANGED',
  );
});

test('uploads atomically, runs python3 -u in a PTY, streams output, accepts input/resize, and stops safely', async () => {
  const sftp = new FakeSftp();
  const client = new FakeClient({ sftp });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    terminationGraceMs: 0,
  });
  const events = [];
  driver.on('event', event => events.push(event));
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const started = await driver.request('runScript', { script: 'print(input(), flush=True)' });
  const runCall = client.execCalls.find(call => call.options?.pty);
  assert.equal(started.running, true);
  assert.match(runCall.command, /python3' -u/);
  assert.equal(runCall.options.pty.term, 'xterm-256color');
  assert.ok(sftp.calls.some(call => call[0] === 'rename' && call[2].endsWith('/main.py')));

  runCall.stream.emit('data', Buffer.from('Ada\r\n'));
  assert.deepEqual(events.at(-1), {
    event: 'scriptOutput',
    params: { text: 'Ada\r\n', runId: started.runId },
  });

  await driver.request('terminalInput', { text: 'Ada\n' });
  await driver.request('terminalSetSize', { columns: 100, rows: 30 });
  assert.equal(runCall.stream.writes.at(-1), 'Ada\n');
  assert.deepEqual(runCall.stream.windowSizes.at(-1), [30, 100, 0, 0]);

  await driver.request('stopScript');
  const stopCall = client.execCalls.at(-1);
  assert.match(stopCall.command, /SIGTERM/);
  assert.match(stopCall.command, /SIGKILL/);
  assert.match(stopCall.command, /777/);
  assert.doesNotMatch(stopCall.command, /kill -TERM -- -\$\$/);
});

test('rejects a concurrent run start before remote launch and starts only one PTY', async () => {
  const client = new FakeClient();
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    runStartTimeoutMs: 40,
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const [first, second] = await Promise.allSettled([
    driver.request('runScript', { script: 'print("first")', runId: 'first' }),
    driver.request('runScript', { script: 'print("second")', runId: 'second' }),
  ]);

  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason.code, 'RUN_ALREADY_ACTIVE');
  assert.equal(client.execCalls.filter(call => call.options?.pty).length, 1);
  await driver.request('stopScript');
});

test('clears the run-start sentinel after failure so a later run can retry', async () => {
  const client = new FakeClient({ runStartFailures: 1 });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    runStartTimeoutMs: 40,
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const [first, concurrent] = await Promise.allSettled([
    driver.request('runScript', { script: 'print("fails")', runId: 'fails' }),
    driver.request('runScript', { script: 'print("blocked")', runId: 'blocked' }),
  ]);
  assert.equal(first.status, 'rejected');
  assert.equal(first.reason.code, 'RUN_START_FAILED');
  assert.equal(concurrent.status, 'rejected');
  assert.equal(concurrent.reason.code, 'RUN_ALREADY_ACTIVE');
  assert.equal(client.execCalls.filter(call => call.options?.pty).length, 1);

  const retry = await driver.request('runScript', { script: 'print("retry")', runId: 'retry' });
  assert.equal(retry.running, true);
  assert.equal(client.execCalls.filter(call => call.options?.pty).length, 2);
  await driver.request('stopScript');
});

test('coalesces concurrent preview starts into one remote process', async () => {
  const client = new FakeClient();
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    runStartTimeoutMs: 40,
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const results = await Promise.all([
    driver.request('startPreview', { fps: 2 }),
    driver.request('startPreview', { fps: 2 }),
  ]);

  assert.deepEqual(results[0], results[1]);
  assert.equal(
    client.execCalls.filter(call => call.command.includes('# <aily-preview>')).length,
    1,
  );
  await driver.request('stopPreview');
});

test('clears a failed preview-start sentinel and permits a later retry', async () => {
  const client = new FakeClient({ previewStartFailures: 1 });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    runStartTimeoutMs: 40,
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const failed = await Promise.allSettled([
    driver.request('startPreview', { fps: 2 }),
    driver.request('startPreview', { fps: 2 }),
  ]);
  assert.equal(failed[0].status, 'rejected');
  assert.equal(failed[0].reason.code, 'PREVIEW_UNAVAILABLE');
  assert.equal(failed[1].status, 'rejected');
  assert.equal(failed[1].reason.code, 'PREVIEW_UNAVAILABLE');
  assert.equal(
    client.execCalls.filter(call => call.command.includes('# <aily-preview>')).length,
    1,
  );

  const retry = await driver.request('startPreview', { fps: 2 });
  assert.equal(retry.running, true);
  assert.equal(
    client.execCalls.filter(call => call.command.includes('# <aily-preview>')).length,
    2,
  );
  await driver.request('stopPreview');
});

test('probes and uses a nonstandard absolute python3 path for run, stop, and preview helpers', async () => {
  const pythonExecutable = '/opt/aily/python/bin/python3';
  const client = new FakeClient({
    probe: {
      platform: 'raspberry-pi',
      hostname: 'raspberrypi',
      architecture: 'aarch64',
      pythonVersion: '3.12.4',
      pythonExecutable,
      homeDirectory: '/home/pi',
      writableWorkspace: '/home/pi/.aily',
      autostart: 'systemd',
      previewBackend: 'opencv',
    },
  });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    terminationGraceMs: 0,
  });
  const status = await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  assert.equal(status.capabilities.pythonExecutable, pythonExecutable);
  assert.match(client.execCalls[0].command, /command -v python3/);

  await driver.request('runScript', { script: 'print("path")' });
  const runCall = client.execCalls.find(call => call.options?.pty);
  assert.match(runCall.command, /^'\/opt\/aily\/python\/bin\/python3' -u -c /);
  assert.match(decodeLauncher(runCall.command), /os\.execv\("\/opt\/aily\/python\/bin\/python3"/);
  await driver.request('stopScript');
  assert.match(client.execCalls.at(-1).command, /^'\/opt\/aily\/python\/bin\/python3' -u -c /);

  await driver.request('startPreview', { fps: 2, resolution: { w: 320, h: 240 } });
  const previewCall = client.execCalls.find(call => call.command.includes('<aily-preview>'));
  assert.match(previewCall.command, /^'\/opt\/aily\/python\/bin\/python3' -u -c /);
  assert.match(sourceString(decodeLauncher(previewCall.command), 'preview_command'), /\/opt\/aily\/python\/bin\/python3/);
  await driver.request('stopPreview');
});

test('uses the probed nonstandard python3 path for the SSH file helper', async () => {
  const client = new ChunkedFallbackClient();
  client.probe = {
    platform: 'walnutpi',
    hostname: 'walnutpi',
    architecture: 'aarch64',
    pythonVersion: '3.12.4',
    pythonExecutable: '/data/venv/bin/python3',
    homeDirectory: '/root',
    writableWorkspace: '/data/aily',
    autostart: 'boot-start-sh',
    previewBackend: null,
  };
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });

  await driver.request('io.writeFile', {
    path: '/data/nonstandard-python.bin',
    dataBase64: Buffer.from('path').toString('base64'),
  });

  const fileCall = client.execCalls.find(call => !call.command.includes('__AILY_CAPABILITY_PROBE__'));
  assert.match(fileCall.command, /^'\/data\/venv\/bin\/python3' -u -c /);
});

test('uses the probed nonstandard python3 path in managed systemd and boot-start autostart files', async () => {
  const systemdSftp = new FakeSftp();
  const systemdClient = new FakeClient({
    sftp: systemdSftp,
    probe: {
      platform: 'raspberry-pi',
      hostname: 'raspberrypi',
      architecture: 'aarch64',
      pythonVersion: '3.12.4',
      pythonExecutable: '/opt/python/bin/python3',
      homeDirectory: '/home/pi',
      writableWorkspace: '/home/pi/.aily',
      autostart: 'systemd',
      previewBackend: null,
    },
  });
  const systemdDriver = new LinuxSshDriver({
    clientFactory: () => systemdClient,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await systemdDriver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });
  await systemdDriver.request('installAutostart', { projectId: 'demo', script: 'print("boot")' });
  assert.match(
    systemdSftp.files.get('/home/pi/.aily/demo/.aily-demo.service.tmp').toString('utf8'),
    /ExecStart=\/opt\/python\/bin\/python3 -u /,
  );

  const bootSftp = new FakeSftp();
  const bootClient = new FakeClient({
    sftp: bootSftp,
    probe: {
      platform: 'walnutpi',
      hostname: 'walnutpi',
      architecture: 'aarch64',
      pythonVersion: '3.12.4',
      pythonExecutable: '/data/venv/bin/python3',
      homeDirectory: '/root',
      writableWorkspace: '/data/aily',
      autostart: 'boot-start-sh',
      previewBackend: null,
    },
  });
  const bootDriver = new LinuxSshDriver({
    clientFactory: () => bootClient,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await bootDriver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });
  await bootDriver.request('installAutostart', { projectId: 'demo', script: 'print("boot")' });
  assert.match(
    bootSftp.files.get('/boot/start/aily-demo.sh').toString('utf8'),
    /nohup '\/data\/venv\/bin\/python3' -u /,
  );
});

test('uses the real ssh2 SFTP handle API and atomically renames writes', async () => {
  const sftp = new FakeSftp();
  sftp.files.set('/home/pi/input.bin', Buffer.from([0, 1, 255]));
  const driver = new LinuxSshDriver({
    clientFactory: () => new FakeClient({ sftp }),
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const read = await driver.request('io.readFile', { path: '/home/pi/input.bin' });
  assert.deepEqual(Buffer.from(read.dataBase64, 'base64'), Buffer.from([0, 1, 255]));
  await driver.request('io.writeFile', {
    path: '/home/pi/output.bin',
    dataBase64: Buffer.from([9, 8, 7]).toString('base64'),
  });

  assert.ok(sftp.calls.some(call => call[0] === 'fstat' && Buffer.isBuffer(call[1])));
  const rename = sftp.calls.find(call => call[0] === 'rename' && call[2] === '/home/pi/output.bin');
  assert.match(rename[1], /^\/home\/pi\/\.output\.bin\.aily-/);
  assert.deepEqual(sftp.files.get('/home/pi/output.bin'), Buffer.from([9, 8, 7]));
});

test('overwrites an existing SFTP file when OpenSSH rename refuses to replace it', async () => {
  const sftp = new FakeSftp();
  const driver = new LinuxSshDriver({
    clientFactory: () => new FakeClient({ sftp }),
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });
  await driver.request('io.writeFile', {
    path: '/home/pi/main.py',
    dataBase64: Buffer.from('first').toString('base64'),
  });
  await driver.request('io.writeFile', {
    path: '/home/pi/main.py',
    dataBase64: Buffer.from('second').toString('base64'),
  });
  assert.deepEqual(sftp.files.get('/home/pi/main.py'), Buffer.from('second'));
  assert.ok(sftp.calls.some(call => call[0] === 'unlink' && call[1] === '/home/pi/main.py'));
});

test('creates missing parent directories before a nested SFTP mkdir', async () => {
  const client = new FakeClient();
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });
  await driver.request('io.mkdir', { path: '/home/pi/.aily/project' });
  assert.ok(client.execCalls.some(call => (
    /mkdir -p/.test(call.command)
    && call.command.includes("'/home/pi/.aily/project'")
  )));
});

test('streams a 4 MiB SFTP fallback write in CRC chunks and retries a rejected chunk', async () => {
  const client = new ChunkedFallbackClient();
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });
  const data = Buffer.allocUnsafe(4 * 1024 * 1024);
  for (let index = 0; index < data.length; index += 1) data[index] = index % 251;

  const result = await driver.request('io.writeFile', {
    path: '/data/fallback.bin',
    dataBase64: data.toString('base64'),
  });

  const fileCall = client.execCalls.find(call => !call.command.includes('__AILY_CAPABILITY_PROBE__'));
  assert.ok(fileCall.command.length < 100_000, 'file content must not be embedded in one SSH command');
  assert.ok(client.acceptedChunks.length > 80);
  assert.equal(client.maxChunkLength <= 48 * 1024, true);
  assert.equal(client.chunkAttempts.get(0), 2);
  assert.deepEqual(Buffer.concat(client.acceptedChunks), data);
  assert.equal(result.length, data.length);
  assert.equal(result.sha256, createHash('sha256').update(data).digest('hex'));
});

test('stops an SFTP fallback write after at most three chunk retries', async () => {
  const client = new ChunkedFallbackClient({ alwaysRejectChunks: true });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });

  await assert.rejects(
    driver.request('io.writeFile', {
      path: '/data/retry.bin',
      dataBase64: Buffer.from('retry me').toString('base64'),
    }),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  assert.equal(client.chunkAttempts.get(0), 4);
  assert.equal(client.commit, null);
});

test('discards a timed-out chunk NACK instead of consuming it as the next attempt response', async () => {
  const client = new DelayedAckFallbackClient('late-nack');
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    fileProtocolTimeoutMs: 30,
  });
  await driver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });

  await driver.request('io.writeFile', {
    path: '/data/late-nack.bin',
    dataBase64: Buffer.from('late nack').toString('base64'),
  });

  const chunks = client.protocolMessages.filter(message => message.type === 'chunk');
  assert.equal(client.chunkAttempts.get(0), 2);
  assert.ok(chunks.every(message => typeof message.transferId === 'string' && message.transferId));
  assert.ok(chunks.every(message => typeof message.chunkId === 'string' && message.chunkId));
  assert.deepEqual(chunks.map(message => message.attempt), [0, 1]);
});

test('discards consecutive late ACKs without letting them satisfy a retry or commit response', async () => {
  const client = new DelayedAckFallbackClient('consecutive-late-acks');
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    fileProtocolTimeoutMs: 30,
  });
  await driver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });

  const result = await driver.request('io.writeFile', {
    path: '/data/consecutive-late-acks.bin',
    dataBase64: Buffer.from('late acknowledgements').toString('base64'),
  });

  assert.equal(client.chunkAttempts.get(0), 2);
  assert.equal(result.written, true);
});

test('discards a prior chunk ACK while the next chunk is awaiting its own response', async () => {
  const client = new DelayedAckFallbackClient('cross-chunk');
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
    fileProtocolTimeoutMs: 100,
  });
  await driver.connect({ kind: 'ssh', host: 'walnutpi.local', port: 22, username: 'root' });
  const data = Buffer.alloc((48 * 1024) + 1, 7);

  await driver.request('io.writeFile', {
    path: '/data/cross-chunk.bin',
    dataBase64: data.toString('base64'),
  });

  assert.equal(client.chunkAttempts.get(0), 1);
  assert.equal(client.chunkAttempts.get(1), 1);
});

test('installs, queries, and removes systemd autostart through the unified request API', async () => {
  const client = new FakeClient();
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const installed = await driver.request('installAutostart', {
    projectId: 'demo',
    script: 'print("boot")',
  });
  const status = await driver.request('autostartStatus', { projectId: 'demo' });
  const removed = await driver.request('removeAutostart', { projectId: 'demo' });

  assert.equal(installed.installed, true);
  assert.equal(status.kind, 'systemd');
  assert.equal(removed.removed, true);
  assert.ok(client.execCalls.some(call => /systemctl enable/.test(call.command)));
  assert.ok(client.execCalls.some(call => /systemctl is-enabled/.test(call.command)));
  assert.ok(client.execCalls.some(call => /systemctl disable/.test(call.command)));
});

test('runs camera preview in an independent process group and emits JPEG frames', async () => {
  const client = new FakeClient();
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  const frames = [];
  driver.on('frame', payload => frames.push(payload.data));
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  const result = await driver.request('startPreview', { fps: 2, resolution: { w: 320, h: 240 } });
  const previewCall = client.execCalls.find(call => call.command.includes('<aily-preview>'));
  previewCall.stream.emit('data', Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]));

  assert.equal(result.running, true);
  assert.equal(frames.length, 1);
  await driver.request('stopPreview');
  assert.ok(client.execCalls.some(call => /preview.*SIGTERM|SIGTERM.*preview/.test(call.command)));
});

test('rolls back only the managed systemd unit when enable fails and keeps the original error', async () => {
  const sftp = new FakeSftp();
  const client = new FakeClient({
    sftp,
    failCommands: [command => /systemctl enable --now/.test(command)],
  });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  await assert.rejects(
    driver.request('installAutostart', { projectId: 'demo', script: 'print("boot")' }),
    error => error.code === 'AUTOSTART_PERMISSION_DENIED',
  );

  const commands = client.execCalls.map(call => call.command);
  assert.ok(commands.some(command => /systemctl disable --now 'aily-demo\.service'/.test(command)));
  assert.ok(commands.some(command => /rm -f '\/etc\/systemd\/system\/aily-demo\.service'/.test(command)));
  assert.ok(commands.some(command => /rm -f '\/home\/pi\/\.aily\/demo\/\.aily-demo\.service\.tmp'/.test(command)));
  assert.ok(commands.some(command => /systemctl daemon-reload/.test(command)));
  assert.ok(!commands.some(command => /ssh\.service|cron\.service|unrelated/.test(command)));
});

test('continues remaining systemd rollback steps after a rollback command fails', async () => {
  const sftp = new FakeSftp();
  const client = new FakeClient({
    sftp,
    failCommands: [
      command => /systemctl enable --now/.test(command),
      command => /systemctl disable --now 'aily-demo\.service'/.test(command),
    ],
  });
  const driver = new LinuxSshDriver({
    clientFactory: () => client,
    knownHostStore: new MemoryKnownHostStore(),
  });
  await driver.connect({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' });

  await assert.rejects(
    driver.request('installAutostart', { projectId: 'demo', script: 'print("boot")' }),
    error => error.code === 'AUTOSTART_PERMISSION_DENIED',
  );

  const commands = client.execCalls.map(call => call.command);
  assert.ok(commands.some(command => /rm -f '\/etc\/systemd\/system\/aily-demo\.service'/.test(command)));
  assert.ok(commands.some(command => /rm -f '\/home\/pi\/\.aily\/demo\/\.aily-demo\.service\.tmp'/.test(command)));
  assert.ok(commands.some(command => /systemctl daemon-reload/.test(command)));
});

test('serializes concurrent first-time JsonKnownHostStore writes without dropping records', async () => {
  const filePath = path.join(os.tmpdir(), `aily-known-hosts-${randomUUID()}.json`);
  const store = new JsonKnownHostStore(filePath);
  try {
    await Promise.all([
      store.set('pi.local:22', 'sha256:host-a'),
      store.set('walnutpi.local:22', 'sha256:host-b'),
    ]);
    const stored = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    assert.equal(stored['pi.local:22'], 'sha256:host-a');
    assert.equal(stored['walnutpi.local:22'], 'sha256:host-b');
  } finally {
    await fs.promises.rm(filePath, { force: true });
  }
});

test('a failed JsonKnownHostStore write does not poison later writes', async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aily-known-hosts-'));
  const filePath = path.join(directory, 'known-hosts.json');
  const store = new JsonKnownHostStore(filePath);
  const originalRename = fs.promises.rename;
  let failOnce = true;
  fs.promises.rename = async (from, to) => {
    if (failOnce && String(to) === filePath) {
      failOnce = false;
      const error = new Error('injected rename failure');
      error.code = 'EIO';
      throw error;
    }
    return originalRename.call(fs.promises, from, to);
  };
  try {
    await assert.rejects(store.set('pi.local:22', 'sha256:first'));
    await store.set('walnutpi.local:22', 'sha256:second');
    const stored = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    assert.equal(stored['walnutpi.local:22'], 'sha256:second');
  } finally {
    fs.promises.rename = originalRename;
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

function decodeLauncher(command) {
  const matches = command.match(/[A-Za-z0-9+/=]{100,}/g) || [];
  const encoded = matches.sort((left, right) => right.length - left.length)[0];
  return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : null;
}

function sourceString(source, name) {
  const match = source.match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match ? JSON.parse(match[1]) : '';
}

const TEST_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < TEST_CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  TEST_CRC_TABLE[index] = value >>> 0;
}

function testCrc32(value) {
  let result = 0xffffffff;
  for (const byte of value) {
    result = TEST_CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
  }
  return (result ^ 0xffffffff) >>> 0;
}
