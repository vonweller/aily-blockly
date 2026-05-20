import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import type { ImportedDebugSessionViewModel } from '../../helpers/chat-debug-viewer-state';
import { buildHostSessionDebugEventSummary, type HostSessionDebugEvent } from '../../services/host-session-debug-events';
import type { ImportedDebugResourceSummary } from '../../services/chat-debug-browser.service';
import { AilyChatDebugBreadcrumbComponent } from '../aily-chat-debug-breadcrumb/aily-chat-debug-breadcrumb.component';

@Component({
  selector: 'aily-chat-debug-viewer',
  standalone: true,
  imports: [CommonModule, AilyChatDebugBreadcrumbComponent],
  templateUrl: './aily-chat-debug-viewer.component.html',
  styleUrl: './aily-chat-debug-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AilyChatDebugViewerComponent {
  @Input({ required: true }) session!: ImportedDebugResourceSummary;
  @Input({ required: true }) view!: ImportedDebugSessionViewModel;
  @Input() debugEvents: readonly HostSessionDebugEvent[] = [];
  @Output() homeRequested = new EventEmitter<void>();
  @Output() logsRequested = new EventEmitter<void>();
  @Output() flowRequested = new EventEmitter<void>();
  @Output() cacheRequested = new EventEmitter<void>();
  @Output() closeRequested = new EventEmitter<void>();

  readonly sessionDetails = [{
    label: '会话类型',
    value: '导入调试快照',
  }];

  get debugSummary() {
    return buildHostSessionDebugEventSummary(this.debugEvents);
  }

  get summaryMetrics() {
    const summary = this.debugSummary;
    return [
      { label: '模型轮次', value: String(summary.modelTurnCount) },
      { label: '工具调用', value: String(summary.toolCallCount) },
      { label: '输入 Tokens', value: String(summary.totalInputTokens) },
      { label: '输出 Tokens', value: String(summary.totalOutputTokens) },
      { label: '缓存 Tokens', value: String(summary.totalCachedTokens) },
      { label: '总 Tokens', value: String(summary.totalInputTokens + summary.totalOutputTokens) },
      { label: '错误事件', value: String(summary.errorCount) },
    ];
  }
}