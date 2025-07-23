import { Component, OnDestroy, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Datasource, UiScrollModule } from 'ngx-ui-scroll4';
import { LogService, LogOptions } from '../../services/log.service';
import { AnsiPipe } from './ansi.pipe';
import { NzMessageService } from 'ng-zorro-antd/message';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-log',
  imports: [CommonModule, AnsiPipe, UiScrollModule],
  templateUrl: './log.component.html',
  styleUrl: './log.component.scss',
})
export class LogComponent implements OnInit, OnDestroy, AfterViewInit {
  private clickTimeout: any;
  private preventSingleClick = false;
  private isInitialized = false;

  // 虚拟滚动数据源
  datasource = new Datasource<LogOptions>({
    get: (index: number, count: number) => {
      console.log(`Datasource get called: index=${index}, count=${count}, total=${this.logService.list.length}`);

      const data: LogOptions[] = [];
      const startIndex = Math.max(0, index);
      const endIndex = Math.min(this.logService.list.length, startIndex + count);

      for (let i = startIndex; i < endIndex; i++) {
        if (this.logService.list[i]) {
          data.push(this.logService.list[i]);
        }
      }

      return Promise.resolve(data);
    },

    settings: {
      minIndex: 0,
      startIndex: 0,
      bufferSize: 10,
      padding: 0.3,
      infinite: false
    }
  });

  get logList() {
    return this.logService.list;
  }

  constructor(
    private logService: LogService,
    private message: NzMessageService,
    private uiService: UiService
  ) { }

  ngOnInit() {
    // 监听日志更新
    this.logService.stateSubject.subscribe((opts) => {
      console.log('logService stateSubject', opts);
      console.log(opts.timestamp);

      if (this.isInitialized) {
        // 当有新日志时，重新加载数据源
        this.reloadDatasource();
      }
    });
  }

  ngAfterViewInit() {
    // 初始化时加载数据并滚动到底部
    const relaxPromise = this.datasource.adapter.relax();
    if (relaxPromise && typeof relaxPromise.then === 'function') {
      relaxPromise.then(() => {
        this.isInitialized = true;
        setTimeout(() => this.scrollToBottom(), 100);
      });
    } else {
      // 如果 relax() 没有返回 Promise，直接设置初始化状态
      this.isInitialized = true;
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  reloadDatasource() {
    // 重新加载整个数据源以确保显示最新数据
    if (this.datasource.adapter && this.logService.list.length > 0) {
      // 计算应该从哪个索引开始显示（显示最后几项）
      const startIndex = Math.max(0, this.logService.list.length - 50); // 显示最后50项

      const reloadPromise = this.datasource.adapter.reload(startIndex);
      if (reloadPromise && typeof reloadPromise.then === 'function') {
        reloadPromise.then(() => {
          // 重新加载后滚动到底部
          setTimeout(() => this.scrollToBottom(), 100);
        });
      } else {
        // 如果 reload() 没有返回 Promise，直接滚动到底部
        setTimeout(() => this.scrollToBottom(), 100);
      }
    }
  }

  clear() {
    this.logService.clear();
  }

  ngOnDestroy() {
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
    }
  }

  // 处理点击事件，区分单击和双击
  handleClick(item: any, event: MouseEvent) {
    this.clickTimeout = setTimeout(() => {
      if (!this.preventSingleClick) {
        this.copyLogItemToClipboard(item);
      }
      this.preventSingleClick = false;
    }, 250);
  }

  // 处理双击事件
  handleDoubleClick(item: any, event: MouseEvent) {
    this.preventSingleClick = true;
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
    }
    this.copyLogItemToChat(item);
  }

  // 单击复制日志内容到剪切板
  async copyLogItemToClipboard(item: any) {
    try {
      const logContent = `${item.detail}`;
      await navigator.clipboard.writeText(logContent);
      this.message.success('日志内容已复制到剪切板');
    } catch (err) {
      console.error('复制到剪切板失败:', err);
    }
  }

  // 双击打开AI助手并发送日志内容
  async copyLogItemToChat(item: any) {
    // 这里可以实现将日志内容发送到AI助手的逻辑
    // 例如，调用一个服务方法来处理这个操作
    this.uiService.openTool("aily-chat");
    setTimeout(() => {
      window.sendToAilyChat(`运行日志：\n${item.detail}`, {
        sender: 'LogComponent',
        type: 'log'
        // cover: true 是默认值，可以省略
      });
    }, 100);
    this.message.info('日志内容已发送到AI助手');
  }

  private scrollToBottom(): void {
    // 对于 ngx-ui-scroll，我们需要滚动到最后一个可见的元素
    if (this.datasource.adapter && this.logService.list.length > 0) {
      // 等待 DOM 更新完成后滚动
      setTimeout(() => {
        // 使用原生 DOM 滚动到底部
        const viewport = document.querySelector('.log-box');
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }, 50);
    }
  }
}
