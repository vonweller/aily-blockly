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
import type { PythonRuntimeCapabilities } from '../../../../services/python-runtime/python-runtime-capabilities';
import type { PythonRuntimeEndpoint } from '../../../../services/python-runtime/python-runtime-endpoint';
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
  sshHost = '';
  sshPort = 22;
  sshUsername = '';
  sshPassword = '';
  sshPrivateKeyPath = '';
  sshPrivateKeyPassphrase = '';
  serialBaudRate = 115200;
  autostartMessage = '';
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
        if (this.isCanmvRuntime || this.isSerialShellRuntime) {
          await this.scanForBoards(runtime, activationId);
        }
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

  get isCanmvRuntime(): boolean {
    return this.runtimeMetadata?.adapter === 'canmv-k230';
  }

  get isSshRuntime(): boolean {
    return this.runtimeMetadata?.adapter === 'linux-ssh';
  }

  get isSerialShellRuntime(): boolean {
    return this.runtimeMetadata?.adapter === 'linux-serial-shell';
  }

  async detect(): Promise<void> {
    if (
      !this.runtime
      || this.isSshRuntime
      || this.runtime.snapshot.connectionState === 'connected'
    ) return;
    const runtime = this.runtime;
    const activationId = this.activationId;
    await this.perform(
      () => this.scanForBoards(runtime, activationId),
      activationId,
    );
  }

  async connect(): Promise<void> {
    if (!this.runtime) return;
    const isSshConnection = this.isSshRuntime;
    if (isSshConnection && (!this.sshHost.trim() || !this.sshUsername.trim())) {
      this.error = 'Enter an SSH host and username first';
      return;
    }
    if (!isSshConnection && !this.selectedPort) {
      this.error = 'Select a device port first';
      return;
    }
    const runtime = this.runtime;
    const activationId = this.activationId;
    this.clearDeviceRescan();
    try {
      if (isSshConnection) {
        const endpoint: PythonRuntimeEndpoint = {
          kind: 'ssh',
          host: this.sshHost.trim(),
          port: this.sshPort,
          username: this.sshUsername.trim(),
          ...(this.sshPrivateKeyPath.trim()
            ? { privateKeyPath: this.sshPrivateKeyPath.trim() }
            : {}),
        };
        const credentials = {
          ...(this.sshPassword ? { password: this.sshPassword } : {}),
          ...(this.sshPrivateKeyPassphrase
            ? { passphrase: this.sshPrivateKeyPassphrase }
            : {}),
        };
        await this.perform(() => runtime.connect(endpoint, credentials), activationId);
      } else if (this.isSerialShellRuntime) {
        await this.perform(() => runtime.connect({
          kind: 'serial-shell',
          port: this.selectedPort,
          baudRate: this.serialBaudRate,
        }), activationId);
      } else {
        await this.perform(() => runtime.connect(this.selectedPort), activationId);
      }
      if (runtime.snapshot.connectionState !== 'connected') {
        this.scheduleDeviceRescan(runtime, activationId);
      }
    } finally {
      if (isSshConnection) this.clearSshSecrets();
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
    if (
      !this.runtime
      || this.runtime.snapshot.connectionState !== 'connected'
      || !this.previewEnabled(state)
    ) return;
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
      || !this.filesEnabled(this.runtime.snapshot)
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
      || !this.filesEnabled(this.runtime.snapshot)
      || !this.openedFilePath
    ) return;
    await this.perform(() => this.runtime!.writeRemoteTextFile(this.openedFilePath, this.openedFileText));
  }

  async installAutostart(): Promise<void> {
    if (!this.runtime || !this.autostartEnabled(this.runtime.snapshot)) return;
    await this.perform(async () => {
      const result = await this.runtime!.installAutostart({
        projectId: this.autostartProjectId(),
        script: this.source,
      });
      this.autostartMessage = this.describeAutostartResult(result, 'Autostart installed');
    });
  }

  async checkAutostartStatus(): Promise<void> {
    if (!this.runtime || !this.autostartEnabled(this.runtime.snapshot)) return;
    await this.perform(async () => {
      const result = await this.runtime!.getAutostartStatus({
        projectId: this.autostartProjectId(),
      });
      this.autostartMessage = this.describeAutostartResult(result, 'Autostart status checked');
    });
  }

  async removeAutostart(): Promise<void> {
    if (!this.runtime || !this.autostartEnabled(this.runtime.snapshot)) return;
    await this.perform(async () => {
      const result = await this.runtime!.removeAutostart({
        projectId: this.autostartProjectId(),
      });
      this.autostartMessage = this.describeAutostartResult(result, 'Autostart removed');
    });
  }

  filesEnabled(state: PythonRuntimeSessionState): boolean {
    return state.connectionState === 'connected'
      && (
        (state.capabilities != null && state.capabilities.files !== 'none')
        || this.legacyCapabilityFallback(state)
      );
  }

  autostartEnabled(state: PythonRuntimeSessionState): boolean {
    return state.connectionState === 'connected'
      && state.capabilities != null
      && state.capabilities.autostart !== 'none';
  }

  previewEnabled(state: PythonRuntimeSessionState): boolean {
    return state.connectionState === 'connected'
      && (state.capabilities?.preview.available === true || this.legacyCapabilityFallback(state));
  }

  terminalInputEnabled(state: PythonRuntimeSessionState): boolean {
    return state.connectionState === 'connected'
      && (state.capabilities?.pty === true || this.legacyCapabilityFallback(state));
  }

  terminalResizeEnabled(state: PythonRuntimeSessionState): boolean {
    return state.connectionState === 'connected'
      && (
        state.capabilities?.terminalResize === true
        || this.legacyCapabilityFallback(state)
      );
  }

  capabilityReason(
    state: PythonRuntimeSessionState,
    capability: keyof NonNullable<PythonRuntimeCapabilities['unavailableReasons']>,
  ): string {
    if (state.connectionState !== 'connected') {
      return 'Connect the Python runtime first.';
    }
    const explicit = state.capabilities?.unavailableReasons?.[capability];
    if (explicit) return explicit;
    switch (capability) {
      case 'files':
        return 'Remote files are not supported by this runtime.';
      case 'autostart':
        return 'No supported autostart manager is available.';
      case 'preview':
        return 'No camera preview backend is available.';
      case 'terminalResize':
        return 'The runtime terminal cannot be resized.';
      case 'pty':
        return 'Interactive terminal input is not supported.';
    }
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
    this.autostartMessage = '';
    this.clearSshSecrets();
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
      !this.isCanmvRuntime
      || this.deviceRescanTimer !== null
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
    this.autostartMessage = '';
  }

  private clearPreview(): void {
    if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
    this.frameUrl = '';
  }

  private legacyCapabilityFallback(state: PythonRuntimeSessionState): boolean {
    return this.isCanmvRuntime && state.capabilities == null;
  }

  private clearSshSecrets(): void {
    this.sshPassword = '';
    this.sshPrivateKeyPassphrase = '';
  }

  private autostartProjectId(): string {
    const adapter = this.runtimeMetadata?.adapter || 'python';
    const entry = this.runtimeMetadata?.entry || 'main.py';
    return `${adapter}-${entry}`
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 128);
  }

  private describeAutostartResult(result: unknown, fallback: string): string {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const candidate = result as Record<string, unknown>;
      if (typeof candidate['message'] === 'string') return candidate['message'];
      if (typeof candidate['installed'] === 'boolean') {
        return candidate['installed'] ? 'Autostart is installed' : 'Autostart is not installed';
      }
      if (typeof candidate['removed'] === 'boolean' && candidate['removed']) {
        return 'Autostart removed';
      }
    }
    return fallback;
  }
}
