import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import type { ChatSessionInventoryGroup } from '../helpers/chat-session-presentation';
import type { ChatSessionListItem } from '../services/menu-manager.service';
import { ChatSessionEntriesComponent } from './chat-session-entries.component';

@Component({
  selector: 'aily-chat-session-list',
  standalone: true,
  imports: [CommonModule, ChatSessionEntriesComponent],
  templateUrl: './chat-session-list.component.html',
  styleUrl: './chat-session-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatSessionListComponent {
  @Input() groups: readonly ChatSessionInventoryGroup[] = [];
  @Input() items: readonly ChatSessionListItem[] = [];
  @Input() selectedSessionId = '';
  @Input() title = 'Sessions';
  @Input() emptyLabel = 'No sessions';
  @Input() showNewSession = false;
  @Input() variant: 'sidebar' | 'entry' = 'sidebar';

  @Output() selectSession = new EventEmitter<{ sessionId: string; item: ChatSessionListItem }>();
  @Output() actionClick = new EventEmitter<{ action: string; data: ChatSessionListItem }>();
  @Output() newSession = new EventEmitter<void>();

  requestNewSession(): void {
    this.newSession.emit();
  }
}