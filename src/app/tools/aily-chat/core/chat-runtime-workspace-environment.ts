import { AilyHost } from './host';

export interface ChatRuntimeWorkspaceEnvironment {
  readonly currentProjectPath: string;
  readonly projectRootPath: string;
  readonly projectPath: string;
}

export function readChatRuntimeWorkspaceEnvironment(): ChatRuntimeWorkspaceEnvironment {
  const currentProjectPath = normalizePath(AilyHost.get().project?.currentProjectPath);
  const projectRootPath = normalizePath(AilyHost.get().project?.projectRootPath);
  return {
    currentProjectPath,
    projectRootPath,
    projectPath: currentProjectPath || projectRootPath,
  };
}

function normalizePath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
