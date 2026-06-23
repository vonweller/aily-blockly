import { AilyHost } from '../../core/host';
import { ProjectRelatedFileStorage } from './project-related-file-storage';

export function buildProjectRelatedFilesPromptText(projectPath: string | undefined): string {
  const normalizedProjectPath = typeof projectPath === 'string'
    ? projectPath.trim()
    : '';
  if (!normalizedProjectPath) {
    return '';
  }

  const storage = new ProjectRelatedFileStorage(AilyHost.get());
  return storage.buildPromptText(normalizedProjectPath);
}
