export const LOCAL_PYTHON_BOARD_FOLDERS = ['raspberrypi', 'walnutpi', 'walnutpi_serial'] as const;
export const LOCAL_PYTHON_LIBRARY_FOLDERS = ['python-core', 'linux-python'] as const;

export const LOCAL_PYTHON_BOARD_RUNTIME_FILES = [
  'package.json',
  'board.json',
  'board.webp',
  'LICENSE.image.txt',
  'menu.json',
  'readme.md',
  'i18n',
] as const;

export const LOCAL_PYTHON_BOARD_APP_DATA_FILES = [
  ...LOCAL_PYTHON_BOARD_RUNTIME_FILES,
  'template',
] as const;

export const LOCAL_PYTHON_LIBRARY_RUNTIME_FILES = [
  'package.json',
  'block.json',
  'generator.js',
  'toolbox.json',
  'readme.md',
  'readme_ai.md',
  'i18n',
] as const;

const WORKSPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

export interface LocalPathApi {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(value: string): boolean;
}

export interface LocalCatalogIo {
  exists(path: string): boolean;
  readFile(path: string): string;
  path: LocalPathApi;
}

export interface LocalCopyIo extends LocalCatalogIo {
  mkdirSync(path: string): void;
  copySync(source: string, destination: string): void;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

export interface LocalPythonCatalogEntry {
  name: string;
  nickname: string;
  version: string;
  description: string;
  author: string;
  brand?: string;
  url: string;
  compatibility: unknown;
  img?: string;
  disabled: boolean;
  type?: string;
  mode?: string[];
  keywords?: string[];
  tags?: string[];
  spec?: boolean;
  localSource: string;
  [key: string]: unknown;
}

function pathSeparator(pathApi: LocalPathApi): string {
  const sample = pathApi.join('a', 'b');
  return sample.includes('\\') && !sample.includes('/') ? '\\' : '/';
}

function isUncOrDevicePath(value: string): boolean {
  return /^[\\/]{2}/.test(value) || /^\\\\\?\\/i.test(value);
}

export function resolveSiblingWorkspaceRoot(
  electronPath: string,
  workspaceName: string,
  pathApi: LocalPathApi,
): string | null {
  if (typeof electronPath !== 'string' || !electronPath.trim()) {
    return null;
  }
  if (typeof workspaceName !== 'string' || !WORKSPACE_NAME_PATTERN.test(workspaceName)) {
    return null;
  }
  if (!pathApi.isAbsolute(electronPath) || isUncOrDevicePath(electronPath)) {
    return null;
  }
  return pathApi.resolve(pathApi.join(electronPath, '..', '..', workspaceName));
}

export function isSafeLocalSourcePath(
  candidate: string,
  allowedRoots: string[],
  pathApi: LocalPathApi,
): boolean {
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0')) {
    return false;
  }
  const trimmed = candidate.trim();
  if (isUncOrDevicePath(trimmed) || !pathApi.isAbsolute(trimmed)) {
    return false;
  }

  const resolved = pathApi.resolve(trimmed);
  if (isUncOrDevicePath(resolved) || !pathApi.isAbsolute(resolved)) {
    return false;
  }

  const sep = pathSeparator(pathApi);
  return allowedRoots.some((root) => {
    if (typeof root !== 'string' || !root.trim() || !pathApi.isAbsolute(root) || isUncOrDevicePath(root)) {
      return false;
    }
    const resolvedRoot = pathApi.resolve(root);
    const relative = pathApi.relative(resolvedRoot, resolved);
    return relative !== ''
      && relative !== '..'
      && !relative.startsWith(`..${sep}`)
      && !pathApi.isAbsolute(relative);
  });
}

function readJsonObject(io: LocalCatalogIo, filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(io.readFile(filePath));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function copyLocalizedFields(source: Record<string, unknown>, target: LocalPythonCatalogEntry): void {
  for (const [key, value] of Object.entries(source)) {
    if ((key.startsWith('nickname_') || key.startsWith('description_')) && typeof value === 'string') {
      target[key] = value;
    }
  }
}

function stringField(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function recordField(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

export function readLocalPythonBoardCatalog(
  io: LocalCatalogIo,
  boardsRoot: string,
): LocalPythonCatalogEntry[] {
  if (!boardsRoot || !io.exists(boardsRoot)) {
    return [];
  }

  const entries: LocalPythonCatalogEntry[] = [];
  for (const folder of LOCAL_PYTHON_BOARD_FOLDERS) {
    const boardDir = io.path.join(boardsRoot, folder);
    const packagePath = io.path.join(boardDir, 'package.json');
    const boardJsonPath = io.path.join(boardDir, 'board.json');
    const templatePackagePath = io.path.join(boardDir, 'template', 'package.json');
    if (!io.exists(packagePath) || !io.exists(boardJsonPath) || !io.exists(templatePackagePath)) {
      continue;
    }
    if (!isSafeLocalSourcePath(boardDir, [boardsRoot], io.path)) {
      continue;
    }

    const pkg = readJsonObject(io, packagePath);
    const board = readJsonObject(io, boardJsonPath);
    const packageName = recordField(pkg, 'name');
    const packageVersion = recordField(pkg, 'version');
    if (typeof packageName !== 'string' || !packageName.trim() || typeof packageVersion !== 'string') {
      continue;
    }
    const boardMode = recordField(board, 'mode');
    const packageKeywords = recordField(pkg, 'keywords');

    const entry: LocalPythonCatalogEntry = {
      name: packageName,
      nickname: stringField(recordField(pkg, 'nickname'), stringField(recordField(board, 'name'), folder)),
      version: packageVersion,
      description: stringField(recordField(pkg, 'description'), stringField(recordField(board, 'description'))),
      author: stringField(recordField(pkg, 'author')),
      brand: stringField(recordField(pkg, 'brand')),
      url: stringField(recordField(pkg, 'url')),
      compatibility: '',
      img: `${folder}.webp`,
      disabled: false,
      type: stringField(recordField(board, 'type')),
      mode: Array.isArray(boardMode) ? boardMode.filter((mode) => typeof mode === 'string') : ['python'],
      keywords: Array.isArray(packageKeywords) ? packageKeywords.filter((item) => typeof item === 'string') : [],
      localSource: boardDir,
    };
    copyLocalizedFields(pkg, entry);
    entries.push(entry);
  }
  return entries;
}

export function readLocalPythonLibraryCatalog(
  io: LocalCatalogIo,
  librariesRoot: string,
): LocalPythonCatalogEntry[] {
  if (!librariesRoot || !io.exists(librariesRoot)) {
    return [];
  }

  const entries: LocalPythonCatalogEntry[] = [];
  for (const folder of LOCAL_PYTHON_LIBRARY_FOLDERS) {
    const libraryDir = io.path.join(librariesRoot, folder);
    const packagePath = io.path.join(libraryDir, 'package.json');
    const blockPath = io.path.join(libraryDir, 'block.json');
    const generatorPath = io.path.join(libraryDir, 'generator.js');
    if (!io.exists(packagePath) || !io.exists(blockPath) || !io.exists(generatorPath)) {
      continue;
    }
    if (!isSafeLocalSourcePath(libraryDir, [librariesRoot], io.path)) {
      continue;
    }

    const pkg = readJsonObject(io, packagePath);
    const packageName = recordField(pkg, 'name');
    const packageVersion = recordField(pkg, 'version');
    if (typeof packageName !== 'string' || !packageName.trim() || typeof packageVersion !== 'string') {
      continue;
    }
    const compatibility = recordField(pkg, 'compatibility');
    const packageKeywords = recordField(pkg, 'keywords');
    const packageTags = recordField(pkg, 'tags');

    const entry: LocalPythonCatalogEntry = {
      name: packageName,
      nickname: stringField(recordField(pkg, 'nickname'), folder),
      version: packageVersion,
      description: stringField(recordField(pkg, 'description')),
      author: stringField(recordField(pkg, 'author')),
      url: stringField(recordField(pkg, 'url')),
      compatibility: compatibility && typeof compatibility === 'object' ? compatibility : { core: [] },
      disabled: false,
      keywords: Array.isArray(packageKeywords) ? packageKeywords.filter((item) => typeof item === 'string') : [],
      tags: Array.isArray(packageTags) ? packageTags.filter((item) => typeof item === 'string') : [],
      spec: recordField(pkg, 'spec') === true,
      localSource: libraryDir,
    };
    copyLocalizedFields(pkg, entry);
    entries.push(entry);
  }
  return entries;
}

export function mergeLocalCatalogEntries<T extends { name?: string }>(
  remote: T[] | null | undefined,
  local: T[] | null | undefined,
): T[] {
  const remoteList = Array.isArray(remote) ? remote.filter((entry) => entry && typeof entry.name === 'string') : [];
  const localList = Array.isArray(local) ? local.filter((entry) => entry && typeof entry.name === 'string') : [];
  const replacements = new Map(localList.map((entry) => [entry.name as string, entry]));
  const merged = remoteList.map((entry) => replacements.get(entry.name as string) || entry);
  const extras = localList.filter((entry) => !remoteList.some((remoteEntry) => remoteEntry.name === entry.name));
  return [...extras, ...merged];
}

export function copyAllowlist(
  source: string,
  destination: string,
  allowlist: readonly string[],
  io: LocalCopyIo,
): void {
  io.mkdirSync(destination);
  for (const entry of allowlist) {
    const sourcePath = io.path.join(source, entry);
    if (io.exists(sourcePath)) {
      io.copySync(sourcePath, io.path.join(destination, entry));
    }
  }
}

export function replaceCopiedDirectory(
  source: string,
  destination: string,
  allowlist: readonly string[],
  io: LocalCopyIo,
): void {
  if (io.exists(destination)) {
    io.rmSync(destination, { recursive: true, force: true });
  }
  copyAllowlist(source, destination, allowlist, io);
}

export interface LocalLinuxProjectSeedPlan {
  appDataBoardDest: string;
  projectBoardDest: string;
  pythonCoreDest: string;
  linuxLibraryDest: string;
}

export function planLocalLinuxProjectSeed(input: {
  path: LocalPathApi;
  appDataPath: string;
  projectPath: string;
  boardPackageName: string;
}): LocalLinuxProjectSeedPlan {
  return {
    appDataBoardDest: input.path.join(input.appDataPath, 'node_modules', input.boardPackageName),
    projectBoardDest: input.path.join(input.projectPath, 'node_modules', input.boardPackageName),
    pythonCoreDest: input.path.join(input.projectPath, 'node_modules', '@aily-project/lib-python-core'),
    linuxLibraryDest: input.path.join(input.projectPath, 'node_modules', '@aily-project/lib-linux-python'),
  };
}

export function seedLocalLinuxPythonProject(input: {
  io: LocalCopyIo;
  boardsRoot: string;
  librariesRoot: string;
  boardSource: string;
  pythonCoreSource: string;
  linuxLibrarySource: string;
  appDataPath: string;
  projectPath: string;
  boardPackageName: string;
}): LocalLinuxProjectSeedPlan {
  const allowedBoardRoots = [input.boardsRoot];
  const allowedLibraryRoots = [input.librariesRoot];
  if (!isSafeLocalSourcePath(input.boardSource, allowedBoardRoots, input.io.path)) {
    throw new Error(`Unsafe local board source: ${input.boardSource}`);
  }
  if (!isSafeLocalSourcePath(input.pythonCoreSource, allowedLibraryRoots, input.io.path)) {
    throw new Error(`Unsafe local Python core source: ${input.pythonCoreSource}`);
  }
  if (!isSafeLocalSourcePath(input.linuxLibrarySource, allowedLibraryRoots, input.io.path)) {
    throw new Error(`Unsafe local Linux library source: ${input.linuxLibrarySource}`);
  }

  const plan = planLocalLinuxProjectSeed({
    path: input.io.path,
    appDataPath: input.appDataPath,
    projectPath: input.projectPath,
    boardPackageName: input.boardPackageName,
  });

  replaceCopiedDirectory(input.boardSource, plan.appDataBoardDest, LOCAL_PYTHON_BOARD_APP_DATA_FILES, input.io);
  replaceCopiedDirectory(input.boardSource, plan.projectBoardDest, LOCAL_PYTHON_BOARD_RUNTIME_FILES, input.io);
  replaceCopiedDirectory(input.pythonCoreSource, plan.pythonCoreDest, LOCAL_PYTHON_LIBRARY_RUNTIME_FILES, input.io);
  replaceCopiedDirectory(input.linuxLibrarySource, plan.linuxLibraryDest, LOCAL_PYTHON_LIBRARY_RUNTIME_FILES, input.io);
  return plan;
}
