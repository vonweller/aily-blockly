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

  constructor() {
    // 初始化 Mermaid
    this.initializeMermaid();
  }

  ngOnInit() {
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

      // 检查内容是否可以被渲染
      if (!this.canBeRendered(this.rawCode)) {
        this.isLoading = true;
        this.renderedSvg = '';
        this.errorMessage = '';
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
   * 检查内容是否可以被渲染
   */
  private canBeRendered(code: string): boolean {
    // 首先检查基本的完整性
    if (!this.isMermaidCodeComplete(code)) {
      return false;
    }

    // 检查是否包含足够的内容
    const trimmedCode = code.trim();
    if (trimmedCode.length < 10) {
      return false;
    }

    // 检查是否看起来像正在输入中的内容
    if (this.looksLikePartialInput(trimmedCode)) {
      return false;
    }

    return true;
  }

  /**
   * 检查是否看起来像部分输入的内容
   */
  private looksLikePartialInput(code: string): boolean {
    const lines = code.split('\n');
    
    // 如果只有一行且很短，可能是正在输入
    if (lines.length === 1 && code.length < 20) {
      return true;
    }

    // 检查最后几行是否看起来不完整
    const lastFewLines = lines.slice(-3).join('\n').trim();
    
    // 如果最后的内容以常见的开始关键字结尾但没有更多内容
    const incompleteStartPatterns = [
      /graph\s*$/i,
      /flowchart\s*$/i,
      /sequencediagram\s*$/i,
      /classdiagram\s*$/i,
      /gantt\s*$/i,
      /pie\s*$/i,
      /statediagram\s*$/i,
      /participant\s+\w+\s*$/i,
      /class\s+\w+\s*$/i,
    ];

    if (incompleteStartPatterns.some(pattern => pattern.test(lastFewLines))) {
      return true;
    }

    return false;
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

      // 验证 Mermaid 语法
      const isValid = await mermaid.parse(code);
      if (!isValid) {
        throw new Error('Invalid Mermaid syntax');
      }

      // 渲染 Mermaid 图表
      const { svg } = await mermaid.render(diagramId, code);

      // 为 SVG 添加必要的属性
      const enhancedSvg = svg.replace(
        '<svg',
        `<svg id="${diagramId}" data-mermaid-svg="true"`
      );

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

      // 如果是语法错误且代码可能不完整，显示加载状态
      if (error.message?.includes('syntax') && this.mightBeIncomplete(code)) {
        this.isLoading = true;
        return;
      }

      this.errorMessage = error.message || '图表渲染失败';
    }
  }

  /**
   * 检查 Mermaid 代码是否完整
   */
  private isMermaidCodeComplete(code: string): boolean {
    const trimmedCode = code.trim();

    // 如果代码为空或太短，认为不完整
    if (!trimmedCode || trimmedCode.length < 5) {
      return false;
    }

    // 检查是否包含基本的图表类型关键字
    const diagramTypes = [
      'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
      'erDiagram', 'gantt', 'pie', 'gitgraph', 'mindmap',
      'timeline', 'journey', 'stateDiagram', 'state', 'c4context'
    ];

    const hasValidStart = diagramTypes.some(type => 
      trimmedCode.toLowerCase().includes(type.toLowerCase())
    );
    
    if (!hasValidStart) {
      return false;
    }

    // 检查是否以不完整的语句结尾
    const incompleteSuffixes = [
      '->', '-->', '---', '==>', '-.', '=', '-', '|', '[', '(', '{',
      '--', '..', ':::', '~~~', '```', '***', '///', '###'
    ];
    
    const endsIncomplete = incompleteSuffixes.some(suffix =>
      trimmedCode.endsWith(suffix) || 
      trimmedCode.endsWith(suffix + ' ') ||
      trimmedCode.endsWith(' ' + suffix)
    );

    if (endsIncomplete) {
      return false;
    }

    // 检查括号、引号等是否配对
    if (!this.areDelimitersBalanced(trimmedCode)) {
      return false;
    }

    // 检查是否包含基本的节点或连接
    if (!this.hasBasicStructure(trimmedCode)) {
      return false;
    }

    // 检查代码是否以常见的不完整模式结尾
    if (this.endsWithIncompletePattern(trimmedCode)) {
      return false;
    }

    return true;
  }

  /**
   * 检查分隔符是否平衡（括号、引号等）
   */
  private areDelimitersBalanced(code: string): boolean {
    const pairs = [
      ['[', ']'],
      ['(', ')'],
      ['{', '}'],
      ['"', '"'],
      ["'", "'"],
      ['`', '`']
    ];

    for (const [open, close] of pairs) {
      let count = 0;
      let inString = false;
      let stringChar = '';

      for (let i = 0; i < code.length; i++) {
        const char = code[i];
        
        // 处理字符串内容
        if ((char === '"' || char === "'" || char === '`') && !inString) {
          inString = true;
          stringChar = char;
          continue;
        } else if (char === stringChar && inString) {
          // 检查是否是转义字符
          if (i > 0 && code[i-1] !== '\\') {
            inString = false;
            stringChar = '';
          }
          continue;
        }

        // 如果在字符串内，跳过括号检查
        if (inString) continue;

        if (char === open) {
          count++;
        } else if (char === close) {
          count--;
          if (count < 0) return false; // 右括号多于左括号
        }
      }

      // 对于引号类字符，检查是否成对出现
      if ((open === close) && count % 2 !== 0) {
        return false;
      }
      // 对于括号类字符，检查是否完全匹配
      else if (open !== close && count !== 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查是否包含基本的图表结构
   */
  private hasBasicStructure(code: string): boolean {
    const lowerCode = code.toLowerCase();
    
    // 对于流程图，检查是否有节点连接
    if (lowerCode.includes('graph') || lowerCode.includes('flowchart')) {
      const hasConnection = /[a-z0-9_]+\s*[-=]+[>|]\s*[a-z0-9_]+/i.test(code);
      const hasNode = /[a-z0-9_]+(\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/i.test(code);
      return hasConnection || hasNode;
    }

    // 对于序列图，检查是否有参与者或消息
    if (lowerCode.includes('sequencediagram')) {
      const hasParticipant = /participant\s+\w+/i.test(code);
      const hasMessage = /\w+\s*[-=]+[>|]\s*\w+/i.test(code);
      return hasParticipant || hasMessage;
    }

    // 对于类图，检查是否有类定义
    if (lowerCode.includes('classdiagram')) {
      const hasClass = /class\s+\w+/i.test(code);
      const hasRelation = /\w+\s*[<>|*+\-=]+\s*\w+/i.test(code);
      return hasClass || hasRelation;
    }

    // 对于甘特图，检查是否有任务
    if (lowerCode.includes('gantt')) {
      const hasTask = /\w+\s*:\s*\w+/i.test(code);
      return hasTask;
    }

    // 对于饼图，检查是否有数据
    if (lowerCode.includes('pie')) {
      const hasData = /"\w+"\s*:\s*\d+/i.test(code);
      return hasData;
    }

    // 对于状态图，检查是否有状态
    if (lowerCode.includes('statediagram') || lowerCode.includes('state')) {
      const hasState = /\w+\s*-->\s*\w+/i.test(code);
      const hasStateDefinition = /state\s+\w+/i.test(code);
      return hasState || hasStateDefinition;
    }

    // 默认情况，如果包含基本的标识符，认为有结构
    return /[a-z0-9_]+/i.test(code);
  }

  /**
   * 检查是否以不完整的模式结尾
   */
  private endsWithIncompletePattern(code: string): boolean {
    const lines = code.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    
    // 检查最后一行是否以不完整的模式结尾
    const incompletePatterns = [
      /\w+\s*-$/,           // 节点名后跟单个连字符
      /\w+\s*=$/,           // 节点名后跟等号
      /\w+\s*\|$/,          // 节点名后跟竖线
      /\w+\s*<$/,           // 节点名后跟小于号
      /\w+\s*>$/,           // 节点名后跟大于号
      /--\s*$/,             // 双连字符结尾
      /==\s*$/,             // 双等号结尾
      /\[\s*$/,             // 左方括号结尾
      /\(\s*$/,             // 左圆括号结尾
      /\{\s*$/,             // 左花括号结尾
      /:\s*$/,              // 冒号结尾
      /;\s*$/,              // 分号结尾
      /,\s*$/,              // 逗号结尾
      /\.\s*$/,             // 句号结尾（可能是不完整的）
      /\w+\s*\[\s*$/,       // 节点名后跟左方括号
      /\w+\s*\(\s*$/,       // 节点名后跟左圆括号
      /participant\s*$/i,   // participant 关键字但没有名称
      /class\s*$/i,         // class 关键字但没有名称
      /state\s*$/i,         // state 关键字但没有名称
    ];

    return incompletePatterns.some(pattern => pattern.test(lastLine));
  }

  /**
   * 判断代码是否可能不完整（用于错误处理）
   */
  private mightBeIncomplete(code: string): boolean {
    const trimmedCode = code.trim();

    // 如果代码太短，可能不完整
    if (trimmedCode.length < 15) {
      return true;
    }

    // 使用相同的完整性检查逻辑
    return !this.isMermaidCodeComplete(trimmedCode);
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

  logDetail(){
    console.log('Mermaid Viewer Data:', this.data);
  }
}
