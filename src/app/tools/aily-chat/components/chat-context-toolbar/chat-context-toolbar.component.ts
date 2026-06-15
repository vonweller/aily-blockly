import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostBinding,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';

export type ChatContextToolbarAppearance = 'edit' | 'composer';

@Component({
  selector: 'aily-chat-context-toolbar',
  standalone: true,
  imports: [CommonModule, TranslateModule, NzToolTipModule],
  templateUrl: './chat-context-toolbar.component.html',
  styleUrl: './chat-context-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatContextToolbarComponent {
  @Input() appearance: ChatContextToolbarAppearance = 'composer';
  @Input() showAddList = false;
  @Input() currentMode = 'agent';
  @Input() currentCustomAgentTarget: string | undefined;
  @Input() showModelChip = false;
  @Input() showModeLabel = true;
  @Input() modelChipLabel = '';
  @Input() modelBillingLabel = '';

  @Output() toggleAddList = new EventEmitter<void>();
  @Output() addFile = new EventEmitter<void>();
  @Output() addFolder = new EventEmitter<void>();
  @Output() modeClick = new EventEmitter<MouseEvent>();
  @Output() modelClick = new EventEmitter<MouseEvent>();

  @HostBinding('class.acc-host--edit')
  get isEditAppearance(): boolean {
    return this.appearance === 'edit';
  }

  @HostBinding('class.acc-host--composer')
  get isComposerAppearance(): boolean {
    return this.appearance === 'composer';
  }

  get modeIconClass(): string {
    if (this.currentCustomAgentTarget && this.currentMode === 'agent') {
      return 'fa-light fa-user-astronaut';
    }

    switch (this.currentMode) {
      case 'edit':
        return 'fa-light fa-pen-line';
      case 'ask':
        return 'fa-light fa-comment-smile';
      default:
        return 'fa-light fa-user-astronaut';
    }
  }

  get modeLabelKey(): string | undefined {
    if (this.currentCustomAgentTarget && this.currentMode === 'agent') {
      return undefined;
    }

    switch (this.currentMode) {
      case 'edit':
        return 'AILY_CHAT.MODE_EDIT';
      case 'ask':
        return 'AILY_CHAT.MODE_QA';
      default:
        return 'AILY_CHAT.MODE_AGENT';
    }
  }
}
