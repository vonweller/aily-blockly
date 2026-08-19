import { LinuxSerialShellRuntimeAdapter, LINUX_SERIAL_SHELL_RUNTIME_ADAPTER_PROVIDER } from './linux-serial-shell-runtime.adapter';
import { LinuxSshRuntimeAdapter, LINUX_SSH_RUNTIME_ADAPTER_PROVIDER } from './linux-ssh-runtime.adapter';
import type { PythonRuntimeMetadata } from './python-mode';
import { PYTHON_RUNTIME_ADAPTER_PROVIDERS } from './python-runtime-providers';
import { PythonRuntimeRegistry } from './python-runtime-registry';

describe('Linux Python runtime adapters', () => {
  const sshMetadata: PythonRuntimeMetadata = {
    kind: 'python',
    adapter: 'linux-ssh',
    entry: 'main.py',
    execution: {
      transport: 'ssh',
      output: 'pty-combined',
      input: 'pty',
      stop: 'process-group',
      files: 'sftp',
      temporaryRun: true,
    },
    deployment: {
      autostart: {
        kind: 'systemd',
        unitDirectory: '/etc/systemd/system',
      },
    },
  };
  const serialMetadata: PythonRuntimeMetadata = {
    kind: 'python',
    adapter: 'linux-serial-shell',
    entry: 'main.py',
    execution: {
      transport: 'serial-shell',
      output: 'pty-combined',
      input: 'pty',
      stop: 'process-group',
      files: 'serial-transfer',
      temporaryRun: true,
    },
    deployment: {
      autostart: {
        kind: 'boot-start-sh',
        directory: '/boot/start',
        backgroundRequired: true,
      },
    },
  };

  it('registers both Linux providers in the runtime provider bundle', () => {
    expect(PYTHON_RUNTIME_ADAPTER_PROVIDERS).toContain(LINUX_SSH_RUNTIME_ADAPTER_PROVIDER);
    expect(PYTHON_RUNTIME_ADAPTER_PROVIDERS).toContain(LINUX_SERIAL_SHELL_RUNTIME_ADAPTER_PROVIDER);
  });

  it('resolves both Linux adapters by runtime metadata', () => {
    const ssh = new LinuxSshRuntimeAdapter();
    const serial = new LinuxSerialShellRuntimeAdapter();
    const registry = new PythonRuntimeRegistry([ssh, serial]);

    expect(registry.resolve(sshMetadata).id).toBe('linux-ssh');
    expect(registry.resolve(serialMetadata).id).toBe('linux-serial-shell');

    ssh.dispose();
    serial.dispose();
  });

  it('validates the Linux execution and deployment profiles', () => {
    const ssh = new LinuxSshRuntimeAdapter();
    const serial = new LinuxSerialShellRuntimeAdapter();

    expect(() => ssh.validateMetadata(sshMetadata)).not.toThrow();
    expect(() => serial.validateMetadata(serialMetadata)).not.toThrow();
    expect(() => ssh.validateMetadata({
      ...sshMetadata,
      execution: { ...sshMetadata.execution!, transport: 'serial-shell' },
    })).toThrowError(/linux-ssh.*execution profile/i);
    expect(() => serial.validateMetadata({
      ...serialMetadata,
      deployment: {
        autostart: {
          kind: 'systemd',
          unitDirectory: '/etc/systemd/system',
        },
      },
    })).toThrowError(/linux-serial-shell.*deployment profile/i);

    ssh.dispose();
    serial.dispose();
  });
});
