import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
  renderedSvg: SafeHtml = '';
  rawSvgString = '';  // 保存原始 SVG 字符串用于调试
  containerId = '';

  constructor(private sanitizer: DomSanitizer) { }

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
      theme: 'dark',
      securityLevel: 'loose',
      fontFamily: 'MiSans, sans-serif',
      htmlLabels: true,
      deterministicIds: false,
      deterministicIDSeed: undefined,
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
        padding: 20
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
      this.renderedSvg = '';
      this.rawSvgString = '';
      return;
    }

    console.log('=== Processing Mermaid Data ===');
    console.log('Input data:', this.data);

    try {
      // 提取 Mermaid 代码
      let code = this.data.code || this.data.content || this.data.raw || '';

      // 如果数据来自原始文本，可能需要解析
      if (this.data.metadata?.isRawText && !code) {
        code = this.data.raw || '';
      }

      console.log('Extracted code:', code);

      this.rawCode = code.trim();
      this.errorMessage = '';

      if (!this.rawCode) {
        this.errorMessage = '没有找到 Mermaid 代码';
        this.isLoading = false;
        this.renderedSvg = '';
        this.rawSvgString = '';
        return;
      }

      // 渲染 Mermaid 图表
      this.renderMermaidDiagram(this.rawCode);
    } catch (error) {
      console.error('Error processing mermaid data:', error);
      this.errorMessage = `数据处理失败: ${error.message}`;
      this.isLoading = false;
      this.renderedSvg = '';
      this.rawSvgString = '';
    }
  }

  /**
   * 渲染 Mermaid 图表
   */
  private async renderMermaidDiagram(code: string): Promise<void> {
    try {
      this.isLoading = true;
      this.renderedSvg = '';
      this.rawSvgString = '';

      console.log('=== Rendering Mermaid Diagram ===');
      console.log('Code to render:', code);

      // 生成唯一的图表 ID
      const diagramId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.containerId = `mermaid-container-${diagramId}`;

      console.log('Diagram ID:', diagramId);
      console.log('Container ID:', this.containerId);

      // 验证 Mermaid 代码
      try {
        await mermaid.parse(code);
        console.log('Mermaid parse: SUCCESS');
      } catch (parseError) {
        console.warn('Mermaid parse warning:', parseError);
        // 继续尝试渲染，因为有些情况下 parse 可能误报
      }

      // 渲染 Mermaid 图表 - 使用与测试文件相同的方式
      console.log('Starting mermaid.render...');
      const renderResult = await mermaid.render(diagramId, code);
      console.log('Render result:', renderResult);
      console.log('Render result type:', typeof renderResult);

      // 获取 SVG 内容 - 优先使用 svg 属性
      let svg: string;
      if (typeof renderResult === 'object' && renderResult.svg) {
        svg = renderResult.svg;
        console.log('Using renderResult.svg');
      } else if (typeof renderResult === 'string') {
        svg = renderResult;
        console.log('Using renderResult as string');
      } else {
        throw new Error('Invalid render result from Mermaid');
      }

      if (!svg || typeof svg !== 'string') {
        throw new Error('Failed to get SVG from Mermaid render result');
      }

      console.log('SVG length:', svg.length);
      console.log('SVG preview:', svg.substring(0, 200) + '...');

      // 清理和增强 SVG
      const enhancedSvg = this.enhanceSvg(svg, diagramId);
      this.rawSvgString = enhancedSvg;  // 保存原始字符串
      this.renderedSvg = this.sanitizer.bypassSecurityTrustHtml(enhancedSvg);  // 安全地绕过清理
      this.isLoading = false;
      this.errorMessage = '';

      console.log('Enhanced SVG length:', enhancedSvg.length);

      // 延迟发送事件，确保 DOM 已渲染
      setTimeout(() => {
        this.notifyMermaidReady(diagramId);
        console.log('Mermaid diagram rendering completed');
        // 不需要额外的样式应用，因为主题配置已经足够
      }, 100);

    } catch (error) {
      console.error('Mermaid rendering error:', error);
      this.isLoading = false;
      this.renderedSvg = '';
      this.rawSvgString = '';
      this.errorMessage = this.getErrorMessage(error);
    }
  }

  /**
   * 增强 SVG 内容
   */
  private enhanceSvg(svg: string, diagramId: string): string {
    return svg
      .replace('<svg', `<svg id="${diagramId}" data-mermaid-svg="true"`)
      .replace(/width="[^"]*"/, 'width="100%"')
      .replace(/height="[^"]*"/, 'height="auto"')
      .replace(/<svg([^>]*)>/, (match, attrs) => {
        return `<svg${attrs} style="max-width: 100%; height: auto; display: block;">`;
      });
  }

  /**
   * 获取错误信息
   */
  private getErrorMessage(error: any): string {
    if (error.message?.includes('Parse error')) {
      return '图表语法错误，请检查代码格式';
    } else if (error.message?.includes('Cannot read properties')) {
      return '图表渲染失败，可能是版本兼容性问题';
    } else if (error.message?.includes('Invalid render result')) {
      return '图表渲染失败，无法获取有效的 SVG 内容';
    }
    return error.message || '图表渲染失败';
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

  logDetail() {
    console.log('Raw Code:', this.rawCode);
    // 检查 DOM 中的 SVG 元素
    if (this.containerId) {
      const container = document.getElementById(this.containerId);
      console.log('Container element:', container);
      if (container) {
        const svg = container.querySelector('svg');
        console.log('SVG element:', svg);
        console.log('SVG innerHTML length:', svg?.innerHTML?.length || 0);
      }
    }
  }

}
