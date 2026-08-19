import { Injectable } from '@angular/core';
import { BoundPythonRuntimeBridge, type NativePythonRuntimeApi } from './bound-python-runtime-bridge';
import { createUnavailablePythonRuntimeBridge } from './embedded-python-runtime.service';
import type { PythonRuntimeMetadata } from './python-mode';
import {
  PYTHON_RUNTIME_ADAPTERS,
  type PythonRuntimeAdapter,
} from './python-runtime-adapter';
import { PythonRuntimeClient } from './python-runtime-client';

@Injectable({ providedIn: 'root' })
export class LinuxSshRuntimeAdapter implements PythonRuntimeAdapter {
  readonly id = 'linux-ssh';
  readonly runtime: PythonRuntimeClient;
  private readonly bridgeAvailable: boolean;
  private disposed = false;

  constructor() {
    const nativeApi = readNativePythonRuntimeApi();
    this.bridgeAvailable = Boolean(nativeApi);
    this.runtime = new PythonRuntimeClient(
      nativeApi
        ? new BoundPythonRuntimeBridge(nativeApi, this.id)
        : createUnavailablePythonRuntimeBridge(),
    );
  }

  get available(): boolean {
    return this.bridgeAvailable && this.runtime.snapshot.runtimeAvailable;
  }

  validateMetadata(metadata: PythonRuntimeMetadata): void {
    const execution = metadata.execution;
    if (
      execution
      && (
        execution.transport !== 'ssh'
        || execution.output !== 'pty-combined'
        || execution.input !== 'pty'
        || execution.stop !== 'process-group'
        || execution.files !== 'sftp'
        || execution.temporaryRun !== true
      )
    ) {
      throw new Error('linux-ssh runtime metadata has an incompatible execution profile');
    }

    const autostart = metadata.deployment?.autostart;
    const validSystemd = autostart?.kind === 'systemd'
      && autostart.unitDirectory === '/etc/systemd/system';
    const validBootScript = autostart?.kind === 'boot-start-sh'
      && autostart.directory === '/boot/start'
      && autostart.backgroundRequired === true;
    if (autostart && !validSystemd && !validBootScript) {
      throw new Error('linux-ssh runtime metadata has an incompatible deployment profile');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.dispose();
  }
}

export const LINUX_SSH_RUNTIME_ADAPTER_PROVIDER = {
  provide: PYTHON_RUNTIME_ADAPTERS,
  useExisting: LinuxSshRuntimeAdapter,
  multi: true,
};

function readNativePythonRuntimeApi(): NativePythonRuntimeApi | null {
  return (
    (window as any).electronAPI?.pythonRuntime
    || (window as any).pythonRuntime
    || null
  ) as NativePythonRuntimeApi | null;
}
