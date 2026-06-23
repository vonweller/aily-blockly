import type { IAilyHostAPI, IDirent, IFileSystem } from '../../core/host-api';
import type {
  ProjectRelatedContentGroup,
  ProjectRelatedFileEntry,
  RelatedContentScope,
} from './project-related-file.types';

const RELATED_FILES_METADATA_NAME = '.related-files.json';
const RELATED_CONTENT_COPY_LIMIT_BYTES = 10 * 1024 * 1024;

interface FileDialogSelection {
  canceled: boolean;
  filePaths: string[];
}

interface RelatedFileMetadataEntry {
  readonly originalPath: string;
  readonly relativePath: string;
  readonly name?: string;
  readonly type?: 'file' | 'folder' | 'link';
  readonly isExternal?: boolean;
  readonly addedAt?: number;
}

interface PickAndCopyResult {
  readonly addedEntries: readonly ProjectRelatedFileEntry[];
  readonly skippedOriginalPaths: readonly string[];
}

type FileDialogLike = Pick<IAilyHostAPI['dialog'], 'selectFiles'>;

export class ProjectRelatedFileStorage {
  constructor(
    private readonly host: Pick<IAilyHostAPI, 'fs' | 'path' | 'dialog'>,
  ) {}

  list(scope: RelatedContentScope, projectPath: string, sessionId?: string): ProjectRelatedFileEntry[] {
    const rootDir = this.resolveRootDir(scope, projectPath, sessionId);
    const metadataEntries = this.readMetadata(scope, projectPath, sessionId);
    const metadataByRelativePath = new Map(
      metadataEntries.map((entry) => [entry.relativePath, entry]),
    );

    const copiedEntries = rootDir && this.host.fs.existsSync(rootDir)
      ? readDirEntries(this.host.fs, rootDir)
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== RELATED_FILES_METADATA_NAME)
        .map((entry) => {
          const absolutePath = this.host.path.join(rootDir, entry.name);
          const relativePath = this.host.path.join(
            this.resolveRelativeRootDirName(scope, sessionId),
            entry.name,
          );
          return {
            type: entry.isDirectory() ? 'folder' : 'file',
            name: entry.name,
            absolutePath,
            relativePath,
            originalPath: metadataByRelativePath.get(relativePath)?.originalPath,
          } as ProjectRelatedFileEntry;
        })
      : [];

    const externalEntries = metadataEntries
      .filter((entry) => entry.isExternal === true)
      .map((entry) => {
        return {
          type: entry.type ?? 'file',
          name: entry.name || this.host.path.basename(entry.originalPath),
          absolutePath: entry.originalPath,
          relativePath: entry.relativePath,
          originalPath: entry.originalPath,
          isExternal: true,
        } as ProjectRelatedFileEntry;
      })
      .filter((entry) => entry.name.trim().length > 0);

    return [...copiedEntries, ...externalEntries]
      .sort((left, right) => {
        const leftAddedAt = metadataByRelativePath.get(left.relativePath)?.addedAt ?? 0;
        const rightAddedAt = metadataByRelativePath.get(right.relativePath)?.addedAt ?? 0;
        if (rightAddedAt !== leftAddedAt) {
          return rightAddedAt - leftAddedAt;
        }
        return left.name.localeCompare(right.name);
      });
  }

  listGrouped(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): ProjectRelatedContentGroup[] {
    const entries = this.list(scope, projectPath, sessionId);
    const orderedTypes: readonly ProjectRelatedFileEntry['type'][] = [
      'file',
      'folder',
      'link',
    ];

    return orderedTypes
      .map((type) => ({
        type,
        entries: entries.filter((entry) => entry.type === type),
      }))
      .filter((group) => group.entries.length > 0);
  }

  async pickAndCopy(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): Promise<PickAndCopyResult> {
    const result = await this.host.dialog.selectFiles({
      title: '选择文件或文件夹',
      properties: ['multiSelections', 'openFile', 'openDirectory'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    }) as FileDialogSelection | null | undefined;

    if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { addedEntries: [], skippedOriginalPaths: [] };
    }

    return this.importPaths(scope, projectPath, result.filePaths, sessionId);
  }

  importPaths(
    scope: RelatedContentScope,
    projectPath: string,
    sourcePaths: readonly string[],
    sessionId?: string,
  ): PickAndCopyResult {
    const rootDir = this.requireRootDir(scope, projectPath, sessionId);
    this.ensureDir(rootDir);
    const metadataEntries = this.readMetadata(scope, projectPath, sessionId);
    const existingOriginalPaths = new Set(
      metadataEntries.map((entry) => this.normalizePath(entry.originalPath)).filter(Boolean),
    );

    const addedEntries: ProjectRelatedFileEntry[] = [];
    const skippedOriginalPaths: string[] = [];
    const nextMetadataEntries = [...metadataEntries];

    for (const sourcePath of sourcePaths) {
      const normalizedOriginalPath = this.normalizePath(sourcePath);
      if (normalizedOriginalPath && existingOriginalPaths.has(normalizedOriginalPath)) {
        skippedOriginalPaths.push(sourcePath);
        continue;
      }

      const name = this.host.path.basename(sourcePath);
      const sourceStat = this.host.fs.statSync(sourcePath);
      const type: ProjectRelatedFileEntry['type'] = sourceStat.isDirectory()
        ? 'folder'
        : 'file';
      const shouldStoreAsReference = sourceStat.isFile()
        && ((Number.isFinite(sourceStat.size) ? sourceStat.size : 0) > RELATED_CONTENT_COPY_LIMIT_BYTES);

      if (shouldStoreAsReference) {
        if (normalizedOriginalPath) {
          existingOriginalPaths.add(normalizedOriginalPath);
          nextMetadataEntries.push({
            originalPath: sourcePath,
            relativePath: sourcePath,
            name,
            type,
            isExternal: true,
            addedAt: Date.now(),
          });
        }

        addedEntries.push({
          type,
          name,
          absolutePath: sourcePath,
          relativePath: sourcePath,
          ...(normalizedOriginalPath ? { originalPath: sourcePath } : {}),
          isExternal: true,
        });
        continue;
      }

      const destinationPath = this.createUniqueDestination(rootDir, name);
      this.copyPath(sourcePath, destinationPath);
      const relativePath = this.host.path.join(
        this.resolveRelativeRootDirName(scope, sessionId),
        this.host.path.basename(destinationPath),
      );
      if (normalizedOriginalPath) {
        existingOriginalPaths.add(normalizedOriginalPath);
        nextMetadataEntries.push({
          originalPath: sourcePath,
          relativePath,
          addedAt: Date.now(),
        });
      }
      addedEntries.push({
        type: this.host.fs.statSync(destinationPath).isDirectory() ? 'folder' : 'file',
        name: this.host.path.basename(destinationPath),
        absolutePath: destinationPath,
        relativePath,
        ...(normalizedOriginalPath ? { originalPath: sourcePath } : {}),
      });
    }

    this.writeMetadata(scope, projectPath, sessionId, nextMetadataEntries);
    return { addedEntries, skippedOriginalPaths };
  }

  importLinks(
    scope: RelatedContentScope,
    projectPath: string,
    urls: readonly string[],
    sessionId?: string,
  ): PickAndCopyResult {
    const rootDir = this.requireRootDir(scope, projectPath, sessionId);
    this.ensureDir(rootDir);
    const metadataEntries = this.readMetadata(scope, projectPath, sessionId);
    const existingOriginalPaths = new Set(
      metadataEntries.map((entry) => this.normalizePath(entry.originalPath)).filter(Boolean),
    );

    const addedEntries: ProjectRelatedFileEntry[] = [];
    const skippedOriginalPaths: string[] = [];
    const nextMetadataEntries = [...metadataEntries];

    for (const rawUrl of urls) {
      const normalizedUrl = this.normalizeUrl(rawUrl);
      if (!normalizedUrl) {
        skippedOriginalPaths.push(rawUrl);
        continue;
      }

      const dedupeKey = this.normalizePath(normalizedUrl);
      if (dedupeKey && existingOriginalPaths.has(dedupeKey)) {
        skippedOriginalPaths.push(rawUrl);
        continue;
      }

      const name = this.buildLinkName(normalizedUrl);
      if (dedupeKey) {
        existingOriginalPaths.add(dedupeKey);
        nextMetadataEntries.push({
          originalPath: normalizedUrl,
          relativePath: normalizedUrl,
          name,
          type: 'link',
          isExternal: true,
          addedAt: Date.now(),
        });
      }

      addedEntries.push({
        type: 'link',
        name,
        absolutePath: normalizedUrl,
        relativePath: normalizedUrl,
        originalPath: normalizedUrl,
        isExternal: true,
      });
    }

    this.writeMetadata(scope, projectPath, sessionId, nextMetadataEntries);
    return { addedEntries, skippedOriginalPaths };
  }

  importPathReferences(
    scope: RelatedContentScope,
    projectPath: string,
    sourcePaths: readonly string[],
    sessionId?: string,
  ): PickAndCopyResult {
    const rootDir = this.requireRootDir(scope, projectPath, sessionId);
    this.ensureDir(rootDir);
    const metadataEntries = this.readMetadata(scope, projectPath, sessionId);
    const existingOriginalPaths = new Set(
      metadataEntries.map((entry) => this.normalizePath(entry.originalPath)).filter(Boolean),
    );

    const addedEntries: ProjectRelatedFileEntry[] = [];
    const skippedOriginalPaths: string[] = [];
    const nextMetadataEntries = [...metadataEntries];

    for (const sourcePath of sourcePaths) {
      const normalizedOriginalPath = this.normalizePath(sourcePath);
      if (normalizedOriginalPath && existingOriginalPaths.has(normalizedOriginalPath)) {
        skippedOriginalPaths.push(sourcePath);
        continue;
      }

      const stat = this.host.fs.statSync(sourcePath);
      const type: ProjectRelatedFileEntry['type'] = stat.isDirectory()
        ? 'folder'
        : 'file';
      const name = this.host.path.basename(sourcePath);

      if (normalizedOriginalPath) {
        existingOriginalPaths.add(normalizedOriginalPath);
        nextMetadataEntries.push({
          originalPath: sourcePath,
          relativePath: sourcePath,
          name,
          type,
          isExternal: true,
          addedAt: Date.now(),
        });
      }

      addedEntries.push({
        type,
        name,
        absolutePath: sourcePath,
        relativePath: sourcePath,
        originalPath: sourcePath,
        isExternal: true,
      });
    }

    this.writeMetadata(scope, projectPath, sessionId, nextMetadataEntries);
    return { addedEntries, skippedOriginalPaths };
  }

  remove(
    scope: RelatedContentScope,
    projectPath: string,
    entry: ProjectRelatedFileEntry,
    sessionId?: string,
  ): void {
    if (entry.isExternal === true) {
      this.removeMetadataEntry(scope, projectPath, entry, sessionId);
      return;
    }

    if (!this.host.fs.existsSync(entry.absolutePath)) {
      this.removeMetadataEntry(scope, projectPath, entry, sessionId);
      return;
    }

    if (this.host.fs.statSync(entry.absolutePath).isDirectory()) {
      this.host.fs.rmdirSync(entry.absolutePath, { recursive: true, force: true });
      this.removeMetadataEntry(scope, projectPath, entry, sessionId);
      return;
    }

    this.host.fs.unlinkSync(entry.absolutePath);
    this.removeMetadataEntry(scope, projectPath, entry, sessionId);
  }

  buildPromptText(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): string {
    const entries = this.list(scope, projectPath, sessionId);
    if (entries.length === 0) {
      return '';
    }

    const lines = [
      `Reference related content when it may help with the current ${scope}.`,
      ...entries.map((entry) => `- ${entry.relativePath}`),
    ];

    return lines.join('\n');
  }

  private resolveRootDir(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): string | undefined {
    const normalizedProjectPath = typeof projectPath === 'string' ? projectPath.trim() : '';
    return normalizedProjectPath
      ? this.host.path.join(
        normalizedProjectPath,
        this.resolveRelativeRootDirName(scope, sessionId),
      )
      : undefined;
  }

  private requireRootDir(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): string {
    const rootDir = this.resolveRootDir(scope, projectPath, sessionId);
    if (!rootDir) {
      throw new Error('Project path is required for related files.');
    }

    return rootDir;
  }

  private ensureDir(dirPath: string): void {
    if (!this.host.fs.existsSync(dirPath)) {
      this.host.fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  private createUniqueDestination(rootDir: string, name: string): string {
    const extension = this.host.path.extname(name);
    const baseName = extension ? name.slice(0, -extension.length) : name;
    let candidateName = name;
    let index = 2;

    while (this.host.fs.existsSync(this.host.path.join(rootDir, candidateName))) {
      candidateName = extension
        ? `${baseName}-${index}${extension}`
        : `${baseName}-${index}`;
      index += 1;
    }

    return this.host.path.join(rootDir, candidateName);
  }

  private copyPath(sourcePath: string, destinationPath: string): void {
    const sourceStat = this.host.fs.statSync(sourcePath);
    if (sourceStat.isDirectory()) {
      this.copyDirectory(sourcePath, destinationPath);
      return;
    }

    this.copyFile(sourcePath, destinationPath);
  }

  private copyDirectory(sourceDir: string, destinationDir: string): void {
    this.ensureDir(destinationDir);

    for (const entry of readDirEntries(this.host.fs, sourceDir)) {
      const sourcePath = this.host.path.join(sourceDir, entry.name);
      const destinationPath = this.host.path.join(destinationDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(sourcePath, destinationPath);
      } else if (entry.isFile()) {
        this.copyFile(sourcePath, destinationPath);
      }
    }
  }

  private copyFile(sourcePath: string, destinationPath: string): void {
    const content = this.host.fs.readFileSync(sourcePath);
    this.host.fs.writeFileSync(destinationPath, content);
  }

  private readMetadata(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): RelatedFileMetadataEntry[] {
    const metadataPath = this.resolveMetadataPath(scope, projectPath, sessionId);
    if (!metadataPath || !this.host.fs.existsSync(metadataPath)) {
      return [];
    }

    try {
      const raw = this.host.fs.readFileSync(metadataPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((entry): entry is RelatedFileMetadataEntry => (
          entry
          && typeof entry === 'object'
          && typeof entry.originalPath === 'string'
          && typeof entry.relativePath === 'string'
        ))
        .map((entry) => ({
          originalPath: entry.originalPath,
          relativePath: entry.relativePath,
          ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
          ...(entry.type === 'file' || entry.type === 'folder' || entry.type === 'link'
            ? { type: entry.type }
            : {}),
          ...(entry.isExternal === true ? { isExternal: true } : {}),
          ...(typeof entry.addedAt === 'number' ? { addedAt: entry.addedAt } : {}),
        }));
    } catch {
      return [];
    }
  }

  private readMetadataByRelativePath(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): Map<string, RelatedFileMetadataEntry> {
    const entries = this.readMetadata(scope, projectPath, sessionId);
    return new Map(entries.map((entry) => [entry.relativePath, entry]));
  }

  private writeMetadata(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId: string | undefined,
    entries: readonly RelatedFileMetadataEntry[],
  ): void {
    const metadataPath = this.resolveMetadataPath(scope, projectPath, sessionId);
    if (!metadataPath) {
      return;
    }

    const nextEntries = entries
      .filter((entry) => entry.originalPath.trim().length > 0 && entry.relativePath.trim().length > 0)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    this.host.fs.writeFileSync(metadataPath, JSON.stringify(nextEntries, null, 2), 'utf-8');
  }

  private removeMetadataEntry(
    scope: RelatedContentScope,
    projectPath: string,
    entry: ProjectRelatedFileEntry,
    sessionId?: string,
  ): void {
    const entries = this.readMetadata(scope, projectPath, sessionId)
      .filter((item) => item.relativePath !== entry.relativePath);
    this.writeMetadata(scope, projectPath, sessionId, entries);
  }

  private resolveMetadataPath(
    scope: RelatedContentScope,
    projectPath: string,
    sessionId?: string,
  ): string | undefined {
    const rootDir = this.resolveRootDir(scope, projectPath, sessionId);
    return rootDir
      ? this.host.path.join(rootDir, RELATED_FILES_METADATA_NAME)
      : undefined;
  }

  private resolveRelativeRootDirName(
    scope: RelatedContentScope,
    sessionId?: string,
  ): string {
    return scope === 'project'
      ? 'files'
      : this.host.path.join('.chat_history', 'memory-tool', 'contents', sessionId || 'default');
  }

  private normalizePath(path: string): string {
    return typeof path === 'string'
      ? path.trim().replace(/\\/g, '/').toLowerCase()
      : '';
  }

  private normalizeUrl(value: string): string | undefined {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      return undefined;
    }

    try {
      return new URL(trimmed).toString();
    } catch {
      return undefined;
    }
  }

  private buildLinkName(url: string): string {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return `${parsed.hostname}${path}`;
    } catch {
      return url;
    }
  }
}

function readDirEntries(
  fs: Pick<IFileSystem, 'readdirSync' | 'readDirSync' | 'statSync'>,
  dirPath: string,
): IDirent[] {
  if (fs.readDirSync) {
    return fs.readDirSync(dirPath);
  }

  return fs.readdirSync(dirPath).map((name) => ({
    name,
    isDirectory: () => fs.statSync(`${dirPath}/${name}`).isDirectory(),
    isFile: () => fs.statSync(`${dirPath}/${name}`).isFile(),
  }));
}
