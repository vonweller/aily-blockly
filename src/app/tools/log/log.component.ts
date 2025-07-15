import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { LogService } from '../../services/log.service';
import { AnsiPipe } from './ansi.pipe';
import { NzMessageService } from 'ng-zorro-antd/message';

@Component({
  selector: 'app-log',
  imports: [CommonModule, SimplebarAngularModule, AnsiPipe],
  templateUrl: './log.component.html',
  styleUrl: './log.component.scss',
})
export class LogComponent {
  @ViewChild(SimplebarAngularComponent) simplebar: SimplebarAngularComponent;

  get logList() {
    return this.logService.list;
  }

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  constructor(
    private logService: LogService,
    private message: NzMessageService
  ) { }

  ngAfterViewInit() {
    setTimeout(() => this.scrollToBottom(), 100);
    this.logService.stateSubject.subscribe((opts) => {
      console.log('logService stateSubject', opts);
      console.log(opts.timestamp);
      setTimeout(() => this.scrollToBottom(), 100);
    });
  }

  clear() {
    this.logService.clear();
  }

  // 双击复制日志内容到剪切板
  async copyLogItemToClipboard(item: any, event?: Event) {
    try {
      const logContent = `${item.detail}`;
      await navigator.clipboard.writeText(logContent);
      this.message.success('日志内容已复制到剪切板');
    } catch (err) {
      console.error('复制到剪切板失败:', err);
    }
  }

  private scrollToBottom(): void {
    if (this.simplebar?.SimpleBar) {
      this.simplebar.SimpleBar.getScrollElement().scrollTop = this.simplebar.SimpleBar.getScrollElement().scrollHeight;
    }
  }
}
