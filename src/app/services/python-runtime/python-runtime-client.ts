import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { decodeRemoteFileContent, encodeRemoteFileContent, RemoteFileReadResult } from './remote-file-codec';

export type PythonRuntimeBackendState = 'stopped' | 'starting' | 'ready';
export type PythonRuntimeConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';
type PythonRuntimeOperationKind = 'connection' | 'script' | 'preview';

export interface PythonRuntimeBoard {
  port: string;
  name: string;
  vid: string;
  pid: string;
  serialNumber?: string;
  description?: string;
}

export interface PythonRuntimeSessionState {
  runtimeAvailable: boolean;
  unavailableReason: string | null;
  backendState: PythonRuntimeBackendState;
  connectionState: PythonRuntimeConnectionState;
  boards: PythonRuntimeBoard[];
  port: string | null;
  boardInfo: Record<string, any> | null;
  running: boolean;
  previewing: boolean;
  error: string | null;
}

export interface PythonRuntimeBridge {
  status(): Promise<{
    state: PythonRuntimeBackendState;
    pid: number | null;
    available?: boolean;
    unavailableReason?: string | null;
  }>;
  detectBoards(): Promise<{ boards: PythonRuntimeBoard[] }>;
  connect(options: { port: string; baudRate?: number }): Promise<Record<string, any>>;
  disconnect(): Promise<void>;
  runScript(script: string): Promise<{ status: 'ok' | 'error'; output?: string; message?: string }>;
  stopScript(): Promise<void>;
  scriptRunning(): Promise<{ running: boolean }>;
  terminalInput(text: string): Promise<any>;
  terminalResize(columns: number, rows: number): Promise<any>;
  startPreview(options?: { fps?: number; resolution?: { w: number; h: number } }): Promise<{ streamId: string }>;
  stopPreview(): Promise<void>;
  firmwareCommit(): Promise<any>;
  virtualTouchStatus(): Promise<any>;
  virtualTouchEvent(options: any): Promise<any>;
  files: {
    listDir(path: string): Promise<any>;
    stat(path: string): Promise<any>;
    readFile(path: string): Promise<RemoteFileReadResult>;
    writeFile(path: string, dataBase64: string): Promise<any>;
    deleteFile(path: string): Promise<any>;
    renameFile(oldPath: string, newPath: string): Promise<any>;
    mkdir(path: string): Promise<any>;
    rmdir(path: string): Promise<any>;
    exec(path: string): Promise<any>;
  };
  onEvent(callback: (event: any) => void): () => void;
  onFrame(callback: (frame: { frameId: number; data: Uint8Array }) => void): () => void;
  onState(callback: (state: PythonRuntimeBackendState) => void): () => void;
  onStderr(callback: (text: string) => void): () => void;
}

const INITIAL_STATE: PythonRuntimeSessionState = {
  runtimeAvailable: false,
  unavailableReason: null,
  backendState: 'stopped',
  connectionState: 'disconnected',
  boards: [],
  port: null,
  boardInfo: null,
  running: false,
  previewing: false,
  error: null,
};

export class PythonRuntimeClient {
  private readonly stateSubject = new BehaviorSubject<PythonRuntimeSessionState>({ ...INITIAL_STATE });
  private readonly terminalOutputSubject = new Subject<string>();
  private readonly frameSubject = new Subject<{ frameId: number; data: Uint8Array }>();
  private readonly backendStderrSubject = new Subject<string>();
  private cleanupListeners: Array<() => void> = [];
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private readonly operationGenerations: Record<PythonRuntimeOperationKind, number> = {
    connection: 0,
    script: 0,
    preview: 0,
  };
  private readonly operationTails: Record<PythonRuntimeOperationKind, Promise<void> | null> = {
    connection: null,
    script: null,
    preview: null,
  };
  private scriptStateVersion = 0;
  private sessionGeneration = 0;
  private detectBoardsInFlight: {
    generation: number;
    promise: Promise<PythonRuntimeBoard[]>;
  } | null = null;

  readonly state$: Observable<PythonRuntimeSessionState> = this.stateSubject.asObservable();
  readonly terminalOutput$: Observable<string> = this.terminalOutputSubject.asObservable();
  readonly frame$: Observable<{ frameId: number; data: Uint8Array }> = this.frameSubject.asObservable();
  readonly backendStderr$: Observable<string> = this.backendStderrSubject.asObservable();

  constructor(protected readonly api: PythonRuntimeBridge) {}

  get snapshot(): PythonRuntimeSessionState {
    return this.stateSubject.value;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;
    const generation = this.lifecycleGeneration;
    const cleanupListeners = [
      onceCleanup(this.api.onEvent(event => this.handleEvent(event))),
      onceCleanup(this.api.onFrame(frame => {
        if (
          this.snapshot.connectionState === 'connected'
          && this.snapshot.previewing
        ) {
          this.frameSubject.next(frame);
        }
      })),
      onceCleanup(this.api.onState(state => this.handleBackendState(state))),
      onceCleanup(this.api.onStderr(text => this.backendStderrSubject.next(text))),
    ];
    this.cleanupListeners = cleanupListeners;
    const initialization = (async () => {
      try {
        const status = await this.api.status();
        if (generation !== this.lifecycleGeneration) return;
        this.patch({
          backendState: status.state,
          runtimeAvailable: status.available !== false,
          unavailableReason: status.unavailableReason || null,
        });
        this.initialized = true;
      } catch (error) {
        for (const cleanup of cleanupListeners) cleanup();
        if (this.cleanupListeners === cleanupListeners) {
          this.cleanupListeners = [];
        }
        throw error;
      }
    });
    let trackedInitialization: Promise<void>;
    trackedInitialization = initialization().finally(() => {
      if (this.initializationPromise === trackedInitialization) {
        this.initializationPromise = null;
      }
    });
    this.initializationPromise = trackedInitialization;
    return trackedInitialization;
  }

  async detectBoards(): Promise<PythonRuntimeBoard[]> {
    const generation = this.sessionGeneration;
    await this.initialize();
    if (this.detectBoardsInFlight?.generation === generation) {
      return this.detectBoardsInFlight.promise;
    }
    const request = this.detectBoardsForGeneration(generation);
    const inFlight = { generation, promise: request };
    this.detectBoardsInFlight = inFlight;
    return request.finally(() => {
      if (this.detectBoardsInFlight === inFlight) {
        this.detectBoardsInFlight = null;
      }
    });
  }

  private async detectBoardsForGeneration(
    generation: number,
  ): Promise<PythonRuntimeBoard[]> {
    if (this.isCurrentSession(generation)) {
      this.patch({ connectionState: 'scanning', error: null });
    }
    try {
      const result = await this.api.detectBoards();
      const boards = Array.isArray(result?.boards) ? result.boards : [];
      if (this.isCurrentSession(generation)) {
        this.patch({
          boards,
          connectionState: this.snapshot.port ? 'connected' : 'disconnected',
        });
      }
      return boards;
    } catch (error) {
      if (this.isCurrentSession(generation)) this.fail(error);
      throw error;
    }
  }

  async connect(port: string, baudRate = 115200): Promise<Record<string, any>> {
    const generation = this.sessionGeneration;
    const operationGeneration = this.nextOperation('connection');
    if (this.isCurrentSession(generation)) {
      this.patch({ connectionState: 'connecting', error: null });
    }
    return this.enqueueOperation('connection', async () => {
      await this.initialize();
      try {
        const boardInfo = await this.api.connect({ port, baudRate });
        if (
          this.isCurrentOperation('connection', operationGeneration)
          && this.isCurrentSession(generation)
        ) {
          this.patch({ connectionState: 'connected', port, boardInfo, error: null });
        }
        return boardInfo;
      } catch (error) {
        if (
          this.isCurrentOperation('connection', operationGeneration)
          && this.isCurrentSession(generation)
        ) {
          this.fail(error);
        }
        throw error;
      }
    });
  }

  async disconnect(): Promise<void> {
    const operationGeneration = this.nextOperation('connection');
    this.invalidateSessionGeneration();
    await this.enqueueOperation('connection', async () => {
      await this.invokeOperation(
        'connection',
        operationGeneration,
        () => this.api.disconnect(),
      );
      if (!this.isCurrentOperation('connection', operationGeneration)) return;
      this.patch({
        connectionState: 'disconnected',
        boards: [],
        port: null,
        boardInfo: null,
        running: false,
        previewing: false,
        error: null,
      });
    });
  }

  async runScript(script: string): Promise<void> {
    const operationGeneration = this.nextOperation('script');
    await this.enqueueOperation('script', async () => {
      const generation = this.sessionGeneration;
      const scriptStateVersion = this.scriptStateVersion;
      const result = await this.invokeOperation(
        'script',
        operationGeneration,
        () => this.api.runScript(script),
      );
      if (result.output) this.terminalOutputSubject.next(result.output);
      if (result.status === 'error') throw new Error(result.message || 'Script failed');
      if (
        this.isCurrentOperation('script', operationGeneration)
        && this.isCurrentSession(generation)
        && this.scriptStateVersion === scriptStateVersion
      ) {
        this.patch({ running: true, error: null });
      }
    });
  }

  async stopScript(): Promise<void> {
    const operationGeneration = this.nextOperation('script');
    await this.enqueueOperation('script', async () => {
      await this.invokeOperation(
        'script',
        operationGeneration,
        () => this.api.stopScript(),
      );
      if (this.isCurrentOperation('script', operationGeneration)) {
        this.patch({ running: false });
      }
    });
  }

  async refreshScriptRunning(): Promise<boolean> {
    const generation = this.sessionGeneration;
    const result = await this.invoke(() => this.api.scriptRunning());
    if (this.isCurrentSession(generation)) {
      this.patch({ running: result.running });
    }
    return result.running;
  }

  sendTerminalInput(text: string): Promise<any> {
    return this.invoke(() => this.api.terminalInput(text));
  }

  resizeTerminal(columns: number, rows: number): Promise<any> {
    return this.invoke(() => this.api.terminalResize(columns, rows));
  }

  async startPreview(options: { fps?: number; resolution?: { w: number; h: number } } = {}): Promise<string> {
    const operationGeneration = this.nextOperation('preview');
    return this.enqueueOperation('preview', async () => {
      const generation = this.sessionGeneration;
      const result = await this.invokeOperation(
        'preview',
        operationGeneration,
        () => this.api.startPreview(options),
      );
      if (
        this.isCurrentOperation('preview', operationGeneration)
        && this.isCurrentSession(generation)
      ) {
        this.patch({ previewing: true });
      }
      return result.streamId;
    });
  }

  async stopPreview(): Promise<void> {
    const operationGeneration = this.nextOperation('preview');
    await this.enqueueOperation('preview', async () => {
      await this.invokeOperation(
        'preview',
        operationGeneration,
        () => this.api.stopPreview(),
      );
      if (this.isCurrentOperation('preview', operationGeneration)) {
        this.patch({ previewing: false });
      }
    });
  }

  listRemoteDirectory(path = '/'): Promise<any> { return this.invoke(() => this.api.files.listDir(path)); }
  statRemotePath(path: string): Promise<any> { return this.invoke(() => this.api.files.stat(path)); }
  deleteRemoteFile(path: string): Promise<any> { return this.invoke(() => this.api.files.deleteFile(path)); }
  renameRemotePath(oldPath: string, newPath: string): Promise<any> {
    return this.invoke(() => this.api.files.renameFile(oldPath, newPath));
  }
  createRemoteDirectory(path: string): Promise<any> { return this.invoke(() => this.api.files.mkdir(path)); }
  removeRemoteDirectory(path: string): Promise<any> { return this.invoke(() => this.api.files.rmdir(path)); }
  executeRemoteFile(path: string): Promise<any> { return this.invoke(() => this.api.files.exec(path)); }
  getFirmwareCommit(): Promise<any> { return this.invoke(() => this.api.firmwareCommit()); }
  getVirtualTouchStatus(): Promise<any> { return this.invoke(() => this.api.virtualTouchStatus()); }
  sendVirtualTouchEvent(options: any): Promise<any> {
    return this.invoke(() => this.api.virtualTouchEvent(options));
  }

  async readRemoteFile(path: string): Promise<Uint8Array> {
    return decodeRemoteFileContent(await this.invoke(() => this.api.files.readFile(path)));
  }

  async readRemoteTextFile(path: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.readRemoteFile(path));
  }

  writeRemoteFile(path: string, content: Uint8Array): Promise<any> {
    return this.invoke(() => this.api.files.writeFile(path, encodeRemoteFileContent(content)));
  }

  writeRemoteTextFile(path: string, content: string): Promise<any> {
    return this.writeRemoteFile(path, new TextEncoder().encode(content));
  }

  dispose(): void {
    const shouldDisconnect = this.snapshot.connectionState === 'connecting'
      || this.snapshot.connectionState === 'connected';
    this.lifecycleGeneration += 1;
    this.initializationPromise = null;
    this.invalidateOperations();
    this.invalidateDeviceSession();
    if (shouldDisconnect) {
      this.nextOperation('connection');
      void this.enqueueOperation('connection', () => this.api.disconnect()).catch(() => undefined);
    }
    for (const cleanup of this.cleanupListeners) cleanup();
    this.cleanupListeners = [];
    this.initialized = false;
  }

  private handleEvent(event: any): void {
    if (event?.event === 'scriptOutput' && typeof event.params?.text === 'string') {
      this.terminalOutputSubject.next(event.params.text);
      return;
    }
    if (event?.event === 'scriptState') {
      const state = event.params?.state;
      this.scriptStateVersion += 1;
      if (state === 'started') this.patch({ running: true });
      if (state === 'finished' || state === 'stopped') this.patch({ running: false });
      if (state === 'error') {
        const errorText = this.eventErrorText(event.params);
        this.patch({
          running: false,
          error: errorText,
        });
        this.terminalOutputSubject.next(
          errorText.endsWith('\n') ? errorText : `${errorText}\r\n`,
        );
      }
      return;
    }
    if (event?.event === 'boardDisconnected') {
      this.invalidateDeviceSession();
    }
  }

  private handleBackendState(state: PythonRuntimeBackendState): void {
    if (state === 'stopped') {
      this.invalidateSessionGeneration();
      this.patch({
        backendState: state,
        connectionState: 'disconnected',
        boards: [],
        port: null,
        boardInfo: null,
        running: false,
        previewing: false,
      });
      return;
    }
    this.patch({ backendState: state });
  }

  private eventErrorText(params: any): string {
    if (typeof params?.message === 'string' && params.message.trim()) return params.message;
    if (typeof params?.error === 'string' && params.error.trim()) return params.error;
    if (typeof params?.error?.message === 'string' && params.error.message.trim()) {
      return params.error.message;
    }
    return 'Script failed';
  }

  private fail(error: unknown): void {
    if (this.isRequestTimeout(error)) {
      this.invalidateDeviceSession(error);
      return;
    }
    this.patch({
      connectionState: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private async invoke<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (this.isRequestTimeout(error)) this.invalidateDeviceSession(error);
      throw error;
    }
  }

  private async invokeOperation<T>(
    kind: PythonRuntimeOperationKind,
    operationGeneration: number,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        this.isCurrentOperation(kind, operationGeneration)
        && this.isRequestTimeout(error)
      ) {
        this.invalidateDeviceSession(error);
      }
      throw error;
    }
  }

  private isRequestTimeout(error: unknown): boolean {
    const candidate = error as { code?: unknown; message?: unknown } | null;
    return candidate?.code === 1002
      || (typeof candidate?.message === 'string' && /request timed out/i.test(candidate.message));
  }

  private invalidateDeviceSession(error?: unknown): void {
    this.invalidateSessionGeneration();
    this.patch({
      connectionState: 'disconnected',
      boards: [],
      port: null,
      boardInfo: null,
      running: false,
      previewing: false,
      error: error == null
        ? null
        : error instanceof Error
          ? error.message
          : String(error),
    });
  }

  private invalidateSessionGeneration(): void {
    this.sessionGeneration += 1;
    this.detectBoardsInFlight = null;
  }

  private isCurrentSession(generation: number): boolean {
    return generation === this.sessionGeneration;
  }

  private nextOperation(kind: PythonRuntimeOperationKind): number {
    this.operationGenerations[kind] += 1;
    return this.operationGenerations[kind];
  }

  private invalidateOperations(): void {
    this.nextOperation('connection');
    this.nextOperation('script');
    this.nextOperation('preview');
  }

  private isCurrentOperation(
    kind: PythonRuntimeOperationKind,
    generation: number,
  ): boolean {
    return this.operationGenerations[kind] === generation;
  }

  private enqueueOperation<T>(
    kind: PythonRuntimeOperationKind,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.operationTails[kind];
    let operation: Promise<T>;
    try {
      operation = previous
        ? previous.then(action, action)
        : Promise.resolve(action());
    } catch (error) {
      operation = Promise.reject(error);
    }
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.operationTails[kind] = tail;
    return operation.finally(() => {
      if (this.operationTails[kind] === tail) {
        this.operationTails[kind] = null;
      }
    });
  }

  private patch(patch: Partial<PythonRuntimeSessionState>): void {
    this.stateSubject.next({ ...this.snapshot, ...patch });
  }
}

function onceCleanup(cleanup: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    cleanup();
  };
}
