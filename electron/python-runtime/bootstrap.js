const path = require('node:path');
const fs = require('node:fs');

const { CanmvBackend } = require('./backend');
const { CanmvDriver } = require('./canmv-driver');
const { registerPythonRuntimeIpc } = require('./ipc');
const { LinuxSerialShellBackend } = require('./linux-serial-shell/backend');
const { LinuxSshDriver } = require('./linux-ssh/driver');
const { RuntimeBroker } = require('./runtime-broker');
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
  const canmvDriver = new CanmvDriver(backend);
  const sshDriver = createLazyDriverFactory(
    'linux-ssh',
    options.sshSessionFactory || (() => new LinuxSshDriver(options.sshOptions)),
  );
  const serialDriver = createLazyDriverFactory(
    'linux-serial-shell',
    options.serialSessionFactory || (() => new LinuxSerialShellBackend(options.serialOptions)),
    async () => {
      const { listPorts } = require('../serial');
      const ports = await listPorts();
      return {
        boards: ports.map(port => ({
          port: port.path,
          name: port.friendlyName || port.manufacturer || port.path,
          vid: port.vendorId || '',
          pid: port.productId || '',
          serialNumber: port.serialNumber,
          description: port.friendlyName || port.manufacturer,
        })),
      };
    },
  );
  const broker = new RuntimeBroker({
    drivers: [canmvDriver, serialDriver, sshDriver],
  });
  const registration = registerPythonRuntimeIpc({
    ipcMain: options.ipcMain,
    backend,
    broker,
  });
  return {
    available: Boolean(executable),
    unavailableReason,
    backend,
    broker,
    registration,
  };
}

function createLazyDriverFactory(id, createSession, detectBoards) {
  return {
    id,
    createSession,
    detectBoards: detectBoards || (async () => ({ boards: [] })),
  };
}

module.exports = {
  createPythonRuntimeRegistration,
};
