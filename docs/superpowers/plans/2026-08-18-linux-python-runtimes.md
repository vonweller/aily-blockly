# Linux Python Runtimes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-ready `linux-ssh` and `linux-serial-shell` Python runtime adapters for Raspberry Pi and WalnutPi while preserving the verified CyberCAM K230 workflow.

**Architecture:** Electron owns a runtime broker that binds each renderer to adapter-scoped sessions and delegates to CanMV, SSH, or serial-shell drivers. Linux drivers share capability, process, autostart, path, and JPEG utilities; SSH uses native PTY/SFTP channels while serial-shell bootstraps a temporary Python-standard-library helper with a framed protocol. Angular consumes a discriminated endpoint and capability contract so the same panel can expose only the operations supported by the connected board.

**Tech Stack:** Electron/CommonJS, Node.js test runner, `ssh2`, `serialport`, Python 3 standard library, Angular 19, TypeScript, Jasmine/Karma, Playwright.

---

## File structure

- `electron/python-runtime/runtime-broker.js`: owns drivers, renderer owners, sessions, routing, event isolation, and cleanup.
- `electron/python-runtime/runtime-errors.js`: stable error codes and sanitized public errors.
- `electron/python-runtime/canmv-driver.js`: adapts the existing `CanmvBackend` without changing its binary protocol.
- `electron/python-runtime/linux-shared/*.js`: endpoint validation, Linux paths, launch tokens, capability normalization, autostart plans, and JPEG parsing.
- `electron/python-runtime/linux-ssh/*.js`: SSH connection, host-key verification, PTY process lifecycle, SFTP/file-helper transfer, and preview channel.
- `electron/python-runtime/linux-serial-shell/*.js`: raw serial transport, framing, bootstrap, temporary helper source, file transfer, process lifecycle, and preview scheduling.
- `electron/python-runtime/ipc.js`: validates adapter/session context and exposes broker operations.
- `electron/python-runtime/bootstrap.js`: builds drivers and registers the broker lazily.
- `electron/preload.js`, `electron/main.js`, `src/app/types/electron.d.ts`: typed renderer bridge and application lifecycle.
- `src/app/services/python-runtime/*.ts`: endpoint/capability types, context-bound bridge, Linux services/adapters, registry, and client session state.
- `src/app/editors/blockly-editor/components/python-runtime-panel/**`: transport-specific connection controls and capability-gated runtime actions.
- `electron/test/linux-*.test.js`, `src/app/services/python-runtime/*.spec.ts`, `e2e/tests/linux-python-runtime.spec.ts`: unit, integration, and UI coverage.
- `docs/python-board-runtime-compatibility.md`, `docs/linux-python-runtime-hardware-acceptance.md`, `docs/cybercam-development-handoff-2026-08-14.md`: compatibility, evidence, and handoff.

### Task 1: Introduce the Runtime Broker and session-scoped IPC

**Files:**
- Create: `electron/python-runtime/runtime-errors.js`
- Create: `electron/python-runtime/runtime-broker.js`
- Create: `electron/python-runtime/canmv-driver.js`
- Modify: `electron/python-runtime/ipc.js`
- Modify: `electron/python-runtime/bootstrap.js`
- Test: `electron/test/python-runtime-broker.test.js`
- Test: `electron/test/canmv-ipc.test.js`
- Test: `electron/test/python-runtime-bootstrap.test.js`

- [ ] **Step 1: Write failing broker routing tests**

```js
test('routes events only to the renderer that owns the session', async () => {
  const broker = new RuntimeBroker({ drivers: [fakeDriver('linux-ssh')] });
  const ownerA = broker.attachOwner({ id: 1, send: sentA.push.bind(sentA) });
  const ownerB = broker.attachOwner({ id: 2, send: sentB.push.bind(sentB) });
  const { sessionId } = await broker.connect(ownerA, {
    adapterId: 'linux-ssh',
    endpoint: { kind: 'ssh', host: 'pi.local', port: 22, username: 'pi' },
  });
  broker.emitSessionEvent(sessionId, 'event', { type: 'output', data: 'hello' });
  assert.equal(sentA.length, 1);
  assert.equal(sentB.length, 0);
});

test('destroying a renderer closes every session it owns', async () => {
  await broker.connect(owner, { adapterId: 'linux-ssh', endpoint });
  await broker.releaseOwner(owner.id);
  assert.equal(driver.disconnectCalls, 1);
});
```

- [ ] **Step 2: Run the broker tests and verify RED**

Run:

```powershell
node --test electron/test/python-runtime-broker.test.js
```

Expected: FAIL because `runtime-broker.js` and its exported `RuntimeBroker` do not exist.

- [ ] **Step 3: Implement stable errors and the broker contract**

```js
const RUNTIME_ERROR_CODES = Object.freeze({
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  INVALID_ENDPOINT: 'INVALID_ENDPOINT',
  AUTH_FAILED: 'AUTH_FAILED',
  HOST_KEY_CHANGED: 'HOST_KEY_CHANGED',
  SHELL_NOT_DETECTED: 'SHELL_NOT_DETECTED',
  PYTHON3_NOT_FOUND: 'PYTHON3_NOT_FOUND',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  SESSION_CLOSED: 'SESSION_CLOSED',
  RUN_ALREADY_ACTIVE: 'RUN_ALREADY_ACTIVE',
  RUN_START_FAILED: 'RUN_START_FAILED',
  RUN_STOP_FAILED: 'RUN_STOP_FAILED',
  FILE_TRANSFER_FAILED: 'FILE_TRANSFER_FAILED',
  AUTOSTART_PERMISSION_DENIED: 'AUTOSTART_PERMISSION_DENIED',
  PREVIEW_UNAVAILABLE: 'PREVIEW_UNAVAILABLE',
  PROTOCOL_DESYNC: 'PROTOCOL_DESYNC',
});
```

`RuntimeBroker.connect(ownerId, request)` must validate the driver, create a `crypto.randomUUID()` session, bind it to the owner, and wrap every driver event as:

```js
{
  adapterId: session.adapterId,
  sessionId: session.id,
  payload
}
```

`request()` must reject owner/session mismatches with `SESSION_CLOSED`; `releaseOwner()` must stop preview, stop runs, disconnect drivers, and remove event listeners.

- [ ] **Step 4: Wrap the existing CanMV backend**

`CanmvDriver` forwards the existing `status()` and `request(method, params)` calls, translates `connect` to `connectBoard`, and emits the existing `event`, `frame`, `state`, and `stderr` payloads through one broker session. It must preserve lazy executable startup and not alter `backend.js` or `protocol.js`.

- [ ] **Step 5: Convert IPC to explicit context validation**

Every request must accept:

```js
{
  context: {
    adapterId: 'canmv-k230',
    sessionId: 'uuid-after-connect'
  },
  payload: {}
}
```

`status`, `detectBoards`, and `connect` may omit `sessionId`; all other operations require it. IPC must remember the invoking `webContents.id` and call `broker.releaseOwner(id)` on `destroyed`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node --test electron/test/python-runtime-broker.test.js electron/test/canmv-ipc.test.js electron/test/python-runtime-bootstrap.test.js electron/test/canmv-backend.test.js electron/test/canmv-protocol.test.js
```

Expected: all tests pass; read-only status does not spawn the CanMV executable.

- [ ] **Step 7: Commit the broker**

```powershell
git add electron/python-runtime electron/test
git commit -m "feat(python): add session-scoped runtime broker"
```

### Task 2: Add shared Linux contracts, endpoint validation, and process launch plans

**Files:**
- Create: `electron/python-runtime/linux-shared/endpoint.js`
- Create: `electron/python-runtime/linux-shared/capabilities.js`
- Create: `electron/python-runtime/linux-shared/process-launcher.js`
- Create: `electron/python-runtime/linux-shared/posix-path.js`
- Test: `electron/test/linux-shared.test.js`

- [ ] **Step 1: Write failing endpoint and launch-plan tests**

```js
test('normalizes an SSH endpoint without retaining secrets', () => {
  assert.deepEqual(validateEndpoint({
    kind: 'ssh', host: ' pi.local ', port: 22, username: 'pi',
    password: 'secret', privateKeyPath: 'C:/keys/pi',
  }), {
    kind: 'ssh', host: 'pi.local', port: 22, username: 'pi',
    privateKeyPath: 'C:/keys/pi',
  });
});

test('builds an injection-safe python3 unbuffered launch', () => {
  const plan = createLaunchPlan('session-id', 'run-id');
  assert.equal(plan.scriptPath, '/tmp/aily-runtime/session-id/main.py');
  assert.match(plan.command, /python3 -u/);
  assert.doesNotMatch(plan.command, /session-id.*;/);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test electron/test/linux-shared.test.js
```

Expected: FAIL because the shared modules do not exist.

- [ ] **Step 3: Implement endpoint and POSIX path validation**

Accept only:

```js
{ kind: 'ssh', host, port, username, credentialId?, privateKeyPath? }
{ kind: 'serial-shell', port, baudRate }
```

Reject NUL, blank host/user/port, ports outside `1..65535`, serial baud outside `1200..12000000`, non-absolute board paths, backslashes, and `..` segments. Return metadata with no password, private-key contents, or passphrase.

- [ ] **Step 4: Implement capabilities and launch token helpers**

Normalize capabilities to:

```js
{
  platform: 'raspberry-pi' | 'walnutpi' | 'linux',
  hostname: string,
  architecture: string,
  pythonVersion: string,
  homeDirectory: string,
  writableWorkspace: string,
  pty: boolean,
  terminalResize: boolean,
  processGroups: boolean,
  files: 'sftp' | 'agent' | 'none',
  autostart: 'systemd' | 'boot-start-sh' | 'none',
  preview: { available: boolean, backend?: 'rpicam' | 'v4l2-ffmpeg' | 'opencv', transports: string[] }
}
```

`createLaunchPlan()` must generate random control nonce/run token, a fixed `/tmp/aily-runtime/<safe-session>/main.py` path, and a launcher that creates a new process group and records PID, PGID, token, and `/proc/<pid>/stat` start time before `exec python3 -u`.

- [ ] **Step 5: Run shared tests and commit**

```powershell
node --test electron/test/linux-shared.test.js
git add electron/python-runtime/linux-shared electron/test/linux-shared.test.js
git commit -m "feat(python): define shared Linux runtime contracts"
```

Expected: all shared tests pass and `git diff --check HEAD^` reports no whitespace errors.

### Task 3: Implement `linux-ssh` connection, PTY, input, resize, and process-group stop

**Files:**
- Modify: `electron/package.json`
- Modify: `electron/package-lock.json`
- Modify: `package.json`
- Create: `electron/python-runtime/linux-ssh/backend.js`
- Create: `electron/python-runtime/linux-ssh/session.js`
- Create: `electron/python-runtime/linux-ssh/process-controller.js`
- Test: `electron/test/linux-ssh-session.test.js`
- Test: `electron/test/linux-ssh-process.test.js`

- [ ] **Step 1: Install the SSH dependency**

Run:

```powershell
npm install --prefix electron ssh2@^1.16.0
```

Expected: `ssh2` is recorded in `electron/package.json` and lockfile. Add `electron/node_modules/ssh2/**` and `electron/node_modules/cpu-features/**` to `asarUnpack` only when dependency inspection shows native files that cannot execute inside ASAR.

- [ ] **Step 2: Write failing SSH session tests**

```js
test('requests a PTY and streams combined process output', async () => {
  const session = new SshRuntimeSession({ client: fakeClient, hostKeys, credentials });
  const started = await session.runScript('print("hello", flush=True)');
  assert.equal(started.command.includes('python3 -u'), true);
  fakeChannel.emit('data', Buffer.from('hello\r\n'));
  assert.deepEqual(events.at(-1).payload, { type: 'output', runId: started.runId, data: 'hello\r\n' });
});

test('writes PTY input and forwards terminal resize', async () => {
  await session.terminalInput('Ada\n');
  await session.terminalResize(120, 40);
  assert.equal(fakeChannel.writes.at(-1), 'Ada\n');
  assert.deepEqual(fakeChannel.windows.at(-1), [40, 120, 0, 0]);
});
```

- [ ] **Step 3: Run and verify RED**

Run:

```powershell
node --test electron/test/linux-ssh-session.test.js electron/test/linux-ssh-process.test.js
```

Expected: FAIL because the SSH runtime classes do not exist.

- [ ] **Step 4: Implement secure connection and host-key verification**

Use `ssh2.Client`. Resolve credentials at connection time through an injected credential provider. Compute the presented host-key fingerprint with SHA-256. First connection records `{ host, port, fingerprint }`; a changed fingerprint throws `HOST_KEY_CHANGED`. Sanitized diagnostics may include host, port, username, and fingerprint but never password, private-key contents, or passphrase.

- [ ] **Step 5: Implement PTY execution and events**

Create `/tmp/aily-runtime/<sessionId>/main.py` atomically, request an `xterm-256color` PTY, and run the controlled launcher. Parse only nonce-prefixed control lines; emit all other channel bytes as `output`. Return after the `started` control line and emit a single `exited` event when the channel closes.

- [ ] **Step 6: Implement safe process-group stop**

Use a separate SSH exec channel to verify run token and `/proc` start time, then:

```sh
kill -TERM -- "-$PGID"
for i in 1 2 3 4 5 6 7 8 9 10; do
  kill -0 -- "-$PGID" 2>/dev/null || exit 0
  sleep 0.2
done
kill -KILL -- "-$PGID" 2>/dev/null || true
```

Reject stale PID/PGID records; disconnect and owner cleanup call the same stop operation.

- [ ] **Step 7: Run focused tests and commit**

```powershell
node --test electron/test/linux-ssh-session.test.js electron/test/linux-ssh-process.test.js electron/test/python-runtime-broker.test.js
git add electron/package.json electron/package-lock.json package.json electron/python-runtime/linux-ssh electron/test
git commit -m "feat(python): run Linux scripts over SSH PTY"
```

Expected: all focused tests pass, including authentication failure, disconnect cleanup, output, input, resize, TERM, KILL, and stale-process rejection.

### Task 4: Add SSH files, autostart, and camera preview

**Files:**
- Create: `electron/python-runtime/linux-shared/autostart.js`
- Create: `electron/python-runtime/linux-shared/jpeg-stream.js`
- Create: `electron/python-runtime/linux-ssh/sftp-files.js`
- Create: `electron/python-runtime/linux-ssh/python-file-helper.js`
- Create: `electron/python-runtime/linux-ssh/preview.js`
- Modify: `electron/python-runtime/linux-ssh/backend.js`
- Test: `electron/test/linux-ssh-files.test.js`
- Test: `electron/test/linux-autostart.test.js`
- Test: `electron/test/linux-preview.test.js`

- [ ] **Step 1: Write failing SFTP and fallback tests**

```js
test('writes through a sibling temporary file then atomically renames it', async () => {
  await files.writeFile('/home/pi/app/data.bin', Buffer.from([0, 255]));
  assert.deepEqual(sftp.calls.slice(-2), [
    ['writeFile', match(/^\/home\/pi\/app\/\.data\.bin\.aily-/), Buffer.from([0, 255])],
    ['rename', match(/^\/home\/pi\/app\/\.data\.bin\.aily-/), '/home/pi/app/data.bin'],
  ]);
});

test('uses the Python file helper when SFTP is unavailable', async () => {
  const files = await createSshFiles({ openSftp: async () => { throw new Error('disabled'); }, execPython });
  assert.equal(files.capability, 'agent');
});
```

- [ ] **Step 2: Write failing autostart and JPEG parser tests**

```js
test('creates a managed Raspberry Pi systemd unit', () => {
  const plan = createAutostartPlan(capabilities, { projectId: 'demo-1', scriptPath: '/home/pi/aily/demo/main.py' });
  assert.equal(plan.unitName, 'aily-demo-1.service');
  assert.match(plan.unitText, /ExecStart=\/usr\/bin\/python3 -u/);
});

test('extracts split and concatenated JPEG frames', () => {
  assert.deepEqual(parser.push(Buffer.concat([jpegA, jpegB])), [jpegA, jpegB]);
});
```

- [ ] **Step 3: Run and verify RED**

Run:

```powershell
node --test electron/test/linux-ssh-files.test.js electron/test/linux-autostart.test.js electron/test/linux-preview.test.js
```

Expected: FAIL because file, autostart, and preview modules do not exist.

- [ ] **Step 4: Implement SFTP CRUD and the standard-library fallback**

Implement list/stat/read/write/delete/rename/mkdir/rmdir. Binary reads return Base64 at IPC. Writes use a sibling temporary file, verify byte length, and rename atomically. The fallback Python command exchanges numbered Base64 chunks with length, CRC32, ACK/retry, final SHA-256, and `os.replace()`; cap retries at three and surface `FILE_TRANSFER_FAILED`.

- [ ] **Step 5: Implement systemd and `/boot/start` autostart**

Raspberry Pi plans use a filtered stable project ID, an absolute script path, `python3 -u`, `Restart=on-failure`, `daemon-reload`, `enable`, `start`, `status`, `disable`, and uninstall. Probe writable unit directories and non-interactive sudo; permission failure returns `AUTOSTART_PERMISSION_DENIED` without a fallback.

WalnutPi plans write the Python file and `/boot/start/aily-<projectId>.sh` atomically. The shell script uses an absolute path and:

```sh
#!/bin/sh
exec /usr/bin/python3 -u /data/aily/<projectId>/main.py >>/data/aily/<projectId>/autostart.log 2>&1 &
```

Both implementations support query, update, uninstall, and cleanup of partially written managed files.

- [ ] **Step 6: Implement delayed camera capability and SSH binary preview**

Probe in order: `rpicam-vid`/`libcamera-vid`, V4L2 with FFmpeg, then importable OpenCV. Start preview on a separate SSH channel, parse JPEG SOI/EOI boundaries, cap a frame at 8 MiB, and stop only the preview process group. Do not install packages.

- [ ] **Step 7: Run tests and commit**

```powershell
node --test electron/test/linux-ssh-files.test.js electron/test/linux-autostart.test.js electron/test/linux-preview.test.js electron/test/linux-ssh-session.test.js
git add electron/python-runtime/linux-shared electron/python-runtime/linux-ssh electron/test
git commit -m "feat(python): add SSH files autostart and preview"
```

Expected: all focused tests pass, including binary files, empty files, atomic rename, permission failure, rollback, JPEG fragmentation, and independent preview stop.

### Task 5: Implement serial-shell framing and temporary helper bootstrap

**Files:**
- Create: `electron/python-runtime/linux-serial-shell/frame-codec.js`
- Create: `electron/python-runtime/linux-serial-shell/serial-transport.js`
- Create: `electron/python-runtime/linux-serial-shell/shell-bootstrap.js`
- Create: `electron/python-runtime/linux-serial-shell/helper-source.js`
- Test: `electron/test/linux-serial-frame-codec.test.js`
- Test: `electron/test/linux-serial-bootstrap.test.js`

- [ ] **Step 1: Write failing frame parser tests**

```js
test('decodes split, concatenated, and noise-prefixed frames', () => {
  const parser = new FrameParser({ magic });
  assert.deepEqual(parser.push(Buffer.concat([Buffer.from('login:\r\n'), frameA.subarray(0, 7)])), []);
  assert.deepEqual(parser.push(Buffer.concat([frameA.subarray(7), frameB])), [payloadA, payloadB]);
});

test('drops a bad CRC frame and resynchronizes at the next magic', () => {
  assert.deepEqual(parser.push(Buffer.concat([badFrame, goodFrame])), [goodPayload]);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test electron/test/linux-serial-frame-codec.test.js electron/test/linux-serial-bootstrap.test.js
```

Expected: FAIL because serial-shell modules do not exist.

- [ ] **Step 3: Implement the framed protocol**

Use:

```text
magic[16] | version:u8 | type:u8 | flags:u16 | sequence:u32 |
payloadLength:u32 | crc32:u32 | payload[payloadLength]
```

Set a 16 MiB absolute payload cap. The parser must retain partial input, search for the next magic after CRLF/echo/banner/noise, reject unsupported versions, verify CRC32, and continue after a corrupt frame. Define distinct frame types for control, terminal, file, preview, ACK, error, and heartbeat.

- [ ] **Step 4: Implement raw serial transport and shell detection**

Reuse `createRawSerialPort()` from `electron/serial.js`; do not use the 100 ms throttled wrapper. Enumerate ports without opening them. On connect, send CR/LF, recognize login or shell prompts, and verify the active shell with:

```sh
printf '\n__AILY_SHELL_<nonce>__\n'
```

Reject an unverified port with `SHELL_NOT_DETECTED`, including a suggestion to choose the WalnutPi SERIAL-A port.

- [ ] **Step 5: Implement helper bootstrap and source**

Encode a Python-standard-library helper as small Base64 lines, write it to `/tmp/aily-runtime-helper-<nonce>.py`, verify SHA-256, and launch:

```sh
python3 -u /tmp/aily-runtime-helper-<nonce>.py --magic <hex>
```

The helper imports only `base64`, `binascii`, `fcntl`, `hashlib`, `json`, `os`, `pty`, `selectors`, `signal`, `struct`, `subprocess`, `termios`, `threading`, `time`, and `zlib`. It deletes itself during shutdown.

- [ ] **Step 6: Run tests and commit**

```powershell
node --test electron/test/linux-serial-frame-codec.test.js electron/test/linux-serial-bootstrap.test.js
git add electron/python-runtime/linux-serial-shell electron/test
git commit -m "feat(python): bootstrap framed WalnutPi serial sessions"
```

Expected: all tests pass for CRLF, echo, login prompt, shell prompt, split frames, concatenated frames, noise, CRC failure, resync, bootstrap hash failure, and cleanup.

### Task 6: Add serial PTY execution, stopping, file transfer, autostart, and preview

**Files:**
- Create: `electron/python-runtime/linux-serial-shell/backend.js`
- Create: `electron/python-runtime/linux-serial-shell/file-transfer.js`
- Create: `electron/python-runtime/linux-serial-shell/preview.js`
- Modify: `electron/python-runtime/linux-serial-shell/helper-source.js`
- Test: `electron/test/linux-serial-runtime.test.js`
- Test: `electron/test/linux-serial-files.test.js`
- Test: `electron/test/linux-serial-preview.test.js`

- [ ] **Step 1: Write failing serial runtime tests**

```js
test('runs python3 -u in a new process group and returns PTY output', async () => {
  const started = await backend.runScript('print("serial", flush=True)');
  assert.match(peer.lastRun.command, /python3 -u/);
  assert.equal(peer.lastRun.startNewSession, true);
  peer.output(started.runId, 'serial\r\n');
  assert.equal(events.at(-1).payload.data, 'serial\r\n');
});

test('prioritizes control and terminal frames over preview frames', () => {
  scheduler.enqueuePreview(frameA);
  scheduler.enqueuePreview(frameB);
  scheduler.enqueueTerminal(Buffer.from('answer\r\n'));
  assert.equal(scheduler.next().type, FRAME_TYPES.TERMINAL);
  assert.equal(scheduler.next().payload, frameB);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test electron/test/linux-serial-runtime.test.js electron/test/linux-serial-files.test.js electron/test/linux-serial-preview.test.js
```

Expected: FAIL because the serial backend operations do not exist.

- [ ] **Step 3: Implement helper PTY lifecycle**

The helper writes uploaded source to `/tmp/aily-runtime/<sessionId>/main.py`, calls:

```py
master_fd, slave_fd = pty.openpty()
child = subprocess.Popen(
    ["python3", "-u", script_path],
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    start_new_session=True,
    close_fds=True,
)
```

It reports run ID, PID, PGID, token, and `/proc` start time. Input writes to `master_fd`; resize calls `fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))`.

- [ ] **Step 4: Implement helper stop and disconnect cleanup**

Validate run token and `/proc` start time, send `SIGTERM` to the PGID, wait up to two seconds, then `SIGKILL`. Emit one exit event. Stop preview and the run before closing transport; remove helper and session temporary files.

- [ ] **Step 5: Implement serial file transfer and WalnutPi autostart**

Use numbered chunks no larger than 48 KiB, per-chunk CRC32, ACK/retry up to three times, final SHA-256, a default 32 MiB file cap, one active transfer, normalized absolute POSIX paths, temporary writes, and `os.replace()`. Expose list/stat/read/write/delete/rename/mkdir/rmdir and reuse the `/boot/start` plan from Task 4.

- [ ] **Step 6: Implement bounded serial preview**

Probe the same backend order as SSH. Request low-bandwidth JPEG defaults of 320×240 at 2 FPS. Enforce a 1 MiB frame cap and configurable byte budget; retain only the latest unsent frame and drop previews before delaying control, terminal, ACK, or heartbeat frames.

- [ ] **Step 7: Run tests and commit**

```powershell
node --test electron/test/linux-serial-frame-codec.test.js electron/test/linux-serial-bootstrap.test.js electron/test/linux-serial-runtime.test.js electron/test/linux-serial-files.test.js electron/test/linux-serial-preview.test.js electron/test/linux-autostart.test.js
git add electron/python-runtime/linux-serial-shell electron/test
git commit -m "feat(python): complete WalnutPi serial runtime"
```

Expected: all serial tests pass, including input, resize, TERM/KILL, stale PID protection, retry, empty/binary files, size limits, atomic replace, frame dropping, and helper cleanup.

### Task 7: Register Linux drivers and expose the context-bound Electron bridge

**Files:**
- Modify: `electron/python-runtime/bootstrap.js`
- Modify: `electron/python-runtime/ipc.js`
- Modify: `electron/preload.js`
- Modify: `electron/main.js`
- Modify: `src/app/types/electron.d.ts`
- Test: `electron/test/python-runtime-bootstrap.test.js`
- Test: `electron/test/python-runtime-ipc-context.test.js`
- Test: `electron/test/python-toolchain-wiring.test.js`

- [ ] **Step 1: Write failing registration and bridge tests**

```js
test('registers canmv-k230, linux-ssh, and linux-serial-shell lazily', () => {
  const runtime = createPythonRuntimeRegistration(options);
  assert.deepEqual(runtime.broker.adapterIds(), [
    'canmv-k230', 'linux-serial-shell', 'linux-ssh',
  ]);
  assert.equal(sshConnectCalls, 0);
  assert.equal(serialOpenCalls, 0);
});

test('rejects using a session from another renderer', async () => {
  await assert.rejects(
    invokeAs(senderB, channels.runScript, { context: { adapterId: 'linux-ssh', sessionId }, payload: { script: 'pass' } }),
    error => error.code === 'SESSION_CLOSED',
  );
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test electron/test/python-runtime-bootstrap.test.js electron/test/python-runtime-ipc-context.test.js electron/test/python-toolchain-wiring.test.js
```

Expected: FAIL because Linux drivers and context-bound bridge methods are not registered.

- [ ] **Step 3: Register all drivers lazily**

`createPythonRuntimeRegistration()` constructs the broker with `CanmvDriver`, `LinuxSshBackend`, and `LinuxSerialShellBackend`. Startup must not connect, enumerate, open serial ports, resolve credentials, or start native CanMV. Application quit disposes the broker once.

- [ ] **Step 4: Expose a typed bridge**

Preload methods accept explicit adapter/session context:

```js
connect: (adapterId, endpoint, credentials) =>
  ipcRenderer.invoke(channels.connect, {
    context: { adapterId },
    payload: { endpoint, credentials },
  }),
request: (context, operation, payload) =>
  ipcRenderer.invoke(channelFor(operation), { context, payload }),
onEvent: callback => subscribe(events.event, callback),
```

Credentials are sent only for the connect invocation and never echoed in results/events. Add autostart `install/status/uninstall` methods.

- [ ] **Step 5: Run tests and commit**

```powershell
node --test electron/test/python-runtime-*.test.js electron/test/canmv-*.test.js electron/test/python-toolchain-wiring.test.js
git add electron/python-runtime electron/preload.js electron/main.js src/app/types/electron.d.ts electron/test
git commit -m "feat(python): expose Linux runtime drivers to Electron"
```

Expected: all Electron runtime tests pass and CanMV method/event compatibility remains green.

### Task 8: Add Angular endpoint, capabilities, adapters, and session isolation

**Files:**
- Create: `src/app/services/python-runtime/python-runtime-endpoint.ts`
- Create: `src/app/services/python-runtime/python-runtime-capabilities.ts`
- Create: `src/app/services/python-runtime/bound-python-runtime-bridge.ts`
- Create: `src/app/services/python-runtime/linux-ssh-runtime.adapter.ts`
- Create: `src/app/services/python-runtime/linux-serial-shell-runtime.adapter.ts`
- Modify: `src/app/services/python-runtime/python-runtime-client.ts`
- Modify: `src/app/services/python-runtime/canmv-k230-runtime.adapter.ts`
- Modify: `src/app/services/python-runtime/python-mode.ts`
- Modify: `src/app/app.config.ts`
- Test: `src/app/services/python-runtime/linux-runtime-adapters.spec.ts`
- Test: `src/app/services/python-runtime/python-runtime-client.spec.ts`

- [ ] **Step 1: Write failing adapter and stale-event tests**

```ts
expect(registry.resolve({
  kind: 'python', adapter: 'linux-ssh', entry: 'main.py',
} as PythonRuntimeMetadata).id).toBe('linux-ssh');

bridge.emitEvent({
  adapterId: 'linux-ssh',
  sessionId: oldSessionId,
  payload: { type: 'output', runId: 'old', data: 'stale' },
});
expect(outputs).toEqual([]);
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npx ng test --watch=false --browsers=ChromeHeadless --include src/app/services/python-runtime/linux-runtime-adapters.spec.ts --include src/app/services/python-runtime/python-runtime-client.spec.ts
```

Expected: FAIL because Linux adapter and endpoint types do not exist.

- [ ] **Step 3: Implement discriminated endpoints and capabilities**

```ts
export type PythonRuntimeEndpoint =
  | { kind: 'canmv'; port: string; baudRate: number }
  | { kind: 'ssh'; host: string; port: number; username: string; credentialId?: string; privateKeyPath?: string }
  | { kind: 'serial-shell'; port: string; baudRate: number };
```

Add `sessionId`, `endpoint`, and `capabilities` to client state. Clear them on disconnect/backend stop. Ignore events and frames whose `adapterId` or `sessionId` do not match the bound adapter and active session.

- [ ] **Step 4: Implement context-bound bridges and adapters**

Each `BoundPythonRuntimeBridge` captures one adapter ID and adds the current session ID to Electron requests. Linux adapters validate matching metadata and endpoint kinds. Register:

```ts
CANMV_K230_RUNTIME_ADAPTER_PROVIDER
LINUX_SSH_RUNTIME_ADAPTER_PROVIDER
LINUX_SERIAL_SHELL_RUNTIME_ADAPTER_PROVIDER
```

The CanMV adapter keeps its current automatic USB flow and existing public methods.

- [ ] **Step 5: Run Angular runtime tests and commit**

```powershell
npx ng test --watch=false --browsers=ChromeHeadless --include src/app/services/python-runtime/*.spec.ts
git add src/app/services/python-runtime src/app/app.config.ts src/app/types/electron.d.ts
git commit -m "feat(python): register Linux runtime adapters"
```

Expected: all Python runtime specs pass and no adapter ID is duplicated.

### Task 9: Add SSH and serial connection UI with capability gating

**Files:**
- Modify: `src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.ts`
- Modify: `src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.html`
- Modify: `src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.scss`
- Modify: `src/app/editors/blockly-editor/components/python-runtime-panel/python-terminal/python-terminal.component.ts`
- Modify: `src/app/editors/blockly-editor/components/python-runtime-panel/remote-file-tree/remote-file-tree.component.ts`
- Test: `src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.spec.ts`

- [ ] **Step 1: Write failing transport UI tests**

```ts
expect(fixture.nativeElement.querySelector('[data-testid="ssh-host"]')).not.toBeNull();
expect(fixture.nativeElement.querySelector('[data-testid="serial-port"]')).toBeNull();

component.state = connectedState({
  files: 'none',
  autostart: 'none',
  preview: { available: false, transports: [] },
});
fixture.detectChanges();
expect(fileBrowser.disabled).toBeTrue();
expect(autostartButton.disabled).toBeTrue();
expect(previewButton.disabled).toBeTrue();
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
npx ng test --watch=false --browsers=ChromeHeadless --include src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.spec.ts
```

Expected: FAIL because the panel only renders a serial board selector and lacks Linux capability controls.

- [ ] **Step 3: Implement endpoint-specific connection controls**

For `linux-ssh`, render host, port, username, password or private-key path, and recent non-secret endpoints. For `linux-serial-shell`, render serial port and baud rate with a SERIAL-A hint. Password and passphrase live only in component memory until connect returns, then are cleared. CanMV retains the existing board dropdown.

- [ ] **Step 4: Gate runtime actions by capabilities**

Files require `files !== 'none'`; resize requires `terminalResize`; autostart requires `autostart !== 'none'`; preview requires `preview.available`. Disabled controls show the backend-provided reason. Terminal input remains available while a PTY run is active. Add Install/Status/Remove Autostart actions without coupling them to Run.

- [ ] **Step 5: Run panel and E2E tests**

```powershell
npx ng test --watch=false --browsers=ChromeHeadless --include src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.spec.ts --include src/app/services/python-runtime/*.spec.ts
npm run test:e2e:fast -- --grep "CyberCam"
```

Expected: Angular tests and existing CyberCAM E2E pass; the verified COM/CanMV controls remain unchanged.

- [ ] **Step 6: Commit**

```powershell
git add src/app/editors/blockly-editor/components/python-runtime-panel src/app/services/python-runtime
git commit -m "feat(python): add Linux runtime connection controls"
```

### Task 10: Add fake-peer integration tests, documentation, Windows launch, and hardware acceptance

**Files:**
- Create: `electron/test/fixtures/fake-ssh-runtime-server.js`
- Create: `electron/test/fixtures/fake-serial-linux-peer.js`
- Create: `electron/test/linux-runtime-integration.test.js`
- Create: `e2e/tests/linux-python-runtime.spec.ts`
- Create: `docs/linux-python-runtime-hardware-acceptance.md`
- Modify: `docs/python-board-runtime-compatibility.md`
- Modify: `docs/cybercam-development-handoff-2026-08-14.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing end-to-end backend scenarios**

The fake SSH server must exercise host-key capture, PTY request, `python3 -u`, output, input, resize, PGID stop, SFTP CRUD, systemd plan, and two JPEG frames. The fake serial peer must exercise shell verification, helper bootstrap, fragmented/noisy frames, output, input, resize, stop, file retry, `/boot/start`, preview dropping, and helper cleanup.

```js
test('completes the SSH runtime workflow', async () => {
  const session = await harness.connectSsh();
  await harness.runAndExpect(session, 'print(input())', 'Ada\n', 'Ada\r\n');
  await harness.resize(session, 100, 30);
  await harness.roundTripFile(session, '/tmp/aily.bin', Buffer.from([0, 1, 255]));
  await harness.previewFrames(session, 2);
  await harness.stop(session);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test electron/test/linux-runtime-integration.test.js
```

Expected: FAIL until both drivers complete the fake-peer workflows.

- [ ] **Step 3: Finish integration wiring and package scripts**

Add:

```json
{
  "test:python-runtime": "node --test electron/test/python-runtime-*.test.js electron/test/canmv-*.test.js electron/test/linux-*.test.js",
  "test:python-runtime:angular": "ng test --watch=false --browsers=ChromeHeadless --include src/app/services/python-runtime/*.spec.ts --include src/app/editors/blockly-editor/components/python-runtime-panel/**/*.spec.ts"
}
```

The Playwright scenario verifies the SSH form, serial form, capability gating, live output, stop state, file tree, autostart controls, preview frame, and unchanged CyberCAM form.

- [ ] **Step 4: Run the complete automated verification**

Run:

```powershell
npm run test:python-runtime
npm run test:python-runtime:angular
npm run test:create-cybercam-project
npm run test:cybercam-hardware-smoke
npm run test:e2e:fast -- --grep "CyberCam|Linux Python"
npx ng build --configuration development
git diff --check
```

Expected: every command exits `0` with zero failing tests and no whitespace errors.

- [ ] **Step 5: Start the Windows development application**

Run:

```powershell
npm run electron
```

Expected: Angular serves on port 4200, Electron opens the Blockly application, runtime registration reports no startup error, and selecting CanMV/Linux metadata renders the matching connection controls without opening SSH or serial automatically.

- [ ] **Step 6: Execute available real-device acceptance without inventing evidence**

Discover current serial ports and reachable configured hosts without opening unrelated ports. For a supplied Raspberry Pi, record firmware/OS, host-key fingerprint, Python version, PTY output/input/resize, stop timing, file checksum, systemd install/reboot/status/uninstall, and preview backend/frame count. For an independent WalnutPi, record the same SSH checks when available plus SERIAL-A/115200 shell, helper cleanup, file checksum, `/boot/start` reboot behavior, and serial preview.

If either physical device or its credentials are absent from the current machine, mark only that real-device row `BLOCKED — hardware/credential unavailable`; automated fake-peer acceptance remains a separate result and must not be labeled as real-device acceptance.

- [ ] **Step 7: Update compatibility and handoff documents**

`docs/linux-python-runtime-hardware-acceptance.md` must contain exact commands, timestamps, device identity, pass/fail evidence, cleanup evidence, and blocked reasons. The compatibility matrix must distinguish automated support from real-device verification. The handoff must name the branch, commit, launch command, test commands, remaining hardware-only action, and safe cleanup paths.

- [ ] **Step 8: Commit, push, and verify the remote**

```powershell
git add package.json electron src docs e2e
git commit -m "test(python): verify Linux runtime workflows"
git push origin codex/cybercam-main-integration
git status --short --branch
git rev-parse HEAD
git rev-parse origin/codex/cybercam-main-integration
```

Expected: local and remote commit IDs match; the branch is not ahead of its upstream; only explicitly documented local runtime artifacts may remain untracked.
