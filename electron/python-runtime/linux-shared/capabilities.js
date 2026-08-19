const DEFAULT_PREVIEW = Object.freeze({
  available: false,
  transports: [],
});

const PREVIEW_BACKENDS = new Set(['rpicam', 'v4l2-ffmpeg', 'opencv']);
const PREVIEW_TRANSPORTS = new Set(['ssh-binary', 'serial-framed']);

function normalizeCapabilities(input = {}) {
  const preview = input.preview && typeof input.preview === 'object'
    ? {
      available: input.preview.available === true,
      ...(PREVIEW_BACKENDS.has(input.preview.backend) ? { backend: input.preview.backend } : {}),
      transports: Array.from(new Set(
        Array.isArray(input.preview.transports)
          ? input.preview.transports.filter(value => PREVIEW_TRANSPORTS.has(value))
          : [],
      )),
    }
    : { ...DEFAULT_PREVIEW };
  return {
    platform: ['raspberry-pi', 'walnutpi', 'linux'].includes(input.platform)
      ? input.platform
      : 'linux',
    hostname: String(input.hostname || ''),
    architecture: String(input.architecture || ''),
    pythonVersion: String(input.pythonVersion || ''),
    homeDirectory: String(input.homeDirectory || ''),
    writableWorkspace: String(input.writableWorkspace || '/tmp/aily-runtime'),
    pty: input.pty === true,
    terminalResize: input.terminalResize === true,
    processGroups: input.processGroups === true,
    files: ['sftp', 'agent', 'none'].includes(input.files) ? input.files : 'none',
    autostart: ['systemd', 'boot-start-sh', 'none'].includes(input.autostart)
      ? input.autostart
      : 'none',
    preview,
  };
}

module.exports = {
  normalizeCapabilities,
};
