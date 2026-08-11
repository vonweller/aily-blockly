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
  private frameSubscription: Subscription | null = null;

  constructor(private readonly registry: PythonRuntimeRegistry) {}

  get visible(): boolean {
    return Boolean(this.runtimeMetadata && this.runtime);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['runtimeMetadata']) void this.activate();
  }

  async activate(): Promise<void> {
    this.deactivateRuntime();
    if (!this.runtimeMetadata) return;
    const adapter = this.registry.resolve(this.runtimeMetadata);
    this.runtime = adapter.runtime;
    this.state$ = this.runtime.state$;
    this.frameSubscription = this.runtime.frame$.subscribe(frame => {
      const nextUrl = URL.createObjectURL(new Blob([frame.data.buffer as ArrayBuffer], { type: 'image/jpeg' }));
      this.clearPreview();
      this.frameUrl = nextUrl;
    });
    await this.perform(() => this.runtime!.initialize());
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
    if (!this.runtime) return;
    await this.perform(async () => {
      const boards = await this.runtime!.detectBoards();
      if (!this.selectedPort && boards.length > 0) this.selectedPort = boards[0].port;
    });
  }

  async connect(): Promise<void> {
    if (!this.runtime || !this.selectedPort) {
      this.error = 'Select a device port first';
      return;
    }
    await this.perform(() => this.runtime!.connect(this.selectedPort));
  }

  async disconnect(): Promise<void> {
    if (!this.runtime) return;
    await this.perform(() => this.runtime!.disconnect());
    this.clearPreview();
  }

  async run(): Promise<void> {
    if (!this.runtime || !this.source) return;
    await this.perform(() => this.runtime!.runScript(this.source));
  }

  async stop(): Promise<void> {
    if (!this.runtime) return;
    await this.perform(() => this.runtime!.stopScript());
  }

  async togglePreview(state: PythonRuntimeSessionState): Promise<void> {
    if (!this.runtime) return;
    if (state.previewing) {
      await this.perform(() => this.runtime!.stopPreview());
      this.clearPreview();
    } else {
      await this.perform(() => this.runtime!.startPreview({ fps: 15 }));
    }
  }

  async openRemoteFile(node: RemoteDirectoryNode): Promise<void> {
    if (!this.runtime || node.type !== 'file') return;
    await this.perform(async () => {
      this.openedFileText = await this.runtime!.readRemoteTextFile(node.path);
      this.openedFilePath = node.path;
    });
  }

  async saveRemoteFile(): Promise<void> {
    if (!this.runtime || !this.openedFilePath) return;
    await this.perform(() => this.runtime!.writeRemoteTextFile(this.openedFilePath, this.openedFileText));
  }

  statusText(state: PythonRuntimeSessionState): string {
    if (state.error || this.error) return state.error || this.error;
    if (!state.runtimeAvailable) return state.unavailableReason || 'Python runtime unavailable';
    if (state.connectionState === 'connected') return state.running ? 'Connected · running' : 'Connected';
    if (state.connectionState === 'scanning') return 'Scanning devices...';
    if (state.connectionState === 'connecting') return 'Connecting...';
    return state.backendState === 'ready' ? 'Ready to connect' : 'Checking runtime...';
  }

  ngOnDestroy(): void {
    this.deactivateRuntime();
  }

  private async perform(action: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      await action();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private deactivateRuntime(): void {
    this.frameSubscription?.unsubscribe();
    this.frameSubscription = null;
    this.clearPreview();
    this.runtime?.dispose();
    this.runtime = null;
    this.state$ = null;
  }

  private clearPreview(): void {
    if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
    this.frameUrl = '';
  }
}
