import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { SubWindowComponent } from '../../../../components/sub-window/sub-window.component';
import { ToolI18nService } from '../../../../services/tool-i18n.service';
import { ChatProcessDetailPanelComponent } from '../process-detail-panel/chat-process-detail-panel.component';
import { AilyHost } from '../../core/host';
import { readChatProcessOutputFile } from '../../helpers/chat-process-window';
import {
  getBlocklyCommandSessionStatus,
  listPersistedBlocklyCommandSessionSnapshots,
} from '../../helpers/lex-agent-bootstrap';
import { ChatHistoryService } from '../../services/chat-history.service';

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
  imports: [CommonModule, TranslateModule, SubWindowComponent, ChatProcessDetailPanelComponent],
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
  windowTitle = '';

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initDataCleanup: (() => void) | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
    private readonly chatHistoryService: ChatHistoryService,
    private readonly translate: TranslateService,
    private readonly toolI18n: ToolI18nService,
  ) {}

  ngOnInit(): void {
    void this.initializeTranslations();
    this.windowTitle = this.translate.instant('AILY_CHAT.PROCESS_WINDOW_TITLE') || 'Terminal Process Detail';
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
      return this.translate.instant('AILY_CHAT.PROCESS_DURATION_SECONDS', { count: totalSeconds });
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return this.translate.instant('AILY_CHAT.PROCESS_DURATION_MINUTES_SECONDS', { minutes, seconds });
  }

  openOutputFile(): void {
    if (!this.outputFilePath) {
      return;
    }
    AilyHost.get().shell?.openByExplorer?.(this.outputFilePath);
  }

  get displayStatus(): string {
    const summary = this.summary;
    if (!summary) {
      return '-';
    }
    const rawStatus = typeof summary.status === 'string' && summary.status.trim()
      ? summary.status.trim()
      : 'unknown';
    if (summary.running === true) {
      return this.translate.instant('AILY_CHAT.PROCESS_STATUS_RUNNING');
    }
    if (rawStatus === 'completed') {
      return this.translate.instant('AILY_CHAT.PROCESS_STATUS_COMPLETED');
    }
    if (rawStatus === 'failed') {
      return this.translate.instant('AILY_CHAT.PROCESS_STATUS_FAILED');
    }
    if (rawStatus === 'timeout') {
      return `${this.translate.instant('AILY_CHAT.PROCESS_STATUS_FAILED')} · ${this.translate.instant('AILY_CHAT.PROCESS_REASON_TIMEOUT')}`;
    }
    if (rawStatus === 'killed') {
      return `${this.translate.instant('AILY_CHAT.PROCESS_STATUS_KILLED')} · ${this.translate.instant('AILY_CHAT.PROCESS_REASON_KILLED')}`;
    }
    if (rawStatus === 'cancelled') {
      return `${this.translate.instant('AILY_CHAT.PROCESS_STATUS_CANCELLED')} · ${this.translate.instant('AILY_CHAT.PROCESS_REASON_CANCELLED')}`;
    }
    return this.translate.instant('AILY_CHAT.PROCESS_STATUS_FAILED');
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.refresh();
    }, 1000);
  }

  private async initializeTranslations(): Promise<void> {
    await this.toolI18n.load('aily-chat');
    this.windowTitle = this.summary
      ? `${this.translate.instant('AILY_CHAT.PROCESS_WINDOW_TITLE') || 'Terminal Process Detail'} · ${this.command || this.processId}`
      : this.translate.instant('AILY_CHAT.PROCESS_WINDOW_TITLE') || 'Terminal Process Detail';
    this.cdr.markForCheck();
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

    const [summary, liveStatus] = await Promise.all([
      this.readSummaryFromHost(),
      getBlocklyCommandSessionStatus(this.processId).catch(() => null),
    ]);
    const mergedSummary = this.mergeSummaryWithLiveStatus(summary, liveStatus);
    if (mergedSummary) {
      this.summary = mergedSummary;
      this.outputSessionId = mergedSummary.outputSessionId || this.outputSessionId;
      this.outputFilePath = mergedSummary.outputFilePath || this.outputFilePath;
      this.command = mergedSummary.command || this.command;
      this.windowTitle = `${this.translate.instant('AILY_CHAT.PROCESS_WINDOW_TITLE') || 'Terminal Process Detail'} · ${this.command || this.processId}`;
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
      const liveProcess = snapshot?.processes?.find(item => item.processId === this.processId) ?? null;
      const projectPathHint = this.chatHistoryService.findEntry(this.sessionId)?.projectPath ?? null;
      const persistedProcess = listPersistedBlocklyCommandSessionSnapshots(this.sessionId, projectPathHint)
        .find(item => item.processId === this.processId) ?? null;
      if (liveProcess && persistedProcess) {
        return {
          ...persistedProcess,
          ...liveProcess,
          outputFilePath: liveProcess.outputFilePath ?? persistedProcess.outputFilePath,
        };
      }
      return liveProcess ?? persistedProcess;
    } catch {
      const projectPathHint = this.chatHistoryService.findEntry(this.sessionId)?.projectPath ?? null;
      return listPersistedBlocklyCommandSessionSnapshots(this.sessionId, projectPathHint)
        .find(item => item.processId === this.processId) ?? null;
    }
  }

  private readOutput(): string {
    return readChatProcessOutputFile(this.outputFilePath);
  }

  private mergeSummaryWithLiveStatus(
    summary: ProcessWindowProcessSummary | null,
    liveStatus: Awaited<ReturnType<typeof getBlocklyCommandSessionStatus>>,
  ): ProcessWindowProcessSummary | null {
    if (!summary && !liveStatus) {
      return null;
    }

    const startedAt = liveStatus?.startedAt ?? summary?.startedAt;
    const completedAt = liveStatus?.completedAt ?? summary?.completedAt;
    const elapsedMs = typeof startedAt === 'number' && Number.isFinite(startedAt)
      ? Math.max(0, (completedAt ?? Date.now()) - startedAt)
      : summary?.elapsedMs;

    return {
      ...(summary ?? { processId: this.processId }),
      ...(liveStatus ?? {}),
      processId: this.processId,
      outputSessionId: liveStatus?.outputSessionId ?? summary?.outputSessionId ?? this.outputSessionId,
      outputFilePath: liveStatus?.outputFilePath ?? summary?.outputFilePath ?? this.outputFilePath,
      command: liveStatus?.command ?? summary?.command ?? this.command,
      startedAt,
      completedAt,
      elapsedMs,
      exitCode: typeof liveStatus?.exitCode === 'number'
        ? liveStatus.exitCode
        : summary?.exitCode,
    };
  }
}
