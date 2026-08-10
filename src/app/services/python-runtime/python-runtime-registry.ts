import { Inject, Injectable } from '@angular/core';
import {
  PYTHON_RUNTIME_ADAPTERS,
  type PythonRuntimeAdapter,
} from './python-runtime-adapter';
import type { PythonRuntimeMetadata } from './python-mode';

@Injectable({ providedIn: 'root' })
export class PythonRuntimeRegistry {
  private readonly adapters = new Map<string, PythonRuntimeAdapter>();

  constructor(@Inject(PYTHON_RUNTIME_ADAPTERS) adapters: readonly PythonRuntimeAdapter[]) {
    for (const adapter of adapters) this.register(adapter);
  }

  resolve(metadata: PythonRuntimeMetadata | null | undefined): PythonRuntimeAdapter {
    if (
      metadata?.kind !== 'python'
      || typeof metadata.adapter !== 'string'
      || !metadata.adapter.trim()
    ) {
      throw new Error('A valid Python runtime metadata object is required');
    }
    const adapter = this.adapters.get(metadata.adapter);
    if (!adapter) {
      throw new Error(`Unsupported Python runtime adapter: ${metadata.adapter}`);
    }
    return adapter;
  }

  private register(adapter: PythonRuntimeAdapter): void {
    if (!adapter?.id || this.adapters.has(adapter.id)) {
      throw new Error(`Duplicate or invalid Python runtime adapter: ${adapter?.id || '<empty>'}`);
    }
    this.adapters.set(adapter.id, adapter);
  }
}
