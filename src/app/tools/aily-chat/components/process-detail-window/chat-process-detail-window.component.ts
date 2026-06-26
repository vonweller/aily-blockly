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
import { readChatProcessOutputFile } from '../../helpers/chat-process-window';
import { listPersistedBlocklyCommandSessionSnapshots } from '../../helpers/lex-agent-bootstrap';
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
    private readonly chatHistoryService: ChatHistoryService,
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

  get displayStatus(): string {
    const summary = this.summary;
    if (!summary) {
      return '-';
    }
    const rawStatus = typeof summary.status === 'string' && summary.status.trim()
      ? summary.status.trim()
      : 'unknown';
    if (summary.running === true) {
      return '执行中';
    }
    if (rawStatus === 'completed') {
      return '已完成';
    }
    if (rawStatus === 'failed') {
      return '失败';
    }
    if (rawStatus === 'timeout') {
      return '失败 · 超时';
    }
    if (rawStatus === 'killed') {
      return '已终止 · 手动停止';
    }
    if (rawStatus === 'cancelled') {
      return '已取消 · 用户取消';
    }
    return '失败';
  }

  private describeStatusReason(status: string): string {
    switch (status) {
      case 'running':
        return '运行中';
      case 'completed':
        return '正常结束';
      case 'failed':
        return '执行失败';
      case 'timeout':
        return '超时';
      case 'killed':
        return '手动停止';
      case 'cancelled':
        return '用户取消';
      default:
        return '未知状态';
    }
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
}
