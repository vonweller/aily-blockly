export type RemoteEntryType = 'file' | 'directory';

export interface RemoteDirectoryEntry {
  name: string;
  type: RemoteEntryType;
  size: number;
  mtime?: number;
}

export interface RemoteDirectoryNode extends RemoteDirectoryEntry {
  path: string;
}

export interface RemoteDirectoryResult {
  entries?: RemoteDirectoryEntry[];
}

export function joinRemotePath(parent: string, name: string): string {
  const normalizedParent = parent === '/' ? '' : String(parent || '').replace(/\/+$/, '');
  return `${normalizedParent}/${name}`.replace(/^\/{2,}/, '/');
}

export function normalizeRemoteDirectory(parent: string, result: RemoteDirectoryResult): RemoteDirectoryNode[] {
  if (!Array.isArray(result?.entries)) return [];
  return result.entries.map(entry => {
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name === '.' || entry.name === '..' || /[\\/]/.test(entry.name)) {
      throw new TypeError(`Remote directory contains an invalid name: ${entry?.name ?? ''}`);
    }
    if (entry.type !== 'file' && entry.type !== 'directory') {
      throw new TypeError(`Remote directory contains an invalid type for ${entry.name}`);
    }
    return {
      name: entry.name,
      path: joinRemotePath(parent, entry.name),
      type: entry.type,
      size: Number.isFinite(entry.size) ? entry.size : 0,
      mtime: entry.mtime,
    };
  }).sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}
