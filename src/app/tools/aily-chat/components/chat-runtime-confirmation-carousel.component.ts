import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatRuntimeInteractionHostService, type RuntimeConfirmationDecision } from '../services/chat-runtime-interaction-host.service';
import { XAilyConfirmationViewerComponent } from './x-dialog/x-aily-confirmation-viewer/x-aily-confirmation-viewer.component';

@Component({
  selector: 'aily-chat-runtime-confirmation-carousel',
  standalone: true,
  imports: [CommonModule, XAilyConfirmationViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (activeConfirmation; as active) {
      <div class="rtc-shell">
        <div class="rtc-header">
          <div class="rtc-title-group">
            <div class="rtc-title">{{ active.kind === 'approval' ? '工具审批' : '确认请求' }}</div>
            @if (queue.length > 1) {
              <div class="rtc-step">{{ activeIndex + 1 }}/{{ queue.length }}</div>
            }
          </div>
          @if (queue.length > 1) {
            <div class="rtc-nav">
              <button type="button" class="rtc-nav-btn" (click)="navigate(-1)" aria-label="上一个确认">
                <i class="fa-light fa-chevron-left"></i>
              </button>
              <button type="button" class="rtc-nav-btn" (click)="navigate(1)" aria-label="下一个确认">
                <i class="fa-light fa-chevron-right"></i>
              </button>
            </div>
          }
        </div>

        <x-aily-confirmation-viewer
          class="rtc-viewer"
          [data]="active.data"
          [interactive]="true"
          (decision)="onDecision($event)" />
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .rtc-shell {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0 0 8px;
      padding: 8px;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      background: rgba(255,255,255,0.03);
    }

    .rtc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .rtc-title-group {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .rtc-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--chat-fg, #cccccc);
    }

    .rtc-step {
      font-size: 11px;
      color: var(--chat-fg-dim, #8e8e8e);
    }

    .rtc-nav {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .rtc-nav-btn {
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--chat-fg-dim, #8e8e8e);
      cursor: pointer;
    }

    .rtc-nav-btn:hover {
      background: rgba(255,255,255,0.05);
      color: var(--chat-fg, #cccccc);
    }

    .rtc-viewer {
      margin: 0;
    }
  `],
})
export class ChatRuntimeConfirmationCarouselComponent {
  @Input() sessionId = '';

  private readonly runtimeHost = inject(ChatRuntimeInteractionHostService);

  get queue() {
    return this.sessionId ? this.runtimeHost.getConfirmationQueue(this.sessionId) : [];
  }

  get activeIndex(): number {
    return this.sessionId ? this.runtimeHost.getActiveConfirmationIndex(this.sessionId) : 0;
  }

  get activeConfirmation() {
    return this.sessionId ? this.runtimeHost.getActiveConfirmation(this.sessionId) : null;
  }

  navigate(delta: number): void {
    if (!this.sessionId) {
      return;
    }

    this.runtimeHost.navigateConfirmation(this.sessionId, delta);
  }

  onDecision(decision: RuntimeConfirmationDecision): void {
    const active = this.activeConfirmation;
    if (!active || !this.sessionId) {
      return;
    }

    if (decision.sideEffectOnly && typeof decision.actionId === 'string' && decision.actionId.length > 0) {
      this.runtimeHost.triggerConfirmationAction(this.sessionId, active.id, decision.actionId);
      return;
    }

    if (active.toolCallId) {
      this.runtimeHost.resolveToolApproval(this.sessionId, active.toolCallId, decision);
      return;
    }

    this.runtimeHost.resolveConfirmation(this.sessionId, active.id, decision);
  }
}