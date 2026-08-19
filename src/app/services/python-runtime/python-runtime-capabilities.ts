export interface PythonRuntimeUnavailableReasons {
  files?: string;
  autostart?: string;
  preview?: string;
  terminalResize?: string;
  pty?: string;
}

export interface LinuxRuntimeCapabilities {
  platform: 'raspberry-pi' | 'walnutpi' | 'linux';
  hostname: string;
  architecture: string;
  pythonVersion: string;
  homeDirectory: string;
  writableWorkspace: string;
  pty: boolean;
  terminalResize: boolean;
  processGroups: boolean;
  files: 'sftp' | 'agent' | 'none';
  autostart: 'systemd' | 'boot-start-sh' | 'none';
  preview: {
    available: boolean;
    backend?: 'rpicam' | 'v4l2-ffmpeg' | 'opencv';
    transports: Array<'ssh-binary' | 'serial-framed'>;
  };
  unavailableReasons?: PythonRuntimeUnavailableReasons;
}

export interface CanmvRuntimeCapabilities {
  platform: 'canmv';
  hostname: string;
  architecture: string;
  pythonVersion: string;
  homeDirectory: string;
  writableWorkspace: string;
  pty: boolean;
  terminalResize: boolean;
  processGroups: boolean;
  files: 'agent' | 'none';
  autostart: 'none';
  preview: {
    available: boolean;
    transports: [];
  };
  unavailableReasons?: PythonRuntimeUnavailableReasons;
}

export type PythonRuntimeCapabilities =
  | LinuxRuntimeCapabilities
  | CanmvRuntimeCapabilities;

export const LEGACY_CANMV_CAPABILITIES: CanmvRuntimeCapabilities = {
  platform: 'canmv',
  hostname: '',
  architecture: 'k230',
  pythonVersion: '',
  homeDirectory: '/',
  writableWorkspace: '/',
  pty: true,
  terminalResize: true,
  processGroups: false,
  files: 'agent',
  autostart: 'none',
  preview: {
    available: true,
    transports: [],
  },
  unavailableReasons: {
    autostart: 'Autostart is not available through the legacy CanMV connection.',
  },
};
