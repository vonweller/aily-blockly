import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, EventEmitter, OnDestroy, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subscription } from 'rxjs';
import { Observable } from 'rxjs';
import { EmbeddedPythonRuntimeService } from '../../../../services/python-runtime/embedded-python-runtime.service';
import { PythonRuntimeSessionState } from '../../../../services/python-runtime/python-runtime-client';

@Component({
  selector: 'app-python-device-panel',
  standalone: true,
  imports: [CommonModule, AsyncPipe, FormsModule, NzIconModule, NzSelectModule],
  templateUrl: './python-device-panel.component.html',
  styleUrl: './python-device-panel.component.scss',
})
export class PythonDevicePanelComponent implements OnDestroy {
  @Output() runRequested = new EventEmitter<void>();
  @Output() stopRequested = new EventEmitter<void>();

  readonly state$: Observable<PythonRuntimeSessionState>;
  selectedPort = '';
  busy = false;
  error = '';
  frameUrl = '';
  private frameSubscription: Subscription;

  constructor(public readonly runtime: EmbeddedPythonRuntimeService) {
    this.state$ = this.runtime.state$;
    this.frameSubscription = this.runtime.frame$.subscribe(frame => {
      const nextUrl = URL.createObjectURL(new Blob([frame.data.buffer as ArrayBuffer], { type: 'image/jpeg' }));
      if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
      this.frameUrl = nextUrl;
    });
  }

  async detect(): Promise<void> {
    await this.perform(async () => {
      const boards = await this.runtime.detectBoards();
      if (!this.selectedPort && boards.length > 0) this.selectedPort = boards[0].port;
    });
  }

  async connect(): Promise<void> {
    if (!this.selectedPort) {
      this.error = 'Select a serial port first';
      return;
    }
    await this.perform(() => this.runtime.connect(this.selectedPort));
  }

  async disconnect(): Promise<void> {
    await this.perform(() => this.runtime.disconnect());
    this.clearPreview();
  }

  async togglePreview(state: PythonRuntimeSessionState): Promise<void> {
    if (state.previewing) {
      await this.perform(() => this.runtime.stopPreview());
      this.clearPreview();
    } else {
      await this.perform(() => this.runtime.startPreview({ fps: 15 }));
    }
  }

  run(): void {
    this.runRequested.emit();
  }

  stop(): void {
    this.stopRequested.emit();
  }

  statusText(state: PythonRuntimeSessionState): string {
    if (state.error || this.error) return state.error || this.error;
    if (state.connectionState === 'connected') return state.running ? 'Connected · running' : 'Connected';
    if (state.connectionState === 'scanning') return 'Scanning ports...';
    if (state.connectionState === 'connecting') return 'Connecting...';
    return state.backendState === 'ready' ? 'Ready to connect' : 'Starting runtime...';
  }

  ngOnDestroy(): void {
    this.frameSubscription.unsubscribe();
    this.clearPreview();
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

  private clearPreview(): void {
    if (this.frameUrl) URL.revokeObjectURL(this.frameUrl);
    this.frameUrl = '';
  }
}
