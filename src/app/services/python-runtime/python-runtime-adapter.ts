import { InjectionToken } from '@angular/core';
import type { PythonRuntimeMetadata } from './python-mode';
import type { PythonRuntimeClient } from './python-runtime-client';

export interface PythonRuntimeAdapter {
  readonly id: string;
  readonly runtime: PythonRuntimeClient;
  readonly available: boolean;
  validateMetadata?(metadata: PythonRuntimeMetadata): void;
  dispose(): void;
}

export const PYTHON_RUNTIME_ADAPTERS = new InjectionToken<readonly PythonRuntimeAdapter[]>(
  'PYTHON_RUNTIME_ADAPTERS',
);
