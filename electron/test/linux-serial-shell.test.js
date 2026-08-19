const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildShellNonceCommand,
  createShellNonce,
  createShellNotDetectedError,
  detectShellPrompt,
  detectShellNonce,
  ShellNonceDetector,
} = require('../python-runtime/linux-serial-shell/shell');
const {
  buildBase64HelperBootstrap,
  buildHelperStartCommand,
  shellQuote,
} = require('../python-runtime/linux-serial-shell/bootstrap');
const {
  buildBootStartInstallCommand,
  buildBootStartRemoveCommand,
  buildBootStartStatusCommand,
  buildBootStartUpdateCommand,
  getBootStartScriptPath,
  renderBootStartScript,
} = require('../python-runtime/linux-serial-shell/autostart');

test('builds and detects a shell nonce without accepting a partial or echoed command', () => {
  const nonce = 'LSS_NONCE_123';
  const command = buildShellNonceCommand(nonce);
  const detector = new ShellNonceDetector(nonce);

  assert.match(command, /printf/);
  assert.match(command, new RegExp(nonce));
  assert.equal(detector.push(Buffer.from(`root# ${command}\nLSS_NON`)), false);
  assert.equal(detector.push(Buffer.from('CE_123\nroot@board:~#')), true);
  assert.equal(detectShellNonce('root\nLSS_NONCE_123\n#', nonce), true);
  assert.equal(detectShellNonce('LSS_NONCE_12', nonce), false);
});

test('detects nonce and prompts when a serial console uses carriage returns without line feeds', () => {
  const nonce = 'LSS_CR_NONCE_123';
  const detector = new ShellNonceDetector(nonce);

  assert.equal(detector.push(Buffer.from('noise\rLSS_CR_')), false);
  assert.equal(detector.push(Buffer.from('NONCE_123\rroot# ')), true);
  assert.equal(detectShellNonce(`noise\r${nonce}\rroot# `, nonce), true);
  assert.equal(detectShellPrompt('booting Linux\rWalnutPi login: '), 'login');
  assert.equal(detectShellPrompt('banner\rroot@WalnutPi:~# '), 'shell');
});

test('creates shell nonces from cryptographically random bytes', () => {
  const first = createShellNonce();
  const second = createShellNonce();

  assert.match(first, /^LSS_NONCE_[a-f0-9]{32}$/);
  assert.match(second, /^LSS_NONCE_[a-f0-9]{32}$/);
  assert.notEqual(first, second);
});

test('detects shell and login prompts and maps failures to SHELL_NOT_DETECTED with SERIAL-A guidance', () => {
  assert.equal(detectShellPrompt('WalnutPi login: '), 'login');
  assert.equal(detectShellPrompt('root@WalnutPi:~# '), 'shell');
  assert.equal(detectShellPrompt('user@linux:/tmp$ '), 'shell');
  assert.equal(detectShellPrompt('booting Linux...\n'), null);

  const error = createShellNotDetectedError();
  assert.equal(error.code, 'SHELL_NOT_DETECTED');
  assert.match(error.message, /WalnutPi SERIAL-A/i);
  assert.match(error.details.suggestion, /SERIAL-A/i);
});

test('creates a chunked Base64 helper bootstrap with remote SHA-256 verification', () => {
  const source = `print("quote ' and newline\\n")`;
  const result = buildBase64HelperBootstrap(source, '/tmp/lss-agent.py', { chunkSize: 8 });

  assert.equal(result.remotePath, '/tmp/lss-agent.py');
  assert.equal(result.tempPath, '/tmp/lss-agent.py.part');
  assert.equal(result.commands[0], `: > ${shellQuote('/tmp/lss-agent.py.part')}`);
  assert.ok(result.commands.slice(1, -2).every(command => /base64 -d/.test(command)));
  assert.match(result.commands.at(-2), /hashlib\.sha256/);
  assert.match(result.commands.at(-2), new RegExp(result.sha256));
  assert.match(result.commands.at(-1), /chmod \+x/);
  assert.equal(Buffer.from(result.encoded, 'base64').toString(), source);
  assert.equal(
    buildHelperStartCommand('/tmp/lss-agent.py'),
    `exec python3 -u ${shellQuote('/tmp/lss-agent.py')}`,
  );
});

test('manages a complete /boot/start/aily-<project>.sh script atomically', () => {
  const script = renderBootStartScript({
    project: 'demo-project',
    scriptPath: '/data/aily/demo/main.py',
  });
  const install = buildBootStartInstallCommand({
    project: 'demo-project',
    scriptPath: '/data/aily/demo/main.py',
  });
  const update = buildBootStartUpdateCommand({
    project: 'demo-project',
    scriptPath: '/data/aily/demo/main.py',
  });
  const status = buildBootStartStatusCommand({ project: 'demo-project' });
  const remove = buildBootStartRemoveCommand({ project: 'demo-project' });

  assert.equal(getBootStartScriptPath('demo-project'), '/boot/start/aily-demo-project.sh');
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /python3 -u '\/data\/aily\/demo\/main\.py'/);
  assert.match(script, /<\/dev\/null &/);
  assert.match(install, /\/boot\/start\/aily-demo-project\.sh/);
  assert.match(install, /os\.replace/);
  assert.equal(update, install);
  assert.match(status, /test -f '\/boot\/start\/aily-demo-project\.sh'/);
  assert.match(remove, /rm -f '\/boot\/start\/aily-demo-project\.sh'/);
});
