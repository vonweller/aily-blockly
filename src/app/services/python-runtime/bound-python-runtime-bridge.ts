import type { PythonRuntimeCapabilities } from './python-runtime-capabilities';
import type {
  PythonRuntimeCredentials,
  PythonRuntimeEndpoint,
} from './python-runtime-endpoint';
import type {
  PythonRuntimeBackendState,
  PythonRuntimeBoard,
  PythonRuntimeBridge,
  PythonRuntimeConnectResult,
  PythonRuntimeContext,
} from './python-runtime-client';

interface PythonRuntimeEnvelope<T = unknown> {
  adapterId: string;
  sessionId: string;
  payload: T;
}

export interface NativePythonRuntimeApi {
  status(context?: Pick<PythonRuntimeContext, 'adapterId'>): Promise<{
    state: string;
    pid: number | null;
    available?: boolean;
    unavailableReason?: string | null;
  }>;
  detectBoards(context?: Pick<PythonRuntimeContext, 'adapterId'>): Promise<{
    boards: PythonRuntimeBoard[];
  }>;
  connect(
    adapterId: string,
    endpoint: PythonRuntimeEndpoint,
    credentials?: PythonRuntimeCredentials,
  ): Promise<PythonRuntimeConnectResult>;
  request(
    context: PythonRuntimeContext,
    operation: string,
    payload?: Record<string, unknown>,
  ): Promise<any>;
  disconnect(context: PythonRuntimeContext): Promise<void>;
  installAutostart?(
    context: PythonRuntimeContext,
    options: Record<string, unknown>,
  ): Promise<any>;
  autostartStatus?(
    context: PythonRuntimeContext,
    options: Record<string, unknown>,
  ): Promise<any>;
  removeAutostart?(
    context: PythonRuntimeContext,
    options: Record<string, unknown>,
  ): Promise<any>;
  onEvent(callback: (event: PythonRuntimeEnvelope) => void): () => void;
  onFrame(callback: (frame: PythonRuntimeEnvelope) => void): () => void;
  onState(callback: (state: PythonRuntimeEnvelope) => void): () => void;
  onStderr(callback: (text: PythonRuntimeEnvelope) => void): () => void;
}

export class BoundPythonRuntimeBridge implements PythonRuntimeBridge {
  private context: PythonRuntimeContext | null = null;
  private connectionGeneration = 0;

  constructor(
    private readonly nativeApi: NativePythonRuntimeApi,
    readonly adapterId: string,
  ) {}

  async status(): ReturnType<PythonRuntimeBridge['status']> {
    const status = await this.nativeApi.status({ adapterId: this.adapterId });
    const state: PythonRuntimeBackendState = status.state === 'starting'
      ? 'starting'
      : status.available === false
        ? 'stopped'
        : 'ready';
    return { ...status, state };
  }

  detectBoards(): Promise<{ boards: PythonRuntimeBoard[] }> {
    return this.nativeApi.detectBoards({ adapterId: this.adapterId });
  }

  async connect(
    endpointOrOptions: PythonRuntimeEndpoint | { port: string; baudRate?: number },
    credentials?: PythonRuntimeCredentials,
  ): Promise<PythonRuntimeConnectResult> {
    const endpoint: PythonRuntimeEndpoint = 'kind' in endpointOrOptions
      ? endpointOrOptions
      : {
        kind: 'canmv',
        port: endpointOrOptions.port,
        baudRate: endpointOrOptions.baudRate ?? 115200,
      };
    const generation = ++this.connectionGeneration;
    this.context = null;
    const result = await this.nativeApi.connect(this.adapterId, endpoint, credentials);
    if (generation !== this.connectionGeneration) {
      throw new Error(`Stale ${this.adapterId} connection result`);
    }
    if (result.adapterId !== this.adapterId) {
      throw new Error(
        `Python runtime adapter mismatch: expected ${this.adapterId}, received ${result.adapterId}`,
      );
    }
    if (!result.sessionId) {
      throw new Error(`Python runtime ${this.adapterId} did not return a session id`);
    }
    this.context = {
      adapterId: result.adapterId,
      sessionId: result.sessionId,
    };
    return {
      ...result,
      capabilities: result.capabilities as PythonRuntimeCapabilities | null,
    };
  }

  async disconnect(): Promise<void> {
    ++this.connectionGeneration;
    const context = this.context;
    this.context = null;
    if (!context) return;
    await this.nativeApi.disconnect(context);
  }

  runScript(script: string): Promise<{ status: 'ok' | 'error'; output?: string; message?: string }> {
    return this.request('runScript', { script });
  }

  stopScript(): Promise<void> {
    return this.request('stopScript', {});
  }

  scriptRunning(): Promise<{ running: boolean }> {
    return this.request('scriptRunning', {});
  }

  terminalInput(text: string): Promise<any> {
    return this.request('terminalInput', { text });
  }

  terminalResize(columns: number, rows: number): Promise<any> {
    return this.request('terminalSetSize', { columns, rows });
  }

  startPreview(
    options: { fps?: number; resolution?: { w: number; h: number } } = {},
  ): Promise<{ streamId: string }> {
    return this.request('startPreview', options);
  }

  stopPreview(): Promise<void> {
    return this.request('stopPreview', {});
  }

  firmwareCommit(): Promise<any> {
    return this.request('firmwareCommit', {});
  }

  virtualTouchStatus(): Promise<any> {
    return this.request('virtualTouchStatus', {});
  }

  virtualTouchEvent(options: any): Promise<any> {
    return this.request('virtualTouchEvent', options || {});
  }

  installAutostart(options: Record<string, unknown>): Promise<any> {
    return this.autostartRequest('installAutostart', options);
  }

  autostartStatus(options: Record<string, unknown>): Promise<any> {
    return this.autostartRequest('autostartStatus', options);
  }

  removeAutostart(options: Record<string, unknown>): Promise<any> {
    return this.autostartRequest('removeAutostart', options);
  }

  readonly files = {
    listDir: (path: string): Promise<any> => this.request('io.listDir', { path }),
    stat: (path: string): Promise<any> => this.request('io.queryFileStat', { path }),
    readFile: (path: string): Promise<any> => this.request('io.readFile', { path }),
    writeFile: (path: string, dataBase64: string): Promise<any> => (
      this.request('io.writeFile', { path, dataBase64 })
    ),
    deleteFile: (path: string): Promise<any> => this.request('io.deleteFile', { path }),
    renameFile: (oldPath: string, newPath: string): Promise<any> => (
      this.request('io.renameFile', { oldPath, newPath })
    ),
    mkdir: (path: string): Promise<any> => this.request('io.mkdir', { path }),
    rmdir: (path: string): Promise<any> => this.request('io.rmdir', { path }),
    exec: (path: string): Promise<any> => this.request('io.fileExec', { path }),
  };

  onEvent(callback: (event: any) => void): () => void {
    return this.listen(this.nativeApi.onEvent.bind(this.nativeApi), callback);
  }

  onFrame(callback: (frame: { frameId: number; data: Uint8Array }) => void): () => void {
    return this.listen(this.nativeApi.onFrame.bind(this.nativeApi), callback);
  }

  onState(callback: (state: any) => void): () => void {
    return this.nativeApi.onState(envelope => {
      const context = this.context;
      if (
        !context
        || envelope?.adapterId !== context.adapterId
        || envelope?.sessionId !== context.sessionId
      ) return;
      callback(envelope.payload);
      if (envelope.payload === 'disconnected') {
        ++this.connectionGeneration;
        this.context = null;
      }
    });
  }

  onStderr(callback: (text: string) => void): () => void {
    return this.listen(this.nativeApi.onStderr.bind(this.nativeApi), callback);
  }

  private request<T>(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    return this.nativeApi.request(this.requireContext(), operation, payload);
  }

  private autostartRequest(
    operation: 'installAutostart' | 'autostartStatus' | 'removeAutostart',
    options: Record<string, unknown>,
  ): Promise<any> {
    const context = this.requireContext();
    const method = this.nativeApi[operation];
    return method
      ? method.call(this.nativeApi, context, options)
      : this.nativeApi.request(context, operation, options);
  }

  private requireContext(): PythonRuntimeContext {
    if (!this.context) {
      throw new Error(`Python runtime ${this.adapterId} is not connected`);
    }
    return this.context;
  }

  private listen<T>(
    subscribe: (callback: (envelope: PythonRuntimeEnvelope<T>) => void) => () => void,
    callback: (payload: T) => void,
  ): () => void {
    return subscribe(envelope => {
      const context = this.context;
      if (
        !context
        || envelope?.adapterId !== context.adapterId
        || envelope?.sessionId !== context.sessionId
      ) return;
      callback(envelope.payload);
    });
  }
}
