import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(TEST_DIR, 'create-local-cybercam-project.mjs');

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixtureSources(root) {
  const boardSource = path.join(root, 'board-cybercam');
  const librarySource = path.join(root, 'lib-cybercam');

  writeJson(path.join(boardSource, 'package.json'), {
    name: '@aily-project/board-cybercam',
    version: '1.1.0',
    dependencies: {},
    boardDependencies: {},
  });
  writeJson(path.join(boardSource, 'board.json'), { name: 'CyberCAM' });
  writeJson(path.join(boardSource, 'template', 'package.json'), {
    name: 'project_',
    version: '1.0.0',
    board: 'CyberCAM',
    devmode: 'python',
    dependencies: {
      '@aily-project/board-cybercam': '1.1.0',
      '@aily-project/lib-cybercam': '1.0.0',
    },
  });
  writeJson(path.join(boardSource, 'template', 'project.abi'), {
    blocks: {
      languageVersion: 0,
      blocks: [
        { type: 'cybercam_start', id: 'start' },
        { type: 'cybercam_forever', id: 'forever' },
      ],
    },
  });

  writeJson(path.join(librarySource, 'package.json'), {
    name: '@aily-project/lib-cybercam',
    version: '1.0.0',
    dependencies: {},
  });
  writeJson(path.join(librarySource, 'block.json'), [{ type: 'cybercam_camera_snapshot' }]);
  writeFileSync(path.join(librarySource, 'generator.js'), 'export default {};\n');
  writeJson(path.join(librarySource, 'toolbox.json'), { kind: 'categoryToolbox', contents: [] });

  return { boardSource, librarySource };
}

test('creates a complete offline CyberCAM Python project from local packages', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-create-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');

  execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
    '--name', 'CyberCAM Starter',
  ], { encoding: 'utf8' });

  const projectPackage = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(projectPackage.name, 'cybercam_starter');
  assert.equal(projectPackage.nickname, 'CyberCAM Starter');
  assert.equal(projectPackage.board, 'CyberCAM');
  assert.equal(projectPackage.devmode, 'python');
  assert.deepEqual(projectPackage.dependencies, {
    '@aily-project/board-cybercam': '1.1.0',
    '@aily-project/lib-cybercam': '1.0.0',
  });

  const abi = JSON.parse(readFileSync(path.join(target, 'project.abi'), 'utf8'));
  assert.deepEqual(abi.blocks.blocks.map((block) => block.type), [
    'cybercam_start',
    'cybercam_forever',
  ]);

  assert.equal(
    JSON.parse(readFileSync(path.join(
      target,
      'node_modules',
      '@aily-project',
      'board-cybercam',
      'board.json',
    ), 'utf8')).name,
    'CyberCAM',
  );
  assert.ok(readFileSync(path.join(
    target,
    'node_modules',
    '@aily-project',
    'lib-cybercam',
    'generator.js',
  ), 'utf8').includes('export default'));
});

test('refuses to overwrite an existing project directory', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-existing-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');
  mkdirSync(target);
  writeFileSync(path.join(target, 'keep.txt'), 'user data');

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /already exists/i);
  assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'user data');
});

test('rejects a template whose declared package versions drift from local sources', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-version-drift-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');
  const templatePackagePath = path.join(boardSource, 'template', 'package.json');
  const templatePackage = JSON.parse(readFileSync(templatePackagePath, 'utf8'));
  templatePackage.dependencies['@aily-project/lib-cybercam'] = '0.9.0';
  writeJson(templatePackagePath, templatePackage);

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /dependency version mismatch/i);
  assert.equal(pathExists(target), false);
});

test('rejects a target nested inside either source package', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-nested-target-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(boardSource, 'generated-project');

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], {
    encoding: 'utf8',
    timeout: 1_000,
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /inside a source package/i);
  assert.equal(pathExists(target), false);
});

test('copies only the runtime package allowlist', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-allowlist-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');

  for (const source of [boardSource, librarySource]) {
    writeFileSync(path.join(source, '.env'), 'SECRET=value\n');
    writeJson(path.join(source, 'test', 'fixture.json'), { secret: true });
    mkdirSync(path.join(source, 'scripts'), { recursive: true });
    writeFileSync(path.join(source, 'scripts', 'publish.mjs'), 'throw new Error("do not copy");\n');
  }

  execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  for (const packageName of ['board-cybercam', 'lib-cybercam']) {
    const installedPackage = path.join(target, 'node_modules', '@aily-project', packageName);
    assert.equal(pathExists(path.join(installedPackage, '.env')), false);
    assert.equal(pathExists(path.join(installedPackage, 'test')), false);
    assert.equal(pathExists(path.join(installedPackage, 'scripts')), false);
  }
});

test('copies only package.json and project.abi from the project template', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-template-allowlist-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');
  const templatePath = path.join(boardSource, 'template');
  writeFileSync(path.join(templatePath, '.env'), 'SECRET=value\n');
  writeFileSync(path.join(templatePath, 'extra.txt'), 'do not copy\n');

  execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  assert.equal(pathExists(path.join(target, 'package.json')), true);
  assert.equal(pathExists(path.join(target, 'project.abi')), true);
  assert.equal(pathExists(path.join(target, '.env')), false);
  assert.equal(pathExists(path.join(target, 'extra.txt')), false);
});

const commonRuntimeDependencyFields = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
];
const runtimeDependencyCases = [
  ...commonRuntimeDependencyFields.map((field) => ({
    name: `board ${field}`,
    packagePath: ['board-cybercam', 'package.json'],
    field,
  })),
  {
    name: 'board boardDependencies',
    packagePath: ['board-cybercam', 'package.json'],
    field: 'boardDependencies',
  },
  ...commonRuntimeDependencyFields.map((field) => ({
    name: `library ${field}`,
    packagePath: ['lib-cybercam', 'package.json'],
    field,
  })),
];

for (const dependencyCase of runtimeDependencyCases) {
  test(`rejects non-empty ${dependencyCase.name} for an offline package`, (t) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-runtime-dependency-'));
    t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
    const { boardSource, librarySource } = createFixtureSources(tempRoot);
    const target = path.join(tempRoot, 'CyberCAM_Starter');
    const packagePath = path.join(tempRoot, ...dependencyCase.packagePath);
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageJson[dependencyCase.field] = dependencyCase.field.startsWith('bundle')
      ? ['unexpected-runtime-package']
      : { 'unexpected-runtime-package': '1.0.0' };
    writeJson(packagePath, packageJson);

    const result = spawnSync(process.execPath, [
      SCRIPT_PATH,
      '--target', target,
      '--board-source', boardSource,
      '--library-source', librarySource,
    ], { encoding: 'utf8' });

    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /offline package must have no runtime dependencies/i,
    );
    assert.equal(pathExists(target), false);
  });
}

test('allows empty object and array runtime dependency declarations', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-empty-dependencies-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');
  const packageCases = [
    {
      packagePath: path.join(boardSource, 'package.json'),
      fields: [...commonRuntimeDependencyFields, 'boardDependencies'],
    },
    {
      packagePath: path.join(librarySource, 'package.json'),
      fields: commonRuntimeDependencyFields,
    },
  ];

  for (const packageCase of packageCases) {
    const packageJson = JSON.parse(readFileSync(packageCase.packagePath, 'utf8'));
    packageCase.fields.forEach((field, index) => {
      packageJson[field] = index % 2 === 0 ? [] : {};
    });
    writeJson(packageCase.packagePath, packageJson);
  }

  execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  assert.equal(pathExists(path.join(target, 'package.json')), true);
});

test('rejects invalid runtime dependency declaration types', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-invalid-dependencies-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');
  const libraryPackagePath = path.join(librarySource, 'package.json');
  const libraryPackage = JSON.parse(readFileSync(libraryPackagePath, 'utf8'));
  libraryPackage.optionalDependencies = 'unexpected-runtime-package';
  writeJson(libraryPackagePath, libraryPackage);

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /offline package must have no runtime dependencies/i,
  );
  assert.equal(pathExists(target), false);
});

test('rejects an offline package manifest that references a missing main entry', (t) => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aily-cybercam-missing-main-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const { boardSource, librarySource } = createFixtureSources(tempRoot);
  const target = path.join(tempRoot, 'CyberCAM_Starter');
  const boardPackagePath = path.join(boardSource, 'package.json');
  const boardPackage = JSON.parse(readFileSync(boardPackagePath, 'utf8'));
  boardPackage.main = 'index.js';
  writeJson(boardPackagePath, boardPackage);

  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--target', target,
    '--board-source', boardSource,
    '--library-source', librarySource,
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /main entry.*missing/i);
  assert.equal(pathExists(target), false);
});

function pathExists(filePath) {
  try {
    readFileSync(filePath);
    return true;
  } catch (error) {
    if (error.code === 'EISDIR') return true;
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
