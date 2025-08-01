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
      // 首次渲染整个内容
      await this.renderContent(currentContent);
      return;
    }

    // 获取新增的内容
    const newContent = currentContent.slice(this.lastContentLength);
    console.log('Processing new content:', newContent);
    
    if (newContent.length > 0) {
      try {
        // 清除之前的渲染超时
        if (this.renderTimeout) {
          clearTimeout(this.renderTimeout);
          this.renderTimeout = null;
        }

        // 分析新增内容的性质，决定如何处理
        await this.processIncrementalContent(this.lastProcessedContent, newContent, currentContent);
        
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
   * 处理增量内容的核心逻辑
   */
  private async processIncrementalContent(previousContent: string, newContent: string, fullContent: string): Promise<void> {
    // 分析新增内容的类型和应该如何处理
    const incrementalAction = this.analyzeIncrementalContent(previousContent, newContent);
    
    switch (incrementalAction.type) {
      case 'append_to_last':
        // 新增内容应该追加到最后一个元素中
        await this.appendToLastElement(newContent, fullContent);
        break;
        
      case 'create_new':
        // 新增内容应该创建新的元素
        await this.createNewElements(newContent);
        break;
        
      case 'rerender_all':
        // 需要重新渲染所有内容（比如影响了已有结构）
        await this.renderContent(fullContent);
        break;
        
      case 'wait_for_more':
        // 等待更多内容（比如代码块未完成）
        this.scheduleDelayedRender(fullContent);
        break;
    }
  }

  /**
   * 分析新增内容应该如何处理
   */
  private analyzeIncrementalContent(previousContent: string, newContent: string): { type: string, reason?: string } {
    // 检查是否有未闭合的代码块
    const codeBlockMatches = (previousContent + newContent).match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      return { type: 'wait_for_more', reason: 'unclosed_code_block' };
    }

    // 检查之前的内容是否以完整结构结束
    const previousEndsComplete = this.endsWithCompleteStructure(previousContent);
    
    // 检查新内容是否以新的结构开始
    const newStartsWithStructure = this.startsWithNewStructure(newContent);
    
    // 如果之前内容没有完整结束，且新内容不是新结构，则追加到最后元素
    if (!previousEndsComplete && !newStartsWithStructure) {
      return { type: 'append_to_last', reason: 'continue_previous' };
    }
    
    // 如果新内容明确开始了新的结构
    if (newStartsWithStructure) {
      return { type: 'create_new', reason: 'new_structure' };
    }
    
    // 如果之前内容完整结束，新内容是普通文本
    if (previousEndsComplete) {
      // 检查新内容是否形成完整的段落或结构
      const newContentComplete = this.isCompleteContent(newContent);
      if (newContentComplete) {
        return { type: 'create_new', reason: 'complete_new_content' };
      } else {
        // 新内容不完整，等待更多内容
        return { type: 'wait_for_more', reason: 'incomplete_content' };
      }
    }
    
    // 默认情况：创建新元素
    return { type: 'create_new', reason: 'default' };
  }

  /**
   * 检查内容是否以完整的结构结束
   */
  private endsWithCompleteStructure(content: string): boolean {
    if (!content.trim()) return true;
    
    const patterns = [
      /\n\n$/,                 // 双换行（段落结束）
      /[.!?。！？]\s*$/,       // 句子结束符
      /```\s*$/,               // 代码块结束
      /^\s*---+\s*$/m,         // 分隔线
      /\|\s*$/m,               // 表格行结束
    ];
    
    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * 检查新内容是否以新结构开始
   */
  private startsWithNewStructure(content: string): boolean {
    const patterns = [
      /^\s*#{1,6}\s/,          // 标题
      /^\s*[-*+]\s/,           // 无序列表
      /^\s*\d+\.\s/,           // 有序列表
      /^\s*>/,                 // 引用块
      /^\s*```/,               // 代码块开始
      /^\s*---+/,              // 分隔线
      /^\s*\|/,                // 表格
    ];
    
    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * 检查内容是否是完整的内容单元
   */
  private isCompleteContent(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;
    
    // 检查是否以句子结束符结尾
    if (/[.!?。！？]\s*$/.test(trimmed)) {
      return true;
    }
    
    // 检查是否以换行结尾（可能是段落）
    if (content.endsWith('\n')) {
      return true;
    }
    
    // 检查是否包含完整的结构
    return this.hasCompleteMarkdownStructures(content);
  }

  /**
   * 追加内容到最后一个元素
   */
  private async appendToLastElement(newContent: string, fullContent: string): Promise<void> {
    const container = this.contentDiv?.nativeElement;
    if (!container) return;

    const lastElement = container.lastElementChild;
    if (!lastElement) {
      // 没有最后元素，创建新元素
      await this.createNewElements(newContent);
      return;
    }

    // 获取最后元素的完整内容 + 新内容，重新渲染该部分
    const lastElementText = this.getElementText(lastElement);
    const combinedContent = lastElementText + newContent;
    
    // 渲染组合后的内容
    const htmlObservable = this.markdownPipe.transform(combinedContent);
    const safeHtml = await firstValueFrom(htmlObservable);
    const htmlString = this.getHtmlString(safeHtml);
    
    // 创建临时容器解析HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    // 替换最后一个元素
    if (tempDiv.firstElementChild) {
      container.replaceChild(tempDiv.firstElementChild, lastElement);
    }
    
    // 更新状态
    this.updateRenderState(fullContent);
  }

  /**
   * 创建新的元素
   */
  private async createNewElements(newContent: string): Promise<void> {
    const container = this.contentDiv?.nativeElement;
    if (!container) return;

    // 渲染新内容
    const htmlObservable = this.markdownPipe.transform(newContent.trim());
    const safeHtml = await firstValueFrom(htmlObservable);
    const htmlString = this.getHtmlString(safeHtml);
    
    // 创建临时容器解析HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    // 添加所有新元素到容器
    while (tempDiv.firstChild) {
      container.appendChild(tempDiv.firstChild);
    }
    
    // 更新状态
    this.updateRenderState(this.lastProcessedContent + newContent);
  }

  /**
   * 延迟渲染
   */
  private scheduleDelayedRender(fullContent: string): void {
    this.renderTimeout = setTimeout(async () => {
      await this.renderContent(fullContent);
    }, 1000);
  }

  /**
   * 获取元素的文本内容（尽可能保持原始格式）
   */
  private getElementText(element: Element): string {
    // 这里可能需要根据元素类型来恢复原始的markdown格式
    // 简化处理：直接使用textContent
    return element.textContent || '';
  }

  /**
   * 更新渲染状态
   */
  private updateRenderState(content: string): void {
    this.lastContentLength = content.length;
    this.lastProcessedContent = content;
    this.loaded = true;
    
    // 触发重新初始化
    setTimeout(() => {
      this.initializeRenderedContent();
    }, 50);
  }

  /**
   * 执行完整内容渲染（用于首次渲染或需要重新渲染全部内容的情况）
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
    this.updateRenderState(currentContent);
  }

  /**
   * 从 SafeHtml 中提取 HTML 字符串
   */
  private getHtmlString(safeHtml: SafeHtml): string {
    // Angular 的 SafeHtml 对象内部包含了原始的 HTML 字符串
    return (safeHtml as any).changingThisBreaksApplicationSecurity || '';
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
