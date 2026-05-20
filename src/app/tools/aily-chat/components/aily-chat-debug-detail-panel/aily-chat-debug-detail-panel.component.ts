import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';

import {
  getHostSessionDebugEventDetails,
  getHostSessionDebugEventTitle,
  type HostSessionDebugEvent,
  type HostSessionDebugResolvedEventContent,
  type HostSessionDebugResolvedMessageContent,
  type HostSessionDebugResolvedModelTurnContent,
  type HostSessionDebugResolvedTextContent,
  type HostSessionDebugResolvedToolCallContent,
} from '../../services/host-session-debug-events';

@Component({
  selector: 'aily-chat-debug-detail-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aily-chat-debug-detail-panel.component.html',
  styleUrl: './aily-chat-debug-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AilyChatDebugDetailPanelComponent {
  @ViewChild('panelRoot') private panelRoot?: ElementRef<HTMLElement>;
  @Input() event: HostSessionDebugEvent | null = null;
  @Input() resolvedContent: HostSessionDebugResolvedEventContent | null = null;
  @Input() titleOverride: string | null = null;
  @Output() closeRequested = new EventEmitter<void>();

  get isVisible(): boolean {
    return Boolean(this.event || this.resolvedContent);
  }

  focus(): void {
    this.panelRoot?.nativeElement.focus();
  }

  get title(): string {
    if (this.titleOverride) {
      return this.titleOverride;
    }

    return this.event ? getHostSessionDebugEventTitle(this.event) : '事件详情';
  }

  get summary(): string | undefined {
    return this.event ? getHostSessionDebugEventDetails(this.event) : undefined;
  }

  get messageContent(): HostSessionDebugResolvedMessageContent | null {
    return this.resolvedContent?.kind === 'message' ? this.resolvedContent : null;
  }

  get toolCallContent(): HostSessionDebugResolvedToolCallContent | null {
    return this.resolvedContent?.kind === 'toolCall' ? this.resolvedContent : null;
  }

  get modelTurnContent(): HostSessionDebugResolvedModelTurnContent | null {
    return this.resolvedContent?.kind === 'modelTurn' ? this.resolvedContent : null;
  }

  get textContent(): HostSessionDebugResolvedTextContent | null {
    return this.resolvedContent?.kind === 'text' ? this.resolvedContent : null;
  }
}