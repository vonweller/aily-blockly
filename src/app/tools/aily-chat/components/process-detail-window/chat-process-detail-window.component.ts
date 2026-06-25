import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { SubWindowComponent } from '../../../../components/sub-window/sub-window.component';
import { AilyHost } from '../../core/host';

interface ProcessWindowInitData {
  readonly sessionId?: string;
  readonly processId?: string;
  readonly outputSessionId?: string;
  readonly outputFilePath?: string;
  readonly command?: string;
}

interface ProcessWindowProcessSummary {
  readonly processId: string;
  readonly outputSessionId?: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly status?: string;
  readonly running?: boolean;
  readonly exitCode?: number;
  readonly pid?: number;
  readonly startedAt?: number;
  readonly lastOutputAt?: number;
  readonly completedAt?: number;
  readonly elapsedMs?: number;
  readonly bytesTotal?: number;
  readonly outputFilePath?: string;
}

@Component({
  selector: 'app-chat-process-detail-window',
  standalone: true,
  imports: [CommonModule, SubWindowComponent],
  templateUrl: './chat-process-detail-window.component.html',
  styleUrl: './chat-process-detail-window.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatProcessDetailWindowComponent implements OnInit, OnDestroy {
  sessionId = '';
  processId = '';
  outputSessionId = '';
  outputFilePath = '';
  command = '';
  summary: ProcessWindowProcessSummary | null = null;
  output = '';
  windowTitle = '终端执行详情';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initDataCleanup: (() => void) | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.sessionId = decodeURIComponent(params.get('sessionId') || '');
      this.processId = decodeURIComponent(params.get('processId') || '');
      this.outputSessionId = this.processId;
      this.refresh();
    });

    if (window['subWindow']?.onInitData) {
      this.initDataCleanup = window['subWindow'].onInitData((payload: { data?: ProcessWindowInitData } | ProcessWindowInitData) => {
        const data = payload && typeof payload === 'object' && 'data' in payload
          ? payload.data
          : payload as ProcessWindowInitData | undefined;
        this.applyInitData((data ?? undefined) as ProcessWindowInitData | undefined);
      });
    }

    this.startPolling();
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.initDataCleanup?.();
    this.initDataCleanup = null;
  }

  formatElapsedMs(value: number | undefined): string {
    const totalSeconds = Math.max(0, Math.floor((value ?? 0) / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }

  openOutputFile(): void {
    if (!this.outputFilePath) {
      return;
    }
    AilyHost.get().shell?.openByExplorer?.(this.outputFilePath);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.refresh();
    }, 1000);
  }

  private applyInitData(data: ProcessWindowInitData | null | undefined): void {
    if (!data) {
      return;
    }
    if (typeof data.sessionId === 'string' && data.sessionId.trim()) {
      this.sessionId = data.sessionId.trim();
    }
    if (typeof data.processId === 'string' && data.processId.trim()) {
      this.processId = data.processId.trim();
    }
    if (typeof data.outputSessionId === 'string' && data.outputSessionId.trim()) {
      this.outputSessionId = data.outputSessionId.trim();
    }
    if (typeof data.outputFilePath === 'string' && data.outputFilePath.trim()) {
      this.outputFilePath = data.outputFilePath.trim();
    }
    if (typeof data.command === 'string' && data.command.trim()) {
      this.command = data.command.trim();
    }
    this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.sessionId || !this.processId) {
      this.cdr.markForCheck();
      return;
    }

    const summary = await this.readSummaryFromHost();
    if (summary) {
      this.summary = summary;
      this.outputSessionId = summary.outputSessionId || this.outputSessionId;
      this.outputFilePath = summary.outputFilePath || this.outputFilePath;
      this.command = summary.command || this.command;
      this.windowTitle = `终端执行详情 · ${this.command || this.processId}`;
    }

    this.output = this.readOutput();
    this.cdr.markForCheck();
  }

  private async readSummaryFromHost(): Promise<ProcessWindowProcessSummary | null> {
    try {
      const electronApi = window['electronAPI'] as { chatRuntimeHost?: { call?: (method: string, args: readonly unknown[]) => Promise<unknown> } } | undefined;
      const snapshot = await electronApi?.chatRuntimeHost?.call?.('readInteractionSnapshot', [this.sessionId]) as {
        processes?: readonly ProcessWindowProcessSummary[];
      } | null;
      const process = snapshot?.processes?.find(item => item.processId === this.processId) ?? null;
      return process;
    } catch {
      return null;
    }
  }

  private readOutput(): string {
    const outputFilePath = typeof this.outputFilePath === 'string' ? this.outputFilePath.trim() : '';
    if (!outputFilePath) {
      return '';
    }
    try {
      const host = AilyHost.get();
      if (!host.fs?.existsSync?.(outputFilePath)) {
        return '';
      }
      return String(host.fs.readFileSync(outputFilePath, 'utf-8') ?? '');
    } catch {
      return '';
    }
  }
}
