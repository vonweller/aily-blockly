import {
  isSafeLocalSourcePath,
  libraryFoldersForLocalBoard,
  mergeLocalCatalogEntries,
  planLocalLinuxProjectSeed,
  pickLibrariesRootForBoard,
  readLocalPythonBoardCatalog,
  readLocalPythonLibraryCatalog,
  resolveBoardCatalogImageUrl,
  resolveExistingSiblingWorkspaceRoots,
  resolveSiblingWorkspaceRoot,
  seedLocalLinuxPythonProject,
  type LocalPathApi,
} from './local-python-catalog';

function posixPath(): LocalPathApi {
  return {
    join: (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
    resolve: (...parts: string[]) => {
      const joined = parts.filter(Boolean).join('/');
      const stack: string[] = [];
      for (const part of joined.split('/')) {
        if (!part || part === '.') {
          continue;
        }
        if (part === '..') {
          stack.pop();
          continue;
        }
        stack.push(part);
      }
      return `/${stack.join('/')}`;
    },
    relative: (from: string, to: string) => {
      const fromParts = from.split('/').filter(Boolean);
      const toParts = to.split('/').filter(Boolean);
      let index = 0;
      while (index < fromParts.length && index < toParts.length && fromParts[index] === toParts[index]) {
        index += 1;
      }
      return [...fromParts.slice(index).map(() => '..'), ...toParts.slice(index)].join('/') || '.';
    },
    isAbsolute: (value: string) => value.startsWith('/'),
  };
}

function winPath(): LocalPathApi {
  return {
    join: (...parts: string[]) => parts.filter(Boolean).join('\\').replace(/\\+/g, '\\'),
    resolve: (...parts: string[]) => {
      const joined = parts.filter(Boolean).join('\\');
      const match = /^[A-Za-z]:/.exec(joined);
      const drive = match ? match[0] : 'D:';
      const stack: string[] = [];
      for (const part of joined.replace(/^[A-Za-z]:/, '').split(/[\\/]/)) {
        if (!part || part === '.') {
          continue;
        }
        if (part === '..') {
          stack.pop();
          continue;
        }
        stack.push(part);
      }
      return `${drive}\\${stack.join('\\')}`;
    },
    relative: (from: string, to: string) => {
      const fromParts = from.replace(/^[A-Za-z]:/, '').split(/[\\/]/).filter(Boolean);
      const toParts = to.replace(/^[A-Za-z]:/, '').split(/[\\/]/).filter(Boolean);
      let index = 0;
      while (index < fromParts.length && index < toParts.length && fromParts[index] === toParts[index]) {
        index += 1;
      }
      return [...fromParts.slice(index).map(() => '..'), ...toParts.slice(index)].join('\\') || '.';
    },
    isAbsolute: (value: string) => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'),
  };
}

describe('local Python catalog', () => {
  it('resolves sibling workspace roots from the Electron directory', () => {
    expect(resolveSiblingWorkspaceRoot('/repo/aily-blockly/electron', 'aily-blockly-boards', posixPath()))
      .toBe('/repo/aily-blockly-boards');
    expect(resolveSiblingWorkspaceRoot('D:\\repo\\aily-blockly\\electron', 'aily-blockly-libraries', winPath()))
      .toBe('D:\\repo\\aily-blockly-libraries');
    expect(resolveSiblingWorkspaceRoot('/repo/electron', '../escape', posixPath())).toBeNull();
    expect(resolveSiblingWorkspaceRoot('electron', 'aily-blockly-boards', posixPath())).toBeNull();
    expect(resolveExistingSiblingWorkspaceRoots(
      '/repo/aily-blockly/electron',
      ['aily-blockly-boards', 'aily-blockly-linux-boards'],
      posixPath(),
      (filePath) => filePath === '/repo/aily-blockly-linux-boards',
    )).toEqual(['/repo/aily-blockly-linux-boards']);
    expect(pickLibrariesRootForBoard(
      '/repo/aily-blockly-linux-boards/raspberrypi',
      ['/repo/aily-blockly-libraries', '/repo/aily-blockly-linux-libraries'],
      posixPath(),
      (filePath) => filePath === '/repo/aily-blockly-linux-libraries/python-core'
        || filePath === '/repo/aily-blockly-linux-libraries/linux-python'
        || filePath === '/repo/aily-blockly-libraries/cybercam',
    )).toBe('/repo/aily-blockly-linux-libraries');
    expect(pickLibrariesRootForBoard(
      '/repo/aily-blockly-boards/cybercam',
      ['/repo/aily-blockly-libraries', '/repo/aily-blockly-linux-libraries'],
      posixPath(),
      (filePath) => filePath === '/repo/aily-blockly-linux-libraries/python-core'
        || filePath === '/repo/aily-blockly-linux-libraries/linux-python'
        || filePath === '/repo/aily-blockly-libraries/cybercam',
    )).toBe('/repo/aily-blockly-libraries');
  });

  it('rejects relative, escaped and UNC local sources', () => {
    const pathApi = posixPath();
    expect(isSafeLocalSourcePath('/repo/aily-blockly-boards/raspberrypi', ['/repo/aily-blockly-boards'], pathApi)).toBe(true);
    expect(isSafeLocalSourcePath('../raspberrypi', ['/repo/aily-blockly-boards'], pathApi)).toBe(false);
    expect(isSafeLocalSourcePath('/repo/aily-blockly-boards/../secret', ['/repo/aily-blockly-boards'], pathApi)).toBe(false);
    expect(isSafeLocalSourcePath('//server/share/board', ['/repo/aily-blockly-boards'], pathApi)).toBe(false);
    expect(isSafeLocalSourcePath('\\\\server\\share\\board', ['D:\\repo\\aily-blockly-boards'], winPath())).toBe(false);
  });

  it('reads unpublished Linux board and library catalog entries', () => {
    const files = new Map<string, string>([
      ['/repo/aily-blockly-boards/raspberrypi/package.json', JSON.stringify({
        name: '@aily-project/board-raspberrypi',
        nickname: 'Raspberry Pi',
        version: '1.0.0',
        description: 'Raspberry Pi Linux',
        brand: 'RaspberryPi',
        author: 'RaspberryPi',
        url: 'https://www.raspberrypi.com/documentation/',
        keywords: ['Linux', 'Python'],
        description_zh_cn: '树莓派',
      })],
      ['/repo/aily-blockly-boards/raspberrypi/board.json', JSON.stringify({
        name: 'Raspberry Pi',
        type: 'linux:python:raspberrypi',
        mode: ['python'],
      })],
      ['/repo/aily-blockly-boards/raspberrypi/template/package.json', JSON.stringify({
        dependencies: {
          '@aily-project/board-raspberrypi': '1.0.0',
          '@aily-project/lib-python-core': '1.0.0',
          '@aily-project/lib-linux-python': '1.0.0',
        },
      })],
      ['/repo/aily-blockly-libraries/python-core/package.json', JSON.stringify({
        name: '@aily-project/lib-python-core',
        nickname: 'Python Core',
        version: '1.0.0',
        description: 'Portable CPython',
        spec: true,
        compatibility: { core: ['linux:python:raspberrypi'] },
      })],
      ['/repo/aily-blockly-libraries/python-core/block.json', '[]'],
      ['/repo/aily-blockly-libraries/python-core/generator.js', 'export default {};'],
    ]);
    const io = {
      exists: (filePath: string) => filePath === '/repo/aily-blockly-boards'
        || filePath === '/repo/aily-blockly-libraries'
        || files.has(filePath)
        || filePath === '/repo/aily-blockly-boards/raspberrypi'
        || filePath === '/repo/aily-blockly-libraries/python-core',
      readFile: (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) {
          throw new Error(`missing ${filePath}`);
        }
        return content;
      },
      path: posixPath(),
    };

    expect(readLocalPythonBoardCatalog(io, '/repo/aily-blockly-boards')).toEqual([
      jasmine.objectContaining({
        name: '@aily-project/board-raspberrypi',
        nickname: 'Raspberry Pi',
        version: '1.0.0',
        brand: 'RaspberryPi',
        type: 'linux:python:raspberrypi',
        mode: ['python'],
        img: 'raspberrypi.webp',
        localImg: '/imgs/boards/raspberrypi.webp',
        localSource: '/repo/aily-blockly-boards/raspberrypi',
        description_zh_cn: '树莓派',
      }),
    ]);
    expect(readLocalPythonLibraryCatalog(io, '/repo/aily-blockly-libraries')).toEqual([
      jasmine.objectContaining({
        name: '@aily-project/lib-python-core',
        spec: true,
        localSource: '/repo/aily-blockly-libraries/python-core',
      }),
    ]);
  });

  it('lets local catalog entries replace remote collisions and prepend unpublished boards', () => {
    const merged = mergeLocalCatalogEntries(
      [
        { name: '@aily-project/board-cybercam', nickname: 'CyberCAM' },
        { name: '@aily-project/board-raspberrypi', nickname: 'Old Pi' },
      ],
      [
        { name: '@aily-project/board-raspberrypi', nickname: 'Raspberry Pi', localSource: '/boards/raspberrypi' },
        { name: '@aily-project/board-walnutpi', nickname: 'WalnutPi', localSource: '/boards/walnutpi' },
      ],
    );

    expect(merged.map((entry) => entry.name)).toEqual([
      '@aily-project/board-walnutpi',
      '@aily-project/board-cybercam',
      '@aily-project/board-raspberrypi',
    ]);
    expect(merged[2]).toEqual(jasmine.objectContaining({
      nickname: 'Raspberry Pi',
      localSource: '/boards/raspberrypi',
    }));
  });

  it('resolves local board images from the app public folder and remote images from the resource CDN', () => {
    expect(resolveBoardCatalogImageUrl(
      { img: 'raspberrypi.webp', localImg: '/imgs/boards/raspberrypi.webp' },
      'https://cdn.example/resource',
    )).toBe('/imgs/boards/raspberrypi.webp');
    expect(resolveBoardCatalogImageUrl(
      { img: 'uno.webp' },
      'https://cdn.example/resource/',
    )).toBe('https://cdn.example/resource/imgs/boards/uno.webp');
    expect(resolveBoardCatalogImageUrl(
      { img: 'uno.webp' },
      'https://cdn.example/resource/imgs/boards',
    )).toBe('https://cdn.example/resource/imgs/boards/uno.webp');
    expect(libraryFoldersForLocalBoard('/repo/aily-blockly-boards/cybercam', posixPath())).toEqual(['cybercam']);
    expect(libraryFoldersForLocalBoard('/repo/aily-blockly-boards/walnutpi', posixPath())).toEqual(['python-core', 'linux-python']);
  });

  it('seeds local Linux board and library files into app data and the project', () => {
    const copies: Array<[string, string]> = [];
    const removals: string[] = [];
    const files = new Set([
      '/boards/raspberrypi',
      '/boards/raspberrypi/package.json',
      '/boards/raspberrypi/template',
      '/libs/python-core',
      '/libs/python-core/package.json',
      '/libs/linux-python',
      '/libs/linux-python/package.json',
      '/app/node_modules/@aily-project/board-raspberrypi',
    ]);
    const io = {
      exists: (filePath: string) => files.has(filePath),
      readFile: () => '',
      mkdirSync: () => undefined,
      copySync: (source: string, destination: string) => copies.push([source, destination]),
      rmSync: (filePath: string) => removals.push(filePath),
      path: posixPath(),
    };

    const plan = seedLocalLinuxPythonProject({
      io,
      boardsRoot: '/boards',
      librariesRoot: '/libs',
      boardSource: '/boards/raspberrypi',
      appDataPath: '/app',
      projectPath: '/projects/Pi_Starter',
      boardPackageName: '@aily-project/board-raspberrypi',
    });

    expect(plan).toEqual(planLocalLinuxProjectSeed({
      path: posixPath(),
      appDataPath: '/app',
      projectPath: '/projects/Pi_Starter',
      boardPackageName: '@aily-project/board-raspberrypi',
      libraryFolders: ['python-core', 'linux-python'],
    }));
    expect(removals).toEqual(['/app/node_modules/@aily-project/board-raspberrypi']);
    expect(copies).toEqual([
      ['/boards/raspberrypi/package.json', '/app/node_modules/@aily-project/board-raspberrypi/package.json'],
      ['/boards/raspberrypi/template', '/app/node_modules/@aily-project/board-raspberrypi/template'],
      ['/boards/raspberrypi/package.json', '/projects/Pi_Starter/node_modules/@aily-project/board-raspberrypi/package.json'],
      ['/libs/python-core/package.json', '/projects/Pi_Starter/node_modules/@aily-project/lib-python-core/package.json'],
      ['/libs/linux-python/package.json', '/projects/Pi_Starter/node_modules/@aily-project/lib-linux-python/package.json'],
    ]);
  });

  it('seeds CyberCAM with lib-cybercam instead of Linux Python libraries', () => {
    const copies: Array<[string, string]> = [];
    const files = new Set([
      '/boards/cybercam',
      '/boards/cybercam/package.json',
      '/boards/cybercam/template',
      '/libs/cybercam',
      '/libs/cybercam/package.json',
    ]);
    const io = {
      exists: (filePath: string) => files.has(filePath),
      readFile: () => '',
      mkdirSync: () => undefined,
      copySync: (source: string, destination: string) => copies.push([source, destination]),
      rmSync: () => undefined,
      path: posixPath(),
    };

    const plan = seedLocalLinuxPythonProject({
      io,
      boardsRoot: '/boards',
      librariesRoot: '/libs',
      boardSource: '/boards/cybercam',
      appDataPath: '/app',
      projectPath: '/projects/CyberCAM_Starter',
      boardPackageName: '@aily-project/board-cybercam',
    });

    expect(plan.libraryDests).toEqual({
      cybercam: '/projects/CyberCAM_Starter/node_modules/@aily-project/lib-cybercam',
    });
    expect(copies).toEqual([
      ['/boards/cybercam/package.json', '/app/node_modules/@aily-project/board-cybercam/package.json'],
      ['/boards/cybercam/template', '/app/node_modules/@aily-project/board-cybercam/template'],
      ['/boards/cybercam/package.json', '/projects/CyberCAM_Starter/node_modules/@aily-project/board-cybercam/package.json'],
      ['/libs/cybercam/package.json', '/projects/CyberCAM_Starter/node_modules/@aily-project/lib-cybercam/package.json'],
    ]);
  });

  it('refuses to seed a board or library outside the sibling workspace roots', () => {
    expect(() => seedLocalLinuxPythonProject({
      io: {
        exists: () => true,
        readFile: () => '',
        mkdirSync: () => undefined,
        copySync: () => undefined,
        rmSync: () => undefined,
        path: posixPath(),
      },
      boardsRoot: '/boards',
      librariesRoot: '/libs',
      boardSource: '/tmp/evil-board',
      appDataPath: '/app',
      projectPath: '/projects/Pi_Starter',
      boardPackageName: '@aily-project/board-raspberrypi',
    })).toThrowError(/Unsafe local board source/);
  });
});
