import { ArduinoGenerator } from '../components/blockly/generators/arduino/arduino';

const GENERATED_HEADER_PATTERN = /^[a-zA-Z0-9_-]+-[a-f0-9]{8}\.h$/;

/**
 * Materialize large generator declarations outside sketch.ino. The generator
 * only emits deterministic include directives; file I/O stays at the build
 * boundary so preview-only generation remains side-effect free.
 */
export async function writeArduinoGeneratedArtifacts(
  projectPath: string | null | undefined,
  generator: ArduinoGenerator,
): Promise<void> {
  if (!projectPath) return;
  const fsApi = window['fs'];
  const pathApi = window['path'];
  // Keep generated headers inside the Arduino sketch directory. Arduino build
  // tools copy this directory as one compilation unit, so quoted includes stay
  // valid even when the preprocessed .ino.cpp is emitted under .build.
  const outputDirectory = pathApi.join(projectPath, '.temp', 'sketch', 'generated');
  const artifacts = generator.getGeneratedArtifacts();
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
}
