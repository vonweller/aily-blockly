import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-chat-process-detail-panel',
  standalone: true,
  imports: [CommonModule],
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
  @Input() exitCode: number | string | null | undefined = null;
  @Input() outputTitle = 'command 预览';
  @Input() output = '';
  @Input() emptyOutputText = '暂无输出';

  @Output() actionClick = new EventEmitter<void>();

  ngAfterViewInit(): void {
    this.scheduleScrollToBottom();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['output']) {
      this.scheduleScrollToBottom();
    }
  }

  onActionClick(): void {
    this.actionClick.emit();
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
}
