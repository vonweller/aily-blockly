export type PublicProjectMode = 'arduino' | 'python' | 'freertos';
export type InternalGeneratorMode = 'arduino' | 'micropython';

export type PythonRuntimeTransport = 'canmv-usbdbg' | 'serial-shell' | 'ssh';
export type PythonRuntimeOutputModel = 'event-stream' | 'pty-combined';
export type PythonRuntimeInputModel = 'repl' | 'pty';
export type PythonRuntimeStopModel = 'device-interrupt' | 'process-group';
export type PythonRuntimeFileTransport = 'canmv-io' | 'serial-transfer' | 'sftp';

export interface PythonRuntimeExecutionProfile {
  transport: PythonRuntimeTransport;
  output: PythonRuntimeOutputModel;
  input: PythonRuntimeInputModel;
  stop: PythonRuntimeStopModel;
  files: PythonRuntimeFileTransport;
  temporaryRun: boolean;
}

export type PythonRuntimeAutostartProfile =
  | {
    kind: 'boot-start-sh';
    directory: string;
    backgroundRequired: boolean;
  }
  | {
    kind: 'systemd';
    unitDirectory: string;
  };

export interface PythonRuntimeDeploymentProfile {
  autostart: PythonRuntimeAutostartProfile;
}

export interface PythonRuntimeMetadata {
  kind: 'python';
  adapter: string;
  entry: string;
  execution?: PythonRuntimeExecutionProfile;
  deployment?: PythonRuntimeDeploymentProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDeclaredProjectMode(mode: unknown): mode is PublicProjectMode | 'micropython' {
  return mode === 'arduino' || mode === 'python' || mode === 'micropython' || mode === 'freertos';
}

export function normalizeBlocklyGeneratorMode(mode: unknown): InternalGeneratorMode {
  return mode === 'python' || mode === 'micropython' ? 'micropython' : 'arduino';
}

export function normalizePublicProjectMode(mode: unknown): PublicProjectMode {
  if (mode === 'python' || mode === 'micropython') return 'python';
  if (mode === 'freertos') return 'freertos';
  return 'arduino';
}

export function getBoardProjectModes(board: unknown): PublicProjectMode[] {
  const declaredModes = isRecord(board) && Array.isArray(board['mode'])
    ? board['mode'].filter(isDeclaredProjectMode)
    : [];
  const modes = declaredModes.length > 0 ? declaredModes : ['arduino'];
  return [...new Set(modes.map(normalizePublicProjectMode))];
}

export function getProjectModeTranslationKey(mode: unknown): string {
  switch (normalizePublicProjectMode(mode)) {
    case 'python':
      return 'PROJECT_NEW.FORM.MODE_PYTHON';
    case 'freertos':
      return 'PROJECT_NEW.FORM.MODE_FREERTOS';
    default:
      return 'PROJECT_NEW.FORM.MODE_ARDUINO';
  }
}

export function readPythonRuntimeMetadata(board: unknown): PythonRuntimeMetadata | null {
  if (!isRecord(board) || !isRecord(board['runtime'])) {
    return null;
  }
  const runtime = board['runtime'];
  if (runtime['kind'] !== 'python' || typeof runtime['adapter'] !== 'string' || !runtime['adapter'].trim()) {
    return null;
  }
  const metadata: PythonRuntimeMetadata = {
    kind: 'python',
    adapter: runtime['adapter'].trim(),
    entry: typeof runtime['entry'] === 'string' && runtime['entry'].trim()
      ? runtime['entry'].trim()
      : 'main.py',
  };
  const hasExecution = Object.prototype.hasOwnProperty.call(runtime, 'execution');
  const execution = readExecutionProfile(runtime['execution']);
  if (hasExecution && !execution) return null;
  if (execution) metadata.execution = execution;
  const hasDeployment = Object.prototype.hasOwnProperty.call(runtime, 'deployment');
  const deployment = readDeploymentProfile(runtime['deployment']);
  if (hasDeployment && !deployment) return null;
  if (deployment) metadata.deployment = deployment;
  return metadata;
}

function readExecutionProfile(value: unknown): PythonRuntimeExecutionProfile | null {
  if (!isRecord(value)) return null;
  const transport = value['transport'];
  const output = value['output'];
  const input = value['input'];
  const stop = value['stop'];
  const files = value['files'];
  if (
    !isOneOf(transport, ['canmv-usbdbg', 'serial-shell', 'ssh'])
    || !isOneOf(output, ['event-stream', 'pty-combined'])
    || !isOneOf(input, ['repl', 'pty'])
    || !isOneOf(stop, ['device-interrupt', 'process-group'])
    || !isOneOf(files, ['canmv-io', 'serial-transfer', 'sftp'])
    || typeof value['temporaryRun'] !== 'boolean'
  ) {
    return null;
  }
  return {
    transport,
    output,
    input,
    stop,
    files,
    temporaryRun: value['temporaryRun'],
  };
}

function readDeploymentProfile(value: unknown): PythonRuntimeDeploymentProfile | null {
  if (!isRecord(value) || !isRecord(value['autostart'])) return null;
  const autostart = value['autostart'];
  if (
    autostart['kind'] === 'boot-start-sh'
    && typeof autostart['directory'] === 'string'
    && autostart['directory'].trim()
    && typeof autostart['backgroundRequired'] === 'boolean'
  ) {
    return {
      autostart: {
        kind: 'boot-start-sh',
        directory: autostart['directory'].trim(),
        backgroundRequired: autostart['backgroundRequired'],
      },
    };
  }
  if (
    autostart['kind'] === 'systemd'
    && typeof autostart['unitDirectory'] === 'string'
    && autostart['unitDirectory'].trim()
  ) {
    return {
      autostart: {
        kind: 'systemd',
        unitDirectory: autostart['unitDirectory'].trim(),
      },
    };
  }
  return null;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}
