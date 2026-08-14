const path = require('node:path');
const fs = require('node:fs');

const { CanmvBackend } = require('./backend');
const { registerPythonRuntimeIpc } = require('./ipc');
const { resolveCanmvBackendExecutable } = require('./runtime-path');

function createPythonRuntimeRegistration(options) {
  let executable = null;
  let unavailableReason = null;
  try {
    executable = resolveCanmvBackendExecutable({
      override: options.override,
      isPackaged: options.isPackaged,
      resourcesPath: options.resourcesPath,
      moduleDir: options.moduleDir,
      platform: options.platform,
      arch: options.arch,
    });
    const fileSystem = options.fileSystem || fs;
    if (!fileSystem.existsSync(executable)) {
      throw new Error(`CanMV backend executable was not found: ${executable}`);
    }
    const platform = options.platform || process.platform;
    if (platform !== 'win32') {
      fileSystem.accessSync(executable, fileSystem.constants.X_OK);
    }
  } catch (error) {
    executable = null;
    unavailableReason = error instanceof Error ? error.message : String(error);
  }

  const backend = new CanmvBackend({
    ...(options.backendOptions || {}),
    executable,
    unavailableReason,
    cwd: executable ? path.dirname(executable) : undefined,
    platform: options.platform || process.platform,
  });
  const registration = registerPythonRuntimeIpc({
    ipcMain: options.ipcMain,
    backend,
  });
  return {
    available: Boolean(executable),
    unavailableReason,
    backend,
    registration,
  };
}

module.exports = {
  createPythonRuntimeRegistration,
};
