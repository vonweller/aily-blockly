import { Injectable } from '@angular/core';
import { EmbeddedPythonRuntimeService } from './embedded-python-runtime.service';
import type { PythonRuntimeMetadata } from './python-mode';
import {
  PYTHON_RUNTIME_ADAPTERS,
  type PythonRuntimeAdapter,
} from './python-runtime-adapter';

@Injectable({ providedIn: 'root' })
export class CanmvK230RuntimeAdapter implements PythonRuntimeAdapter {
  readonly id = 'canmv-k230';
  private disposed = false;

  constructor(readonly runtime: EmbeddedPythonRuntimeService) {}

  get available(): boolean {
    return this.runtime.available;
  }

  validateMetadata(metadata: PythonRuntimeMetadata): void {
    const execution = metadata.execution;
    if (
      execution
      && (
        execution.transport !== 'canmv-usbdbg'
        || execution.output !== 'event-stream'
        || execution.input !== 'repl'
        || execution.stop !== 'device-interrupt'
        || execution.files !== 'canmv-io'
        || execution.temporaryRun !== true
      )
    ) {
      throw new Error('canmv-k230 runtime metadata has an incompatible execution profile');
    }
    const autostart = metadata.deployment?.autostart;
    if (
      autostart
      && (
        autostart.kind !== 'boot-start-sh'
        || autostart.directory !== '/boot/start'
        || autostart.backgroundRequired !== true
      )
    ) {
      throw new Error('canmv-k230 runtime metadata has an incompatible deployment profile');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.dispose();
  }
}

export const CANMV_K230_RUNTIME_ADAPTER_PROVIDER = {
  provide: PYTHON_RUNTIME_ADAPTERS,
  useExisting: CanmvK230RuntimeAdapter,
  multi: true,
};
