import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import type { ImportedDebugSessionRecord } from '../../services/chat-history.service';

@Component({
  selector: 'aily-chat-debug-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aily-chat-debug-home.component.html',
  styleUrl: './aily-chat-debug-home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AilyChatDebugHomeComponent {
  @Input() sessions: readonly ImportedDebugSessionRecord[] = [];
  @Input() activeSessionId: string | null = null;

  @Output() closeRequested = new EventEmitter<void>();
  @Output() importRequested = new EventEmitter<void>();
  @Output() sessionRequested = new EventEmitter<string>();
}