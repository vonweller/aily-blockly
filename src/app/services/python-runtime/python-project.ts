export const EMBEDDED_PYTHON_PROJECT_SCHEMA_VERSION = 1 as const;

export const CYBERCAM_K230_PYTHON_BOARD = {
  name: 'cybercam-k230',
  nickname: 'CyberCam / CanMV K230',
  version: '1.0.0',
} as const;

export interface EmbeddedPythonProjectConfig {
  readonly schemaVersion: typeof EMBEDDED_PYTHON_PROJECT_SCHEMA_VERSION;
  readonly projectType: 'python';
  readonly runtime: string;
  readonly adapter: string;
  readonly entry: string;
}

export interface EmbeddedPythonProjectOptions {
  readonly runtime: string;
  readonly adapter: string;
  readonly entry: string;
}

export interface EmbeddedPythonStarterInput {
  readonly name: string;
  readonly nickname: string;
  readonly board: {
    readonly name: string;
    readonly nickname: string;
    readonly version: string;
  };
  readonly runtime?: string;
  readonly adapter?: string;
  readonly entry?: string;
}

export interface EmbeddedPythonStarterFileSystem {
  createDirectory(path: string): Promise<void>;
  joinPath(root: string, fileName: string): string;
  writeFile(path: string, content: string): void;
}

export interface EmbeddedPythonPackageFields {
  readonly platform: 'embedded-python';
  readonly devmode: 'python';
  readonly aily: EmbeddedPythonProjectConfig;
}

export type EmbeddedPythonPackageJson<
  TBase extends Record<string, unknown> = Record<string, unknown>,
> = TBase & EmbeddedPythonPackageFields;

export function createEmbeddedPythonPackage<TBase extends Record<string, unknown>>(
  basePackage: TBase,
  options: EmbeddedPythonProjectOptions,
): EmbeddedPythonPackageJson<TBase> {
  return {
    ...basePackage,
    platform: 'embedded-python',
    devmode: 'python',
    aily: {
      schemaVersion: EMBEDDED_PYTHON_PROJECT_SCHEMA_VERSION,
      projectType: 'python',
      runtime: options.runtime,
      adapter: options.adapter,
      entry: options.entry,
    },
  };
}

export function isEmbeddedPythonProject(value: unknown): value is EmbeddedPythonPackageJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const packageJson = value as Record<string, unknown>;
  if (packageJson['platform'] !== 'embedded-python' || packageJson['devmode'] !== 'python') return false;

  const aily = packageJson['aily'];
  if (!aily || typeof aily !== 'object' || Array.isArray(aily)) return false;
  const config = aily as Record<string, unknown>;

  return config['schemaVersion'] === EMBEDDED_PYTHON_PROJECT_SCHEMA_VERSION
    && config['projectType'] === 'python'
    && isNonEmptyString(config['runtime'])
    && isNonEmptyString(config['adapter'])
    && isNonEmptyString(config['entry']);
}

export function isEmbeddedPythonProjectRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)['projectType'] === 'python';
}

export function createEmbeddedPythonStarterFiles(
  input: EmbeddedPythonStarterInput,
): Readonly<Record<string, string>> {
  const entry = input.entry || 'main.py';
  const packageJson = createEmbeddedPythonPackage({
    name: input.name,
    nickname: input.nickname || input.name,
    version: '1.0.0',
    board: { ...input.board },
    dependencies: {},
  }, {
    runtime: input.runtime || 'micropython',
    adapter: input.adapter || 'canmv-k230',
    entry,
  });

  return {
    'package.json': JSON.stringify(packageJson, null, 2),
    [entry]: [
      `\"\"\"${input.board.nickname} starter project.\"\"\"`,
      '',
      'def main():',
      `    print(\"Hello from ${input.board.nickname}\")`,
      '',
      '',
      "if __name__ == '__main__':",
      '    main()',
      '',
    ].join('\n'),
  };
}

export async function writeEmbeddedPythonStarterProject(
  projectPath: string,
  input: EmbeddedPythonStarterInput,
  fileSystem: EmbeddedPythonStarterFileSystem,
): Promise<void> {
  await fileSystem.createDirectory(projectPath);
  const files = createEmbeddedPythonStarterFiles(input);
  for (const [fileName, content] of Object.entries(files)) {
    fileSystem.writeFile(fileSystem.joinPath(projectPath, fileName), content);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
