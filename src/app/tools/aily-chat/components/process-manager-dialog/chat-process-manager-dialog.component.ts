import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';

import { BaseDialogComponent } from '../../../../components/base-dialog/base-dialog.component';
import { ChatProcessDetailPanelComponent } from '../process-detail-panel/chat-process-detail-panel.component';
import type { ChatRuntimeHostSessionProcessSummary } from '../../core/chat-runtime-host-contract';
import {
  deleteBlocklyCommandSession,
  getBlocklyCommandSessionStatus,
  listPersistedBlocklyCommandSessionSnapshots,
  listPersistedBlocklyProjectCommandSessionSnapshots,
  purgeBlocklyCommandSession,
  subscribeBlocklyCommandSessionUpdates,
} from '../../helpers/lex-agent-bootstrap';
import { openChatProcessWindow, readChatProcessOutputFile } from '../../helpers/chat-process-window';
import { ChatHistoryService } from '../../services/chat-history.service';
import { ChatRuntimeInteractionHostService } from '../../services/chat-runtime-interaction-host.service';

type ProcessFilter = 'all' | 'running' | 'background' | 'completed' | 'failed' | 'removed';

interface ChatProcessManagerDialogData {
  readonly sessionId?: string;
  readonly projectPath?: string;
}

@Component({
  selector: 'app-chat-process-manager-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, NzPopconfirmModule, BaseDialogComponent, ChatProcessDetailPanelComponent],
  templateUrl: './chat-process-manager-dialog.component.html',
  styleUrl: './chat-process-manager-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatProcessManagerDialogComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly modalRef = inject(NzModalRef);
  private readonly data = inject<ChatProcessManagerDialogData>(NZ_MODAL_DATA);
  private readonly runtimeInteractionHost = inject(ChatRuntimeInteractionHostService);
  private readonly chatHistoryService = inject(ChatHistoryService);
  private readonly translate = inject(TranslateService);

  readonly sessionId = typeof this.data.sessionId === 'string' ? this.data.sessionId.trim() : '';
  readonly projectPath = typeof this.data.projectPath === 'string' ? this.data.projectPath.trim() : '';

  selectedFilter: ProcessFilter = 'all';
  selectedProcessId = '';

  processes: readonly ChatRuntimeHostSessionProcessSummary[] = [];
  selectedProcessOutput = '';
  selectedProcessStatusLabel = '';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.refreshProcesses();
    const subscription = subscribeBlocklyCommandSessionUpdates((sessionId) => {
      if (!this.sessionId || sessionId === this.sessionId) {
        this.refreshProcesses();
      }
    });
    this.startPolling();
    this.destroyRef.onDestroy(() => {
      subscription.dispose();
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    });
  }

  closeDialog(): void {
    this.modalRef.close(true);
  }

  updateFilter(value: string): void {
    const nextFilter = this.normalizeFilter(value);
    if (this.selectedFilter === nextFilter) {
      return;
    }
    this.selectedFilter = nextFilter;
    if (!this.filteredProcesses.some(process => process.processId === this.selectedProcessId)) {
      this.selectedProcessId = this.filteredProcesses[0]?.processId ?? '';
    }
    void this.refreshSelectedProcessDetail();
  }

  selectProcess(processId: string): void {
    if (!processId || this.selectedProcessId === processId) {
      return;
    }
    this.selectedProcessId = processId;
    void this.refreshSelectedProcessDetail();
  }

  openProcessWindow(process: ChatRuntimeHostSessionProcessSummary): void {
    openChatProcessWindow({
      sessionId: process.sessionId,
      processId: process.processId,
      outputSessionId: process.outputSessionId,
      outputFilePath: process.outputFilePath,
      command: process.command,
    });
  }

  async stopProcess(process: ChatRuntimeHostSessionProcessSummary): Promise<void> {
    if (!process.running) {
      return;
    }
    await this.runtimeInteractionHost.requestCommandSessionAction(process.sessionId || this.sessionId, {
      actionId: 'stop',
      processId: process.processId,
      outputSessionId: process.outputSessionId,
      outputFilePath: process.outputFilePath,
    });
    this.refreshProcesses();
  }

  deleteProcess(process: ChatRuntimeHostSessionProcessSummary): void {
    deleteBlocklyCommandSession(process.processId, process.sessionId || this.sessionId);
    if (this.selectedProcessId === process.processId) {
      this.selectedProcessId = '';
    }
    this.refreshProcesses();
  }

  hardDeleteProcess(process: ChatRuntimeHostSessionProcessSummary): void {
    purgeBlocklyCommandSession(process.processId, process.sessionId || this.sessionId);
    if (this.selectedProcessId === process.processId) {
      this.selectedProcessId = '';
    }
    this.refreshProcesses();
  }

  trackByProcessId(_: number, process: ChatRuntimeHostSessionProcessSummary): string {
    return process.processId;
  }

  get filteredProcesses(): readonly ChatRuntimeHostSessionProcessSummary[] {
    switch (this.selectedFilter) {
      case 'running':
        return this.processes.filter(process => process.removed !== true && process.running);
      case 'background':
        return this.processes.filter(process => process.removed !== true && process.running && process.background === true);
      case 'completed':
        return this.processes.filter(process => process.removed !== true && !process.running && process.status === 'completed');
      case 'failed':
        return this.processes.filter(process =>
          process.removed !== true && !process.running && process.status !== 'completed',
        );
      case 'removed':
        return this.processes.filter(process => process.removed === true);
      case 'all':
      default:
        return this.processes.filter(process => process.removed !== true);
    }
  }

  get selectedProcess(): ChatRuntimeHostSessionProcessSummary | null {
    const selected = this.filteredProcesses.find(process => process.processId === this.selectedProcessId);
    return selected ?? this.filteredProcesses[0] ?? null;
  }

  formatElapsed(process: ChatRuntimeHostSessionProcessSummary): string {
    const totalSeconds = Math.max(0, Math.floor(process.elapsedMs / 1000));
    if (totalSeconds < 60) {
      return this.translate.instant('AILY_CHAT.PROCESS_DURATION_SECONDS', { count: totalSeconds });
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return this.translate.instant('AILY_CHAT.PROCESS_DURATION_MINUTES_SECONDS', { minutes, seconds });
  }

  summarizeStatus(process: ChatRuntimeHostSessionProcessSummary): string {
    const rawStatus = typeof process.status === 'string' && process.status.trim()
      ? process.status.trim()
      : 'unknown';
    if (process.running) {
      return this.translate.instant(
        process.background
          ? 'AILY_CHAT.PROCESS_STATUS_BACKGROUND'
          : 'AILY_CHAT.PROCESS_STATUS_RUNNING',
      );
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

  resolveStatusTone(process: ChatRuntimeHostSessionProcessSummary): 'info' | 'success' | 'error' | 'neutral' {
    if (process.running) {
      return process.background ? 'neutral' : 'info';
    }
    if (typeof process.exitCode === 'number' && process.exitCode !== 0) {
      return 'error';
    }
    if (process.status === 'completed') {
      return 'success';
    }
    return 'neutral';
  }

  private refreshProcesses(): void {
    const snapshot = this.sessionId
      ? this.runtimeInteractionHost.readSnapshot(this.sessionId)
      : null;
    const liveProcesses = Array.isArray(snapshot?.processes) ? snapshot.processes : [];
    const projectPathHint = this.projectPath || this.chatHistoryService.findEntry(this.sessionId)?.projectPath || null;
    const persistedProcesses = this.sessionId
      ? listPersistedBlocklyCommandSessionSnapshots(this.sessionId, projectPathHint)
      : listPersistedBlocklyProjectCommandSessionSnapshots(projectPathHint);
    const nextProcesses = this.mergeProcessSummaries(liveProcesses, persistedProcesses);
    this.processes = nextProcesses;
    const nextFilteredProcesses = this.filteredProcesses;
    if (!this.selectedProcessId || !nextFilteredProcesses.some(process => process.processId === this.selectedProcessId)) {
      this.selectedProcessId = nextFilteredProcesses[0]?.processId ?? '';
    }
    this.cdr.markForCheck();
    void this.refreshSelectedProcessDetail();
  }

  private async refreshSelectedProcessDetail(): Promise<void> {
    const process = this.selectedProcess;
    if (!process) {
      this.selectedProcessOutput = '';
      this.selectedProcessStatusLabel = '';
      this.cdr.markForCheck();
      return;
    }

    const snapshot = await getBlocklyCommandSessionStatus(process.processId);
    this.selectedProcessOutput = readChatProcessOutputFile(process.outputFilePath)
      || snapshot?.stdout
      || '';
    this.selectedProcessStatusLabel = snapshot?.status
      ? this.summarizeStatus({
          ...process,
          running: snapshot.running === true,
          status: snapshot.status,
          exitCode: typeof snapshot.exitCode === 'number' ? snapshot.exitCode : process.exitCode,
          elapsedMs: Math.max(0, (snapshot.completedAt ?? Date.now()) - snapshot.startedAt),
        })
      : this.summarizeStatus(process);
    this.cdr.markForCheck();
  }

  private startPolling(): void {
    this.refreshTimer = setInterval(() => {
      this.refreshProcesses();
    }, 1000);
  }

  private mergeProcessSummaries(
    liveProcesses: readonly ChatRuntimeHostSessionProcessSummary[],
    persistedProcesses: readonly ChatRuntimeHostSessionProcessSummary[],
  ): readonly ChatRuntimeHostSessionProcessSummary[] {
    const merged = new Map<string, ChatRuntimeHostSessionProcessSummary>();
    for (const process of persistedProcesses) {
      merged.set(process.processId, process);
    }
    for (const process of liveProcesses) {
      const existing = merged.get(process.processId);
      merged.set(process.processId, existing
        ? {
            ...existing,
            ...process,
            outputFilePath: process.outputFilePath ?? existing.outputFilePath,
          }
        : process);
    }
    return [...merged.values()].sort((left, right) => right.startedAt - left.startedAt);
  }

  private normalizeFilter(value: string): ProcessFilter {
    switch (value) {
      case 'running':
      case 'background':
      case 'completed':
      case 'failed':
      case 'removed':
        return value;
      default:
        return 'all';
    }
  }
}
