export type RelatedContentScope = 'project' | 'session';

export interface ProjectRelatedFileEntry {
  readonly type: 'file' | 'folder';
  readonly name: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly originalPath?: string;
}
