const assert = require('node:assert/strict');
const test = require('node:test');

const { buildHelperSource } = require('../python-runtime/linux-serial-shell/helper-source');

test('helper source implements PTY lifecycle, framed events, and guarded TERM to KILL stop', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x42),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-1',
  });

  assert.match(source, /pty\.openpty\(\)/);
  assert.match(source, /subprocess\.Popen/);
  assert.match(source, /start_new_session=True/);
  assert.match(source, /master_fd/);
  assert.match(source, /"started"/);
  assert.match(source, /"output"/);
  assert.match(source, /"exited"/);
  assert.match(source, /os\.write\(run\["master_fd"\]/);
  assert.match(source, /termios\.TIOCSWINSZ/);
  assert.match(source, /starttime/);
  assert.match(source, /token/);
  assert.match(source, /signal\.SIGTERM/);
  assert.match(source, /grace = max\(0\.0, min\(float\(grace\), 10\.0\)\)/);
  assert.match(source, /time\.monotonic\(\) \+ grace/);
  assert.match(source, /signal\.SIGKILL/);
});

test('helper sends started before output or wait threads can publish exited', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x43),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-fast-run',
  });

  const started = source.indexOf('send_runtime_event("started", **result)');
  const outputThread = source.indexOf('threading.Thread(target=read_run_output');
  const waitThread = source.indexOf('threading.Thread(target=wait_for_run');
  assert.ok(started >= 0);
  assert.ok(started < outputThread);
  assert.ok(started < waitThread);
});

test('helper source implements CRC framed file CRUD, atomic commit, preview priority, heartbeat, and cleanup', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x24),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-2',
  });

  assert.match(source, /struct\.Struct\(">16sBBHIII"\)/);
  assert.match(source, /MAX_PAYLOAD = 16 \* 1024 \* 1024/);
  assert.match(source, /zlib\.crc32/);
  assert.match(source, /TYPE_ACK/);
  assert.match(source, /file\.list/);
  assert.match(source, /file\.stat/);
  assert.match(source, /file\.write\.begin/);
  assert.match(source, /file\.write\.chunk/);
  assert.match(source, /file\.write\.commit/);
  assert.match(source, /file\.delete/);
  assert.match(source, /file\.rename/);
  assert.match(source, /file\.mkdir/);
  assert.match(source, /file\.rmdir/);
  assert.match(source, /hashlib\.sha256/);
  assert.match(source, /os\.replace/);
  assert.match(source, /MAX_PREVIEW_FRAME = 1024 \* 1024/);
  assert.match(source, /latest_preview/);
  assert.match(source, /high_priority/);
  assert.match(source, /TYPE_HEARTBEAT/);
  assert.match(source, /os\.unlink\(HELPER_PATH\)/);
  assert.match(source, /shutil\.rmtree\(SESSION_DIRECTORY/);
});

test('helper source acknowledges an immediately retried write chunk without writing it twice', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x33),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-retry',
  });

  assert.match(source, /"last_sequence": -1/);
  assert.match(source, /sequence == transfer\["last_sequence"\]/);
  assert.match(source, /checksum == transfer\["last_crc32"\]/);
  assert.match(source, /return \{"ack": True, "sequence": sequence, "crc32": checksum\}/);
});

test('helper enforces 32 MiB files and 48 KiB chunks for both read and write transfers', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x34),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-limits',
  });

  assert.match(source, /MAX_FILE_SIZE = 33554432/);
  assert.match(source, /MAX_FILE_CHUNK = 48 \* 1024/);
  assert.match(source, /if len\(data\) > MAX_FILE_CHUNK:/);
  assert.match(source, /if chunk_size < 1 or chunk_size > MAX_FILE_CHUNK:/);
});

test('helper source can create a managed autostart project directory recursively', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x44),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-autostart',
  });

  assert.match(source, /request\.get\("recursive"\)/);
  assert.match(source, /os\.makedirs\(path, exist_ok=True\)/);
});

test('helper source probes supported camera backends and builds preview commands without renderer argv', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x55),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-preview',
  });

  assert.match(source, /shutil\.which\("rpicam-vid"\)/);
  assert.match(source, /shutil\.which\("libcamera-vid"\)/);
  assert.match(source, /shutil\.which\("ffmpeg"\)/);
  assert.match(source, /importlib\.util\.find_spec\("cv2"\)/);
  assert.match(source, /def preview_command\(backend, width, height, fps\):/);
  assert.match(source, /request\.get\("fps"\), 2, 1, 30/);
  assert.doesNotMatch(source, /request\.get\("command"\)/);
});

test('helper drops queued and late preview frames when preview stops', () => {
  const source = buildHelperSource({
    magic: Buffer.alloc(16, 0x56),
    helperPath: '/tmp/aily-helper.py',
    sessionDirectory: '/tmp/aily-runtime/session-preview-stop',
  });

  assert.match(source, /def queue_preview_frame\(process, payload\):/);
  assert.match(source, /if preview_process is not process:\s+return False/);
  assert.match(source, /queue_preview_frame\(process, frame\)/);
  assert.match(
    source,
    /def stop_preview\(\):[\s\S]*with state_lock:[\s\S]*preview_process = None[\s\S]*with queue_condition:[\s\S]*latest_preview = None/,
  );
});
