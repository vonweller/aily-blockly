import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import type { ImportedDebugSessionViewModel } from '../../helpers/chat-debug-viewer-state';
import { buildHostSessionDebugEventSummary, type HostSessionDebugEvent } from '../../services/host-session-debug-events';
import { XDialogComponent } from '../x-dialog/x-dialog.component';

@Component({
  selector: 'aily-chat-debug-viewer',
  standalone: true,
  imports: [CommonModule, XDialogComponent],
  templateUrl: './aily-chat-debug-viewer.component.html',
  styleUrl: './aily-chat-debug-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AilyChatDebugViewerComponent {
  @Input({ required: true }) view!: ImportedDebugSessionViewModel;
  @Input() debugEvents: readonly HostSessionDebugEvent[] = [];
  @Output() homeRequested = new EventEmitter<void>();
  @Output() logsRequested = new EventEmitter<void>();
  @Output() flowRequested = new EventEmitter<void>();
  @Output() cacheRequested = new EventEmitter<void>();
  @Output() closeRequested = new EventEmitter<void>();

  get debugSummary() {
    return buildHostSessionDebugEventSummary(this.debugEvents);
  }
}