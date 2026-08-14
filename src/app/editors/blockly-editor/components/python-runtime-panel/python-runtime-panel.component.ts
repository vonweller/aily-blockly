import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Observable, Subscription } from 'rxjs';
import { PythonTerminalComponent } from './python-terminal/python-terminal.component';
import { RemoteFileTreeComponent } from './remote-file-tree/remote-file-tree.component';
import type { PythonRuntimeMetadata } from '../../../../services/python-runtime/python-mode';
import type { PythonRuntimeClient, PythonRuntimeSessionState } from '../../../../services/python-runtime/python-runtime-client';
import { PythonRuntimeRegistry } from '../../../../services/python-runtime/python-runtime-registry';
import type { RemoteDirectoryNode } from '../../../../services/python-runtime/remote-file-tree';

const runtimeLifecycleQueues = new WeakMap<PythonRuntimeClient, Promise<void>>();
const runtimeOwners = new WeakMap<PythonRuntimeClient, symbol>();

@Component({
  selector: 'app-python-runtime-panel',
  standalone: true,
  imports: [
    CommonModule,
    AsyncPipe,
    FormsModule,
    NzIconModule,
    NzSelectModule,
    PythonTerminalComponent,
    RemoteFileTreeComponent,
  ],
  templateUrl: './python-runtime-panel.component.html',
  styleUrl: './python-runtime-panel.component.scss',
})
export class PythonRuntimePanelComponent implements OnChanges, OnDestroy {
  @Input() runtimeMetadata: PythonRuntimeMetadata | null = null;
  @Input() source = '';

  runtime: PythonRuntimeClient | null = null;
  state$: Observable<PythonRuntimeSessionState> | null = null;
  selectedPort = '';
  busy = false;
  error = '';
  frameUrl = '';
  openedFilePath = '';
  openedFileText = '';
  hasScanned = false;
  private frameSubscription: Subscription | null = null;
  private stateSubscription: Subscription | null = null;
  private activationId = 0;
  private deviceRescanTimer: ReturnType<typeof setTimeout> | null = null;
  private previousBoardPorts = new Set<string>();
  private readonly runtimeOwner = Symbol('python-runtime-panel-owner');

  constructor(private readonly registry: PythonRuntimeRegistry) {}

  get visible(): boolean {
    return Boolean(this.runtimeMetadata && this.runtime);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['runtimeMetadata']) void this.activate();
  }

  async activate(): Promise<void> {
    const activationId = ++this.activationId;
    const previousRuntime = this.detachRuntimeView();
    this.busy = false;
    this.error = '';
    if (!this.runtimeMetadata) {
      if (previousRuntime) void this.enqueueRuntimeLifecycle(
        previousRuntime,
        () => this.shutdownRuntime(previousRuntime),
      ).catch(() => undefined);
      return;
    }
    let adapter;
    try {
      adapter = this.registry.resolve(this.runtimeMetadata);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return;
    }
    const runtime = adapter.runtime;
    if (previousRuntime) {
      const shutdown = this.enqueueRuntimeLifecycle(
        previousRuntime,
        () => this.shutdownRuntime(previousRuntime),
      );
      if (previousRuntime === runtime) {
        await shutdown.catch(error => {
          if (activationId === this.activationId) {
            this.error = error instanceof Error ? error.message : String(error);
          }
        });
      } else {
        void shutdown.catch(() => undefined);
      }
    }
    if (activationId !== this.activationId) return;
    this.claimRuntime(runtime);
    this.runtime = runtime;
    this.state$ = runtime.state$;
    let previousConnectionState = runtime.snapshot.connectionState;
    let previousBackendState = runtime.snapshot.backendState;
    this.stateSubscription = runtime.state$.subscribe(state => {
      if (!this.isCurrentActivation(activationId, runtime)) return;
      const lostConnection = previousConnectionState === 'connected'
        && state.connectionState !== 'connected';
      const backendStopped = previousBackendState !== 'stopped'
        && state.backendState === 'stopped';
      previousConnectionState = state.connectionState;
      previousBackendState = state.backendState;
      if (state.connectionState === 'connected') {
        this.clearDeviceRescan();
        return;
      }
      if (lostConnection || backendStopped) {
        this.clearDeviceSessionUi();
        this.selectedPort = '';
        this.previousBoardPorts.clear();
        this.scheduleDeviceRescan(runtime, activationId);
      }
    });
    this.frameSubscription = runtime.frame$.subscribe(frame => {
      if (
        !this.isCurrentActivation(activationId, runtime)
        || runtime.snapshot.connectionState !== 'connected'
        || !runtime.snapshot.previewing
      ) return;
      const nextUrl = URL.createObjectURL(new Blob([frame.data], { type: 'image/jpeg' }));
      this.clearPreview();
      this.frameUrl = nextUrl;
    });
    await this.perform(async () => {
      await this.enqueueRuntimeLifecycle(runtime, async () => {
        await runtime.initialize();
        if (!this.isCurrentActivation(activationId, runtime)) return;
        await this.scanForBoards(runtime, activationId);
      });
    }, activationId);
  }

  canRun(state: PythonRuntimeSessionState): boolean {
    return !this.busy
      && state.runtimeAvailable
      && state.connectionState === 'connected'
      && !state.running
      && this.source.length > 0;
  }

  showStop(state: Pick<PythonRuntimeSessionState, 'running'>): boolean {
    return state.running;
  }

  async detect(): Promise<void> {
    if (!this.runtime || this.runtime.snapshot.connectionState === 'connected') return;
    const runtime = this.runtime;
    const activationId = this.activationId;
    await this.perform(
      () => this.scanForBoards(runtime, activationId),
      activationId,
    );
  }

  async connect(): Promise<void> {
    if (!this.runtime || !this.selectedPort) {
      this.error = 'Select a device port first';
      return;
    }
    const runtime = this.runtime;
    const activationId = this.activationId;
    this.clearDeviceRescan();
    await this.perform(() => runtime.connect(this.selectedPort), activationId);
    if (runtime.snapshot.connectionState !== 'connected') {
      this.scheduleDeviceRescan(runtime, activationId);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.runtime) return;
    const runtime = this.runtime;
    const activationId = this.activationId;
    await this.perform(() => runtime.disconnect(), activationId);
    this.clearDeviceSessionUi();
    this.selectedPort = '';
    this.previousBoardPorts.clear();
    this.scheduleDeviceRescan(runtime, activationId);
  }

  async run(): Promise<void> {
    if (
      !this.runtime
      || this.runtime.snapshot.connectionState !== 'connected'
      || !this.source
    ) return;
    await this.perform(() => this.runtime!.runScript(this.source));
  }

  async stop(): Promise<void> {
    if (!this.runtime || this.runtime.snapshot.connectionState !== 'connected') return;
    await this.perform(() => this.runtime!.stopScript());
  }

  async togglePreview(state: PythonRuntimeSessionState): Promise<void> {
    if (!this.runtime || this.runtime.snapshot.connectionState !== 'connected') return;
    if (state.previewing) {
      await this.perform(() => this.runtime!.stopPreview());
      this.clearPreview();
    } else {
      await this.perform(() => this.runtime!.startPreview({ fps: 15 }));
    }
  }

  async openRemoteFile(node: RemoteDirectoryNode): Promise<void> {
    if (
      !this.runtime
      || this.runtime.snapshot.connectionState !== 'connected'
      || node.type !== 'file'
    ) return;
    const runtime = this.runtime;
    const activationId = this.activationId;
    await this.perform(async () => {
      const text = await runtime.readRemoteTextFile(node.path);
      if (
        !this.isCurrentActivation(activationId, runtime)
        || runtime.snapshot.connectionState !== 'connected'
      ) return;
      this.openedFileText = text;
      this.openedFilePath = node.path;
    }, activationId);
  }

  async saveRemoteFile(): Promise<void> {
    if (
      !this.runtime
      || this.runtime.snapshot.connectionState !== 'connected'
      || !this.openedFilePath
    ) return;
    await this.perform(() => this.runtime!.writeRemoteTextFile(this.openedFilePath, this.openedFileText));
  }

  statusText(state: PythonRuntimeSessionState): string {
    if (state.error || this.error) return state.error || this.error;
    if (!state.runtimeAvailable) return state.unavailableReason || 'Python runtime unavailable';
    if (state.connectionState === 'connected') return state.running ? 'Connected · running' : 'Connected';
    if (state.connectionState === 'scanning') return 'Scanning devices...';
    if (state.connectionState === 'connecting') return 'Connecting...';
    if (this.hasScanned && state.boards.length === 0) return 'No Python device found. Waiting for a board...';
    return state.backendState === 'ready' ? 'Ready to connect' : 'Checking runtime...';
  }

  ngOnDestroy(): void {
    this.activationId += 1;
    const runtime = this.detachRuntimeView();
    if (runtime) {
      void this.enqueueRuntimeLifecycle(runtime, () => this.shutdownRuntime(runtime))
        .catch(() => undefined);
    }
    this.busy = false;
  }

  private async perform(
    action: () => Promise<unknown>,
    activationId = this.activationId,
  ): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      await action();
    } catch (error) {
      if (activationId === this.activationId) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (activationId === this.activationId) this.busy = false;
    }
  }

  private detachRuntimeView(): PythonRuntimeClient | null {
    this.clearDeviceRescan();
    this.frameSubscription?.unsubscribe();
    this.frameSubscription = null;
    this.stateSubscription?.unsubscribe();
    this.stateSubscription = null;
    this.clearDeviceSessionUi();
    const runtime = this.runtime;
    this.runtime = null;
    this.state$ = null;
    this.selectedPort = '';
    this.hasScanned = false;
    this.previousBoardPorts.clear();
    return runtime;
  }

  private async scanForBoards(
    runtime: PythonRuntimeClient,
    activationId: number,
  ): Promise<void> {
    this.clearDeviceRescan();
    try {
      const boards = await runtime.detectBoards();
      if (!this.isCurrentActivation(activationId, runtime)) return;
      this.hasScanned = true;
      const inserted = boards.find(board => !this.previousBoardPorts.has(board.port));
      if (inserted && this.previousBoardPorts.size > 0) {
        this.selectedPort = inserted.port;
      } else if (!boards.some(board => board.port === this.selectedPort)) {
        this.selectedPort = boards[0]?.port || '';
      }
      this.previousBoardPorts = new Set(boards.map(board => board.port));
    } finally {
      if (
        this.isCurrentActivation(activationId, runtime)
        && runtime.snapshot.connectionState !== 'connected'
      ) {
        this.scheduleDeviceRescan(runtime, activationId);
      }
    }
  }

  private isCurrentActivation(
    activationId: number,
    runtime: PythonRuntimeClient,
  ): boolean {
    return activationId === this.activationId
      && runtime === this.runtime
      && this.ownsRuntime(runtime);
  }

  private clearDeviceRescan(): void {
    if (this.deviceRescanTimer !== null) {
      clearTimeout(this.deviceRescanTimer);
      this.deviceRescanTimer = null;
    }
  }

  private scheduleDeviceRescan(
    runtime: PythonRuntimeClient,
    activationId: number,
  ): void {
    if (
      this.deviceRescanTimer !== null
      || !this.isCurrentActivation(activationId, runtime)
      || runtime.snapshot.connectionState === 'connected'
    ) return;
    this.deviceRescanTimer = setTimeout(() => {
      this.deviceRescanTimer = null;
      if (!this.isCurrentActivation(activationId, runtime)) return;
      void this.perform(
        () => this.scanForBoards(runtime, activationId),
        activationId,
      );
    }, 2_000);
  }

  private enqueueRuntimeLifecycle(
    runtime: PythonRuntimeClient,
    action: () => Promise<void>,
  ): Promise<void> {
    const previous = runtimeLifecycleQueues.get(runtime);
    let next: Promise<void>;
    try {
      next = previous
        ? previous.catch(() => undefined).then(action)
        : Promise.resolve(action());
    } catch (error) {
      next = Promise.reject(error);
    }
    runtimeLifecycleQueues.set(runtime, next);
    return next.finally(() => {
      if (runtimeLifecycleQueues.get(runtime) === next) {
        runtimeLifecycleQueues.delete(runtime);
      }
    });
  }

  private async shutdownRuntime(runtime: PythonRuntimeClient): Promise<void> {
    if (!this.ownsRuntime(runtime)) return;
    let disconnectError: unknown = null;
    if (runtime.snapshot.connectionState === 'connected') {
      try {
        await runtime.disconnect();
      } catch (error) {
        disconnectError = error;
      }
    }
    if (!this.ownsRuntime(runtime)) return;
    runtime.dispose();
    runtimeOwners.delete(runtime);
    if (disconnectError) throw disconnectError;
  }

  private claimRuntime(runtime: PythonRuntimeClient): void {
    runtimeOwners.set(runtime, this.runtimeOwner);
  }

  private ownsRuntime(runtime: PythonRuntimeClient): boolean {
    return runtimeOwners.get(runtime) === this.runtimeOwner;
  }

  private clearDeviceSessionUi(): void {
    this.clearPreview();
    this.openedFilePath = '';
    this.openedFileText = '';
  }

  private clearPreview(): void {
    if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
    this.frameUrl = '';
  }
}
