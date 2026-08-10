import {
  prepareGeneratedProjectCode,
  getFirmwareUploadRejection,
  LatestGenerationGate,
  persistGeneratedProjectCode,
  resolveGeneratedProjectRoute,
  writePythonGeneratedArtifact,
} from './python-generated-artifacts';

describe('writePythonGeneratedArtifact', () => {
  it('writes generated Python to the runtime entry with one trailing newline', async () => {
    const writes: Array<[string, string]> = [];
    const target = await writePythonGeneratedArtifact(
      'D:/project',
      'main.py',
      'print("ok")',
      {
        join: (...parts) => parts.join('/'),
        writeText: async (path, content) => { writes.push([path, content]); },
      },
    );

    expect(target).toBe('D:/project/main.py');
    expect(writes).toEqual([['D:/project/main.py', 'print("ok")\n']]);
  });

  it('defaults to main.py and preserves an existing trailing newline', async () => {
    const writes: Array<[string, string]> = [];
    await writePythonGeneratedArtifact('D:/project', '', 'pass\n', {
      join: (...parts) => parts.join('/'),
      writeText: async (path, content) => { writes.push([path, content]); },
    });

    expect(writes).toEqual([['D:/project/main.py', 'pass\n']]);
  });

  it('rejects absolute and traversal runtime entries before writing', async () => {
    for (const entry of ['../outside.py', 'scripts/../../outside.py', '/tmp/outside.py', 'C:\\outside.py']) {
      const writeText = jasmine.createSpy('writeText');
      await expectAsync(writePythonGeneratedArtifact('D:/project', entry, 'pass', {
        join: (...parts) => parts.join('/'),
        writeText,
      })).toBeRejectedWithError(/runtime entry/i);
      expect(writeText).not.toHaveBeenCalled();
    }
  });
});

describe('generated project routing', () => {
  const pythonBoard = {
    runtime: { kind: 'python', adapter: 'canmv-k230', entry: 'main.py' },
  };

  it('keeps Python source unchanged and never invokes Arduino normalization', () => {
    const normalizeArduino = jasmine.createSpy('normalizeArduino');
    const generated = prepareGeneratedProjectCode(
      'python',
      pythonBoard,
      'print("raw")\n',
      normalizeArduino,
    );

    expect(generated).toEqual({
      kind: 'python',
      code: 'print("raw")\n',
      runtime: { kind: 'python', adapter: 'canmv-k230', entry: 'main.py' },
    });
    expect(normalizeArduino).not.toHaveBeenCalled();
  });

  it('keeps Arduino behavior when Python metadata is absent', () => {
    const generated = prepareGeneratedProjectCode(
      'arduino',
      {},
      'raw',
      (code) => `normalized:${code}`,
    );

    expect(generated).toEqual({ kind: 'arduino', code: 'normalized:raw', runtime: null });
  });

  it('rejects a Python project without runtime metadata instead of compiling it as Arduino', () => {
    const normalizeArduino = jasmine.createSpy('normalizeArduino');
    expect(() => prepareGeneratedProjectCode('python', {}, 'raw', normalizeArduino))
      .toThrowError(/Python project requires valid board runtime metadata/);
    expect(resolveGeneratedProjectRoute('python', {})).toEqual({ kind: 'invalid-python', runtime: null });
    expect(normalizeArduino).not.toHaveBeenCalled();
  });

  it('keeps legacy MicroPython projects compatible with board runtime metadata', () => {
    expect(resolveGeneratedProjectRoute('micropython', pythonBoard)).toEqual({
      kind: 'python',
      runtime: { kind: 'python', adapter: 'canmv-k230', entry: 'main.py' },
    });
  });

  it('blocks firmware upload for Python without affecting Arduino upload', () => {
    expect(getFirmwareUploadRejection('python', pythonBoard)).toEqual({
      state: 'warn',
      text: 'Python projects run through the Python device runtime, not the firmware uploader.',
    });
    expect(getFirmwareUploadRejection('python', {})).toEqual({
      state: 'error',
      text: 'Python project requires valid board runtime metadata',
    });
    expect(getFirmwareUploadRejection('arduino', {})).toBeNull();
  });

  it('persists through one shared Python-or-Arduino artifact boundary', async () => {
    const writeText = jasmine.createSpy('writeText').and.resolveTo();
    const writeArduino = jasmine.createSpy('writeArduino').and.resolveTo();
    const python = await persistGeneratedProjectCode({
      mode: 'python',
      board: pythonBoard,
      projectRoot: 'D:/project',
      rawCode: 'print("ok")',
      generator: {},
      normalizeArduino: (code) => `normalized:${code}`,
      io: { join: (...parts) => parts.join('/'), writeText },
      writeArduino,
    });
    expect(python.kind).toBe('python');
    expect(writeText).toHaveBeenCalledOnceWith('D:/project/main.py', 'print("ok")\n');
    expect(writeArduino).not.toHaveBeenCalled();

    writeText.calls.reset();
    await persistGeneratedProjectCode({
      mode: 'arduino',
      board: {},
      projectRoot: 'D:/project',
      rawCode: 'raw',
      generator: { name: 'arduino' },
      normalizeArduino: (code) => `normalized:${code}`,
      io: { join: (...parts) => parts.join('/'), writeText },
      writeArduino,
    });
    expect(writeArduino).toHaveBeenCalledOnceWith('D:/project', { name: 'arduino' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('allows only the latest generation token to commit', () => {
    const gate = new LatestGenerationGate();
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBeTrue();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBeFalse();
    expect(gate.isCurrent(second)).toBeTrue();
  });

  it('propagates Python persistence failures to its caller', async () => {
    await expectAsync(persistGeneratedProjectCode({
      mode: 'python',
      board: pythonBoard,
      projectRoot: 'D:/project',
      rawCode: 'pass',
      generator: {},
      normalizeArduino: (code) => code,
      io: {
        join: (...parts) => parts.join('/'),
        writeText: async () => { throw new Error('disk full'); },
      },
      writeArduino: async () => undefined,
    })).toBeRejectedWithError('disk full');
  });
});
