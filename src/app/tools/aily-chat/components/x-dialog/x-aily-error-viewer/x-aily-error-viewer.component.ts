import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  formatContinuationHardStopReason,
  formatContinuationStopReason,
} from '../../../core/continuation-stop-reason';

interface ErrorDiagnosticsRow {
  label: string;
  value: string;
}

@Component({
  selector: 'x-aily-error-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ac-error" [attr.data-sev]="data?.severity || 'error'">
      <div class="ac-error-header">
        <i class="fa-light" [class]="errorIconClass"></i>
        <span class="ac-error-title">
          {{ titleText }}
        </span>
        @if (data?.timestamp) {
          <span class="ac-error-time">{{ fmtTime(data.timestamp) }}</span>
        }
      </div>
      @if (displayMessage) {
        <p class="ac-error-msg">{{ displayMessage }}</p>
      }
      @if (diagnosticRows.length > 0) {
        <div class="ac-error-meta">
          @for (row of diagnosticRows; track row.label) {
            <div class="ac-error-meta-row">
              <span class="ac-error-meta-label">{{ row.label }}</span>
              <span class="ac-error-meta-value">{{ row.value }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .ac-error {
      border-radius: 5px; padding: 5px 10px; margin: 0;
      background-color: var(--aily-chat-viewer-error-surface-bg);
      color: var(--aily-chat-viewer-subtle);
      overflow: hidden; display: flex; flex-direction: column;
    }
    .ac-error-header {
      display: flex; align-items: center; gap: 5px;
      flex: 1; min-width: 0;
    }
    .ac-error-header i { flex-shrink: 0; font-size: 14px; color: var(--aily-chat-viewer-state-error); }
    .ac-error[data-sev="warning"] .ac-error-header i { color: var(--aily-chat-viewer-state-warn); }
    .ac-error[data-sev="info"] .ac-error-header i { color: var(--aily-chat-viewer-state-info); }
    .ac-error-title { flex: 1; font-size: 13px; color: var(--aily-chat-viewer-error-title); font-weight: 500; }
    .ac-error[data-sev="warning"] .ac-error-title { color: var(--aily-chat-viewer-error-title-warn); }
    .ac-error[data-sev="info"] .ac-error-title { color: var(--aily-chat-viewer-error-title-info); }
    .ac-error-time { font-size: 11px; color: var(--aily-chat-viewer-muted); flex-shrink: 0; }
    .ac-error-msg { padding: 6px 0 0 0; margin: 0; font-size: 12px; color: var(--aily-chat-viewer-muted); line-height: 1.6; width: 100%; white-space: pre-wrap; }
    .ac-error-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--aily-chat-viewer-border-soft);
    }
    .ac-error-meta-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      font-size: 11px;
      color: var(--aily-chat-viewer-muted);
    }
    .ac-error-meta-label {
      flex: 0 0 auto;
      color: var(--aily-chat-viewer-faint);
    }
    .ac-error-meta-value {
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
      color: var(--aily-chat-viewer-subtle);
    }
  `],
})
export class XAilyErrorViewerComponent {
  @Input() data: {
    severity?: string;
    message?: string;
    error?: { status?: number; message?: string };
    timestamp?: string;
    details?: unknown;
    metadata?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
  } | null = null;

  /** 优先使用顶层 message，其次 error.message */
  get displayMessage(): string {
    return this.data?.message ?? this.data?.error?.message ?? '';
  }

  get errorIconClass(): string {
    return this.data?.severity === 'warning'
      ? 'fa-triangle-exclamation'
      : this.data?.severity === 'info'
        ? 'fa-circle-info'
        : 'fa-circle-xmark';
  }

  get titleText(): string {
    return this.data?.severity === 'warning'
      ? '警告'
      : this.data?.severity === 'info'
        ? '信息'
        : (this.data?.error?.status ? `错误 ${this.data.error.status}` : '错误');
  }

  get diagnosticRows(): readonly ErrorDiagnosticsRow[] {
    const entries = [
      ...this.buildNoticeMetadataRows(this.data?.metadata),
      ...this.buildDiagnosticRows(this.data?.diagnostics ?? this.readNoticeDiagnostics(this.data?.metadata)),
    ];

    return entries
      .filter((entry): entry is [keyof typeof DIAGNOSTIC_LABELS, string] => {
        const value = entry[1];
        return typeof value === 'string' && value.length > 0;
      })
      .map(([key, value]) => ({ label: DIAGNOSTIC_LABELS[key], value }));
  }

  fmtTime(ts: string): string {
    try { return new Date(ts).toLocaleString('zh-CN'); } catch { return ts; }
  }

  private readDiagnosticSource(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private buildDiagnosticRows(source: Record<string, unknown> | null): Array<[keyof typeof DIAGNOSTIC_LABELS, string | undefined]> {
    if (!source) {
      return [];
    }

    return [
      ['interactionId', this.readText(source['interactionId'])],
      ['executionId', this.readText(source['executionId'])],
      ['requestId', this.readText(source['requestId'])],
      ['toolCallId', this.readText(source['toolCallId'])],
      ['stopReason', formatContinuationStopReason(this.readText(source['stopReason']))],
      ['hardStopReason', formatContinuationHardStopReason(this.readText(source['hardStopReason']))],
      ['status', this.readText(source['status'])],
      ['errorCode', this.readText(source['errorCode'])],
      ['sourceEvent', this.readText(source['sourceEvent'])],
      ['resolvedModel', this.readText(source['resolvedModel'])],
      ['modelBillingLabel', this.readText(source['modelBillingLabel'])],
      ['promptTokens', this.readText(source['promptTokens'])],
      ['completionTokens', this.readText(source['completionTokens'])],
      ['cacheReadTokens', this.readText(source['cacheReadTokens'])],
      ['cacheCreationTokens', this.readText(source['cacheCreationTokens'])],
      ['repeatedTextScore', this.readText(source['repeatedTextScore'])],
      ['repeatedChunkStreak', this.readText(source['repeatedChunkStreak'])],
      ['noProgressRounds', this.readText(source['noProgressRounds'])],
      ['repeatedToolCallStreak', this.readText(source['repeatedToolCallStreak'])],
      ['repeatedPendingStreak', this.readText(source['repeatedPendingStreak'])],
      ['syncConflictStreak', this.readText(source['syncConflictStreak'])],
      ['pendingInterruptions', this.readText(source['pendingInterruptions'])],
      ['pendingReplyOscillationCount', this.readText(source['pendingReplyOscillationCount'])],
      ['sameToolFingerprintCount', this.readText(source['sameToolFingerprintCount'])],
      ['samePendingFingerprintCount', this.readText(source['samePendingFingerprintCount'])],
      ['lastProgressAtRound', this.readText(source['lastProgressAtRound'])],
    ];
  }

  private buildNoticeMetadataRows(metadata: unknown): Array<[keyof typeof DIAGNOSTIC_LABELS, string | undefined]> {
    const source = this.readDiagnosticSource(metadata);
    const details = this.readDiagnosticSource(source?.['details']);
    const categories = Array.isArray(details?.['categories'])
      ? details?.['categories'].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    return [
      ['noticeCode', this.readText(source?.['code'])],
      ['noticeAction', this.readText(details?.['action'])],
      ['noticeCategories', categories.length > 0 ? categories.join(', ') : undefined],
      ['stopReason', formatContinuationStopReason(this.readText(details?.['stopReason']))],
    ];
  }

  private readNoticeDiagnostics(metadata: unknown): Record<string, unknown> | null {
    const source = this.readDiagnosticSource(metadata);
    const details = this.readDiagnosticSource(source?.['details']);
    return this.readDiagnosticSource(details?.['diagnostics']);
  }

  private readText(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${value}`;
    }
    return undefined;
  }
}

const DIAGNOSTIC_LABELS = {
  noticeCode: 'noticeCode',
  noticeAction: 'noticeAction',
  noticeCategories: 'noticeCategories',
  interactionId: 'interactionId',
  executionId: 'executionId',
  requestId: 'requestId',
  toolCallId: 'toolCallId',
  stopReason: 'stopReason',
  hardStopReason: 'hardStopReason',
  status: 'status',
  errorCode: 'errorCode',
  sourceEvent: 'sourceEvent',
  resolvedModel: 'resolvedModel',
  modelBillingLabel: 'modelBillingLabel',
  promptTokens: 'promptTokens',
  completionTokens: 'completionTokens',
  cacheReadTokens: 'cacheReadTokens',
  cacheCreationTokens: 'cacheCreationTokens',
  repeatedTextScore: 'repeatedTextScore',
  repeatedChunkStreak: 'repeatedChunkStreak',
  noProgressRounds: 'noProgressRounds',
  repeatedToolCallStreak: 'repeatedToolCallStreak',
  repeatedPendingStreak: 'repeatedPendingStreak',
  syncConflictStreak: 'syncConflictStreak',
  pendingInterruptions: 'pendingInterruptions',
  pendingReplyOscillationCount: 'pendingReplyOscillationCount',
  sameToolFingerprintCount: 'sameToolFingerprintCount',
  samePendingFingerprintCount: 'samePendingFingerprintCount',
  lastProgressAtRound: 'lastProgressAtRound',
} as const;
