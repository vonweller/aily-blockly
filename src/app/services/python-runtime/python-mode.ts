export type PublicProjectMode = 'arduino' | 'python' | 'freertos';
export type InternalGeneratorMode = 'arduino' | 'micropython';

export interface PythonRuntimeMetadata {
  kind: 'python';
  adapter: string;
  entry: string;
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
  return {
    kind: 'python',
    adapter: runtime['adapter'].trim(),
    entry: typeof runtime['entry'] === 'string' && runtime['entry'].trim()
      ? runtime['entry'].trim()
      : 'main.py',
  };
}
