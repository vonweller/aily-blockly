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
function firstExisting(...candidates) {
  return candidates.find((candidate) => existsSync(candidate)) || candidates[candidates.length - 1];
}

const BOARDS_ROOT = firstExisting(
  path.resolve(REPO_ROOT, '..', 'aily-blockly-linux-boards'),
  path.resolve(REPO_ROOT, '..', 'aily-blockly-boards'),
);
const LIBRARIES_ROOT = firstExisting(
  path.resolve(REPO_ROOT, '..', 'aily-blockly-linux-libraries'),
  path.resolve(REPO_ROOT, '..', 'aily-blockly-libraries'),
);
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
  'i18n',
];
const COMMON_RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
];

const BOARD_PRESETS = {
  raspberrypi: {
    folder: 'raspberrypi',
    packageName: '@aily-project/board-raspberrypi',
    nickname: 'Raspberry Pi',
    defaultName: 'Raspberry Pi Starter',
    adapter: 'linux-ssh',
  },
  walnutpi: {
    folder: 'walnutpi',
    packageName: '@aily-project/board-walnutpi',
    nickname: 'WalnutPi',
    defaultName: 'WalnutPi Starter',
    adapter: 'linux-ssh',
  },
  walnutpi_serial: {
    folder: 'walnutpi_serial',
    packageName: '@aily-project/board-walnutpi_serial',
    nickname: 'WalnutPi Serial',
    defaultName: 'WalnutPi Serial Starter',
    adapter: 'linux-serial-shell',
  },
};

function parseArgs(argv) {
  const options = {
    target: '',
    board: 'raspberrypi',
    boardSource: '',
    pythonCoreSource: path.join(LIBRARIES_ROOT, 'python-core'),
    linuxLibrarySource: path.join(LIBRARIES_ROOT, 'linux-python'),
    name: '',
  };
  const keys = new Map([
    ['--target', 'target'],
    ['--board', 'board'],
    ['--board-source', 'boardSource'],
    ['--python-core-source', 'pythonCoreSource'],
    ['--linux-library-source', 'linuxLibrarySource'],
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
  return normalized || 'linux_python_starter';
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function assertTemplateDependencies(dependencies, boardPackage, pythonCorePackage, linuxLibraryPackage) {
  const expected = {
    [boardPackage.name]: boardPackage.version,
    '@aily-project/lib-python-core': pythonCorePackage.version,
    '@aily-project/lib-linux-python': linuxLibraryPackage.version,
  };
  const dependencyNames = dependencies && typeof dependencies === 'object'
    ? Object.keys(dependencies)
    : [];

  if (dependencyNames.length !== 3
    || !dependencyNames.every((name) => Object.hasOwn(expected, name))) {
    throw new Error(
      'Linux template dependencies must contain exactly the board package, '
      + '@aily-project/lib-python-core and @aily-project/lib-linux-python',
    );
  }

  for (const [name, version] of Object.entries(expected)) {
    if (dependencies[name] !== version) {
      throw new Error(
        `Linux template dependency version mismatch for ${name}: `
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

export function createLocalLinuxProject(input) {
  const preset = BOARD_PRESETS[input.board];
  if (!preset) {
    throw new Error(`Unknown Linux board preset: ${input.board}`);
  }

  const target = path.resolve(input.target);
  const boardSource = path.resolve(input.boardSource || path.join(BOARDS_ROOT, preset.folder));
  const pythonCoreSource = path.resolve(input.pythonCoreSource);
  const linuxLibrarySource = path.resolve(input.linuxLibrarySource);
  const displayName = String(input.name || preset.defaultName).trim() || preset.defaultName;
  const templatePath = path.join(boardSource, 'template');

  if (
    isPathInside(boardSource, target)
    || isPathInside(pythonCoreSource, target)
    || isPathInside(linuxLibrarySource, target)
  ) {
    throw new Error('Target directory cannot be inside a source package');
  }

  if (existsSync(target)) {
    throw new Error(`Project directory already exists: ${target}`);
  }

  const boardPackagePath = path.join(boardSource, 'package.json');
  const pythonCorePackagePath = path.join(pythonCoreSource, 'package.json');
  const linuxLibraryPackagePath = path.join(linuxLibrarySource, 'package.json');
  assertFile(boardPackagePath, 'Linux board package');
  assertFile(path.join(boardSource, 'board.json'), 'Linux board definition');
  assertFile(path.join(templatePath, 'package.json'), 'Linux project template');
  assertFile(path.join(templatePath, 'project.abi'), 'Linux project workspace');
  assertFile(pythonCorePackagePath, 'Python core library package');
  assertFile(path.join(pythonCoreSource, 'block.json'), 'Python core block definitions');
  assertFile(path.join(pythonCoreSource, 'generator.js'), 'Python core generator');
  assertFile(linuxLibraryPackagePath, 'Linux hardware library package');
  assertFile(path.join(linuxLibrarySource, 'block.json'), 'Linux hardware block definitions');
  assertFile(path.join(linuxLibrarySource, 'generator.js'), 'Linux hardware generator');

  const boardPackage = readJson(boardPackagePath);
  const pythonCorePackage = readJson(pythonCorePackagePath);
  const linuxLibraryPackage = readJson(linuxLibraryPackagePath);
  const boardJson = readJson(path.join(boardSource, 'board.json'));
  if (boardPackage.name !== preset.packageName) {
    throw new Error(`Unexpected Linux board package name: ${boardPackage.name}`);
  }
  if (pythonCorePackage.name !== '@aily-project/lib-python-core') {
    throw new Error(`Unexpected Python core package name: ${pythonCorePackage.name}`);
  }
  if (linuxLibraryPackage.name !== '@aily-project/lib-linux-python') {
    throw new Error(`Unexpected Linux hardware package name: ${linuxLibraryPackage.name}`);
  }
  if (boardJson.runtime?.adapter !== preset.adapter) {
    throw new Error(
      `Linux board adapter mismatch: expected ${preset.adapter}, found ${boardJson.runtime?.adapter}`,
    );
  }
  if (Object.hasOwn(readJson(path.join(templatePath, 'package.json')).dependencies || {}, '@aily-project/lib-cybercam')) {
    throw new Error('Linux templates must not depend on @aily-project/lib-cybercam');
  }
  assertPackageMainExists(boardPackage, boardSource, 'Linux board');
  assertPackageMainExists(pythonCorePackage, pythonCoreSource, 'Python core');
  assertPackageMainExists(linuxLibraryPackage, linuxLibrarySource, 'Linux hardware');
  assertNoRuntimeDependencies(
    boardPackage,
    [...COMMON_RUNTIME_DEPENDENCY_FIELDS, 'boardDependencies'],
    'Linux board',
  );
  assertNoRuntimeDependencies(pythonCorePackage, COMMON_RUNTIME_DEPENDENCY_FIELDS, 'Python core');
  assertNoRuntimeDependencies(linuxLibraryPackage, COMMON_RUNTIME_DEPENDENCY_FIELDS, 'Linux hardware');
  assertTemplateDependencies(
    readJson(path.join(templatePath, 'package.json')).dependencies,
    boardPackage,
    pythonCorePackage,
    linuxLibraryPackage,
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
    projectPackage.board = preset.nickname;
    projectPackage.devmode = 'python';
    writeJson(projectPackagePath, projectPackage);

    const scopePath = path.join(staging, 'node_modules', '@aily-project');
    copyAllowlist(boardSource, path.join(scopePath, path.basename(preset.packageName)), BOARD_RUNTIME_FILES);
    copyAllowlist(pythonCoreSource, path.join(scopePath, 'lib-python-core'), LIBRARY_RUNTIME_FILES);
    copyAllowlist(linuxLibrarySource, path.join(scopePath, 'lib-linux-python'), LIBRARY_RUNTIME_FILES);

    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    target,
    board: `${boardPackage.name}@${boardPackage.version}`,
    pythonCore: `${pythonCorePackage.name}@${pythonCorePackage.version}`,
    linuxLibrary: `${linuxLibraryPackage.name}@${linuxLibraryPackage.version}`,
    adapter: preset.adapter,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const preset = BOARD_PRESETS[parsed.board];
    if (!preset) {
      throw new Error(`Unknown Linux board preset: ${parsed.board}`);
    }
    const result = createLocalLinuxProject({
      ...parsed,
      target: parsed.target || path.join(os.homedir(), 'Documents', 'aily-project', normalizePackageName(preset.defaultName)),
      name: parsed.name || preset.defaultName,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
