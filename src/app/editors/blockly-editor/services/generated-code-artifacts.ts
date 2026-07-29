import type { ArduinoGenerator } from '../components/blockly/generators/arduino/arduino';

const GENERATED_HEADER_PATTERN = /^(?:variables|objects)_[a-zA-Z0-9_-]+-[a-f0-9]{8}\.h$/;

/**
 * Materialize large generator declarations in the project's regular Arduino
 * source directory. The build and lint boundaries copy project/src into the
 * temporary sketch root, so generated includes follow the same rules as user
 * authored headers.
 */
export async function writeArduinoGeneratedArtifacts(
  projectPath: string | null | undefined,
  generator: ArduinoGenerator,
): Promise<void> {
  if (!projectPath) return;
  const fsApi = window['fs'];
  const pathApi = window['path'];
  const artifacts = generator.getGeneratedArtifacts();
  const outputDirectory = pathApi.join(projectPath, 'src');
  if (!artifacts.length && !fsApi.existsSync(outputDirectory)) return;
  if (!fsApi.existsSync(outputDirectory)) fsApi.mkdirSync(outputDirectory, { recursive: true });

  const requiredNames = new Set(artifacts.map((artifact) => artifact.fileName));
  const existingNames: string[] = fsApi.existsSync(outputDirectory)
    ? (fsApi.readdirSync(outputDirectory) || []).map(String)
    : [];
  for (const fileName of existingNames) {
    if (!GENERATED_HEADER_PATTERN.test(fileName) || requiredNames.has(fileName)) continue;
    fsApi.unlinkSync(pathApi.join(outputDirectory, fileName));
  }

  for (const artifact of artifacts) {
    const finalPath = pathApi.join(outputDirectory, artifact.fileName);
    const current = fsApi.existsSync(finalPath) ? fsApi.readFileSync(finalPath, 'utf8') : null;
    if (current === artifact.content) continue;
    const tempPath = `${finalPath}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
    fsApi.writeFileSync(tempPath, artifact.content);
    fsApi.renameSync(tempPath, finalPath);
  }

  // Remove headers produced by the previous hidden-directory implementation.
  // Only files matching our deterministic generated-header namespace qualify.
  const legacyDirectory = pathApi.join(projectPath, '.temp', 'sketch', 'generated');
  if (fsApi.existsSync(legacyDirectory)) {
    for (const fileName of (fsApi.readdirSync(legacyDirectory) || []).map(String)) {
      if (GENERATED_HEADER_PATTERN.test(fileName)) {
        fsApi.unlinkSync(pathApi.join(legacyDirectory, fileName));
      }
    }
  }
}

/** Copy regular project sources into the temporary Arduino sketch root. */
export function syncArduinoProjectSourceToSketch(
  projectPath: string | null | undefined,
  sketchPath: string | null | undefined,
): void {
  if (!projectPath || !sketchPath) return;
  const fsApi = window['fs'];
  const pathApi = window['path'];
  const sourceDirectory = pathApi.join(projectPath, 'src');
  if (!fsApi.existsSync(sourceDirectory)) return;
  if (!fsApi.existsSync(sketchPath)) fsApi.mkdirSync(sketchPath, { recursive: true });
  fsApi.copySync(sourceDirectory, sketchPath);
}
