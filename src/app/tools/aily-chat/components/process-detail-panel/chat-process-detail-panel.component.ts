import {
  AfterViewInit,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  inject,
  OnDestroy,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-chat-process-detail-panel',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './chat-process-detail-panel.component.html',
  styleUrl: './chat-process-detail-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatProcessDetailPanelComponent implements AfterViewInit, OnChanges {
  @ViewChild('outputPreview')
  private outputPreview?: ElementRef<HTMLElement>;

  @Input() title = '';
  @Input() actionLabel = '';
  @Input() actionIconClass = 'fa-light fa-square-terminal';
  @Input() actionVisible = false;
  @Input() statusText = '-';
  @Input() elapsedText = '-';
  @Input() running = false;
  @Input() startedAt?: number | null;
  @Input() completedAt?: number | null;
  @Input() exitCode: number | string | null | undefined = null;
  @Input() outputTitle = 'command 预览';
  @Input() output = '';
  @Input() emptyOutputText = '暂无输出';

  @Output() actionClick = new EventEmitter<void>();

  private readonly cdr = inject(ChangeDetectorRef);
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  ngAfterViewInit(): void {
    this.scheduleScrollToBottom();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['output']) {
      this.scheduleScrollToBottom();
    }
    if (changes['running'] || changes['startedAt'] || changes['completedAt']) {
      this.syncElapsedTimer();
    }
  }

  ngOnDestroy(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  onActionClick(): void {
    this.actionClick.emit();
  }

  get displayElapsedText(): string {
    if (typeof this.startedAt === 'number' && Number.isFinite(this.startedAt)) {
      const end = typeof this.completedAt === 'number' && Number.isFinite(this.completedAt)
        ? this.completedAt
        : Date.now();
      return this.formatElapsed(Math.max(0, end - this.startedAt));
    }
    return this.elapsedText || '-';
  }

  private scheduleScrollToBottom(): void {
    setTimeout(() => {
      const element = this.outputPreview?.nativeElement;
      if (!element) {
        return;
      }
      element.scrollTop = element.scrollHeight;
    }, 0);
  }

  private syncElapsedTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    if (!this.running || typeof this.startedAt !== 'number' || !Number.isFinite(this.startedAt)) {
      return;
    }
    this.elapsedTimer = setInterval(() => {
      this.cdr.markForCheck();
    }, 1000);
  }

  private formatElapsed(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
}
