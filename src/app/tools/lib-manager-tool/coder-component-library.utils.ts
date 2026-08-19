export interface ArduinoLibraryProperties {
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly maintainer: string;
  readonly sentence: string;
  readonly paragraph: string;
  readonly category: string;
  readonly url: string;
  readonly architectures: readonly string[];
}

/** Parse the key=value format defined by Arduino library.properties. */
export function parseArduinoLibraryProperties(content: string): ArduinoLibraryProperties {
  const values = new Map<string, string>();
  let pending = '';

  for (const rawLine of String(content ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = pending + rawLine;
    if (line.endsWith('\\')) {
      pending = line.slice(0, -1);
      continue;
    }
    pending = '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim().toLowerCase();
    const value = trimmed.slice(separator + 1).trim();
    values.set(key, value);
  }

  const get = (key: string): string => values.get(key) ?? '';
  return {
    name: get('name'),
    version: get('version'),
    author: get('author'),
    maintainer: get('maintainer'),
    sentence: get('sentence'),
    paragraph: get('paragraph'),
    category: get('category'),
    url: get('url'),
    architectures: get('architectures')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  };
}

export function isSafeComponentLibraryDirectoryName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(String(value ?? ''));
}
