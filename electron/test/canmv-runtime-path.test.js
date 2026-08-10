const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  platformTarget,
  resolveCanmvBackendExecutable,
} = require('../python-runtime/runtime-path');

test('maps supported operating systems and architectures to VSIX targets', () => {
  assert.equal(platformTarget('win32', 'x64'), 'win32-x64');
  assert.equal(platformTarget('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(platformTarget('linux', 'x64'), 'linux-x64');
});

test('resolves development and packaged backend locations', () => {
  assert.equal(resolveCanmvBackendExecutable({
    isPackaged: false,
    moduleDir: 'C:/repo/electron/python-runtime',
    platform: 'win32',
    arch: 'x64',
  }), path.join('C:/repo/electron/python-runtime', 'bin', 'win32-x64', 'canmv-backend.exe'));

  assert.equal(resolveCanmvBackendExecutable({
    isPackaged: true,
    resourcesPath: 'C:/Program Files/Aily/resources',
    moduleDir: 'ignored',
    platform: 'win32',
    arch: 'x64',
  }), path.join('C:/Program Files/Aily/resources', 'python-runtime', 'bin', 'win32-x64', 'canmv-backend.exe'));
});

test('prefers an explicit backend override', () => {
  assert.equal(resolveCanmvBackendExecutable({
    override: 'D:/tools/canmv-backend.exe',
    isPackaged: true,
    resourcesPath: 'ignored',
    moduleDir: 'ignored',
    platform: 'win32',
    arch: 'x64',
  }), path.normalize('D:/tools/canmv-backend.exe'));
});
