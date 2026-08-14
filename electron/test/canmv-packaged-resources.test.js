const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { resolveCanmvBackendExecutable } = require('../python-runtime/runtime-path');

const root = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const targets = [
  ['win32', 'x64', 'canmv-backend.exe'],
  ['win32', 'arm64', 'canmv-backend.exe'],
  ['darwin', 'x64', 'canmv-backend'],
  ['darwin', 'arm64', 'canmv-backend'],
  ['linux', 'x64', 'canmv-backend'],
  ['linux', 'arm64', 'canmv-backend'],
];

test('electron-builder packages every CanMV backend and its license as resources', () => {
  const resources = packageJson.build?.extraResources || [];
  assert.ok(resources.some(resource =>
    resource.from === 'electron/python-runtime/bin'
    && resource.to === 'python-runtime/bin'
  ));
  assert.ok(resources.some(resource =>
    resource.from === 'electron/python-runtime/LICENSE.canmv-backend.txt'
    && resource.to === 'python-runtime/LICENSE.canmv-backend.txt'
  ));

  for (const [platform, arch, executable] of targets) {
    const source = path.join(
      root,
      'electron',
      'python-runtime',
      'bin',
      `${platform}-${arch}`,
      executable,
    );
    assert.ok(fs.statSync(source).isFile(), `missing packaged backend source: ${source}`);
  }

  const license = path.join(root, 'electron', 'python-runtime', 'LICENSE.canmv-backend.txt');
  assert.match(fs.readFileSync(license, 'utf8'), /Canaan Bright Sight Co\., Ltd/);
});

test('packaged resource paths resolve to all six configured backend targets', () => {
  const resourcesPath = path.join(root, '.packaged-resources');
  for (const [platform, arch, executable] of targets) {
    assert.equal(resolveCanmvBackendExecutable({
      isPackaged: true,
      resourcesPath,
      moduleDir: 'ignored',
      platform,
      arch,
    }), path.join(resourcesPath, 'python-runtime', 'bin', `${platform}-${arch}`, executable));
  }
});
