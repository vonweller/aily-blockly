import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const DEFAULT_BOARD_SOURCE = path.resolve(REPO_ROOT, '..', 'aily-blockly-boards', 'cybercam');
const DEFAULT_LIBRARY_SOURCE = path.resolve(REPO_ROOT, '..', 'aily-blockly-libraries', 'cybercam');
const DEFAULT_TARGET = path.join(os.homedir(), 'Documents', 'aily-project', 'CyberCAM_Starter');
const TEMPLATE_RUNTIME_FILES = ['package.json', 'project.abi'];
const BOARD_RUNTIME_FILES = [
  'package.json',
  'board.json',
  'board.webp',
  'LICENSE.image.txt',
  'menu.json',
  'readme.md',
  'i18n',
];
const LIBRARY_RUNTIME_FILES = [
  'package.json',
  'block.json',
  'generator.js',
  'toolbox.json',
  'readme.md',
  'readme_ai.md',
  'API-COVERAGE.md',
  'i18n',
];
const COMMON_RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
];

function parseArgs(argv) {
  const options = {
    target: DEFAULT_TARGET,
    boardSource: DEFAULT_BOARD_SOURCE,
    librarySource: DEFAULT_LIBRARY_SOURCE,
    name: 'CyberCAM Starter',
  };
  const keys = new Map([
    ['--target', 'target'],
    ['--board-source', 'boardSource'],
    ['--library-source', 'librarySource'],
    ['--name', 'name'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const key = keys.get(argv[index]);
    if (!key || index + 1 >= argv.length) {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function assertFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

function copyAllowlist(source, destination, allowlist) {
  mkdirSync(destination, { recursive: true });
  for (const entry of allowlist) {
    const sourcePath = path.join(source, entry);
    if (existsSync(sourcePath)) {
      cpSync(sourcePath, path.join(destination, entry), { recursive: true });
    }
  }
}

function normalizePackageName(value) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'cybercam_starter';
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function assertTemplateDependencies(dependencies, boardPackage, libraryPackage) {
  const expected = {
    '@aily-project/board-cybercam': boardPackage.version,
    '@aily-project/lib-cybercam': libraryPackage.version,
  };
  const dependencyNames = dependencies && typeof dependencies === 'object'
    ? Object.keys(dependencies)
    : [];

  if (dependencyNames.length !== 2
    || !dependencyNames.every((name) => Object.hasOwn(expected, name))) {
    throw new Error(
      'CyberCAM template dependencies must contain exactly '
      + '@aily-project/board-cybercam and @aily-project/lib-cybercam',
    );
  }

  for (const [name, version] of Object.entries(expected)) {
    if (dependencies[name] !== version) {
      throw new Error(
        `CyberCAM template dependency version mismatch for ${name}: `
        + `expected ${version}, found ${dependencies[name]}`,
      );
    }
  }
}

function assertNoRuntimeDependencies(packageJson, fields, label) {
  for (const field of fields) {
    const dependencies = packageJson[field];
    const isEmptyObject = dependencies !== null
      && typeof dependencies === 'object'
      && !Array.isArray(dependencies)
      && Object.keys(dependencies).length === 0;
    const isEmptyArray = Array.isArray(dependencies) && dependencies.length === 0;
    if (dependencies !== undefined && !isEmptyObject && !isEmptyArray) {
      throw new Error(
        `${label} offline package must have no runtime dependencies in ${field}`,
      );
    }
  }
}

function assertPackageMainExists(packageJson, packageRoot, label) {
  if (packageJson.main === undefined) return;
  if (typeof packageJson.main !== 'string' || !packageJson.main.trim()) {
    throw new Error(`${label} main entry is invalid`);
  }
  const mainPath = path.resolve(packageRoot, packageJson.main);
  if (!isPathInside(packageRoot, mainPath)) {
    throw new Error(`${label} main entry is invalid`);
  }
  if (!existsSync(mainPath)) {
    throw new Error(`${label} main entry is missing: ${packageJson.main}`);
  }
}

export function createLocalCybercamProject(input) {
  const target = path.resolve(input.target);
  const boardSource = path.resolve(input.boardSource);
  const librarySource = path.resolve(input.librarySource);
  const displayName = String(input.name || 'CyberCAM Starter').trim() || 'CyberCAM Starter';
  const templatePath = path.join(boardSource, 'template');

  if (isPathInside(boardSource, target) || isPathInside(librarySource, target)) {
    throw new Error('Target directory cannot be inside a source package');
  }

  if (existsSync(target)) {
    throw new Error(`Project directory already exists: ${target}`);
  }

  const boardPackagePath = path.join(boardSource, 'package.json');
  const libraryPackagePath = path.join(librarySource, 'package.json');
  assertFile(boardPackagePath, 'CyberCAM board package');
  assertFile(path.join(boardSource, 'board.json'), 'CyberCAM board definition');
  assertFile(path.join(templatePath, 'package.json'), 'CyberCAM project template');
  assertFile(path.join(templatePath, 'project.abi'), 'CyberCAM project workspace');
  assertFile(libraryPackagePath, 'CyberCAM library package');
  assertFile(path.join(librarySource, 'block.json'), 'CyberCAM block definitions');
  assertFile(path.join(librarySource, 'generator.js'), 'CyberCAM Python generator');
  assertFile(path.join(librarySource, 'toolbox.json'), 'CyberCAM toolbox');

  const boardPackage = readJson(boardPackagePath);
  const libraryPackage = readJson(libraryPackagePath);
  if (boardPackage.name !== '@aily-project/board-cybercam') {
    throw new Error(`Unexpected CyberCAM board package name: ${boardPackage.name}`);
  }
  if (libraryPackage.name !== '@aily-project/lib-cybercam') {
    throw new Error(`Unexpected CyberCAM library package name: ${libraryPackage.name}`);
  }
  assertPackageMainExists(boardPackage, boardSource, 'CyberCAM board');
  assertPackageMainExists(libraryPackage, librarySource, 'CyberCAM library');
  assertNoRuntimeDependencies(
    boardPackage,
    [...COMMON_RUNTIME_DEPENDENCY_FIELDS, 'boardDependencies'],
    'CyberCAM board',
  );
  assertNoRuntimeDependencies(
    libraryPackage,
    COMMON_RUNTIME_DEPENDENCY_FIELDS,
    'CyberCAM library',
  );
  assertTemplateDependencies(
    readJson(path.join(templatePath, 'package.json')).dependencies,
    boardPackage,
    libraryPackage,
  );

  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);

  try {
    copyAllowlist(templatePath, staging, TEMPLATE_RUNTIME_FILES);

    const projectPackagePath = path.join(staging, 'package.json');
    const projectPackage = readJson(projectPackagePath);
    projectPackage.name = normalizePackageName(displayName);
    projectPackage.nickname = displayName;
    projectPackage.board = 'CyberCAM';
    projectPackage.devmode = 'python';
    writeJson(projectPackagePath, projectPackage);

    const scopePath = path.join(staging, 'node_modules', '@aily-project');
    copyAllowlist(
      boardSource,
      path.join(scopePath, 'board-cybercam'),
      BOARD_RUNTIME_FILES,
    );
    copyAllowlist(
      librarySource,
      path.join(scopePath, 'lib-cybercam'),
      LIBRARY_RUNTIME_FILES,
    );

    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    target,
    board: `${boardPackage.name}@${boardPackage.version}`,
    library: `${libraryPackage.name}@${libraryPackage.version}`,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  try {
    const result = createLocalCybercamProject(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
