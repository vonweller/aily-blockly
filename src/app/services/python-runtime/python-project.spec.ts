import {
  createEmbeddedPythonPackage,
  createEmbeddedPythonStarterFiles,
  isEmbeddedPythonProject,
  isEmbeddedPythonProjectRequest,
  writeEmbeddedPythonStarterProject,
} from './python-project';

describe('embedded Python project manifest', () => {
  it('creates a CanMV project package while preserving template dependencies', () => {
    const packageJson = createEmbeddedPythonPackage(
      {
        name: 'camera_demo',
        nickname: 'Camera Demo',
        dependencies: {
          '@aily-project/board-cybercam': '^1.0.0',
        },
      },
      {
        adapter: 'canmv-k230',
        runtime: 'micropython',
        entry: 'main.py',
      },
    );

    expect(packageJson.platform).toBe('embedded-python');
    expect(packageJson.devmode).toBe('python');
    expect(packageJson.aily).toEqual({
      schemaVersion: 1,
      projectType: 'python',
      runtime: 'micropython',
      adapter: 'canmv-k230',
      entry: 'main.py',
    });
    expect(packageJson.dependencies).toEqual({
      '@aily-project/board-cybercam': '^1.0.0',
    });
  });

  it('recognizes only versioned embedded Python manifests', () => {
    expect(isEmbeddedPythonProject({
      platform: 'embedded-python',
      devmode: 'python',
      aily: {
        schemaVersion: 1,
        projectType: 'python',
        runtime: 'micropython',
        adapter: 'canmv-k230',
        entry: 'main.py',
      },
    })).toBeTrue();

    expect(isEmbeddedPythonProject({ devmode: 'python' })).toBeFalse();
    expect(isEmbeddedPythonProject({
      platform: 'embedded-python',
      aily: { schemaVersion: 2, projectType: 'python' },
    })).toBeFalse();
  });

  it('creates the minimal files needed to open and run a new project', () => {
    const files = createEmbeddedPythonStarterFiles({
      name: 'camera_demo',
      nickname: 'Camera Demo',
      board: {
        name: 'cybercam-k230',
        nickname: 'CyberCam K230',
        version: '1.0.0',
      },
    });

    expect(Object.keys(files).sort()).toEqual(['main.py', 'package.json']);
    expect(JSON.parse(files['package.json']).aily.entry).toBe('main.py');
    expect(JSON.parse(files['package.json']).board.name).toBe('cybercam-k230');
    expect(files['main.py']).toContain('CyberCam K230');
  });

  it('recognizes only explicit Python project creation requests', () => {
    expect(isEmbeddedPythonProjectRequest({ projectType: 'python' })).toBeTrue();
    expect(isEmbeddedPythonProjectRequest({ projectType: 'blockly' })).toBeFalse();
    expect(isEmbeddedPythonProjectRequest({})).toBeFalse();
    expect(isEmbeddedPythonProjectRequest(null)).toBeFalse();
  });

  it('materializes starter files through the host filesystem boundary', async () => {
    const createdDirectories: string[] = [];
    const writtenFiles = new Map<string, string>();

    await writeEmbeddedPythonStarterProject('C:/projects/camera_demo', {
      name: 'camera_demo',
      nickname: 'Camera Demo',
      board: {
        name: 'cybercam-k230',
        nickname: 'CyberCam K230',
        version: '1.0.0',
      },
    }, {
      createDirectory: async path => { createdDirectories.push(path); },
      joinPath: (root, fileName) => `${root}/${fileName}`,
      writeFile: (path, content) => { writtenFiles.set(path, content); },
    });

    expect(createdDirectories).toEqual(['C:/projects/camera_demo']);
    expect(Array.from(writtenFiles.keys()).sort()).toEqual([
      'C:/projects/camera_demo/main.py',
      'C:/projects/camera_demo/package.json',
    ]);
    expect(JSON.parse(writtenFiles.get('C:/projects/camera_demo/package.json') || '{}').aily.adapter)
      .toBe('canmv-k230');
  });
});
