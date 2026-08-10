import {
  joinRemotePath,
  normalizeRemoteDirectory,
} from './remote-file-tree';

describe('remote file tree', () => {
  it('normalizes a directory response and lists directories before files', () => {
    const nodes = normalizeRemoteDirectory('/sd', {
      entries: [
        { name: 'main.py', type: 'file', size: 12 },
        { name: 'lib', type: 'directory', size: 0 },
      ],
    });

    expect(nodes).toEqual([
      { name: 'lib', path: '/sd/lib', type: 'directory', size: 0, mtime: undefined },
      { name: 'main.py', path: '/sd/main.py', type: 'file', size: 12, mtime: undefined },
    ]);
  });

  it('joins board paths without introducing duplicate separators', () => {
    expect(joinRemotePath('/', 'main.py')).toBe('/main.py');
    expect(joinRemotePath('/sd/', 'lib')).toBe('/sd/lib');
  });

  it('rejects directory entries that could escape their parent', () => {
    expect(() => normalizeRemoteDirectory('/', {
      entries: [{ name: '../secret.py', type: 'file', size: 1 }],
    })).toThrowError(/invalid name/i);
  });
});
