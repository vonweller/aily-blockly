import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import mermaid from 'mermaid';

export interface AilyMermaidData {
  type: 'aily-mermaid';
  code?: string;
  content?: string;
  raw?: string;
  metadata?: any;
}

/**
 * Aily Mermaid 查看器组件
 * 用于渲染 Mermaid 图表
 */
@Component({
  selector: 'app-aily-mermaid-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './aily-mermaid-viewer.component.html',
  styleUrls: ['./aily-mermaid-viewer.component.scss']
})
export class AilyMermaidViewerComponent implements OnInit, OnDestroy, OnChanges {
  @Input() data: AilyMermaidData | null = null;

  errorMessage = '';
  isLoading = false;
  rawCode = '';
  renderedSvg = '';
  containerId = '';

  constructor() { }

  ngOnInit() {
    this.initializeMermaid();
    this.processData();
  }

  ngOnDestroy() {
    // 清理资源
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['data']) {
      this.processData();
    }
  }

  /**
   * 设置组件数据（由指令调用）
   */
  setData(data: AilyMermaidData): void {
    this.data = data;
    this.processData();
  }

  /**
   * 初始化 Mermaid
   */
  private initializeMermaid(): void {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'MiSans, sans-serif',
      htmlLabels: true,
      deterministicIds: false,
      deterministicIDSeed: undefined,
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true
      },
      sequence: {
        diagramMarginX: 50,
        diagramMarginY: 10,
        actorMargin: 50,
        width: 150,
        height: 65,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35,
        mirrorActors: true,
        bottomMarginAdj: 1,
        useMaxWidth: true,
        rightAngles: false,
        showSequenceNumbers: false
      },
      gantt: {
        useMaxWidth: true
      },
      themeVariables: {
        primaryColor: '#ff0000'
      }
    });
  }

  /**
   * 处理数据
   */
  private processData(): void {
    if (!this.data) {
      this.errorMessage = '没有可显示的 Mermaid 数据';
      this.isLoading = false;
      return;
    }

    try {
      // 提取 Mermaid 代码
      let code = this.data.code || this.data.content || this.data.raw || '';

      // 如果数据来自原始文本，可能需要解析
      if (this.data.metadata?.isRawText && !code) {
        code = this.data.raw || '';
      }

      this.rawCode = code.trim();
      this.errorMessage = '';

      if (!this.rawCode) {
        this.errorMessage = '没有找到 Mermaid 代码';
        this.isLoading = false;
        return;
      }

      // 渲染 Mermaid 图表
      this.renderMermaidDiagram(this.rawCode);
    } catch (error) {
      console.error('Error processing mermaid data:', error);
      this.errorMessage = `数据处理失败: ${error.message}`;
      this.isLoading = false;
    }
  }

  /**
   * 渲染 Mermaid 图表
   */
  private async renderMermaidDiagram(code: string): Promise<void> {
    try {
      this.isLoading = true;
      this.renderedSvg = '';

      // 生成唯一的图表 ID
      const diagramId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.containerId = `mermaid-container-${diagramId}`;

      // 在 Mermaid 11.x 中，parse 方法已经改变
      let isValid = true;
      try {
        await mermaid.parse(code);
      } catch (parseError) {
        console.warn('Mermaid parse validation failed:', parseError);
        // 即使解析失败，我们仍然尝试渲染，因为有些情况下 parse 可能误报
      }

      // 渲染 Mermaid 图表
      // 在 Mermaid 11.x 中，render 方法返回的结构发生了变化
      const renderResult = await mermaid.render(diagramId, code);

      // 根据 Mermaid 版本获取 SVG
      let svg: string;
      if (typeof renderResult === 'string') {
        // 旧版本直接返回 SVG 字符串
        svg = renderResult;
      } else if (renderResult && typeof renderResult === 'object') {
        // 新版本返回对象，可能包含 svg 属性
        svg = renderResult.svg || renderResult.toString();
      } else {
        throw new Error('Invalid render result from Mermaid');
      }

      if (!svg || typeof svg !== 'string') {
        throw new Error('Failed to get SVG from Mermaid render result');
      }

      // 为 SVG 添加必要的属性和样式
      const enhancedSvg = svg
        .replace('<svg', `<svg id="${diagramId}" data-mermaid-svg="true" style="max-width: 100%; height: auto;"`)
        .replace(/width="[^"]*"/, 'width="100%"')
        .replace(/height="[^"]*"/, ''); // 移除固定高度，让它自适应

      this.renderedSvg = enhancedSvg;
      this.isLoading = false;
      this.errorMessage = '';

      // 延迟发送事件，确保 DOM 已渲染
      setTimeout(() => {
        this.notifyMermaidReady(diagramId);
      }, 100);

    } catch (error) {
      console.error('Mermaid rendering error:', error);
      this.isLoading = false;
      this.errorMessage = error.message || '图表渲染失败';

      // 提供更详细的错误信息
      if (error.message?.includes('Parse error')) {
        this.errorMessage = '图表语法错误，请检查代码格式';
      } else if (error.message?.includes('Cannot read properties')) {
        this.errorMessage = '图表渲染失败，可能是版本兼容性问题';
      }
    }
  }

  /**
   * 通知 Mermaid 图表已准备就绪
   */
  private notifyMermaidReady(diagramId: string): void {
    try {
      // 发送自定义事件到文档
      const event = new CustomEvent('mermaidDiagramReady', {
        detail: { diagramId },
        bubbles: true
      });
      document.dispatchEvent(event);
    } catch (error) {
      console.warn('Failed to notify mermaid ready:', error);
    }
  }

  /**
   * 处理容器点击事件
   */
  onContainerClick(event: Event): void {
    // 可以在这里添加缩放、拖拽等交互功能
    console.log('Mermaid diagram clicked:', event);
  }

  logDetail() {
    console.log('Raw Code:', this.rawCode);
  }
}
