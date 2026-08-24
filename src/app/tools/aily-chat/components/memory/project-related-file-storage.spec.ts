import { ProjectRelatedFileStorage } from './project-related-file-storage';
import type { IAilyHostAPI, IDirent, IFileStat, IFileSystem, IPathUtils } from '../../core/host-api';

describe('ProjectRelatedFileStorage', () => {
  it('lists project assets and links from the project asset directory', () => {
    const host = createHost();
    const storage = new ProjectRelatedFileStorage(host);

    storage.importPathReferences('project', '/project', ['/docs/guide.md']);
    storage.importLinks('project', '/project', ['https://example.com/docs']);

    const entries = storage.list('project', '/project');
    expect(entries.length).toBe(2);
    expect(entries.map((entry) => entry.absolutePath)).toEqual([
      '/project/.assets/guide.md',
      'https://example.com/docs',
    ]);

    const prompt = storage.buildPromptText('project', '/project');
    expect(prompt).toContain('Project assets are stored under the project asset directory.');
    expect(prompt).toContain('interpret that request as referring to the project asset directory by default');
    expect(prompt).toContain('inspect the asset root first');
    expect(prompt).toContain('If an asset entry is a directory');
    expect(prompt).toContain('read RELATED_URLS.txt');
  });

  it('returns an empty prompt outside the project scope', () => {
    const host = createHost();
    const storage = new ProjectRelatedFileStorage(host);

    expect(storage.list('session', '/project')).toEqual([]);
    expect(storage.buildPromptText('session', '/project')).toBe('');
  });
});

function createHost(): Pick<IAilyHostAPI, 'fs' | 'path' | 'dialog'> {
  return {
    fs: new InMemoryFileSystem(),
    path: new InMemoryPathUtils(),
    dialog: {
      selectFiles: async () => ({ canceled: true, filePaths: [] }),
    },
  };
}

type EntryNode =
  | { kind: 'dir'; mtime: Date }
  | { kind: 'file'; content: string; mtime: Date };

class InMemoryFileSystem implements IFileSystem {
  private readonly entries = new Map<string, EntryNode>([
    ['/', { kind: 'dir', mtime: new Date(0) }],
    ['/project', { kind: 'dir', mtime: new Date(0) }],
    ['/docs', { kind: 'dir', mtime: new Date(0) }],
    ['/docs/guide.md', { kind: 'file', content: '# Guide', mtime: new Date(0) }],
  ]);

  readFileSync(path: string, encoding?: string): string {
    const entry = this.readFileEntry(path);
    if (!encoding || encoding === 'utf-8') {
      return entry.content;
    }
    return entry.content;
  }

  writeFileSync(path: string, data: string, encoding?: string): void {
    void encoding;
    const normalizedPath = normalizePath(path);
    this.mkdirSync(dirname(normalizedPath), { recursive: true });
    this.entries.set(normalizedPath, { kind: 'file', content: data, mtime: new Date() });
  }

  existsSync(path: string): boolean {
    return this.entries.has(normalizePath(path));
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === '/') {
      return;
    }

    const parentPath = dirname(normalizedPath);
    if (!this.entries.has(parentPath)) {
      if (!options?.recursive) {
        throw new Error(`ENOENT: ${parentPath}`);
      }
      this.mkdirSync(parentPath, options);
    }

    this.entries.set(normalizedPath, { kind: 'dir', mtime: new Date() });
  }

  unlinkSync(path: string): void {
    const normalizedPath = normalizePath(path);
    this.readEntry(normalizedPath, 'file');
    this.entries.delete(normalizedPath);
  }

  rmdirSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === '/') {
      return;
    }

    const hasChildren = [...this.entries.keys()].some((key) => key !== normalizedPath && isChildPath(normalizedPath, key));
    if (hasChildren && !options?.recursive) {
      throw new Error(`ENOTEMPTY: ${normalizedPath}`);
    }

    for (const key of [...this.entries.keys()]) {
      if (key === normalizedPath || isChildPath(normalizedPath, key)) {
        this.entries.delete(key);
      }
    }
  }

  statSync(path: string): IFileStat {
    const entry = this.readEntry(normalizePath(path));
    return {
      isDirectory: () => entry.kind === 'dir',
      isFile: () => entry.kind === 'file',
      size: entry.kind === 'file' ? entry.content.length : 0,
      mtime: entry.mtime,
      birthtime: entry.mtime,
    };
  }

  isDirectory(path: string): boolean {
    const entry = this.entries.get(normalizePath(path));
    return entry?.kind === 'dir';
  }

  readdirSync(path: string): string[] {
    return this.readDirSync(path).map((entry) => entry.name);
  }

  readDirSync(path: string): IDirent[] {
    const normalizedPath = normalizePath(path);
    this.readEntry(normalizedPath, 'dir');
    const names = new Set<string>();

    for (const key of this.entries.keys()) {
      if (key === normalizedPath || !isChildPath(normalizedPath, key)) {
        continue;
      }

      const relativePath = key.slice(normalizedPath === '/' ? 1 : normalizedPath.length + 1);
      const [name] = relativePath.split('/');
      if (name) {
        names.add(name);
      }
    }

    return [...names].sort().map((name) => {
      const childPath = joinPaths(normalizedPath, name);
      return {
        name,
        isDirectory: () => this.readEntry(childPath, 'dir', false)?.kind === 'dir',
        isFile: () => this.readEntry(childPath, 'file', false)?.kind === 'file',
      };
    });
  }

  private readEntry(path: string, kind?: 'file' | 'dir', throwOnKindMismatch = true): EntryNode {
    const normalizedPath = normalizePath(path);
    const entry = this.entries.get(normalizedPath);
    if (!entry) {
      throw new Error(`ENOENT: ${normalizedPath}`);
    }

    if (kind && throwOnKindMismatch) {
      const expectedKind = kind === 'dir' ? 'dir' : 'file';
      if (entry.kind !== expectedKind) {
        throw new Error(`EINVAL: expected ${expectedKind} at ${normalizedPath}`);
      }
    }

    return entry;
  }

  private readFileEntry(path: string): Extract<EntryNode, { kind: 'file' }> {
    const entry = this.readEntry(path, 'file');
    if (entry.kind !== 'file') {
      throw new Error(`EINVAL: expected file at ${normalizePath(path)}`);
    }
    return entry;
  }
}

class InMemoryPathUtils implements IPathUtils {
  join(...paths: string[]): string {
    return normalizePath(paths.join('/'));
  }

  resolve(...paths: string[]): string {
    return this.join(...paths);
  }

  dirname(path: string): string {
    return dirname(path);
  }

  basename(path: string, ext?: string): string {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === '/') {
      return '/';
    }

    const segments = normalizedPath.split('/');
    const name = segments[segments.length - 1] || '';
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  }

  extname(path: string): string {
    const name = this.basename(path);
    const index = name.lastIndexOf('.');
    return index > 0 ? name.slice(index) : '';
  }

  relative(from: string, to: string): string {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);
    if (normalizedTo.startsWith(`${normalizedFrom}/`)) {
      return normalizedTo.slice(normalizedFrom.length + 1);
    }
    return normalizedTo;
  }

  isAbsolute(path: string): boolean {
    return path.startsWith('/');
  }

  normalize(path: string): string {
    return normalizePath(path);
  }

  getAppDataPath(): string {
    return '/appdata';
  }

  getUserDocuments(): string {
    return '/documents';
  }

  getUserHome(): string {
    return '/home';
  }
}

function normalizePath(input: string): string {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) {
    return '/';
  }

  const parts = value
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.');
  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}

function dirname(path: string): string {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === '/') {
    return '/';
  }

  const index = normalizedPath.lastIndexOf('/');
  return index <= 0 ? '/' : normalizedPath.slice(0, index);
}

function joinPaths(basePath: string, childPath: string): string {
  return normalizePath(`${basePath}/${childPath}`);
}

function isChildPath(parentPath: string, candidatePath: string): boolean {
  const normalizedParentPath = normalizePath(parentPath);
  const normalizedCandidatePath = normalizePath(candidatePath);
  return normalizedCandidatePath.startsWith(`${normalizedParentPath}/`);
}
