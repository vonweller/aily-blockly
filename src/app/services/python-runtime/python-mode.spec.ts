import {
  getBoardProjectModes,
  getProjectModeTranslationKey,
  normalizeBlocklyGeneratorMode,
  normalizePublicProjectMode,
  readPythonRuntimeMetadata,
} from './python-mode';

describe('Python project mode', () => {
  it('maps canonical and legacy Python modes to the current generator', () => {
    expect(normalizeBlocklyGeneratorMode('python')).toBe('micropython');
    expect(normalizeBlocklyGeneratorMode('micropython')).toBe('micropython');
    expect(normalizeBlocklyGeneratorMode('arduino')).toBe('arduino');
  });

  it('uses Python as the canonical product mode and localized product label key', () => {
    expect(normalizePublicProjectMode('micropython')).toBe('python');
    expect(normalizePublicProjectMode('python')).toBe('python');
    expect(getProjectModeTranslationKey('micropython')).toBe('PROJECT_NEW.FORM.MODE_PYTHON');
    expect(getProjectModeTranslationKey('python')).toBe('PROJECT_NEW.FORM.MODE_PYTHON');
    expect(getProjectModeTranslationKey('arduino')).toBe('PROJECT_NEW.FORM.MODE_ARDUINO');
    expect(getProjectModeTranslationKey('freertos')).toBe('PROJECT_NEW.FORM.MODE_FREERTOS');
  });

  it('normalizes and deduplicates modes declared by a board', () => {
    expect(getBoardProjectModes({ mode: ['micropython', 'python', 'arduino'] }))
      .toEqual(['python', 'arduino']);
    expect(getBoardProjectModes({})).toEqual(['arduino']);
    expect(getBoardProjectModes({ mode: [] })).toEqual(['arduino']);
    expect(getBoardProjectModes({ mode: ['python', null, 'unsupported'] })).toEqual(['python']);
    expect(normalizePublicProjectMode('unsupported')).toBe('arduino');
  });

  it('reads a CanMV adapter without checking the board name', () => {
    expect(readPythonRuntimeMetadata({
      mode: ['python'],
      runtime: { kind: 'python', adapter: 'canmv-k230', entry: 'main.py' },
    })).toEqual({ kind: 'python', adapter: 'canmv-k230', entry: 'main.py' });
  });

  it('normalizes execution and deployment profiles for Linux-capable Python boards', () => {
    expect(readPythonRuntimeMetadata({
      mode: ['python'],
      runtime: {
        kind: 'python',
        adapter: 'linux-ssh',
        entry: 'main.py',
        execution: {
          transport: 'ssh',
          output: 'pty-combined',
          input: 'pty',
          stop: 'process-group',
          files: 'sftp',
          temporaryRun: true,
        },
        deployment: {
          autostart: {
            kind: 'systemd',
            unitDirectory: '/etc/systemd/system',
          },
        },
      },
    })).toEqual({
      kind: 'python',
      adapter: 'linux-ssh',
      entry: 'main.py',
      execution: {
        transport: 'ssh',
        output: 'pty-combined',
        input: 'pty',
        stop: 'process-group',
        files: 'sftp',
        temporaryRun: true,
      },
      deployment: {
        autostart: {
          kind: 'systemd',
          unitDirectory: '/etc/systemd/system',
        },
      },
    });
  });

  it('rejects a runtime when a declared execution or deployment profile is malformed', () => {
    expect(readPythonRuntimeMetadata({
      runtime: {
        kind: 'python',
        adapter: 'canmv-k230',
        execution: {
          transport: 'guessed-serial-protocol',
          output: 'unknown',
        },
        deployment: {
          autostart: {
            kind: 'boot-start-sh',
            directory: '',
          },
        },
      },
    })).toBeNull();

    expect(readPythonRuntimeMetadata({
      runtime: {
        kind: 'python',
        adapter: 'canmv-k230',
        execution: {
          transport: 'canmv-usbdbg',
          output: 'event-stream',
          input: 'repl',
          stop: 'device-interrupt',
          files: 'canmv-io',
          temporaryRun: true,
        },
        deployment: {
          autostart: {
            kind: 'boot-start-sh',
            directory: '',
            backgroundRequired: true,
          },
        },
      },
    })).toBeNull();
  });

  it('rejects incomplete or non-Python runtime metadata', () => {
    expect(readPythonRuntimeMetadata({ runtime: { kind: 'arduino', adapter: 'canmv-k230' } })).toBeNull();
    expect(readPythonRuntimeMetadata({ runtime: { kind: 'python' } })).toBeNull();
    expect(readPythonRuntimeMetadata({ runtime: { kind: 'python', adapter: '   ' } })).toBeNull();
  });

  it('defaults a missing or blank Python entry file to main.py', () => {
    expect(readPythonRuntimeMetadata({ runtime: { kind: 'python', adapter: 'canmv-k230' } }))
      .toEqual({ kind: 'python', adapter: 'canmv-k230', entry: 'main.py' });
    expect(readPythonRuntimeMetadata({ runtime: { kind: 'python', adapter: 'canmv-k230', entry: '  ' } }))
      .toEqual({ kind: 'python', adapter: 'canmv-k230', entry: 'main.py' });
  });
});
