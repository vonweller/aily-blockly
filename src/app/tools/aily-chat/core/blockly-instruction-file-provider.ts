import {
  createBlocklyFileCustomizationProvider,
  type BlocklyCustomizationFileSource,
  type BlocklyDiscoveredCustomizationFile,
  type BlocklyFileCustomizationProviderConfigSource,
} from './blockly-file-customization-provider';

import { AilyHost } from './host';

export type BlocklyInstructionFileSource = BlocklyCustomizationFileSource;
export type BlocklyInstructionFileProviderProfile = 'provider' | 'claude';

export interface BlocklyInstructionFileProviderConfigSource extends BlocklyFileCustomizationProviderConfigSource {
  readonly userInstructionFolders?: readonly string[];
  readonly projectInstructionFolders?: readonly string[];
}

export interface BlocklyInstructionFileProviderOptions {
  readonly source: BlocklyInstructionFileSource;
  readonly projectRootPath?: string;
  readonly configSource?: BlocklyInstructionFileProviderConfigSource;
  readonly profile?: BlocklyInstructionFileProviderProfile;
}

export interface BlocklyInstructionFileProvider {
  contributeInstructionFiles(): readonly BlocklyDiscoveredCustomizationFile[];
  onInstructionFilesChanged?(listener: () => void): { dispose(): void };
}

const INSTRUCTION_FILE_EXTENSION = '.instructions.md';
const DEFAULT_INSTRUCTION_FILE_PROVIDER_PROFILE: BlocklyInstructionFileProviderProfile = 'provider';
const AILY_PROJECT_DEFAULT_INSTRUCTION_FOLDERS = ['.aily'] as const;
const AILY_USER_DEFAULT_INSTRUCTION_FOLDERS: readonly string[] = [];
const CLAUDE_PROJECT_DEFAULT_INSTRUCTION_FOLDERS = ['.claude'] as const;
const CLAUDE_USER_DEFAULT_INSTRUCTION_FOLDERS = ['.claude'] as const;
const ROOT_AGENT_INSTRUCTION_FILE_NAMES = new Set(['agents.md', 'aily.md']);
const AILY_AGENT_INSTRUCTION_FILE_NAMES = new Set(['aily-instructions.md']);
const CLAUDE_PROJECT_FOLDER_INSTRUCTION_FILE_NAMES = new Set(['claude.md', 'claude.local.md']);
const CLAUDE_USER_FOLDER_INSTRUCTION_FILE_NAMES = new Set(['claude.md']);
const AILY_ROOT_PROJECT_AGENT_INSTRUCTION_FILES = ['AGENTS.md', 'AILY.md'] as const;
const CLAUDE_ROOT_PROJECT_INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md'] as const;

export function createBlocklyInstructionFileProvider(
  options: BlocklyInstructionFileProviderOptions,
): BlocklyInstructionFileProvider {
  const profile = options.profile ?? DEFAULT_INSTRUCTION_FILE_PROVIDER_PROFILE;
  const provider = createBlocklyFileCustomizationProvider({
    source: options.source,
    projectRootPath: options.projectRootPath,
    configSource: options.configSource,
    defaultFolders: resolveDefaultInstructionFolders(options.source, profile),
    ...(profile === 'provider' ? {
      resolveConfiguredFolders: (configSource: BlocklyInstructionFileProviderConfigSource | undefined, source: BlocklyInstructionFileSource) => source === 'user'
        ? configSource?.userInstructionFolders
        : configSource?.projectInstructionFolders,
    } : {}),
    shouldIncludeFile: (folderPath, fileName, source) => shouldIncludeInstructionFile(folderPath, fileName, source, profile),
  });
  let contributionSignature = serializeDiscoveredInstructionFiles(readInstructionFiles());
  const listeners = new Set<() => void>();
  let rootWatchSubscription: { close?(): void; dispose?(): void; unsubscribe?(): void } | undefined;
  let providerSubscription: { dispose(): void } | undefined;

  const notifyListenersIfChanged = () => {
    const nextFiles = readInstructionFiles();
    const nextSignature = serializeDiscoveredInstructionFiles(nextFiles);
    if (nextSignature === contributionSignature) {
      return;
    }

    contributionSignature = nextSignature;
    for (const listener of Array.from(listeners)) {
      listener();
    }
  };

  const attachRootWatcher = () => {
    if (options.source !== 'project') {
      return;
    }

    const host = AilyHost.get();
    const projectRootPath = resolveInstructionProjectRootPath(options);
    if (!projectRootPath || typeof host.fs?.watch !== 'function') {
      return;
    }

    try {
      rootWatchSubscription = host.fs.watch(projectRootPath, () => {
        notifyListenersIfChanged();
      }) || undefined;
    } catch {
      rootWatchSubscription = undefined;
    }
  };

  const detachChangeSources = () => {
    providerSubscription?.dispose();
    providerSubscription = undefined;
    if (typeof rootWatchSubscription?.unsubscribe === 'function') {
      rootWatchSubscription.unsubscribe();
    } else if (typeof rootWatchSubscription?.dispose === 'function') {
      rootWatchSubscription.dispose();
    } else {
      rootWatchSubscription?.close?.();
    }
    rootWatchSubscription = undefined;
  };

  const attachChangeSources = () => {
    providerSubscription = provider.onFilesChanged?.(() => {
      notifyListenersIfChanged();
    });
    attachRootWatcher();
  };

  function readInstructionFiles(): readonly BlocklyDiscoveredCustomizationFile[] {
    return dedupeDiscoveredInstructionFiles([
      ...readProjectRootAgentInstructionFiles(options),
      ...provider.contributeFiles(),
    ]);
  }

  return {
    contributeInstructionFiles(): readonly BlocklyDiscoveredCustomizationFile[] {
      const files = readInstructionFiles();
      contributionSignature = serializeDiscoveredInstructionFiles(files);
      return files;
    },
    ...((provider.onFilesChanged || (options.source === 'project' && typeof AilyHost.get().fs?.watch === 'function')) ? {
      onInstructionFilesChanged(listener: () => void) {
        listeners.add(listener);
        if (listeners.size === 1) {
          attachChangeSources();
        }

        return {
          dispose() {
            listeners.delete(listener);
            if (listeners.size === 0) {
              detachChangeSources();
            }
          },
        };
      },
    } : {}),
  };
}

function resolveDefaultInstructionFolders(
  source: BlocklyInstructionFileSource,
  profile: BlocklyInstructionFileProviderProfile,
): readonly string[] {
  if (profile === 'claude') {
    return source === 'project'
      ? CLAUDE_PROJECT_DEFAULT_INSTRUCTION_FOLDERS
      : CLAUDE_USER_DEFAULT_INSTRUCTION_FOLDERS;
  }

  return source === 'project'
    ? AILY_PROJECT_DEFAULT_INSTRUCTION_FOLDERS
    : AILY_USER_DEFAULT_INSTRUCTION_FOLDERS;
}

function resolveInstructionProjectRootPath(options: BlocklyInstructionFileProviderOptions): string {
  const host = AilyHost.get();
  return options.projectRootPath
    ?? host.project?.projectRootPath
    ?? host.project?.currentProjectPath
    ?? '';
}

function readProjectRootAgentInstructionFiles(
  options: BlocklyInstructionFileProviderOptions,
): readonly BlocklyDiscoveredCustomizationFile[] {
  if (options.source !== 'project') {
    return [];
  }

  const profile = options.profile ?? DEFAULT_INSTRUCTION_FILE_PROVIDER_PROFILE;

  const host = AilyHost.get();
  const projectRootPath = resolveInstructionProjectRootPath(options).trim();
  if (!projectRootPath) {
    return [];
  }

  return resolveProjectRootInstructionFileNames(profile).flatMap((fileName) => {
    const filePath = host.path?.join?.(projectRootPath, fileName) ?? `${projectRootPath}/${fileName}`;
    try {
      if (!host.fs?.existsSync?.(filePath)) {
        return [];
      }

      const content = host.fs.readFileSync(filePath, 'utf-8');
      return [{
        name: fileName,
        content,
        uri: toFileUri(filePath),
      } satisfies BlocklyDiscoveredCustomizationFile];
    } catch {
      return [];
    }
  });
}

function resolveProjectRootInstructionFileNames(
  profile: BlocklyInstructionFileProviderProfile,
): readonly string[] {
  return profile === 'claude'
    ? CLAUDE_ROOT_PROJECT_INSTRUCTION_FILES
    : AILY_ROOT_PROJECT_AGENT_INSTRUCTION_FILES;
}

function dedupeDiscoveredInstructionFiles(
  files: readonly BlocklyDiscoveredCustomizationFile[],
): readonly BlocklyDiscoveredCustomizationFile[] {
  const seenUris = new Set<string>();
  const deduped: BlocklyDiscoveredCustomizationFile[] = [];

  for (const file of files) {
    const uri = file.uri.trim();
    if (!uri || seenUris.has(uri)) {
      continue;
    }

    seenUris.add(uri);
    deduped.push(file);
  }

  return deduped;
}

function serializeDiscoveredInstructionFiles(
  files: readonly BlocklyDiscoveredCustomizationFile[],
): string {
  return JSON.stringify(files);
}

function toFileUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const encodedPath = encodeURI(normalizedPath);
  if (/^[a-zA-Z]:\//.test(normalizedPath)) {
    return `file:///${encodedPath}`;
  }

  return normalizedPath.startsWith('/') ? `file://${encodedPath}` : `file:///${encodedPath}`;
}

function shouldIncludeInstructionFile(
  folderPath: string,
  fileName: string,
  source: BlocklyInstructionFileSource,
  profile: BlocklyInstructionFileProviderProfile,
): boolean {
  const normalizedFileName = fileName.trim().toLowerCase();
  if (!normalizedFileName) {
    return false;
  }

  if (profile === 'provider' && normalizedFileName.endsWith(INSTRUCTION_FILE_EXTENSION)) {
    return true;
  }

  const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
  if (profile === 'claude') {
    if (!normalizedFolderPath.endsWith('/.claude')) {
      return false;
    }

    return source === 'user'
      ? CLAUDE_USER_FOLDER_INSTRUCTION_FILE_NAMES.has(normalizedFileName)
      : CLAUDE_PROJECT_FOLDER_INSTRUCTION_FILE_NAMES.has(normalizedFileName);
  }

  if (normalizedFolderPath.endsWith('/.aily')) {
    return AILY_AGENT_INSTRUCTION_FILE_NAMES.has(normalizedFileName);
  }

  return ROOT_AGENT_INSTRUCTION_FILE_NAMES.has(normalizedFileName);
}
