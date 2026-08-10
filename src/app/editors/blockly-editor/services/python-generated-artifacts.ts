import {
  normalizePublicProjectMode,
  readPythonRuntimeMetadata,
  type PythonRuntimeMetadata,
} from '../../../services/python-runtime/python-mode';

export interface PythonGeneratedArtifactIo {
  join: (...parts: string[]) => string;
  writeText: (path: string, content: string) => Promise<void>;
}

export interface PersistGeneratedProjectCodeOptions {
  mode: unknown;
  board: unknown;
  projectRoot: string;
  rawCode: string;
  generator: unknown;
  normalizeArduino: (code: string) => string;
  io: PythonGeneratedArtifactIo;
  writeArduino: (projectRoot: string, generator: unknown) => Promise<void>;
}

export class LatestGenerationGate {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export type GeneratedProjectRoute =
  | { kind: 'python'; runtime: PythonRuntimeMetadata }
  | { kind: 'invalid-python'; runtime: null }
  | { kind: 'arduino'; runtime: null };

export type GeneratedProjectCode =
  | ({ kind: 'python'; runtime: PythonRuntimeMetadata } & { code: string })
  | ({ kind: 'arduino'; runtime: null } & { code: string });

export interface FirmwareUploadRejection {
  state: 'warn' | 'error';
  text: string;
}

export function resolveGeneratedProjectRoute(mode: unknown, board: unknown): GeneratedProjectRoute {
  const runtime = readPythonRuntimeMetadata(board);
  if (normalizePublicProjectMode(mode) !== 'python') {
    return { kind: 'arduino', runtime: null };
  }
  return runtime
    ? { kind: 'python', runtime }
    : { kind: 'invalid-python', runtime: null };
}

export function prepareGeneratedProjectCode(
  mode: unknown,
  board: unknown,
  rawCode: string,
  normalizeArduino: (code: string) => string,
): GeneratedProjectCode {
  const route = resolveGeneratedProjectRoute(mode, board);
  if (route.kind === 'invalid-python') {
    throw new Error('Python project requires valid board runtime metadata');
  }
  return route.kind === 'python'
    ? { ...route, code: rawCode }
    : { ...route, code: normalizeArduino(rawCode) };
}

export function getFirmwareUploadRejection(
  mode: unknown,
  board: unknown,
): FirmwareUploadRejection | null {
  const route = resolveGeneratedProjectRoute(mode, board);
  if (route.kind === 'python') {
    return {
      state: 'warn',
      text: 'Python projects run through the Python device runtime, not the firmware uploader.',
    };
  }
  if (route.kind === 'invalid-python') {
    return {
      state: 'error',
      text: 'Python project requires valid board runtime metadata',
    };
  }
  return null;
}

export async function persistGeneratedProjectCode(
  options: PersistGeneratedProjectCodeOptions,
): Promise<GeneratedProjectCode> {
  const generated = prepareGeneratedProjectCode(
    options.mode,
    options.board,
    options.rawCode,
    options.normalizeArduino,
  );
  if (generated.kind === 'python') {
    await writePythonGeneratedArtifact(
      options.projectRoot,
      generated.runtime.entry,
      generated.code,
      options.io,
    );
  } else {
    await options.writeArduino(options.projectRoot, options.generator);
  }
  return generated;
}

export async function writePythonGeneratedArtifact(
  projectRoot: string,
  entry: string,
  code: string,
  io: PythonGeneratedArtifactIo,
): Promise<string> {
  const runtimeEntry = validateRuntimeEntry(entry || 'main.py');
  const target = io.join(projectRoot, runtimeEntry);
  await io.writeText(target, code.endsWith('\n') ? code : `${code}\n`);
  return target;
}

function validateRuntimeEntry(entry: string): string {
  const normalized = entry.trim();
  const segments = normalized.split('/');
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.includes('\\')
    || normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid Python runtime entry: ${entry}`);
  }
  return normalized;
}
