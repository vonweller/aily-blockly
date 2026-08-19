'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LinuxSshDriver,
  MemoryKnownHostStore,
  fingerprintHostKey,
} = require('../python-runtime/linux-ssh/driver');
const {
  LinuxSerialShellDriver,
} = require('../python-runtime/linux-serial-shell/backend');
const {
  decodeLongestBase64,
  FakeSshRuntimeServer,
  SSH_JPEG_FRAMES,
} = require('./fixtures/fake-ssh-runtime-server');
const {
  FakeSerialLinuxPeer,
  SERIAL_JPEG_FRAMES,
} = require('./fixtures/fake-serial-linux-peer');

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const waitFor = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for fake-peer evidence`);
    }
    await nextTurn();
  }
};

test('linux-ssh driver completes the full workflow against the deterministic client/SFTP seam', async () => {
  const server = new FakeSshRuntimeServer();
  const knownHosts = new MemoryKnownHostStore();
  const driver = new LinuxSshDriver({
    clientFactory: () => server.createClient(),
    knownHostStore: knownHosts,
    sessionId: 'ssh-integration',
    terminationGraceMs: 0,
  });
  const events = [];
  const frames = [];
  driver.on('event', event => events.push(event));
  driver.on('frame', frame => frames.push(Buffer.from(frame.data)));

  const status = await driver.connect(
    {
      kind: 'ssh',
      host: 'raspberrypi.test',
      port: 22,
      username: 'pi',
      credentialId: 'fixture-password',
    },
    { password: 'deterministic-only' },
  );

  assert.equal(status.connected, true);
  assert.equal(status.capabilities.files, 'sftp');
  assert.equal(status.capabilities.autostart, 'systemd');
  assert.equal(status.capabilities.preview.available, true);
  assert.equal(
    await knownHosts.get('raspberrypi.test:22'),
    fingerprintHostKey(server.hostKey),
  );
  assert.equal(server.evidence.hostVerifierAccepted, true);

  const run = await driver.request('runScript', {
    script: 'print(input(), flush=True)',
    columns: 90,
    rows: 28,
  });
  await nextTurn();

  assert.equal(run.running, true);
  assert.match(server.evidence.run.command, /python3['"]? -u/);
  assert.deepEqual(server.evidence.run.pty, {
    term: 'xterm-256color',
    cols: 90,
    rows: 28,
    width: 0,
    height: 0,
  });
  assert.ok(events.some(event => (
    event.event === 'scriptOutput'
    && event.params.text === 'ssh fake output\r\n'
    && event.params.runId === run.runId
  )));

  await driver.request('terminalInput', { text: 'Ada\n' });
  await driver.request('terminalSetSize', { columns: 120, rows: 40 });
  assert.equal(server.evidence.run.input.at(-1), 'Ada\n');
  assert.deepEqual(server.evidence.run.resize.at(-1), [40, 120, 0, 0]);

  await driver.request('io.mkdir', { path: '/home/pi/project' });
  await driver.request('io.writeFile', {
    path: '/home/pi/project/main.py',
    dataBase64: Buffer.from('print("file")\n').toString('base64'),
  });
  const read = await driver.request('io.readFile', { path: '/home/pi/project/main.py' });
  const stat = await driver.request('io.stat', { path: '/home/pi/project/main.py' });
  const list = await driver.request('io.listDir', { path: '/home/pi/project' });
  await driver.request('io.renameFile', {
    oldPath: '/home/pi/project/main.py',
    newPath: '/home/pi/project/app.py',
  });
  await driver.request('io.deleteFile', { path: '/home/pi/project/app.py' });
  await driver.request('io.rmdir', { path: '/home/pi/project' });

  assert.equal(Buffer.from(read.dataBase64, 'base64').toString('utf8'), 'print("file")\n');
  assert.equal(stat.stat.type, 'file');
  assert.ok(list.entries.some(entry => entry.name === 'main.py'));
  assert.ok(server.evidence.sftpCalls.some(call => (
    call[0] === 'rename'
    && /^\/home\/pi\/project\/\.main\.py\.aily-/.test(call[1])
    && call[2] === '/home/pi/project/main.py'
  )));
  assert.ok(server.evidence.sftpCalls.some(call => call[0] === 'unlink'));
  assert.ok(server.evidence.sftpCalls.some(call => call[0] === 'rmdir'));

  const installed = await driver.request('installAutostart', {
    projectId: 'ssh-demo',
    script: 'print("boot")\n',
  });
  const autostartStatus = await driver.request('autostartStatus', {
    projectId: 'ssh-demo',
  });
  const removed = await driver.request('removeAutostart', {
    projectId: 'ssh-demo',
  });

  assert.equal(installed.kind, 'systemd');
  assert.deepEqual(autostartStatus, {
    kind: 'systemd',
    installed: true,
    running: true,
    unitName: 'aily-ssh-demo.service',
  });
  assert.equal(removed.removed, true);
  assert.ok(server.evidence.systemdCommands.some(command => /systemctl enable --now/.test(command)));
  assert.ok(server.evidence.systemdCommands.some(command => /systemctl is-enabled/.test(command)));
  assert.ok(server.evidence.systemdCommands.some(command => /systemctl disable --now/.test(command)));
  assert.match(
    server.sftp.files.get('/home/pi/.aily/ssh-demo/.aily-ssh-demo.service.tmp').toString('utf8'),
    /ExecStart=\/usr\/bin\/python3 -u/,
  );

  const preview = await driver.request('startPreview', {
    fps: 2,
    resolution: { w: 320, h: 240 },
  });
  assert.equal(preview.running, true);
  assert.notEqual(preview.pgid, run.pgid);
  assert.deepEqual(frames, SSH_JPEG_FRAMES);
  await driver.request('stopPreview');

  await driver.request('stopScript');
  const runStop = server.evidence.safeStopCommands.at(-1);
  const runStopSource = decodeLongestBase64(runStop);
  assert.match(runStop, /SIGTERM/);
  assert.match(runStop, /SIGKILL/);
  assert.match(runStopSource, /ssh-integration/);
  assert.match(runStopSource, new RegExp(run.token));
  assert.match(runStopSource, /expected_starttime="90101"/);
  assert.doesNotMatch(runStop, /kill -TERM -- -\$\$/);

  await driver.disconnect();
  assert.equal(server.evidence.clientEnded, true);
  assert.equal(driver.status().connected, false);
});

test('linux-serial-shell driver completes shell bootstrap and framed runtime workflow against a noisy peer', async () => {
  const magic = Buffer.alloc(16, 0x6a);
  const peer = new FakeSerialLinuxPeer({ magic });
  const driver = new LinuxSerialShellDriver({
    portFactory: options => peer.createPort(options),
    protocolMagic: magic,
    nonce: 'AILY_SERIAL_INTEGRATION_NONCE',
    nonceTimeoutMs: 500,
    bootstrapTimeoutMs: 1000,
    requestTimeoutMs: 1000,
    fileChunkSize: 8,
    previewFps: 1,
  });
  const events = [];
  const frames = [];
  driver.on('event', event => events.push(event));
  driver.on('frame', frame => frames.push(Buffer.from(frame.data)));

  const status = await driver.connect({
    port: 'COM-WALNUT-A',
    baudRate: 115200,
  });

  assert.equal(status.connected, true);
  assert.equal(status.capabilities.autostart, 'boot-start-sh');
  assert.equal(status.capabilities.files, 'agent');
  assert.equal(peer.evidence.shellPromptSent, true);
  assert.match(peer.evidence.shellVerificationCommand, /AILY_SERIAL_INTEGRATION_NONCE/);
  assert.ok(peer.evidence.bootstrapCommands.some(command => /base64 -d/.test(command)));
  assert.ok(peer.evidence.bootstrapCommands.some(command => /__AILY_HELPER_SHA__/.test(command)));
  assert.match(peer.evidence.helperStartCommand, /^exec python3 -u /);
  assert.ok(peer.evidence.fragmentedFrames > 0);
  assert.ok(peer.evidence.noisyFrames > 0);

  const run = await driver.request('runScript', {
    script: 'print(input(), flush=True)\n',
  });
  await waitFor(() => events.some(event => (
    event.event === 'scriptOutput'
    && event.params.text === 'serial fake output\r\n'
  )));

  assert.equal(run.running, true);
  assert.equal(peer.evidence.run.pythonCommand, `python3 -u ${run.scriptPath}`);
  assert.ok(events.some(event => (
    event.event === 'scriptOutput'
    && event.params.text === 'serial fake output\r\n'
  )));
  assert.ok(peer.evidence.fileChunkAttempts.get(`${run.scriptPath}:0`) >= 2);
  assert.equal(peer.evidence.atomicTransfers.get(run.scriptPath), true);

  await driver.request('terminalInput', { text: 'Grace\n' });
  await driver.request('terminalSetSize', { columns: 132, rows: 43 });
  assert.equal(peer.evidence.terminalInput.at(-1), 'Grace\n');
  assert.deepEqual(peer.evidence.resize.at(-1), { columns: 132, rows: 43 });

  await driver.request('io.mkdir', { path: '/data/project' });
  await driver.request('io.writeFile', {
    path: '/data/project/main.py',
    dataBase64: Buffer.from('print("serial file")\n').toString('base64'),
  });
  const read = await driver.request('io.readFile', { path: '/data/project/main.py' });
  const stat = await driver.request('io.stat', { path: '/data/project/main.py' });
  const list = await driver.request('io.listDir', { path: '/data/project' });
  await driver.request('io.renameFile', {
    oldPath: '/data/project/main.py',
    newPath: '/data/project/app.py',
  });
  await driver.request('io.deleteFile', { path: '/data/project/app.py' });
  await driver.request('io.rmdir', { path: '/data/project' });

  assert.equal(Buffer.from(read.dataBase64, 'base64').toString('utf8'), 'print("serial file")\n');
  assert.equal(stat.type, 'file');
  assert.ok(list.entries.some(entry => entry.name === 'main.py'));
  assert.ok(peer.evidence.actions.includes('file.rename'));
  assert.ok(peer.evidence.actions.includes('file.delete'));
  assert.ok(peer.evidence.actions.includes('file.rmdir'));

  const installed = await driver.request('installAutostart', {
    projectId: 'walnut-demo',
    script: 'print("boot")\n',
  });
  const autostartStatus = await driver.request('autostartStatus', {
    projectId: 'walnut-demo',
  });
  const installedBootScript = peer.evidence.autostartScripts.get(
    '/boot/start/aily-walnut-demo.sh',
  );
  const removed = await driver.request('removeAutostart', {
    projectId: 'walnut-demo',
  });

  assert.equal(installed.path, '/boot/start/aily-walnut-demo.sh');
  assert.equal(autostartStatus.installed, true);
  assert.equal(removed.removed, true);
  assert.match(installedBootScript, /python3 -u/);

  const preview = await driver.request('startPreview', {
    fps: 5,
    resolution: { w: 320, h: 240 },
  });
  assert.equal(preview.running, true);
  await waitFor(() => frames.length === 1 && driver.previewLimiter.pending !== null);
  driver.previewLimiter.flush(Date.now() + 2000);
  assert.deepEqual(frames, SERIAL_JPEG_FRAMES);
  assert.ok(driver.previewLimiter.droppedFrames > 0);
  await driver.request('stopPreview');

  await driver.request('stopScript');
  assert.deepEqual(peer.evidence.stopRequests.at(-1), {
    runId: run.runId,
    token: run.token,
    starttime: run.starttime,
  });

  await driver.disconnect();
  assert.equal(peer.evidence.helperShutdown, true);
  assert.equal(peer.evidence.helperRemoved, true);
  assert.equal(peer.port.isOpen, false);
  assert.equal(driver.status().connected, false);
});
