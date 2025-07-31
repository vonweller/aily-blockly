import {
  Component,
  ElementRef,
  Input,
  OnInit,
  OnDestroy,
  OnChanges,
  SecurityContext,
  ViewChild,
  SimpleChanges,
} from '@angular/core';
// import { ChatService } from '../../services/chat.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
// import { SpeechService } from '../../services/speech.service';
import { CommonModule } from '@angular/common';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NzImageModule } from 'ng-zorro-antd/image';
import { FormsModule } from '@angular/forms';
import { AilyDynamicComponentDirective } from '../../directives/aily-dynamic-component.directive';
import svgPanZoom from 'svg-pan-zoom';
import { MarkdownPipe } from '../../pipes/markdown.pipe';
import { firstValueFrom } from 'rxjs';

// import { AilyCodingComponent } from '../../../../components/aily-coding/aily-coding.component';

@Component({
  selector: 'aily-dialog',
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NzAvatarModule,
    NzButtonModule,
    AilyDynamicComponentDirective,
    NzImageModule
  ]
})
export class DialogComponent implements OnInit, OnChanges, OnDestroy {
  @Input() role = 'user';
  @Input() content;

  loaded = false;
  safeContent: SafeHtml = '';
  private markdownPipe: MarkdownPipe;
  private mermaidEventListener: (event: CustomEvent) => void;
  private lastContentLength = 0; // 跟踪上次处理的内容长度
  private lastProcessedContent = ''; // 跟踪上次处理的完整内容
  private lastRenderTime = 0; // 跟踪上次渲染的时间
  private renderTimeout: any; // 渲染超时定时器

  @ViewChild('contentDiv', { static: true }) contentDiv!: ElementRef<HTMLDivElement>;

  constructor(
    private message: NzMessageService,
    private modal: NzModalService,
    private sanitizer: DomSanitizer,
    private el: ElementRef
  ) {
    this.markdownPipe = new MarkdownPipe(this.sanitizer);
  }

  ngOnInit(): void { 
    if (this.content) {
      this.processContent();
    }
  }

  ngOnDestroy(): void {
    // 清理渲染超时定时器
    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['content'] && this.content) {
      // console.log('Dialog content changed:', this.content);
      this.processContent();
    }
  }

  private async processContent() {
    if (!this.content) {
      return;
    }

    const currentContent = String(this.content);
    
    // 如果内容没有变化，则跳过处理
    if (currentContent === this.lastProcessedContent) {
      return;
    }

    // 如果是全新的内容或内容长度减少了（可能是重置），则清空并重新渲染
    if (currentContent.length < this.lastContentLength || this.lastProcessedContent === '') {
      this.lastContentLength = 0;
      this.lastProcessedContent = '';
      if (this.contentDiv?.nativeElement) {
        this.contentDiv.nativeElement.innerHTML = '';
      }
    }

    // 获取新增的内容
    const newContent = currentContent.slice(this.lastContentLength);
    
    if (newContent.length > 0) {
      try {
        // 清除之前的渲染超时
        if (this.renderTimeout) {
          clearTimeout(this.renderTimeout);
          this.renderTimeout = null;
        }

        // 对于 Markdown 内容，我们需要更智能的处理策略
        // 检查当前内容是否在一个完整的状态（比如段落结束、代码块结束等）
        const shouldRender = this.shouldRenderNow(currentContent);
        
        if (shouldRender || this.lastContentLength === 0) {
          // 立即渲染
          await this.renderContent(currentContent);
        } else {
          // 设置延迟渲染，以防内容长时间不满足渲染条件
          this.renderTimeout = setTimeout(async () => {
            await this.renderContent(currentContent);
          }, 1000); // 最多延迟1秒
        }
        
      } catch (error) {
        console.error('Error processing markdown content:', error);
        // 如果处理失败，至少显示原始文本
        if (this.contentDiv?.nativeElement) {
          this.contentDiv.nativeElement.textContent = currentContent;
        }
      }
    }
  }

  /**
   * 执行实际的内容渲染
   */
  private async renderContent(currentContent: string): Promise<void> {
    // 渲染完整的当前内容
    const fullHtmlObservable = this.markdownPipe.transform(currentContent);
    const fullSafeHtml = await firstValueFrom(fullHtmlObservable);
    const fullHtmlString = this.getHtmlString(fullSafeHtml);
    
    if (this.contentDiv?.nativeElement) {
      this.contentDiv.nativeElement.innerHTML = fullHtmlString;
    }
    
    // 更新状态
    this.lastContentLength = currentContent.length;
    this.lastProcessedContent = currentContent;
    this.lastRenderTime = Date.now(); // 更新渲染时间
    this.loaded = true;
    
    // 触发重新初始化可能的动态组件或特殊元素
    setTimeout(() => {
      this.initializeRenderedContent();
    }, 50);
  }

  /**
   * 判断是否应该现在就渲染内容
   * 主要检查内容是否在一个相对完整的状态
   */
  private shouldRenderNow(content: string): boolean {
    // 如果内容为空，不渲染
    if (!content.trim()) {
      return false;
    }

    // 检查是否有未闭合的代码块
    const codeBlockMatches = content.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      // 有未闭合的代码块，不渲染
      return false;
    }

    // 检查是否以换行符结束（表示段落可能完整）
    const endsWithNewline = content.endsWith('\n') || content.endsWith('\n\n');
    
    // 检查是否以句号、问号、感叹号等结束（表示句子完整）
    const endsWithSentence = /[.!?。！？]\s*$/.test(content);
    
    // 检查是否包含完整的 Markdown 结构标记
    const hasCompleteMarkdown = this.hasCompleteMarkdownStructures(content);
    
    // 添加一个最小延迟机制，避免过于频繁的渲染，但不要太长
    const timeSinceLastRender = Date.now() - (this.lastRenderTime || 0);
    const shouldRenderByTime = timeSinceLastRender > 200; // 至少间隔200ms
    
    // 如果内容以换行结束，或者以句子结束，或者包含完整的 Markdown 结构，就可以渲染
    // 或者如果超过了时间间隔也进行渲染
    return (endsWithNewline || endsWithSentence || hasCompleteMarkdown) && shouldRenderByTime;
  }

  /**
   * 检查内容是否包含完整的 Markdown 结构
   */
  private hasCompleteMarkdownStructures(content: string): boolean {
    // 检查各种完整的 Markdown 结构
    const patterns = [
      /^#{1,6}\s+.+$/m,        // 完整的标题行
      /^\s*[-*+]\s+.+$/m,      // 完整的列表项
      /^\s*\d+\.\s+.+$/m,      // 完整的有序列表项
      /^\s*>.+$/m,             // 完整的引用行
      /```[\s\S]*?```/,        // 完整的代码块
      /^\s*---+\s*$/m,         // 分隔线
      /\|.+\|/,                // 表格行
    ];
    
    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * 从 SafeHtml 中提取 HTML 字符串
   */
  private getHtmlString(safeHtml: SafeHtml): string {
    // Angular 的 SafeHtml 对象内部包含了原始的 HTML 字符串
    return (safeHtml as any).changingThisBreaksApplicationSecurity || '';
  }

  /**
   * 初始化渲染后的内容，如 Mermaid 图表等
   */
  private initializeRenderedContent(): void {
    // 这里可以添加初始化已渲染内容的逻辑
    // 比如初始化 Mermaid 图表、代码高亮等
    
    // 触发自定义事件，通知其他组件内容已更新
    const event = new CustomEvent('contentRendered', {
      detail: { element: this.contentDiv?.nativeElement }
    });
    this.el.nativeElement.dispatchEvent(event);
  }

}
