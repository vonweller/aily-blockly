import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AILY_CONFIRMATION_RESULT_EVENT } from '../../helpers/interaction-events';

export interface AilyConfirmationData {
  type: 'aily-confirmation';
  partId?: string;
  askId?: string;
  toolCallId?: string;
  toolName?: string;
  title?: string;
  message?: string;
  args?: any;
  /** 审批是否已完成 */
  resolved?: boolean;
  /** 用户是否批准 */
  approved?: boolean;
}

@Component({
  selector: 'app-aily-confirmation-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aily-approval-viewer.component.html',
  styleUrls: ['./aily-approval-viewer.component.scss']
})
export class AilyConfirmationViewerComponent implements OnInit {
  @Input() data: AilyConfirmationData | null = null;

  partId = '';
  askId = '';
  toolCallId = '';
  toolName = '';
  title = '确认操作';
  message = '';
  resolved = false;
  approved = false;

  ngOnInit() {
    this.processData();
  }

  setData(data: AilyConfirmationData): void {
    this.data = data;
    this.processData();
  }

  processData(): void {
    if (!this.data) return;
    this.partId = this.data.partId || '';
    this.askId = this.data.askId || '';
    this.toolCallId = this.data.toolCallId || '';
    this.toolName = this.data.toolName || '';
    this.title = this.data.title || '确认操作';
    this.message = this.data.message || '';
    this.resolved = !!this.data.resolved;
    this.approved = !!this.data.approved;
  }

  approve(): void {
    this.resolved = true;
    this.approved = true;
    document.dispatchEvent(new CustomEvent(AILY_CONFIRMATION_RESULT_EVENT, {
      detail: this.toolCallId
        ? { toolCallId: this.toolCallId, approved: true }
        : { askId: this.askId, partId: this.partId, approved: true }
    }));
  }

  reject(): void {
    this.resolved = true;
    this.approved = false;
    document.dispatchEvent(new CustomEvent(AILY_CONFIRMATION_RESULT_EVENT, {
      detail: this.toolCallId
        ? { toolCallId: this.toolCallId, approved: false, reason: '用户拒绝执行' }
        : { askId: this.askId, partId: this.partId, approved: false, reason: '用户拒绝执行' }
    }));
  }

  logDetail(): void {
    // Intentionally quiet: chat renderers must not dump large payloads to DevTools.
  }
}
