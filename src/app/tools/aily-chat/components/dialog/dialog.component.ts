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
    // private speechService: SpeechService,
    private sanitizer: DomSanitizer,
    // private chatService: ChatService,
    private el: ElementRef
  ) {
    this.markdownPipe = new MarkdownPipe(this.sanitizer);
    // 监听 Mermaid 图表就绪事件
    // this.setupMermaidEventListener();
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

  // /**
  //  * 设置 Mermaid 事件监听器
  //  */
  // private setupMermaidEventListener(): void {
  //   this.mermaidEventListener = (event: CustomEvent) => {
  //     // 确保事件来自当前组件的 Mermaid 图表
  //     const diagram = this.el.nativeElement.querySelector(`svg#${event.detail.diagramId}`);
  //     if (diagram) {
  //       console.log('Mermaid diagram ready, initializing pan-zoom:', event.detail.diagramId);
  //       // 延迟初始化以确保 DOM 完全更新
  //       setTimeout(() => {
  //         this.initMermaidPanZoom();
  //       }, 50);
  //     }
  //   };

  //   document.addEventListener('mermaidDiagramReady', this.mermaidEventListener);
  // }

  // ngOnDestroy(): void {
  //   // 清理事件监听器
  //   if (this.mermaidEventListener) {
  //     document.removeEventListener('mermaidDiagramReady', this.mermaidEventListener);
  //   }

  //   // 清理 svg-pan-zoom 实例
  //   const containers = this.el.nativeElement.querySelectorAll('.mermaid-container[data-pan-zoom-initialized]');
  //   containers.forEach((container: HTMLElement) => {
  //     const instance = (container as any)._panZoomInstance;
  //     if (instance && typeof instance.destroy === 'function') {
  //       try {
  //         instance.destroy();
  //       } catch (error) {
  //         console.warn('Failed to destroy svg-pan-zoom instance:', error);
  //       }
  //     }
  //   });
  // }

  // getSafeHTML(html: string) {
  //   return this.sanitizer.sanitize(SecurityContext.HTML, html);
  // }

  // ngAfterViewInit(): void {
  //   // 延迟初始化 Mermaid 图表，确保 DOM 已完全渲染
  //   setTimeout(() => {
  //     this.initMermaidPanZoom();
  //   }, 100);
  // }

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

  /**
   * 初始化 Mermaid 图表的拖拽缩放功能
   */
  // initMermaidPanZoom(): void {
  //   try {
  //     // 查找所有准备就绪但尚未初始化的 Mermaid 容器
  //     const mermaidContainers = this.el.nativeElement.querySelectorAll('.mermaid-container[data-svg-id][data-mermaid-ready]:not([data-pan-zoom-initialized])');

  //     mermaidContainers.forEach((container: HTMLElement) => {
  //       const svgId = container.getAttribute('data-svg-id');
  //       const svg = container.querySelector(`svg#${svgId}`) as SVGElement;

  //       if (svg && !(container as any)._panZoomInstance) {
  //         try {
  //           const panZoomInstance = svgPanZoom(svg, {
  //             zoomEnabled: true,
  //             controlIconsEnabled: false,
  //             fit: true,
  //             center: true,
  //             minZoom: 0.1,
  //             maxZoom: 10,
  //             zoomScaleSensitivity: 0.3,
  //             dblClickZoomEnabled: true,
  //             mouseWheelZoomEnabled: true,
  //             preventMouseEventsDefault: true,
  //             panEnabled: true
  //           });

  //           // 存储实例
  //           (container as any)._panZoomInstance = panZoomInstance;

  //           // 标记为已初始化
  //           container.setAttribute('data-pan-zoom-initialized', 'true');

  //           // 添加控制按钮事件监听
  //           container.addEventListener('mermaid-zoom-in', () => panZoomInstance.zoomIn());
  //           container.addEventListener('mermaid-zoom-out', () => panZoomInstance.zoomOut());
  //           container.addEventListener('mermaid-reset', () => {
  //             panZoomInstance.resetZoom();
  //             panZoomInstance.center();
  //             panZoomInstance.fit();
  //           });
  //           container.addEventListener('mermaid-fullscreen', () => {
  //             this.openMermaidFullscreen(svg, svgId);
  //           });

  //           // 鼠标悬停时显示控制按钮
  //           container.addEventListener('mouseenter', () => {
  //             const controls = container.querySelector('.mermaid-controls') as HTMLElement;
  //             if (controls) controls.style.opacity = '1';
  //           });

  //           container.addEventListener('mouseleave', () => {
  //             const controls = container.querySelector('.mermaid-controls') as HTMLElement;
  //             if (controls) controls.style.opacity = '0.7';
  //           });

  //           // 设置拖拽时的光标
  //           svg.addEventListener('mousedown', () => {
  //             container.style.cursor = 'grabbing';
  //           });

  //           // 使用更好的方式监听鼠标释放
  //           svg.addEventListener('mouseup', () => {
  //             container.style.cursor = 'grab';
  //           });

  //           svg.addEventListener('mouseleave', () => {
  //             container.style.cursor = 'grab';
  //           });

  //           console.log(`Initialized svg-pan-zoom for Mermaid diagram: ${svgId}`);
  //         } catch (error) {
  //           console.warn(`Failed to initialize svg-pan-zoom for ${svgId}:`, error);
  //         }
  //       }
  //     });
  //   } catch (error) {
  //     console.error('Error initializing Mermaid pan-zoom:', error);
  //   }
  // }

  /**
   * 打开 Mermaid 图表全屏模态框
   */
  // openMermaidFullscreen(svg: SVGElement, diagramId: string): void {
  //   try {
  //     // 克隆 SVG 元素
  //     const clonedSvg = svg.cloneNode(true) as SVGElement;

  //     // 确保克隆的 SVG 有唯一的 ID
  //     const fullscreenId = `${diagramId}-fullscreen`;
  //     clonedSvg.id = fullscreenId;

  //     // 创建模态框内容
  //     const modalContent = `
  //       <div class="mermaid-fullscreen-container" style="
  //         width: 100%;
  //         height: 70vh;
  //         display: flex;
  //         justify-content: center;
  //         align-items: center;
  //         background-color: #fafafa;
  //         border-radius: 8px;
  //         position: relative;
  //         overflow: hidden;
  //       ">
  //         <div class="mermaid-fullscreen-controls" style="
  //           position: absolute;
  //           top: 16px;
  //           right: 16px;
  //           z-index: 10;
  //           display: flex;
  //           gap: 8px;
  //         ">
  //           <button id="fullscreen-zoom-in" style="
  //             background: #fff;
  //             border: 1px solid #d9d9d9;
  //             color: #333;
  //             border-radius: 6px;
  //             width: 32px;
  //             height: 32px;
  //             cursor: pointer;
  //             display: flex;
  //             align-items: center;
  //             justify-content: center;
  //             font-size: 16px;
  //             box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  //             transition: all 0.2s;
  //           " title="放大">+</button>
  //           <button id="fullscreen-zoom-out" style="
  //             background: #fff;
  //             border: 1px solid #d9d9d9;
  //             color: #333;
  //             border-radius: 6px;
  //             width: 32px;
  //             height: 32px;
  //             cursor: pointer;
  //             display: flex;
  //             align-items: center;
  //             justify-content: center;
  //             font-size: 16px;
  //             box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  //             transition: all 0.2s;
  //           " title="缩小">-</button>
  //           <button id="fullscreen-reset" style="
  //             background: #fff;
  //             border: 1px solid #d9d9d9;
  //             color: #333;
  //             border-radius: 6px;
  //             width: 32px;
  //             height: 32px;
  //             cursor: pointer;
  //             display: flex;
  //             align-items: center;
  //             justify-content: center;
  //             font-size: 14px;
  //             box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  //             transition: all 0.2s;
  //           " title="重置">⌂</button>
  //         </div>
  //         <div class="mermaid-fullscreen-svg-wrapper" style="
  //           width: 100%;
  //           height: 100%;
  //           display: flex;
  //           justify-content: center;
  //           align-items: center;
  //           cursor: grab;
  //         "></div>
  //       </div>
  //     `;

  //     // 打开模态框
  //     const modalRef = this.modal.create({
  //       nzTitle: 'Mermaid 图表 - 全屏查看',
  //       nzContent: modalContent,
  //       nzWidth: '90vw',
  //       nzBodyStyle: { padding: '16px' },
  //       nzFooter: null,
  //       nzClosable: true,
  //       nzMaskClosable: true,
  //       nzKeyboard: true,
  //       nzCentered: true,
  //       nzOnCancel: () => {
  //         // 清理全屏模式下的 svg-pan-zoom 实例
  //         const fullscreenInstance = (modalRef as any)._fullscreenPanZoom;
  //         if (fullscreenInstance && typeof fullscreenInstance.destroy === 'function') {
  //           try {
  //             fullscreenInstance.destroy();
  //           } catch (error) {
  //             console.warn('Failed to destroy fullscreen svg-pan-zoom instance:', error);
  //           }
  //         }
  //       }
  //     });

  //     // 模态框打开后初始化 SVG
  //     setTimeout(() => {
  //       try {
  //         const modalElement = modalRef.getContentComponent();
  //         const svgWrapper = document.querySelector('.mermaid-fullscreen-svg-wrapper') as HTMLElement;

  //         if (svgWrapper) {
  //           // 添加克隆的 SVG 到容器中
  //           svgWrapper.appendChild(clonedSvg);

  //           // 初始化全屏模式的 svg-pan-zoom
  //           const fullscreenPanZoom = svgPanZoom(clonedSvg, {
  //             zoomEnabled: true,
  //             controlIconsEnabled: false,
  //             fit: true,
  //             center: true,
  //             minZoom: 0.1,
  //             maxZoom: 20,
  //             zoomScaleSensitivity: 0.3,
  //             dblClickZoomEnabled: true,
  //             mouseWheelZoomEnabled: true,
  //             preventMouseEventsDefault: true,
  //             panEnabled: true
  //           });

  //           // 存储实例以便后续清理
  //           (modalRef as any)._fullscreenPanZoom = fullscreenPanZoom;

  //           // 绑定控制按钮事件
  //           const zoomInBtn = document.getElementById('fullscreen-zoom-in');
  //           const zoomOutBtn = document.getElementById('fullscreen-zoom-out');
  //           const resetBtn = document.getElementById('fullscreen-reset');

  //           if (zoomInBtn) {
  //             zoomInBtn.addEventListener('click', () => fullscreenPanZoom.zoomIn());
  //             zoomInBtn.addEventListener('mouseenter', () => {
  //               (zoomInBtn as HTMLElement).style.backgroundColor = '#f0f0f0';
  //             });
  //             zoomInBtn.addEventListener('mouseleave', () => {
  //               (zoomInBtn as HTMLElement).style.backgroundColor = '#fff';
  //             });
  //           }

  //           if (zoomOutBtn) {
  //             zoomOutBtn.addEventListener('click', () => fullscreenPanZoom.zoomOut());
  //             zoomOutBtn.addEventListener('mouseenter', () => {
  //               (zoomOutBtn as HTMLElement).style.backgroundColor = '#f0f0f0';
  //             });
  //             zoomOutBtn.addEventListener('mouseleave', () => {
  //               (zoomOutBtn as HTMLElement).style.backgroundColor = '#fff';
  //             });
  //           }

  //           if (resetBtn) {
  //             resetBtn.addEventListener('click', () => {
  //               fullscreenPanZoom.resetZoom();
  //               fullscreenPanZoom.center();
  //               fullscreenPanZoom.fit();
  //             });
  //             resetBtn.addEventListener('mouseenter', () => {
  //               (resetBtn as HTMLElement).style.backgroundColor = '#f0f0f0';
  //             });
  //             resetBtn.addEventListener('mouseleave', () => {
  //               (resetBtn as HTMLElement).style.backgroundColor = '#fff';
  //             });
  //           }

  //           // 设置拖拽光标
  //           clonedSvg.addEventListener('mousedown', () => {
  //             svgWrapper.style.cursor = 'grabbing';
  //           });

  //           clonedSvg.addEventListener('mouseup', () => {
  //             svgWrapper.style.cursor = 'grab';
  //           });

  //           clonedSvg.addEventListener('mouseleave', () => {
  //             svgWrapper.style.cursor = 'grab';
  //           });

  //           console.log(`Initialized fullscreen svg-pan-zoom for Mermaid diagram: ${fullscreenId}`);
  //         }
  //       } catch (error) {
  //         console.error('Failed to initialize fullscreen Mermaid view:', error);
  //         this.message.error('全屏查看初始化失败');
  //       }
  //     }, 100);

  //   } catch (error) {
  //     console.error('Failed to open Mermaid fullscreen:', error);
  //     this.message.error('无法打开全屏查看');
  //   }
  // }
}
