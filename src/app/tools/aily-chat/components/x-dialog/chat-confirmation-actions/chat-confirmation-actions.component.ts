import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ChatConfirmationActionOption {
  value: string;
  label: string;
  tooltip?: string;
  disabled?: boolean;
  isSecondary?: boolean;
}

@Component({
  selector: 'aily-chat-confirmation-actions',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cca-actions">
      <div class="cca-split-btn">
        <button
          class="cca-btn-primary"
          [class.cca-btn-primary-standalone]="!hasMoreActions"
          [title]="primaryTooltip"
          [disabled]="primaryDisabled"
          (click)="approve.emit(primaryValue)"
        >{{ primaryLabel }}</button>
        @if (hasMoreActions) {
          <button class="cca-btn-caret" #caretBtn [title]="moreActionsTooltip" (click)="toggleDropdown($event)">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        }
        @if (dropdownOpen && hasMoreActions) {
          <div class="cca-dropdown" [style.top.px]="dropdownTop" [style.left.px]="dropdownLeft">
            @for (option of options; track option.value) {
              <button
                class="cca-dropdown-item"
                [class.cca-dropdown-item-secondary]="option.isSecondary"
                [disabled]="!!option.disabled"
                [title]="option.tooltip || option.label"
                (click)="selectOption(option)"
              >{{ option.label }}</button>
            }
          </div>
        }
      </div>
      <button class="cca-btn-reject" [title]="rejectTooltip" (click)="reject.emit()">{{ rejectLabel }}</button>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }
    .cca-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .cca-split-btn {
      display: flex;
      position: relative;
    }
    .cca-btn-primary {
      min-height: 22px;
      padding: 0 10px;
      border-radius: 6px 0 0 6px;
      font-size: 12px;
      font-weight: 400;
      line-height: 1.2;
      background: #0e639c;
      color: #ffffff;
      border: 1px solid transparent;
      outline: none;
      cursor: pointer;
      transition: background 0.15s;
    }
    .cca-btn-primary-standalone {
      border-radius: 6px;
    }
    .cca-btn-primary:hover { background: #1177bb; }
    .cca-btn-primary:disabled {
      background: color-mix(in srgb, #0e639c 40%, transparent);
      color: rgba(255,255,255,0.7);
      cursor: not-allowed;
    }
    .cca-btn-caret {
      min-height: 22px;
      width: 22px;
      padding: 0;
      border-radius: 0 6px 6px 0;
      font-size: 11px;
      background: #0e639c;
      color: #ffffff;
      border: 1px solid transparent;
      border-left: 1px solid rgba(255,255,255,0.2);
      outline: none;
      cursor: pointer;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cca-btn-caret:hover { background: #1177bb; }
    .cca-btn-caret:disabled {
      background: color-mix(in srgb, #0e639c 40%, transparent);
      color: rgba(255,255,255,0.7);
      cursor: not-allowed;
    }
    .cca-dropdown {
      position: fixed;
      background: #252526;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      z-index: 9999;
      min-width: 220px;
      padding: 4px;
      overflow: hidden;
    }
    .cca-dropdown-item {
      display: block;
      width: 100%;
      padding: 7px 10px;
      font-size: 12px;
      color: #e5e7eb;
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s;
      border-radius: 4px;
      line-height: 1.35;
    }
    .cca-dropdown-item-secondary {
      color: #cbd5e1;
    }
    .cca-dropdown-item:hover { background: rgba(255,255,255,0.06); color: #e0e0e0; }
    .cca-dropdown-item:disabled {
      opacity: 0.48;
      cursor: not-allowed;
    }
    .cca-dropdown-item:disabled:hover {
      background: transparent;
      color: #e5e7eb;
    }
    .cca-btn-reject {
      min-height: 22px;
      padding: 0 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 400;
      background: transparent;
      color: var(--chat-fg-dim, #8e8e8e);
      border: 1px solid rgba(255,255,255,0.08);
      outline: none;
      cursor: pointer;
      transition: all 0.15s;
    }
    .cca-btn-reject:hover { color: var(--chat-fg, #cccccc); border-color: rgba(255,255,255,0.16); background: rgba(255,255,255,0.03); }
  `],
})
export class ChatConfirmationActionsComponent {
  @Input() primaryLabel = '允许';
  @Input() primaryValue = 'once';
  @Input() primaryTooltip = '';
  @Input() primaryDisabled = false;
  @Input() moreActionsTooltip = '显示更多允许选项';
  @Input() rejectLabel = '跳过';
  @Input() rejectTooltip = '继续当前对话，但不执行此操作';
  @Input() options: readonly ChatConfirmationActionOption[] = [];

  @Output() approve = new EventEmitter<string>();
  @Output() reject = new EventEmitter<void>();

  @ViewChild('caretBtn', { static: false }) caretBtn?: ElementRef<HTMLButtonElement>;

  dropdownOpen = false;
  dropdownTop = 0;
  dropdownLeft = 0;

  constructor(private cdr: ChangeDetectorRef, private elRef: ElementRef) {}

  get hasMoreActions(): boolean {
    return this.options.length > 0;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.dropdownOpen && !this.elRef.nativeElement.contains(event.target)) {
      this.dropdownOpen = false;
      this.cdr.markForCheck();
    }
  }

  toggleDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.dropdownOpen = !this.dropdownOpen;
    if (this.dropdownOpen && this.caretBtn) {
      const rect = this.caretBtn.nativeElement.getBoundingClientRect();
      this.dropdownTop = rect.bottom + 4;
      this.dropdownLeft = rect.left;
    }
    this.cdr.markForCheck();
  }

  selectOption(option: ChatConfirmationActionOption): void {
    if (option.disabled) {
      return;
    }

    this.dropdownOpen = false;
    this.cdr.markForCheck();
    this.approve.emit(option.value);
  }
}