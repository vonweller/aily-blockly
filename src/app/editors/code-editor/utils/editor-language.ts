const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  c: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  h: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  ino: 'cpp',
  js: 'javascript',
  json: 'json',
  md: 'markdown',
  py: 'python',
  pyi: 'python',
  ts: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
};

export function editorLanguageForPath(filePath: string): string {
  const fileName = String(filePath || '').split(/[\\/]/).pop() || '';
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return 'plaintext';
  return LANGUAGE_BY_EXTENSION[fileName.slice(dotIndex + 1).toLowerCase()] || 'plaintext';
}

export function editorOptionsForPath<T extends Record<string, unknown>>(
  options: T,
  filePath: string,
): T & { language: string } {
  return {
    ...options,
    language: editorLanguageForPath(filePath),
  };
}
