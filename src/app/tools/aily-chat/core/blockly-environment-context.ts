import { AilyHost } from './host';
import { getProjectInfoTool } from '../tools/getProjectInfoTool';

interface BlocklyProjectLibraryInfo {
  name: string;
  path: string;
  readmePath?: string;
}

interface BlocklyProjectInfo {
  projectOpened: boolean;
  projectPath?: string;
  projectName?: string;
  board?: {
    name: string;
    path: string;
  };
  libraries?: BlocklyProjectLibraryInfo[];
}

const MAX_ENV_LIBRARY_NAMES = 12;
const MAX_ENV_README_REFS = 8;
const MAX_ENV_LIBRARIES_WITHOUT_README = 8;

export async function buildBlocklyWorkspaceIdentityLines(host = AilyHost.get()): Promise<string[]> {
  const lines: string[] = [];
  const project = host.project as any;

  if (project?.currentProjectPath) {
    lines.push(`Project path: ${project.currentProjectPath}`);
  }
  if (project?.projectName) {
    lines.push(`Project: ${project.projectName}`);
  }
  if (project?.currentBoard) {
    lines.push(`Current board: ${project.currentBoard}`);
  }

  const projectInfo = await resolveBlocklyProjectInfo(host);
  const libraries = projectInfo?.libraries ?? [];
  if (libraries.length > 0) {
    const displayedLibraryNames = libraries.slice(0, MAX_ENV_LIBRARY_NAMES).map(library => library.name);
    const remainingLibraryNames = libraries.length - displayedLibraryNames.length;
    lines.push(
      `Installed libraries (${libraries.length}): ${displayedLibraryNames.join(', ')}`
      + (remainingLibraryNames > 0 ? ` ... (+${remainingLibraryNames} more)` : ''),
    );

    const librariesWithReadme = libraries.filter(library => Boolean(library.readmePath));
    if (librariesWithReadme.length > 0) {
      const displayedReadmes = librariesWithReadme.slice(0, MAX_ENV_README_REFS);
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
      const displayedWithoutReadme = librariesWithoutReadme.slice(0, MAX_ENV_LIBRARIES_WITHOUT_README);
      const remainingWithoutReadme = librariesWithoutReadme.length - displayedWithoutReadme.length;
      lines.push(
        `Libraries without readme_ai.md (${librariesWithoutReadme.length}): ${displayedWithoutReadme
          .map(library => library.name)
          .join(', ')}`
        + (remainingWithoutReadme > 0 ? ` ... (+${remainingWithoutReadme} more)` : ''),
      );
    }
  }

  if (project?.currentProjectPath) {
    const projectPath = project.currentProjectPath;
    lines.push(`ABS source: ${projectPath}/project.abs`);
    lines.push(`Generated C++: ${projectPath}/.temp/sketch/sketch.ino`);
  }

  return lines;
}

async function resolveBlocklyProjectInfo(host = AilyHost.get()): Promise<BlocklyProjectInfo | null> {
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