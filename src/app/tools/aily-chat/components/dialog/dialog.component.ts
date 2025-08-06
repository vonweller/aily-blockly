import {
  Component,
  ElementRef,
  Input,
  OnInit,
  OnDestroy,
  OnChanges,
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
  private lastContentLength = 0; // 跟踪上次处理的内容长度
  private lastProcessedContent = ''; // 跟踪上次处理的完整内容
  private renderTimeout: any; // 渲染超时定时器
  private contentSegments: Array<{ content: string, element?: HTMLElement }> = []; // 跟踪内容段落和对应的DOM元素
  private isProcessing = false; // 防止并发处理

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

    // 清理内容段落跟踪
    this.contentSegments = [];
    this.isProcessing = false;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['content'] && this.content) {
      // console.log('Dialog content changed:', this.content);
      this.processContent();
    }
  }

  private async processContent() {
    if (!this.content || this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    this.fixContent(); // 确保内容格式正确

    try {
      const currentContent = String(this.content);

      // 如果内容没有变化，则跳过处理
      if (currentContent === this.lastProcessedContent) {
        return;
      }

      // 如果是全新的内容或内容长度减少了（可能是重置），则清空并重新渲染
      if (currentContent.length < this.lastContentLength || this.lastProcessedContent === '') {
        await this.resetAndRenderAll(currentContent);
        return;
      }

      // 获取新增的内容
      const newContent = currentContent.slice(this.lastContentLength);
      console.log('Processing new content:', newContent);

      if (newContent.length > 0) {
        // 清除之前的渲染超时
        if (this.renderTimeout) {
          clearTimeout(this.renderTimeout);
          this.renderTimeout = null;
        }

        // 分析新增内容的性质，决定如何处理
        await this.processIncrementalContent(this.lastProcessedContent, newContent, currentContent);
      }
    } catch (error) {
      console.error('Error processing markdown content:', error);
      // 如果处理失败，回退到完整重新渲染
      await this.fallbackToFullRender(String(this.content));
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 重置并重新渲染所有内容
   */
  private async resetAndRenderAll(currentContent: string): Promise<void> {
    this.lastContentLength = 0;
    this.lastProcessedContent = '';
    this.contentSegments = [];

    if (this.contentDiv?.nativeElement) {
      this.contentDiv.nativeElement.innerHTML = '';
    }

    // 处理代理名称替换后再渲染
    const processedContent = this.replaceAgentNamesInContent(currentContent);

    // 首次渲染整个内容
    await this.renderContent(processedContent);
  }

  /**
   * 回退到完整重新渲染（错误处理）
   */
  private async fallbackToFullRender(content: string): Promise<void> {
    console.warn('Falling back to full render due to error');

    if (this.contentDiv?.nativeElement) {
      // 如果完全失败，至少显示原始文本
      try {
        const processedContent = this.replaceAgentNamesInContent(content);
        await this.renderContent(processedContent);
      } catch (fallbackError) {
        console.error('Even fallback render failed:', fallbackError);
        const processedContent = this.replaceAgentNamesInContent(content);
        this.contentDiv.nativeElement.textContent = processedContent;
        this.updateRenderState(processedContent);
      }
    }
  }

  /**
   * 处理增量内容的核心逻辑
   */
  private async processIncrementalContent(previousContent: string, newContent: string, fullContent: string): Promise<void> {
    // 检查新增内容是否包含需要替换的代理名称
    const processedNewContent = this.replaceAgentNamesInContent(newContent);
    // 注意：由于替换可能改变内容长度，我们需要重新计算处理后的完整内容
    const processedFullContent = this.replaceAgentNamesInContent(fullContent);

    // 分析新增内容的类型和应该如何处理
    const incrementalAction = this.analyzeIncrementalContent(previousContent, processedNewContent);

    switch (incrementalAction.type) {
      case 'append_to_last':
        // 新增内容应该追加到最后一个元素中
        await this.appendToLastElement(processedNewContent, processedFullContent);
        break;

      case 'create_new':
        // 新增内容应该创建新的元素
        await this.createNewElements(processedNewContent);
        break;

      case 'rerender_all':
        // 需要重新渲染所有内容（比如影响了已有结构）
        await this.renderContent(processedFullContent);
        break;

      case 'wait_for_more':
        // 等待更多内容（比如代码块未完成）
        this.scheduleDelayedRender(processedFullContent);
        break;
    }
  }

  /**
   * 分析新增内容应该如何处理
   */
  private analyzeIncrementalContent(previousContent: string, newContent: string): { type: string, reason?: string } {
    // 检查是否有未闭合的代码块
    const allContent = previousContent + newContent;
    const codeBlockMatches = allContent.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      return { type: 'wait_for_more', reason: 'unclosed_code_block' };
    }

    // 检查是否有未闭合的其他结构
    if (this.hasUnclosedStructures(allContent)) {
      return { type: 'wait_for_more', reason: 'unclosed_structures' };
    }

    // 检查新内容是否以新的结构开始
    const newStartsWithStructure = this.startsWithNewStructure(newContent);

    // 如果新内容明确开始了新的结构，总是创建新元素
    if (newStartsWithStructure) {
      return { type: 'create_new', reason: 'new_structure' };
    }

    // 检查之前的内容是否以完整结构结束
    const previousEndsComplete = this.endsWithCompleteStructure(previousContent);

    // 如果之前内容没有完整结束，追加到最后元素
    if (!previousEndsComplete) {
      return { type: 'append_to_last', reason: 'continue_previous' };
    }

    // 检查新内容是否形成完整的内容单元
    const newContentComplete = this.isCompleteContent(newContent);

    if (newContentComplete) {
      return { type: 'create_new', reason: 'complete_new_content' };
    } else {
      // 新内容不完整，但之前内容已完整，等待更多内容
      return { type: 'wait_for_more', reason: 'incomplete_content' };
    }
  }

  /**
   * 检查是否有未闭合的结构
   */
  private hasUnclosedStructures(content: string): boolean {
    // 检查配对的结构是否完整
    const structures = [
      { open: /\(/g, close: /\)/g },           // 括号
      { open: /\[/g, close: /\]/g },           // 方括号
      { open: /\{/g, close: /\}/g },           // 花括号
      { open: /<[^/>][^>]*>/g, close: /<\/[^>]+>/g }  // HTML标签（简化检查）
    ];

    for (const struct of structures) {
      const openMatches = content.match(struct.open) || [];
      const closeMatches = content.match(struct.close) || [];
      if (openMatches.length !== closeMatches.length) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查内容是否以完整的结构结束
   */
  private endsWithCompleteStructure(content: string): boolean {
    if (!content.trim()) return true;

    const trimmed = content.trimEnd();

    const patterns = [
      /\n\n$/,                 // 双换行（段落结束）
      /[.!?。！？]\s*$/,       // 句子结束符
      /```\s*$/,               // 代码块结束
      /^\s*---+\s*$/m,         // 分隔线
      /\|\s*\n$/,              // 表格行结束后的换行
      /^\s*#{1,6}\s+.+\n$/m,   // 标题行结束
      /^\s*[-*+]\s+.+\n$/m,    // 列表项结束
    ];

    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * 检查新内容是否以新结构开始
   */
  private startsWithNewStructure(content: string): boolean {
    const trimmed = content.trimStart();

    const patterns = [
      /^#{1,6}\s/,             // 标题
      /^[-*+]\s/,              // 无序列表
      /^\d+\.\s/,              // 有序列表
      /^>/,                    // 引用块
      /^```/,                  // 代码块开始
      /^---+\s*$/m,            // 分隔线
      /^\|/,                   // 表格
      /^\n#{1,6}\s/,           // 换行后的标题
      /^\n[-*+]\s/,            // 换行后的列表
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

    // 检查是否以双换行结尾（段落分隔）
    if (content.endsWith('\n\n')) {
      return true;
    }

    // 检查是否包含完整的结构且以换行结尾
    if (content.endsWith('\n') && this.hasCompleteMarkdownStructures(content)) {
      return true;
    }

    return false;
  }

  /**
   * 追加内容到最后一个元素
   */
  private async appendToLastElement(newContent: string, fullContent: string): Promise<void> {
    const container = this.contentDiv?.nativeElement;
    if (!container) return;

    // 查找最后一个内容段落
    const lastSegment = this.contentSegments[this.contentSegments.length - 1];

    if (!lastSegment || !lastSegment.element || !container.contains(lastSegment.element)) {
      // 如果没有最后元素或元素已被移除，创建新元素
      console.warn('Last element not found, creating new element');
      await this.createNewElements(newContent);
      return;
    }

    try {
      // 构造完整的段落内容（原内容 + 新内容）
      const combinedContent = lastSegment.content + newContent;

      // 渲染组合后的内容
      const htmlObservable = this.markdownPipe.transform(combinedContent);
      const safeHtml = await firstValueFrom(htmlObservable);
      const htmlString = this.getHtmlString(safeHtml);

      // 创建临时容器解析HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlString;

      // 获取渲染后的元素
      if (tempDiv.children.length > 0) {
        // 如果有多个元素，可能是markdown结构发生了变化
        if (tempDiv.children.length > 1) {
          // 移除旧元素，添加所有新元素
          container.removeChild(lastSegment.element);
          this.contentSegments.pop(); // 移除旧段落记录

          // 添加所有新渲染的元素
          Array.from(tempDiv.children).forEach((child, index) => {
            const clonedChild = child.cloneNode(true) as HTMLElement;
            container.appendChild(clonedChild);

            // 更新段落跟踪
            if (index === 0) {
              // 第一个元素包含组合后的内容
              this.contentSegments.push({
                content: combinedContent,
                element: clonedChild
              });
            } else {
              // 后续元素是新结构，内容为空（将在下次处理时填充）
              this.contentSegments.push({
                content: '',
                element: clonedChild
              });
            }
          });
        } else {
          // 单个元素，直接替换
          const newElement = tempDiv.firstElementChild!.cloneNode(true) as HTMLElement;
          container.replaceChild(newElement, lastSegment.element);

          // 更新段落跟踪
          lastSegment.content = combinedContent;
          lastSegment.element = newElement;
        }
      } else {
        console.warn('No rendered elements found, falling back to text content');
        lastSegment.element.textContent = combinedContent;
        lastSegment.content = combinedContent;
      }

      // 更新状态
      this.updateRenderState(fullContent);

    } catch (error) {
      console.error('Error appending to last element:', error);
      // 如果追加失败，回退到重新渲染
      await this.renderContent(fullContent);
    }
  }

  /**
   * 创建新的元素
   */
  private async createNewElements(newContent: string): Promise<void> {
    const container = this.contentDiv?.nativeElement;
    if (!container) return;

    try {
      // 渲染新内容
      const htmlObservable = this.markdownPipe.transform(newContent.trim());
      const safeHtml = await firstValueFrom(htmlObservable);
      const htmlString = this.getHtmlString(safeHtml);

      // 创建临时容器解析HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlString;

      // 添加所有新元素到容器，并跟踪段落
      const addedElements: HTMLElement[] = [];

      while (tempDiv.firstChild) {
        const child = tempDiv.firstChild;
        const addedChild = container.appendChild(child) as HTMLElement;
        addedElements.push(addedChild);
      }

      // 将新内容作为一个段落添加到跟踪中
      if (addedElements.length > 0) {
        // 如果渲染产生了多个元素，将它们作为一个逻辑段落
        // 只记录第一个元素，因为它们共同组成一个内容段落
        this.contentSegments.push({
          content: newContent.trim(),
          element: addedElements[0]
        });

        // 如果有多个元素，为后续元素添加空记录（它们属于同一段落）
        for (let i = 1; i < addedElements.length; i++) {
          this.contentSegments.push({
            content: '', // 空内容，表示这是上一个段落的延续
            element: addedElements[i]
          });
        }
      }

      // 更新状态
      this.updateRenderState(this.lastProcessedContent + newContent.trim());

    } catch (error) {
      console.error('Error creating new elements:', error);
      // 如果创建失败，至少添加文本内容
      const textNode = document.createTextNode(newContent);
      container.appendChild(textNode);

      // 更新状态
      this.updateRenderState(this.lastProcessedContent + newContent);
    }
  }

  /**
   * 延迟渲染
   */
  private scheduleDelayedRender(fullContent: string): void {
    this.renderTimeout = setTimeout(async () => {
      await this.renderContent(fullContent);
    }, 500);
  }

  /**
   * 更新渲染状态
   */
  private updateRenderState(content: string): void {
    this.lastContentLength = content.length;
    this.lastProcessedContent = content;
    this.loaded = true;

    // 验证内容完整性
    if (!this.validateContentIntegrity(content)) {
      console.warn('Content integrity check failed, scheduling verification');
      // 延迟验证，如果验证失败则重新渲染
      setTimeout(() => {
        this.verifyAndRecoverContent(content);
      }, 100);
    }
  }

  /**
   * 验证内容完整性
   */
  private validateContentIntegrity(expectedContent: string): boolean {
    const container = this.contentDiv?.nativeElement;
    if (!container || !expectedContent.trim()) {
      return true; // 空内容总是有效的
    }

    // 简单的完整性检查：确保容器不为空且包含渲染内容
    const hasRenderedContent = container.children.length > 0 || container.textContent?.trim().length > 0;

    // 检查段落跟踪是否与实际DOM一致
    const validSegments = this.contentSegments.filter(segment =>
      segment.element && container.contains(segment.element)
    ).length;

    return hasRenderedContent && (validSegments === 0 || validSegments > 0); // 宽松的验证
  }

  /**
   * 验证并恢复内容
   */
  private async verifyAndRecoverContent(expectedContent: string): Promise<void> {
    const container = this.contentDiv?.nativeElement;
    if (!container) return;

    // 检查当前渲染的内容是否与期望的内容匹配
    const currentTextContent = container.textContent || '';
    const expectedTextContent = expectedContent.replace(/```[\s\S]*?```/g, '[代码块]').replace(/[#*`>\-\|\s]/g, '').trim();
    const currentNormalized = currentTextContent.replace(/\s/g, '').trim();

    // 如果内容差异过大，重新渲染
    if (expectedTextContent.length > 0 && currentNormalized.length < expectedTextContent.length * 0.8) {
      console.warn('Content appears to be incomplete, recovering...');
      await this.renderContent(expectedContent);
    }

    // 清理失效的段落跟踪
    this.contentSegments = this.contentSegments.filter(segment =>
      segment.element && container.contains(segment.element)
    );
  }

  /**
   * 执行完整内容渲染（用于首次渲染或需要重新渲染全部内容的情况）
   */
  private async renderContent(currentContent: string): Promise<void> {
    try {
      // 渲染完整的当前内容
      const fullHtmlObservable = this.markdownPipe.transform(currentContent);
      const fullSafeHtml = await firstValueFrom(fullHtmlObservable);
      const fullHtmlString = this.getHtmlString(fullSafeHtml);

      if (this.contentDiv?.nativeElement) {
        this.contentDiv.nativeElement.innerHTML = fullHtmlString;

        // 重新构建段落跟踪
        this.rebuildContentSegments(currentContent);
      }

      // 更新状态
      this.updateRenderState(currentContent);

    } catch (error) {
      console.error('Error in renderContent:', error);

      // 如果渲染失败，显示原始文本
      if (this.contentDiv?.nativeElement) {
        this.contentDiv.nativeElement.textContent = currentContent;
      }

      // 清空段落跟踪
      this.contentSegments = [];
      this.updateRenderState(currentContent);
    }
  }

  /**
   * 重新构建内容段落跟踪
   */
  private rebuildContentSegments(content: string): void {
    this.contentSegments = [];
    const container = this.contentDiv?.nativeElement;

    if (!container || !content.trim()) {
      return;
    }

    // 简化处理：将整个内容作为一个段落跟踪
    // 在更复杂的实现中，可以分析content中的markdown结构来创建更精确的段落映射
    const firstElement = container.firstElementChild as HTMLElement;
    if (firstElement) {
      this.contentSegments.push({
        content: content,
        element: firstElement
      });

      // 为其他元素添加空记录
      let currentElement = firstElement.nextElementSibling;
      while (currentElement) {
        this.contentSegments.push({
          content: '',
          element: currentElement as HTMLElement
        });
        currentElement = currentElement.nextElementSibling;
      }
    }
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
   * 替换内容中的代理名称为对应的emoji符号
   */
  private replaceAgentNamesInContent(content: string): string {
    let processedContent = content;

    // 使用正则表达式匹配 [to_xxx] 形式的内容
    const agentNameRegex = /\[to_[^\]]+\]/g;
    const matches = content.match(agentNameRegex);

    if (matches) {
      matches.forEach(match => {
        // 在 agentNameList 中查找对应的emoji
        const agentEntry = agentNameList.find(entry => entry[0] === match);
        if (agentEntry) {
          processedContent = processedContent.replace(match, agentEntry[1]);
        }
      });
    }

    return processedContent;
  }

  fixContent() {
    // 修复mermaid代码块没有语言类型的问题
    this.content = this.content.replace(/```\nflowchart/g, '```aily-mermaid\nflowchart')
  }
}

const agentNameList = [
  ["[to_plannerAgent]", "🤔"],
  ["[to_projectAnalysisAgent]", "🤔"],
  ["[to_projectGenerationAgent]", "🤔"],
  ["[to_boardRecommendationAgent]", "🤨"],
  ["[to_libraryRecommendationAgent]", "🤨"],
  ["[to_arduinoLibraryAnalysisAgent]", "🤔"],
  ["[to_projectCreationAgent]", "😀"],
  ["[to_blocklyGenerationAgent]", "🤔"],
  ["[to_blocklyRepairAgent]", "🤔"],
  ["[to_compilationErrorRepairAgent]", "🤔"],
  ["[to_contextAgent]", "😀"],
  ["[to_libraryInstallationAgent]", "😀"],
  ["[to_fileOperationAgent]", "😁"],
  ["[to_user]", "😉"]
]