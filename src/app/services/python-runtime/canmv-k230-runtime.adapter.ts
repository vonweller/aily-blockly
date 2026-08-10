import { Injectable } from '@angular/core';
import { EmbeddedPythonRuntimeService } from './embedded-python-runtime.service';
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
