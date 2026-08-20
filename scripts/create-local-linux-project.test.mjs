import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(TEST_DIR, 'create-local-linux-project.mjs');

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixtureSources(root, boardKey = 'raspberrypi') {
  const boards = {
    raspberrypi: {
      folder: 'board-raspberrypi',
      name: '@aily-project/board-raspberrypi',
      nickname: 'Raspberry Pi',
      adapter: 'linux-ssh',
      type: 'linux:python:raspberrypi',
    },
    walnutpi: {
      folder: 'board-walnutpi',
      name: '@aily-project/board-walnutpi',
      nickname: 'WalnutPi',
      adapter: 'linux-ssh',
      type: 'linux:python:walnutpi',
    },
    walnutpi_serial: {
      folder: 'board-walnutpi_serial',
      name: '@aily-project/board-walnutpi_serial',
      nickname: 'WalnutPi Serial',
      adapter: 'linux-serial-shell',
      type: 'linux:python:walnutpi-serial',
    },
  };
  const board = boards[boardKey];
  const boardSource = path.join(root, board.folder);
  const pythonCoreSource = path.join(root, 'lib-python-core');
  const linuxLibrarySource = path.join(root, 'lib-linux-python');

  writeJson(path.join(boardSource, 'package.json'), {
    name: board.name,
    version: '1.0.0',
    dependencies: {},
    boardDependencies: {},
  });
  writeJson(path.join(boardSource, 'board.json'), {
    name: board.nickname,
    runtime: { adapter: board.adapter },
    type: board.type,
  });
  writeJson(path.join(boardSource, 'template', 'package.json'), {
    name: 'project_',
    version: '1.0.0',
    board: board.nickname,
    devmode: 'python',
    dependencies: {
      [board.name]: '1.0.0',
      '@aily-project/lib-python-core': '1.0.0',
      '@aily-project/lib-linux-python': '1.0.0',
    },
  });
  writeJson(path.join(boardSource, 'template', 'project.abi'), {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: 'python_start', id: 'start' },
        { type: 'python_forever', id: 'forever' },
      ],
    },
  });

  writeJson(path.join(pythonCoreSource, 'package.json'), {
    name: '@aily-project/lib-python-core',
    version: '1.0.0',
    dependencies: {},
  });
  writeJson(path.join(pythonCoreSource, 'block.json'), [{ type: 'python_print' }]);
  writeFileSync(path.join(pythonCoreSource, 'generator.js'), 'export default {};\n');
  writeJson(path.join(pythonCoreSource, 'toolbox.json'), { kind: 'categoryToolbox', contents: [] });

  writeJson(path.join(linuxLibrarySource, 'package.json'), {
    name: '@aily-project/lib-linux-python',
    version: '1.0.0',
    dependencies: {},
  });
  writeJson(path.join(linuxLibrarySource, 'block.json'), [{ type: 'linux_gpio_init' }]);
  writeFileSync(path.join(linuxLibrarySource, 'generator.js'), 'export default {};\n');
  writeJson(path.join(linuxLibrarySource, 'toolbox.json'), { kind: 'categoryToolbox', contents: [] });

  return { boardSource, pythonCoreSource, linuxLibrarySource, board };
}

test('creates an offline Raspberry Pi Python project from local packages', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-linux-create-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, pythonCoreSource, linuxLibrarySource } = createFixtureSources(tempRoot, 'raspberrypi');
  const target = path.join(tempRoot, 'Raspberry_Pi_Starter');

  execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board', 'raspberrypi',
    '--board-source', boardSource,
    '--python-core-source', pythonCoreSource,
    '--linux-library-source', linuxLibrarySource,
    '--name', 'Raspberry Pi Starter',
  ], { encoding: 'utf8' });

  const projectPackage = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(projectPackage.name, 'raspberry_pi_starter');
  assert.equal(projectPackage.nickname, 'Raspberry Pi Starter');
  assert.equal(projectPackage.board, 'Raspberry Pi');
  assert.equal(projectPackage.devmode, 'python');
  assert.deepEqual(projectPackage.dependencies, {
    '@aily-project/board-raspberrypi': '1.0.0',
    '@aily-project/lib-python-core': '1.0.0',
    '@aily-project/lib-linux-python': '1.0.0',
  });
  assert.ok(!Object.hasOwn(projectPackage.dependencies, '@aily-project/lib-cybercam'));
  assert.ok(readFileSync(path.join(target, 'node_modules', '@aily-project', 'lib-python-core', 'generator.js'), 'utf8'));
  assert.ok(readFileSync(path.join(target, 'node_modules', '@aily-project', 'lib-linux-python', 'generator.js'), 'utf8'));
});

test('creates an offline WalnutPi Serial project with the serial-shell adapter', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-linux-serial-create-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, pythonCoreSource, linuxLibrarySource } = createFixtureSources(tempRoot, 'walnutpi_serial');
  const target = path.join(tempRoot, 'WalnutPi_Serial_Starter');

  const output = execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board', 'walnutpi_serial',
    '--board-source', boardSource,
    '--python-core-source', pythonCoreSource,
    '--linux-library-source', linuxLibrarySource,
    '--name', 'WalnutPi Serial Starter',
  ], { encoding: 'utf8' });

  const result = JSON.parse(output);
  assert.equal(result.adapter, 'linux-serial-shell');
  const projectPackage = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(projectPackage.board, 'WalnutPi Serial');
  assert.deepEqual(projectPackage.dependencies, {
    '@aily-project/board-walnutpi_serial': '1.0.0',
    '@aily-project/lib-python-core': '1.0.0',
    '@aily-project/lib-linux-python': '1.0.0',
  });
});

test('rejects a Linux template that still depends on lib-cybercam', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-linux-reject-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, pythonCoreSource, linuxLibrarySource } = createFixtureSources(tempRoot, 'walnutpi');
  const templatePackage = JSON.parse(readFileSync(path.join(boardSource, 'template', 'package.json'), 'utf8'));
  templatePackage.dependencies['@aily-project/lib-cybercam'] = '1.0.0';
  writeJson(path.join(boardSource, 'template', 'package.json'), templatePackage);

  assert.throws(() => {
    execFileSync(process.execPath, [
      SCRIPT_PATH,
      '--target', path.join(tempRoot, 'bad'),
      '--board', 'walnutpi',
      '--board-source', boardSource,
      '--python-core-source', pythonCoreSource,
      '--linux-library-source', linuxLibrarySource,
    ], { encoding: 'utf8' });
  }, /lib-cybercam/);
});
