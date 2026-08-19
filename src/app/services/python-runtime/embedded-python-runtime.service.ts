import { Injectable } from '@angular/core';
import { PythonRuntimeBridge, PythonRuntimeClient } from './python-runtime-client';

function unavailable(): Promise<never> {
  return Promise.reject(new Error('Embedded Python runtime is available only in the Electron application'));
}

export function createUnavailablePythonRuntimeBridge(): PythonRuntimeBridge {
  const noOpUnsubscribe = () => undefined;
  return {
    status: async () => ({
      state: 'stopped',
      pid: null,
      available: false,
      unavailableReason: 'Embedded Python runtime is available only in the Electron application',
    }),
    detectBoards: unavailable,
    connect: unavailable,
    disconnect: unavailable,
    runScript: unavailable,
    stopScript: unavailable,
    scriptRunning: unavailable,
    terminalInput: unavailable,
    terminalResize: unavailable,
    startPreview: unavailable,
    stopPreview: unavailable,
    firmwareCommit: unavailable,
    virtualTouchStatus: unavailable,
    virtualTouchEvent: unavailable,
    installAutostart: unavailable,
    autostartStatus: unavailable,
    removeAutostart: unavailable,
    files: {
      listDir: unavailable,
      stat: unavailable,
      readFile: unavailable,
      writeFile: unavailable,
      deleteFile: unavailable,
      renameFile: unavailable,
      mkdir: unavailable,
      rmdir: unavailable,
      exec: unavailable,
    },
    onEvent: () => noOpUnsubscribe,
    onFrame: () => noOpUnsubscribe,
    onState: () => noOpUnsubscribe,
    onStderr: () => noOpUnsubscribe,
  };
}

@Injectable({ providedIn: 'root' })
export class EmbeddedPythonRuntimeService extends PythonRuntimeClient {
  private readonly bridgeAvailable: boolean;

  constructor() {
    const api = (window as any).pythonRuntime || (window as any).electronAPI?.pythonRuntime;
    super((api || createUnavailablePythonRuntimeBridge()) as PythonRuntimeBridge);
    this.bridgeAvailable = Boolean(api);
  }

  get available(): boolean {
    return this.bridgeAvailable && this.snapshot.runtimeAvailable;
  }
}
