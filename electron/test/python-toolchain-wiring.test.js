const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertContainsInOrder(source, snippets) {
  let cursor = -1;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, cursor + 1);
    assert.notEqual(next, -1, `missing wiring snippet: ${snippet}`);
    assert.ok(next > cursor, `wiring snippet is out of order: ${snippet}`);
    cursor = next;
  }
}

test('Blockly generation and project save persist Python through the shared artifact writer', () => {
  const component = read('src/app/editors/blockly-editor/components/blockly/blockly.component.ts');
  const project = read('src/app/editors/blockly-editor/services/project.service.ts');

  for (const source of [component, project]) {
    assert.match(source, /persistGeneratedProjectCode\(/);
    assert.match(source, /writeArduinoGeneratedArtifacts/);
  }
  assert.match(component, /LatestGenerationGate/);
  assert.match(component, /codeGenerationSubject\.next\(this\.codeGenerationGate\.begin\(\)\)/);
  assert.match(component, /subscribe\(async \(generationToken\) =>/);
  assert.match(component, /isCurrent\(generationToken\)/);
  assertContainsInOrder(project, [
    'const generatedProjectRoute = resolveGeneratedProjectRoute(',
    'if (!getActiveProjectGenerator() || !this.blocklyService || !this.blocklyService.workspace)',
    "if (generatedProjectRoute.kind !== 'arduino')",
    'throw new Error(\'Python source cannot be saved without an active generator and workspace\');',
  ]);
  assert.match(project, /generatedArtifactPersisted/);
  assert.match(project, /generatedProjectRoute\.kind !== 'arduino'/);
});

test('Builder handles Python before Arduino preprocess and workflow startup', () => {
  const builder = read('src/app/editors/blockly-editor/services/builder.service.ts');

  assert.match(builder, /runPreprocess\(\)[\s\S]*generatedProjectRoute\.kind === 'python'[\s\S]*emitPythonSourceForActiveProject\(\)/);
  assertContainsInOrder(builder, [
    "const generatedProjectRoute = this.getGeneratedProjectRoute();",
    "if (generatedProjectRoute.kind === 'python')",
    'await this.emitPythonSourceForActiveProject();',
    'if (!this.workflowService.startBuild())',
  ]);
});

test('Background dependency preprocessing returns early for Python projects', () => {
  const builder = read('src/app/editors/blockly-editor/services/builder.service.ts');
  const start = builder.indexOf('this.dependencySubscription =');
  const end = builder.indexOf("const tempPath = this.electronService.pathJoin", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const dependencyHandler = builder.slice(start, end);

  assertContainsInOrder(dependencyHandler, [
    'const generatedProjectRoute = this.getGeneratedProjectRoute();',
    "if (generatedProjectRoute.kind === 'python')",
    'this.pendingPrecompile = false;',
    'return;',
    'missingBoardDependencies = await this.getMissingBoardDependencies();',
  ]);
});

test('Uploader rejects Python before touching serial or firmware build state', () => {
  const uploader = read('src/app/editors/blockly-editor/services/uploader.service.ts');

  assertContainsInOrder(uploader, [
    'const pythonUploadRejection = getFirmwareUploadRejection(',
    'if (pythonUploadRejection)',
    'return Promise.reject(pythonUploadRejection);',
    'this.isErrored = false;',
    'const capturedSerialPort = this.serialService.currentPort;',
  ]);
});

test('Published generated code is not normalized a second time', () => {
  const blocklyService = read('src/app/editors/blockly-editor/services/blockly.service.ts');
  const start = blocklyService.indexOf('publishGeneratedCode(code: unknown)');
  const end = blocklyService.indexOf('getGeneratedCode()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const method = blocklyService.slice(start, end);
  assert.doesNotMatch(method, /normalizeArduinoGeneratedCode/);
  assert.match(method, /typeof code === 'string'/);
});

test('Electron exposes a context-bound Python runtime bridge while retaining legacy CanMV methods', () => {
  const preload = read('electron/preload.js');
  const types = read('src/app/types/electron.d.ts');

  assert.match(preload, /connect:\s*\(adapterId,\s*endpoint,\s*credentials\)/);
  assert.match(preload, /request:\s*\(context,\s*operation,\s*payload/);
  assert.match(preload, /installAutostart/);
  assert.match(preload, /autostartStatus/);
  assert.match(preload, /removeAutostart/);
  assert.match(preload, /legacy:/);
  assert.match(types, /interface PythonRuntimeContext/);
  assert.match(types, /adapterId:\s*string/);
  assert.match(types, /sessionId:\s*string/);
  assert.match(types, /request:\s*\(\s*context:\s*PythonRuntimeContext/);
});

test('Application configuration installs the shared Python runtime provider bundle', () => {
  const appConfig = read('src/app/app.config.ts');
  const providers = read('src/app/services/python-runtime/python-runtime-providers.ts');

  assert.match(appConfig, /PYTHON_RUNTIME_ADAPTER_PROVIDERS/);
  assert.match(appConfig, /\.\.\.PYTHON_RUNTIME_ADAPTER_PROVIDERS/);
  assert.match(providers, /CANMV_K230_RUNTIME_ADAPTER_PROVIDER/);
  assert.match(providers, /LINUX_SSH_RUNTIME_ADAPTER_PROVIDER/);
  assert.match(providers, /LINUX_SERIAL_SHELL_RUNTIME_ADAPTER_PROVIDER/);
});

test('Package scripts expose focused Electron and Angular Python runtime suites', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.match(packageJson.scripts['test:python-runtime'], /electron\/test\/linux-\*\.test\.js/);
  assert.match(packageJson.scripts['test:python-runtime:angular'], /--builder-mode=application/);
  assert.match(packageJson.scripts['test:python-runtime:angular'], /python-runtime-client\.spec\.ts/);
  assert.match(packageJson.scripts['test:python-runtime:angular'], /linux-runtime-adapters\.spec\.ts/);
  assert.match(packageJson.scripts['test:python-runtime:angular'], /python-runtime-panel\.component\.spec\.ts/);
});
