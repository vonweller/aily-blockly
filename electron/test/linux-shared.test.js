const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateEndpoint,
  createLaunchPlan,
  sanitizeSessionPart,
} = require('../python-runtime/linux-shared/endpoint');
const { normalizeCapabilities } = require('../python-runtime/linux-shared/capabilities');
const { validateBoardPath } = require('../python-runtime/linux-shared/posix-path');
const {
  RUNTIME_ERROR_CODES,
  runtimeError,
  toPublicRuntimeError,
} = require('../python-runtime/runtime-errors');

test('normalizes an SSH endpoint without retaining secrets', () => {
  assert.deepEqual(validateEndpoint({
    kind: 'ssh',
    host: ' pi.local ',
    port: 22,
    username: 'pi',
    password: 'secret',
    privateKeyPath: 'C:/keys/pi',
  }), {
    kind: 'ssh',
    host: 'pi.local',
    port: 22,
    username: 'pi',
    privateKeyPath: 'C:/keys/pi',
  });
});

test('validates serial shell endpoints and rejects unsafe values', () => {
  assert.deepEqual(validateEndpoint({
    kind: 'serial-shell',
    port: 'COM9',
    baudRate: 115200,
  }), {
    kind: 'serial-shell',
    port: 'COM9',
    baudRate: 115200,
  });
  assert.throws(
    () => validateEndpoint({ kind: 'ssh', host: 'pi; touch /tmp/pwn', port: 22, username: 'pi' }),
    /invalid/i,
  );
  assert.throws(
    () => validateEndpoint({ kind: 'ssh', host: 'pi.local', port: 22, username: 'pi\nwhoami' }),
    /invalid/i,
  );
});

test('builds an injection-safe python3 unbuffered launch', () => {
  const plan = createLaunchPlan('session-id', 'run-id', '/opt/aily/python/bin/python3');
  assert.equal(plan.scriptPath, '/tmp/aily-runtime/session-id/main.py');
  assert.match(plan.command, /\/opt\/aily\/python\/bin\/python3' -u/);
  assert.doesNotMatch(plan.command, /session-id.*;/);
  assert.equal(plan.runId, 'run-id');
  assert.match(plan.token, /^[a-f0-9-]{16,}$/);
  assert.match(plan.controlNonce, /^[a-f0-9-]{16,}$/);
  assert.match(plan.launcherSource, /os\.setsid\(\)/);
  assert.match(plan.launcherSource, /except PermissionError:/);
  assert.match(plan.launcherSource, /os\.getpgid\(0\)/);
  assert.match(plan.launcherSource, /\/proc\/.*\/stat/);
  assert.match(plan.launcherSource, /os\.replace/);
  assert.match(plan.launcherSource, /\/opt\/aily\/python\/bin\/python3/);
  assert.match(plan.launcherSource, /-u/);
  assert.throws(
    () => createLaunchPlan('session-id', 'run-id', 'python3'),
    /absolute POSIX path/i,
  );
  assert.throws(
    () => createLaunchPlan('session-id', 'run-id', '/opt/python/../bin/python3'),
    /absolute POSIX path/i,
  );
});

test('normalizes capability defaults without inventing preview support', () => {
  const capabilities = normalizeCapabilities({
    platform: 'walnutpi',
    hostname: 'walnut',
    architecture: 'aarch64',
    pythonVersion: '3.11.2',
    homeDirectory: '/root',
    writableWorkspace: '/data/aily',
    pty: true,
    terminalResize: true,
    processGroups: true,
    files: 'agent',
    autostart: 'boot-start-sh',
  });
  assert.equal(capabilities.preview.available, false);
  assert.deepEqual(capabilities.preview.transports, []);
});

test('filters unsupported capability enum values', () => {
  const capabilities = normalizeCapabilities({
    files: 'bogus',
    autostart: 'bogus',
    preview: {
      available: true,
      backend: 'bogus',
      transports: ['bogus', 'ssh-binary', 'ssh-binary'],
    },
  });
  assert.equal(capabilities.files, 'none');
  assert.equal(capabilities.autostart, 'none');
  assert.deepEqual(capabilities.preview, {
    available: true,
    transports: ['ssh-binary'],
  });
});

test('rejects board path traversal and normalizes session path parts', () => {
  assert.equal(validateBoardPath('/data/aily/main.py'), '/data/aily/main.py');
  assert.throws(() => validateBoardPath('/data/../etc/passwd'), /invalid/i);
  assert.equal(sanitizeSessionPart('abc/../x'), 'abc-x');
  assert.equal(validateBoardPath('/'), '/');
  assert.equal(require('../python-runtime/linux-shared/posix-path').ensureChildPath('/', '/tmp/main.py'), '/tmp/main.py');
});

test('sanitizes public runtime errors and never exposes credentials or causes', () => {
  const cause = new Error('private key passphrase=top-secret /home/pi/.ssh/id_ed25519');
  const error = runtimeError(RUNTIME_ERROR_CODES.AUTH_FAILED, cause.message, {
    cause,
    details: {
      phase: 'authentication',
      privateKey: '-----BEGIN PRIVATE KEY-----',
    },
  });
  const publicError = toPublicRuntimeError(error);

  assert.equal(publicError.code, RUNTIME_ERROR_CODES.AUTH_FAILED);
  assert.equal(publicError.message, 'Authentication failed. Check the selected credential and try again.');
  assert.equal('cause' in publicError, false);
  assert.deepEqual(publicError.details, { phase: 'authentication' });
  assert.doesNotMatch(JSON.stringify(publicError), /top-secret|PRIVATE KEY|passphrase/i);
});
