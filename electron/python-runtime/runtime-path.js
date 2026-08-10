const path = require('node:path');

const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux']);
const SUPPORTED_ARCHITECTURES = new Set(['x64', 'arm64']);

function platformTarget(platform = process.platform, arch = process.arch) {
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(`CanMV backend is not available for ${platform}-${arch}`);
  }
  return `${platform}-${arch}`;
}

function resolveCanmvBackendExecutable(options = {}) {
  const override = String(options.override || '').trim();
  if (override) return path.normalize(override);

  const platform = options.platform || process.platform;
  const target = platformTarget(platform, options.arch || process.arch);
  const executable = platform === 'win32' ? 'canmv-backend.exe' : 'canmv-backend';
  const root = options.isPackaged
    ? path.join(requiredPath(options.resourcesPath, 'resourcesPath'), 'python-runtime')
    : requiredPath(options.moduleDir, 'moduleDir');
  return path.join(root, 'bin', target, executable);
}

function requiredPath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

module.exports = {
  platformTarget,
  resolveCanmvBackendExecutable,
};
