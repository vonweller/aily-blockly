export const CODER_TEMPLATE_DIRECTORY = 'template_arduino';
export const LEGACY_CODER_TEMPLATE_DIRECTORY = 'template_arrduino';
export const CODER_SOURCE_ENTRY = 'src/main.cpp';

export interface CoderProjectPackageManifest {
  type?: string;
  entry?: string;
  devmode?: string;
  framework?: string;
  sourceRoots?: string[];
  dependencies?: Record<string, string>;
  boardDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function isCoderProjectPackage(manifest: unknown): manifest is CoderProjectPackageManifest {
  return Boolean(manifest)
    && typeof manifest === 'object'
    && !Array.isArray(manifest)
    && (manifest as CoderProjectPackageManifest).type === 'coder';
}

export function applyCoderProjectPackageConfig(
  manifest: CoderProjectPackageManifest,
  boardPackageName: string,
  boardRange: string,
  currentManifest?: CoderProjectPackageManifest,
): void {
  const currentEntry = typeof currentManifest?.entry === 'string' && currentManifest.entry.trim()
    ? currentManifest.entry.replace(/\\/g, '/')
    : CODER_SOURCE_ENTRY;
  manifest.type = 'coder';
  manifest.entry = currentEntry;
  manifest.devmode = 'arduino';
  manifest.framework = 'arduino';
  manifest.sourceRoots = ['src', 'libraries'];
  manifest.dependencies = {
    ...(manifest.dependencies || {}),
    [boardPackageName]: boardRange,
  };
  manifest.boardDependencies = {
    ...(manifest.boardDependencies || {}),
    [boardPackageName]: boardRange,
  };
}

interface CoderTemplatePathApi {
  join(...parts: string[]): string;
  isExists(path: string): boolean;
}

interface CoderTemplateFsApi {
  copySync(source: string, destination: string): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

/**
 * Prefer the correctly named Arduino template while retaining compatibility with
 * board packages published with the historical `template_arrduino` typo.
 */
export function resolveCoderTemplatePath(
  boardPackagePath: string,
  pathApi: CoderTemplatePathApi,
): string {
  const canonicalPath = pathApi.join(boardPackagePath, CODER_TEMPLATE_DIRECTORY);
  if (pathApi.isExists(canonicalPath)) {
    return canonicalPath;
  }

  const legacyPath = pathApi.join(boardPackagePath, LEGACY_CODER_TEMPLATE_DIRECTORY);
  return pathApi.isExists(legacyPath) ? legacyPath : canonicalPath;
}

/**
 * `template_arduino/project.aci` is Arduino source text, not the Coder project
 * configuration. Copy it to the persistent Coder source workspace as main.cpp;
 * all project configuration remains in the copied package.json.
 */
export function copyCoderArduinoTemplate(
  templatePath: string,
  projectPath: string,
  pathApi: CoderTemplatePathApi,
  fsApi: CoderTemplateFsApi,
): void {
  const templatePackagePath = pathApi.join(templatePath, 'package.json');
  const templateSourcePath = pathApi.join(templatePath, 'project.aci');
  for (const [label, requiredPath] of [
    ['package.json', templatePackagePath],
    ['project.aci', templateSourcePath],
  ] as const) {
    if (!pathApi.isExists(requiredPath)) {
      throw new Error(`Coder 板卡模板缺少 ${label}: ${requiredPath}`);
    }
  }

  const sketchRoot = pathApi.join(projectPath, 'sketch');
  const sourcePath = pathApi.join(sketchRoot, 'src', 'main.cpp');
  fsApi.mkdirSync(pathApi.join(sketchRoot, 'src'), { recursive: true });
  fsApi.mkdirSync(pathApi.join(sketchRoot, 'libraries'), { recursive: true });
  fsApi.copySync(templatePackagePath, pathApi.join(projectPath, 'package.json'));
  fsApi.copySync(templateSourcePath, sourcePath);
}
