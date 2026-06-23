import type { IAilyHostAPI, IDirent, IFileSystem } from '../../core/host-api';
import type { ProjectRelatedFileEntry } from './project-related-file.types';

const RELATED_FILES_DIR_NAME = 'files';
const RELATED_FILES_METADATA_NAME = '.related-files.json';

interface FileDialogSelection {
  canceled: boolean;
  filePaths: string[];
}

interface RelatedFileMetadataEntry {
  readonly originalPath: string;
  readonly relativePath: string;
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

  list(projectPath: string): ProjectRelatedFileEntry[] {
    const rootDir = this.resolveRootDir(projectPath);
    if (!rootDir || !this.host.fs.existsSync(rootDir)) {
      return [];
    }

    const metadataByRelativePath = this.readMetadataByRelativePath(projectPath);

    return readDirEntries(this.host.fs, rootDir)
      .filter((entry) => !entry.name.startsWith('.') && entry.name !== RELATED_FILES_METADATA_NAME)
      .map((entry) => {
        const absolutePath = this.host.path.join(rootDir, entry.name);
        const relativePath = this.host.path.join(RELATED_FILES_DIR_NAME, entry.name);
        return {
          type: entry.isDirectory() ? 'folder' : 'file',
          name: entry.name,
          absolutePath,
          relativePath,
          originalPath: metadataByRelativePath.get(relativePath)?.originalPath,
        } as ProjectRelatedFileEntry;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async pickAndCopy(projectPath: string): Promise<PickAndCopyResult> {
    const rootDir = this.requireRootDir(projectPath);
    this.ensureDir(rootDir);
    const metadataEntries = this.readMetadata(projectPath);
    const existingOriginalPaths = new Set(
      metadataEntries.map((entry) => this.normalizePath(entry.originalPath)).filter(Boolean),
    );

    const result = await this.host.dialog.selectFiles({
      title: '选择文件或文件夹',
      properties: ['multiSelections', 'openFile', 'openDirectory'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    }) as FileDialogSelection | null | undefined;

    if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return { addedEntries: [], skippedOriginalPaths: [] };
    }

    const addedEntries: ProjectRelatedFileEntry[] = [];
    const skippedOriginalPaths: string[] = [];
    const nextMetadataEntries = [...metadataEntries];

    for (const sourcePath of result.filePaths) {
      const normalizedOriginalPath = this.normalizePath(sourcePath);
      if (normalizedOriginalPath && existingOriginalPaths.has(normalizedOriginalPath)) {
        skippedOriginalPaths.push(sourcePath);
        continue;
      }

      const name = this.host.path.basename(sourcePath);
      const destinationPath = this.createUniqueDestination(rootDir, name);
      this.copyPath(sourcePath, destinationPath);
      const relativePath = this.host.path.join(
        RELATED_FILES_DIR_NAME,
        this.host.path.basename(destinationPath),
      );
      if (normalizedOriginalPath) {
        existingOriginalPaths.add(normalizedOriginalPath);
        nextMetadataEntries.push({
          originalPath: sourcePath,
          relativePath,
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

    this.writeMetadata(projectPath, nextMetadataEntries);
    return { addedEntries, skippedOriginalPaths };
  }

  remove(projectPath: string, entry: ProjectRelatedFileEntry): void {
    if (!this.host.fs.existsSync(entry.absolutePath)) {
      this.removeMetadataEntry(projectPath, entry);
      return;
    }

    if (this.host.fs.statSync(entry.absolutePath).isDirectory()) {
      this.host.fs.rmdirSync(entry.absolutePath, { recursive: true, force: true });
      this.removeMetadataEntry(projectPath, entry);
      return;
    }

    this.host.fs.unlinkSync(entry.absolutePath);
    this.removeMetadataEntry(projectPath, entry);
  }

  buildPromptText(projectPath: string): string {
    const entries = this.list(projectPath);
    if (entries.length === 0) {
      return '';
    }

    const lines = [
      'Reference related files/folders copied into the current project may be useful.',
      'Review them when relevant before making assumptions.',
      ...entries.map((entry) => `- ${entry.relativePath}`),
    ];

    return lines.join('\n');
  }

  private resolveRootDir(projectPath: string): string | undefined {
    const normalizedProjectPath = typeof projectPath === 'string' ? projectPath.trim() : '';
    return normalizedProjectPath
      ? this.host.path.join(normalizedProjectPath, RELATED_FILES_DIR_NAME)
      : undefined;
  }

  private requireRootDir(projectPath: string): string {
    const rootDir = this.resolveRootDir(projectPath);
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

  private readMetadata(projectPath: string): RelatedFileMetadataEntry[] {
    const metadataPath = this.resolveMetadataPath(projectPath);
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
        }));
    } catch {
      return [];
    }
  }

  private readMetadataByRelativePath(projectPath: string): Map<string, RelatedFileMetadataEntry> {
    const entries = this.readMetadata(projectPath);
    return new Map(entries.map((entry) => [entry.relativePath, entry]));
  }

  private writeMetadata(projectPath: string, entries: readonly RelatedFileMetadataEntry[]): void {
    const metadataPath = this.resolveMetadataPath(projectPath);
    if (!metadataPath) {
      return;
    }

    const nextEntries = entries
      .filter((entry) => entry.originalPath.trim().length > 0 && entry.relativePath.trim().length > 0)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    this.host.fs.writeFileSync(metadataPath, JSON.stringify(nextEntries, null, 2), 'utf-8');
  }

  private removeMetadataEntry(projectPath: string, entry: ProjectRelatedFileEntry): void {
    const entries = this.readMetadata(projectPath).filter((item) => item.relativePath !== entry.relativePath);
    this.writeMetadata(projectPath, entries);
  }

  private resolveMetadataPath(projectPath: string): string | undefined {
    const rootDir = this.resolveRootDir(projectPath);
    return rootDir
      ? this.host.path.join(rootDir, RELATED_FILES_METADATA_NAME)
      : undefined;
  }

  private normalizePath(path: string): string {
    return typeof path === 'string'
      ? path.trim().replace(/\\/g, '/').toLowerCase()
      : '';
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
