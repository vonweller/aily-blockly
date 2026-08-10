import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { decodeRemoteFileContent, encodeRemoteFileContent, RemoteFileReadResult } from './remote-file-codec';

export type PythonRuntimeBackendState = 'stopped' | 'starting' | 'ready';
export type PythonRuntimeConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';

export interface PythonRuntimeBoard {
  port: string;
  name: string;
  vid: string;
  pid: string;
  serialNumber?: string;
  description?: string;
}

export interface PythonRuntimeSessionState {
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
  status(): Promise<{ state: PythonRuntimeBackendState; pid: number | null }>;
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
    this.cleanupListeners = [
      this.api.onEvent(event => this.handleEvent(event)),
      this.api.onFrame(frame => this.frameSubject.next(frame)),
      this.api.onState(state => this.patch({ backendState: state })),
      this.api.onStderr(text => this.backendStderrSubject.next(text)),
    ];
    const status = await this.api.status();
    this.patch({ backendState: status.state });
    this.initialized = true;
  }

  async detectBoards(): Promise<PythonRuntimeBoard[]> {
    await this.initialize();
    this.patch({ connectionState: 'scanning', error: null });
    try {
      const result = await this.api.detectBoards();
      const boards = Array.isArray(result?.boards) ? result.boards : [];
      this.patch({
        boards,
        connectionState: this.snapshot.port ? 'connected' : 'disconnected',
      });
      return boards;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async connect(port: string, baudRate = 115200): Promise<Record<string, any>> {
    await this.initialize();
    this.patch({ connectionState: 'connecting', error: null });
    try {
      const boardInfo = await this.api.connect({ port, baudRate });
      this.patch({ connectionState: 'connected', port, boardInfo, error: null });
      return boardInfo;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.api.disconnect();
    this.patch({
      connectionState: 'disconnected',
      port: null,
      boardInfo: null,
      running: false,
      previewing: false,
      error: null,
    });
  }

  async runScript(script: string): Promise<void> {
    const result = await this.api.runScript(script);
    if (result.output) this.terminalOutputSubject.next(result.output);
    if (result.status === 'error') throw new Error(result.message || 'Script failed');
    this.patch({ running: true, error: null });
  }

  async stopScript(): Promise<void> {
    await this.api.stopScript();
    this.patch({ running: false });
  }

  async refreshScriptRunning(): Promise<boolean> {
    const result = await this.api.scriptRunning();
    this.patch({ running: result.running });
    return result.running;
  }

  sendTerminalInput(text: string): Promise<any> {
    return this.api.terminalInput(text);
  }

  resizeTerminal(columns: number, rows: number): Promise<any> {
    return this.api.terminalResize(columns, rows);
  }

  async startPreview(options: { fps?: number; resolution?: { w: number; h: number } } = {}): Promise<string> {
    const result = await this.api.startPreview(options);
    this.patch({ previewing: true });
    return result.streamId;
  }

  async stopPreview(): Promise<void> {
    await this.api.stopPreview();
    this.patch({ previewing: false });
  }

  listRemoteDirectory(path = '/'): Promise<any> { return this.api.files.listDir(path); }
  statRemotePath(path: string): Promise<any> { return this.api.files.stat(path); }
  deleteRemoteFile(path: string): Promise<any> { return this.api.files.deleteFile(path); }
  renameRemotePath(oldPath: string, newPath: string): Promise<any> { return this.api.files.renameFile(oldPath, newPath); }
  createRemoteDirectory(path: string): Promise<any> { return this.api.files.mkdir(path); }
  removeRemoteDirectory(path: string): Promise<any> { return this.api.files.rmdir(path); }
  executeRemoteFile(path: string): Promise<any> { return this.api.files.exec(path); }
  getFirmwareCommit(): Promise<any> { return this.api.firmwareCommit(); }
  getVirtualTouchStatus(): Promise<any> { return this.api.virtualTouchStatus(); }
  sendVirtualTouchEvent(options: any): Promise<any> { return this.api.virtualTouchEvent(options); }

  async readRemoteFile(path: string): Promise<Uint8Array> {
    return decodeRemoteFileContent(await this.api.files.readFile(path));
  }

  async readRemoteTextFile(path: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.readRemoteFile(path));
  }

  writeRemoteFile(path: string, content: Uint8Array): Promise<any> {
    return this.api.files.writeFile(path, encodeRemoteFileContent(content));
  }

  writeRemoteTextFile(path: string, content: string): Promise<any> {
    return this.writeRemoteFile(path, new TextEncoder().encode(content));
  }

  dispose(): void {
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
      if (state === 'started') this.patch({ running: true });
      if (state === 'finished' || state === 'stopped') this.patch({ running: false });
      return;
    }
    if (event?.event === 'boardDisconnected') {
      this.patch({
        connectionState: 'disconnected',
        port: null,
        boardInfo: null,
        running: false,
        previewing: false,
      });
    }
  }

  private fail(error: unknown): void {
    this.patch({
      connectionState: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private patch(patch: Partial<PythonRuntimeSessionState>): void {
    this.stateSubject.next({ ...this.snapshot, ...patch });
  }
}
