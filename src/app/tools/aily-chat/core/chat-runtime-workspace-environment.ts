import { AilyHost } from './host';

export interface ChatRuntimeWorkspaceEnvironment {
  readonly currentProjectPath: string;
  readonly projectRootPath: string;
  readonly projectPath: string;
}

export function readChatRuntimeWorkspaceEnvironment(): ChatRuntimeWorkspaceEnvironment {
  const currentProjectPath = normalizePath(AilyHost.get().project?.currentProjectPath);
  const projectRootPath = normalizePath(AilyHost.get().project?.projectRootPath);
  const activeProjectPath = currentProjectPath && !isSamePath(currentProjectPath, projectRootPath)
    ? currentProjectPath
    : '';
  return {
    currentProjectPath: activeProjectPath,
    projectRootPath,
    projectPath: activeProjectPath,
  };
}

function normalizePath(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    : '';
}

function isSamePath(left: string, right: string): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.toLowerCase() === right.toLowerCase();
}
