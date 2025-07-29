import {
  Component,
  ElementRef,
  Input,
  OnInit,
  OnDestroy,
  SecurityContext,
  ViewChild,
} from '@angular/core';
import { ChatService } from '../../services/chat.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { SpeechService } from '../../services/speech.service';
import { CommonModule } from '@angular/common';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { DomSanitizer } from '@angular/platform-browser';
import { NzImageModule } from 'ng-zorro-antd/image';
import { FormsModule } from '@angular/forms';
import { CachedMarkdownPipe } from '../../pipes/cached-markdown.pipe';
import { AilyDynamicComponentDirective } from '../../directives/aily-dynamic-component.directive';
import svgPanZoom from 'svg-pan-zoom';

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
    CachedMarkdownPipe,
    AilyDynamicComponentDirective,
    NzImageModule,
    // AilyCodingComponent,
  ],
})
export class DialogComponent implements OnInit, OnDestroy {
  @Input()
  data: any;

  get isDone() {
    if (typeof this.data.isDone == 'boolean') return this.data.isDone;
    return true;
  }

  set isDone(val) {
    this.data.isDone = val;
  }

  get mine() {
    return this.data.role == 'user';
  }

  get system() {
    return this.data.system;
  }

  get user() {
    return '';
  }

  loaded = false;
  private mermaidEventListener: (event: CustomEvent) => void;

  constructor(
    private message: NzMessageService,
    private speechService: SpeechService,
    private sanitizer: DomSanitizer,
    private chatService: ChatService,
    private el: ElementRef
  ) {
    // 监听 Mermaid 图表就绪事件
    this.setupMermaidEventListener();
  }

  ngOnInit(): void { }

  /**
   * 设置 Mermaid 事件监听器
   */
  private setupMermaidEventListener(): void {
    this.mermaidEventListener = (event: CustomEvent) => {
      // 确保事件来自当前组件的 Mermaid 图表
      const diagram = this.el.nativeElement.querySelector(`svg#${event.detail.diagramId}`);
      if (diagram) {
        console.log('Mermaid diagram ready, initializing pan-zoom:', event.detail.diagramId);
        // 延迟初始化以确保 DOM 完全更新
        setTimeout(() => {
          this.initMermaidPanZoom();
        }, 50);
      }
    };
    
    document.addEventListener('mermaidDiagramReady', this.mermaidEventListener);
  }

  ngOnDestroy(): void {
    // 清理事件监听器
    if (this.mermaidEventListener) {
      document.removeEventListener('mermaidDiagramReady', this.mermaidEventListener);
    }
    
    // 清理 svg-pan-zoom 实例
    const containers = this.el.nativeElement.querySelectorAll('.mermaid-container[data-pan-zoom-initialized]');
    containers.forEach((container: HTMLElement) => {
      const instance = (container as any)._panZoomInstance;
      if (instance && typeof instance.destroy === 'function') {
        try {
          instance.destroy();
        } catch (error) {
          console.warn('Failed to destroy svg-pan-zoom instance:', error);
        }
      }
    });
  }

  getSafeHTML(html: string) {
    return this.sanitizer.sanitize(SecurityContext.HTML, html);
  }

  ngAfterViewInit(): void {
    // 延迟初始化 Mermaid 图表，确保 DOM 已完全渲染
    setTimeout(() => {
      this.initMermaidPanZoom();
    }, 100);
  }

  /**
   * 初始化 Mermaid 图表的拖拽缩放功能
   */
  initMermaidPanZoom(): void {
    try {
      // 确保 svgPanZoom 在全局可用
      (window as any).svgPanZoom = svgPanZoom;
      
      // 查找所有准备就绪但尚未初始化的 Mermaid 容器
      const mermaidContainers = this.el.nativeElement.querySelectorAll('.mermaid-container[data-svg-id][data-mermaid-ready]:not([data-pan-zoom-initialized])');
      
      mermaidContainers.forEach((container: HTMLElement) => {
        const svgId = container.getAttribute('data-svg-id');
        const svg = container.querySelector(`svg#${svgId}`) as SVGElement;
        
        if (svg && !(container as any)._panZoomInstance) {
          try {
            const panZoomInstance = svgPanZoom(svg, {
              zoomEnabled: true,
              controlIconsEnabled: false,
              fit: true,
              center: true,
              minZoom: 0.1,
              maxZoom: 10,
              zoomScaleSensitivity: 0.3,
              dblClickZoomEnabled: true,
              mouseWheelZoomEnabled: true,
              preventMouseEventsDefault: true,
              panEnabled: true
            });
            
            // 存储实例
            (container as any)._panZoomInstance = panZoomInstance;
            
            // 标记为已初始化
            container.setAttribute('data-pan-zoom-initialized', 'true');
            
            // 添加控制按钮事件监听
            container.addEventListener('mermaid-zoom-in', () => panZoomInstance.zoomIn());
            container.addEventListener('mermaid-zoom-out', () => panZoomInstance.zoomOut());
            container.addEventListener('mermaid-reset', () => {
              panZoomInstance.resetZoom();
              panZoomInstance.center();
              panZoomInstance.fit();
            });
            
            // 鼠标悬停时显示控制按钮
            container.addEventListener('mouseenter', () => {
              const controls = container.querySelector('.mermaid-controls') as HTMLElement;
              if (controls) controls.style.opacity = '1';
            });
            
            container.addEventListener('mouseleave', () => {
              const controls = container.querySelector('.mermaid-controls') as HTMLElement;
              if (controls) controls.style.opacity = '0.7';
            });
            
            // 设置拖拽时的光标
            svg.addEventListener('mousedown', () => {
              container.style.cursor = 'grabbing';
            });
            
            // 使用更好的方式监听鼠标释放
            svg.addEventListener('mouseup', () => {
              container.style.cursor = 'grab';
            });
            
            svg.addEventListener('mouseleave', () => {
              container.style.cursor = 'grab';
            });
            
            console.log(`Initialized svg-pan-zoom for Mermaid diagram: ${svgId}`);
          } catch (error) {
            console.warn(`Failed to initialize svg-pan-zoom for ${svgId}:`, error);
          }
        }
      });
    } catch (error) {
      console.error('Error initializing Mermaid pan-zoom:', error);
    }
  }

  login() {
    // this.gptService.openAuthModel()
  }

  goto(url) {
    window.open(url, '_blank');
  }

  // async initMermaid() {
  //   let svgs = this.el.nativeElement.querySelectorAll('.language-mermaid')
  //   if (svgs.length == 0) return
  //   mermaid.initialize({ startOnLoad: false, });
  //   await mermaid.run({
  //     querySelector: '.language-mermaid',
  //   });
  //   let svg: any = this.el.nativeElement.querySelector('.language-mermaid svg');
  //   svgPanZoom(svg, {
  //     zoomEnabled: true,
  //     // controlIconsEnabled: true,
  //     fit: true,
  //     center: true,
  //     minZoom: 1,
  //     maxZoom: 10,
  //     zoomScaleSensitivity: 1,
  //   });
  // }
}
