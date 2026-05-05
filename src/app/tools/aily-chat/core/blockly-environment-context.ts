import { AilyHost } from './host';
import { getProjectInfoTool } from '../tools/getProjectInfoTool';

export interface BlocklyProjectLibraryInfo {
  name: string;
  path: string;
  readmePath?: string;
}

export interface BlocklyProjectInfo {
  projectOpened: boolean;
  projectPath?: string;
  projectName?: string;
  board?: {
    name: string;
    path: string;
  };
  libraries?: BlocklyProjectLibraryInfo[];
}

export interface BlocklyContextSnapshotMeta {
  version: number;
  resolvedAt: number;
  stale: boolean;
  invalidatedBy?: string;
}

export interface BlocklyContextSnapshot {
  meta: BlocklyContextSnapshotMeta;
  workspaceIdentity?: {
    cwd: string;
    hostId: 'blockly';
    platform?: string;
  };
  projectInfo?: {
    projectOpened: boolean;
    projectPath?: string;
    projectName?: string;
  };
  boardInfo?: {
    currentBoard?: string;
    fqbn?: string;
  };
  libraryIndex?: readonly BlocklyProjectLibraryInfo[];
  workspaceArtifacts?: {
    absPath?: string;
    generatedCodePath?: string;
  };
}

export interface BlocklyContextSummaryOptions {
  maxLibraries?: number;
  maxReadmeRefs?: number;
  maxLibrariesWithoutReadme?: number;
}

const MAX_ENV_LIBRARY_NAMES = 12;
const MAX_ENV_README_REFS = 8;
const MAX_ENV_LIBRARIES_WITHOUT_README = 8;

export async function buildBlocklyWorkspaceIdentityLines(host = AilyHost.get()): Promise<string[]> {
  const snapshot = await buildBlocklyContextSnapshot(host);
  return summarizeBlocklyContextSnapshot(snapshot);
}

export async function buildBlocklyContextSnapshot(
  host = AilyHost.get(),
  options?: { version?: number; invalidatedBy?: string },
): Promise<BlocklyContextSnapshot> {
  const project = host.project as any;
  const projectInfo = await resolveBlocklyProjectInfo(host);
  const projectPath = projectInfo?.projectPath || project?.currentProjectPath || project?.projectRootPath;
  const projectName = projectInfo?.projectName || project?.projectName;
  const currentBoard = project?.currentBoard || projectInfo?.board?.name;
  const platformType = host.platform?.type || ((host.platform as any)?.isWindows ? 'win32' : undefined);
  const libraries = projectInfo?.libraries ?? [];

  return {
    meta: {
      version: options?.version ?? 1,
      resolvedAt: Date.now(),
      stale: false,
      ...(options?.invalidatedBy ? { invalidatedBy: options.invalidatedBy } : {}),
    },
    ...(projectPath ? {
      workspaceIdentity: {
        cwd: projectPath,
        hostId: 'blockly',
        ...(platformType ? { platform: platformType } : {}),
      },
    } : {}),
    projectInfo: {
      projectOpened: projectInfo?.projectOpened ?? Boolean(projectPath),
      ...(projectPath ? { projectPath } : {}),
      ...(projectName ? { projectName } : {}),
    },
    ...(currentBoard ? {
      boardInfo: {
        currentBoard,
      },
    } : {}),
    ...(libraries.length > 0 ? { libraryIndex: libraries } : {}),
    ...(projectPath ? {
      workspaceArtifacts: {
        absPath: `${projectPath}/project.abs`,
        generatedCodePath: `${projectPath}/.temp/sketch/sketch.ino`,
      },
    } : {}),
  };
}

export function summarizeBlocklyContextSnapshot(
  snapshot: BlocklyContextSnapshot,
  options?: BlocklyContextSummaryOptions,
): string[] {
  const lines: string[] = [];
  const maxLibraries = options?.maxLibraries ?? MAX_ENV_LIBRARY_NAMES;
  const maxReadmeRefs = options?.maxReadmeRefs ?? MAX_ENV_README_REFS;
  const maxLibrariesWithoutReadme = options?.maxLibrariesWithoutReadme ?? MAX_ENV_LIBRARIES_WITHOUT_README;

  if (snapshot.projectInfo?.projectPath) {
    lines.push(`Project path: ${snapshot.projectInfo.projectPath}`);
  }
  if (snapshot.projectInfo?.projectName) {
    lines.push(`Project: ${snapshot.projectInfo.projectName}`);
  }
  if (snapshot.boardInfo?.currentBoard) {
    lines.push(`Current board: ${snapshot.boardInfo.currentBoard}`);
  }

  const libraries = snapshot.libraryIndex ?? [];
  if (libraries.length > 0) {
    const displayedLibraryNames = libraries.slice(0, maxLibraries).map(library => library.name);
    const remainingLibraryNames = libraries.length - displayedLibraryNames.length;
    lines.push(
      `Installed libraries (${libraries.length}): ${displayedLibraryNames.join(', ')}`
      + (remainingLibraryNames > 0 ? ` ... (+${remainingLibraryNames} more)` : ''),
    );

    const librariesWithReadme = libraries.filter(library => Boolean(library.readmePath));
    if (librariesWithReadme.length > 0) {
      const displayedReadmes = librariesWithReadme.slice(0, maxReadmeRefs);
      const remainingReadmes = librariesWithReadme.length - displayedReadmes.length;
      lines.push(
        `Library README docs (${librariesWithReadme.length}): ${displayedReadmes
          .map(library => `${library.name}=${library.readmePath}`)
          .join('; ')}`
        + (remainingReadmes > 0 ? ` ... (+${remainingReadmes} more)` : ''),
      );
    }

    const librariesWithoutReadme = libraries.filter(library => !library.readmePath);
    if (librariesWithoutReadme.length > 0) {
      const displayedWithoutReadme = librariesWithoutReadme.slice(0, maxLibrariesWithoutReadme);
      const remainingWithoutReadme = librariesWithoutReadme.length - displayedWithoutReadme.length;
      lines.push(
        `Libraries without readme_ai.md (${librariesWithoutReadme.length}): ${displayedWithoutReadme
          .map(library => library.name)
          .join(', ')}`
        + (remainingWithoutReadme > 0 ? ` ... (+${remainingWithoutReadme} more)` : ''),
      );
    }
  }

  if (snapshot.workspaceArtifacts?.absPath) {
    lines.push(`ABS source: ${snapshot.workspaceArtifacts.absPath}`);
  }
  if (snapshot.workspaceArtifacts?.generatedCodePath) {
    lines.push(`Generated C++: ${snapshot.workspaceArtifacts.generatedCodePath}`);
  }

  return lines;
}

export async function resolveBlocklyProjectInfo(host = AilyHost.get()): Promise<BlocklyProjectInfo | null> {
  const project = host.project as any;

  if (!project) {
    return null;
  }

  try {
    if (typeof project.getProjectInfo === 'function') {
      const info = await project.getProjectInfo();
      if (info && typeof info === 'object') {
        return info as BlocklyProjectInfo;
      }
    }
  } catch {
    // Fall through to legacy project discovery.
  }

  try {
    const legacyResult = await getProjectInfoTool(project, { include_readme: true });
    const content = legacyResult?.content;
    if (typeof content !== 'string') {
      return null;
    }
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed as BlocklyProjectInfo : null;
  } catch {
    return null;
  }
}