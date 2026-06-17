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
import type { ChatSelectedMode } from '../../core/chat-mode';

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
  @Input() selectedMode: Pick<ChatSelectedMode, 'modeId' | 'customAgentTarget'> | null | undefined;
  @Input() showModelChip = false;
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
    if (this.effectiveCustomAgentTarget && this.effectiveModeId === 'agent') {
      return 'fa-light fa-user-astronaut';
    }

    switch (this.effectiveModeId) {
      case 'edit':
        return 'fa-light fa-pen-line';
      case 'ask':
        return 'fa-light fa-comment-smile';
      case 'plan':
        return 'fa-light fa-list-check';
      default:
        return 'fa-light fa-user-astronaut';
    }
  }

  get displayCustomAgentTarget(): string | undefined {
    return this.effectiveModeId === 'agent' ? this.effectiveCustomAgentTarget : undefined;
  }

  get modeLabelKey(): string | undefined {
    if (this.displayCustomAgentTarget) {
      return undefined;
    }

    switch (this.effectiveModeId) {
      case 'edit':
        return 'AILY_CHAT.MODE_EDIT';
      case 'ask':
        return 'AILY_CHAT.MODE_QA';
      case 'plan':
        return undefined;
      default:
        return 'AILY_CHAT.MODE_AGENT';
    }
  }

  get modePlainLabel(): string | undefined {
    if (this.displayCustomAgentTarget || this.modeLabelKey) {
      return undefined;
    }

    return this.effectiveModeId === 'plan' ? 'Plan' : undefined;
  }

  private get effectiveModeId(): string {
    const selectedModeId = typeof this.selectedMode?.modeId === 'string'
      ? this.selectedMode.modeId.trim()
      : '';
    return selectedModeId || this.currentMode || 'agent';
  }

  private get effectiveCustomAgentTarget(): string | undefined {
    const selectedCustomAgentTarget = typeof this.selectedMode?.customAgentTarget === 'string'
      ? this.selectedMode.customAgentTarget.trim()
      : '';
    const currentCustomAgentTarget = typeof this.currentCustomAgentTarget === 'string'
      ? this.currentCustomAgentTarget.trim()
      : '';
    return selectedCustomAgentTarget || currentCustomAgentTarget || undefined;
  }
}
