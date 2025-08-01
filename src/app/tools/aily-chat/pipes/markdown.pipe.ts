import {
  Pipe,
  PipeTransform
} from '@angular/core';
import { Marked, Renderer } from 'marked';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { markedHighlight } from 'marked-highlight';
import { codeToHtml } from 'shiki';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import mermaid from 'mermaid';

/**
 * 扩展的 Markdown 管道，支持动态 Angular 组件渲染
 * 
 * 此管道将在检测到特殊的 Aily 代码块时，生成带有特殊标记的 HTML，
 * 然后通过指令系统将这些标记替换为真正的 Angular 组件
 */
@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  private marked: Marked;
  private static componentCounter = 0;
  constructor(
    private sanitizer: DomSanitizer
  ) {
    // 初始化 Mermaid
    this.initializeMermaid();

    this.marked = new Marked(
      markedHighlight({
        async: true,
        langPrefix: 'hljs language-',
        highlight: async (code: string, lang: string) => {
          try {
            // 检查是否为特殊的 Aily 代码块类型
            if (this.isAilyCodeBlock(lang)) {
              return this.renderAilyCodeBlockWithComponent(code, lang as any);
            }

            // 检查是否为 Mermaid 图表
            if (lang?.toLowerCase() === 'mermaid') {
              return this.renderMermaidDiagram(code);
            }

            // 处理语言别名
            const langMap: { [key: string]: string } = {
              'cpp': 'cpp',
              'c++': 'cpp',
              'c': 'c',
              'arduino': 'cpp',
              'ino': 'cpp'
            };

            const normalizedLang = langMap[lang?.toLowerCase()] || lang || 'text';

            const html = await codeToHtml(code, {
              lang: normalizedLang,
              theme: 'github-dark'
            });
            return html;
          } catch (error) {
            console.warn('Code highlighting failed for language:', lang, error);
            // 返回基本的代码块格式
            return `<pre class="shiki"><code>${code}</code></pre>`;
          }
        }
      })
    );

    // 配置渲染器选项
    this.marked.setOptions({
      breaks: true,
      gfm: true,
    });

    // 自定义渲染器
    const renderer = new Renderer();

    // 自定义链接渲染，添加 target="_blank"
    renderer.link = ({ href, title, tokens }) => {
      // 简单提取文本内容
      const text = tokens.map(token => {
        if (token.type === 'text') {
          return (token as any).text;
        }
        return token.raw || '';
      }).join('');
      return `<a href="${href}" ${title ? `title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${text}</a>`;
    };

    this.marked.use({ renderer });
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
   * 渲染 Mermaid 图表
   */
  private async renderMermaidDiagram(code: string): Promise<string> {
    try {
      // 检查代码是否完整
      if (!this.isMermaidCodeComplete(code)) {
        return this.renderMermaidLoading(code);
      }

      // 生成唯一的图表 ID
      const diagramId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const containerId = `mermaid-container-${diagramId}`;

      // 验证 Mermaid 语法
      const isValid = await mermaid.parse(code);
      if (!isValid) {
        throw new Error('Invalid Mermaid syntax');
      }

      // 渲染 Mermaid 图表
      const { svg } = await mermaid.render(diagramId, code);

      // 为 SVG 添加必要的属性以支持 svg-pan-zoom
      const enhancedSvg = svg.replace(
        '<svg',
        `<svg id="${diagramId}" data-mermaid-svg="true"`
      );

      // 返回包装后的 SVG，包含缩放和拖拽功能
      const html = `<div class="mermaid-container" id="${containerId}" style="
        position: relative;
        overflow: hidden;
        min-height: 200px;
        cursor: grab;
        user-select: none;
        " data-svg-id="${diagramId}" data-mermaid-ready="true">
        <div class="mermaid-svg-wrapper" style="
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
        ">
          ${enhancedSvg}
        </div>
      </div>`;
      // 延迟发送事件，确保 DOM 已渲染
      setTimeout(() => {
        this.notifyMermaidReady(diagramId);
      }, 100);

      return html;
    } catch (error) {
      console.error('Mermaid rendering error:', error);

      // 如果是语法错误且代码可能不完整，显示加载状态
      if (error.message?.includes('syntax') && this.mightBeIncomplete(code)) {
        return this.renderMermaidLoading(code);
      }

      // 渲染失败时显示错误信息和原始代码
      return `<div class="mermaid-error" style="
        margin: 16px 0;
        padding: 16px;
        background-color: #fff2f0;
        border: 1px solid #ffccc7;
        border-radius: 6px;
        color: #ff4d4f;
      ">
        <div style="font-weight: 600; margin-bottom: 8px;">
          🚫 Mermaid 图表渲染失败
        </div>
        <div style="font-size: 12px; margin-bottom: 12px; color: #8c8c8c;">
          错误信息: ${error.message || '未知错误'}
        </div>
        <details style="cursor: pointer;">
          <summary style="margin-bottom: 8px; color: #595959;">显示原始代码</summary>
          <pre style="
            background-color: #f5f5f5;
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
          "><code>${this.escapeHtml(code)}</code></pre>
        </details>
      </div>`;
    }
  }

  /**
   * 检查 Mermaid 代码是否完整
   */
  private isMermaidCodeComplete(code: string): boolean {
    const trimmedCode = code.trim();

    // 检查基本的图表类型关键字
    const diagramTypes = [
      'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
      'erDiagram', 'gantt', 'pie', 'gitgraph', 'mindmap',
      'timeline', 'journey', 'gitgraph:', 'stateDiagram'
    ];

    const hasValidStart = diagramTypes.some(type => trimmedCode.toLowerCase().startsWith(type.toLowerCase()));
    if (!hasValidStart) {
      return false;
    }

    // 检查是否有基本的语法结构
    if (trimmedCode.length < 10) {
      return false;
    }

    // 检查是否以不完整的语句结尾
    const incompleteSuffixes = ['->', '-->', '---', '==>', '-.', '=', '-', '|', '[', '(', '{'];
    const endsIncomplete = incompleteSuffixes.some(suffix =>
      trimmedCode.endsWith(suffix) || trimmedCode.endsWith(suffix + ' ')
    );

    if (endsIncomplete) {
      return false;
    }

    return true;
  }

  /**
   * 判断代码是否可能不完整（用于错误处理）
   */
  private mightBeIncomplete(code: string): boolean {
    const trimmedCode = code.trim();

    // 如果代码太短，可能不完整
    if (trimmedCode.length < 20) {
      return true;
    }

    // 检查是否以常见的不完整模式结尾
    const incompletePatterns = [
      /-->\s*$/, /\|\s*$/, /\[\s*$/, /\(\s*$/, /\{\s*$/,
      /-\s*$/, /=\s*$/, /:\s*$/, /;\s*$/
    ];

    return incompletePatterns.some(pattern => pattern.test(trimmedCode));
  }

  /**
   * 渲染 Mermaid 加载状态
   */
  private renderMermaidLoading(code: string): string {
    const loadingId = `mermaid-loading-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return `<div class="mermaid-loading" id="${loadingId}" style="
      margin: 16px 0;
      padding: 24px;
      background-color: #fafafa;
      border: 1px solid #d9d9d9;
      border-radius: 6px;
      text-align: center;
      min-height: 120px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 12px;
      color: #666;
    ">
      <div class="mermaid-loading-spinner" style="
        width: 24px;
        height: 24px;
        border: 2px solid #f0f0f0;
        border-top: 2px solid #1890ff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      "></div>
      <div style="font-size: 14px; font-weight: 500;">
        📊 图表渲染中...
      </div>
      <div style="font-size: 12px; color: #999;">
        正在等待完整的 Mermaid 代码
      </div>
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </div>`;
  }

  /**
   * 通知 Mermaid 图表已准备就绪
   */
  private notifyMermaidReady(diagramId: string): void {
    try {
      // 发送自定义事件到文档，DialogComponent 可以监听此事件
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
   * HTML 转义工具函数
   */
  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }  /**
   * 检查是否为特殊的 Aily 代码块类型
   */
  private isAilyCodeBlock(lang: string): boolean {
    const ailyTypes = ['aily-blockly', 'aily-board', 'aily-library', 'aily-state', 'aily-button'];
    return ailyTypes.includes(lang);
  }/**
   * 渲染 Aily 特殊代码块为组件占位符
   */
  private renderAilyCodeBlockWithComponent(code: string, type: string): string {
    try {
      // 解析代码内容
      const parsedContent = this.parseAilyContent(code, type);

      // 生成唯一的组件 ID
      const componentId = `aily-component-${++MarkdownPipe.componentCounter}`;      // 使用安全的 Base64 编码以避免 UTF-8 字符问题
      const encodedData = safeBase64Encode(JSON.stringify(parsedContent));

      // 返回包含组件占位符的 HTML
      // 这个占位符将在后续的指令处理中被替换为真正的 Angular 组件
      return `<div class="aily-code-block-placeholder" 
                   data-aily-type="${type}" 
                   data-aily-data="${encodedData}" 
                   data-component-id="${componentId}">
                  <!-- Aily ${type} Component Placeholder -->
              </div>`;
    } catch (error) {
      console.error(`Error preparing ${type} component:`, error);
      return this.renderFallbackCodeBlock(code, type, error);
    }
  }

  /**
   * 渲染降级的代码块（当组件渲染失败时）
   */
  private renderFallbackCodeBlock(code: string, type: string, error?: any): string {
    return `<div class="aily-code-block error-block" data-type="${type}">
      <div class="aily-code-header">
        <span class="aily-code-type">Aily ${type}</span>
        <span class="error-badge">渲染失败</span>
      </div>
      <div class="error-message">
        组件渲染失败: ${error?.message || '未知错误'}
      </div>
      <div class="fallback-content">
        <pre><code>${code}</code></pre>
      </div>
    </div>`;
  }
  /**
   * 解析 Aily 代码内容
   */
  private parseAilyContent(code: string, type: string): any {
    try {
      // 清理代码内容 - 移除多余的空白字符和换行
      const cleanedCode = code.trim();

      // 尝试解析为 JSON
      const jsonData = JSON.parse(cleanedCode);

      // 根据类型验证和规范化数据
      switch (type) {
        case 'aily-blockly':
          return {
            type: 'aily-blockly',
            blocks: jsonData.blocks || jsonData,
            workspace: jsonData.workspace || {},
            metadata: jsonData.metadata || {},
            config: jsonData.config || {}
          };
        case 'aily-board':
          return {
            type: 'aily-board',
            board: this.validateBoardData(jsonData.board || jsonData),
            config: jsonData.config || {},
            metadata: jsonData.metadata || {}
          };

        case 'aily-library':
          return {
            type: 'aily-library',
            library: this.validateLibraryData(jsonData.library || jsonData),
            dependencies: jsonData.dependencies || [],
            metadata: jsonData.metadata || {}
          };
        case 'aily-state':
          return {
            type: 'aily-state',
            state: jsonData.state || jsonData.status || 'info',
            id: jsonData.id || `state-${Date.now()}`,
            text: jsonData.text || jsonData.message || jsonData.content || '',
            progress: jsonData.progress,
            metadata: jsonData.metadata || {}
          };
        case 'aily-button':
          return {
            type: 'aily-button',
            buttons: Array.isArray(jsonData) ? jsonData : (jsonData.buttons || [jsonData]),
            config: jsonData.config || {},
            metadata: jsonData.metadata || {}
          };
        default:
          console.warn(`Unknown aily type: ${type}, using raw data`);
          return {
            type: type,
            raw: cleanedCode,
            content: jsonData,
            metadata: { isUnknownType: true }
          };
      }
    } catch (parseError) {
      console.warn(`Failed to parse JSON for ${type}:`, parseError);
      console.log('Using raw content for rendering:', code);
      // 如果不是 JSON，返回原始字符串格式的数据
      return {
        type: type,
        raw: code,
        content: code.trim(),
        metadata: {
          isRawText: true,
          parseError: parseError.message
        }
      };
    }
  }

  /**
   * 验证开发板数据
   */
  private validateBoardData(boardData: any): any {
    if (!boardData || typeof boardData !== 'object') {
      throw new Error('Invalid board data: must be an object');
    }

    return {
      name: boardData.name || 'Unknown Board',
      nickname: boardData.nickname || boardData.name || 'Unknown Board',
      version: boardData.version || '1.0.0',
      description: boardData.description || '',
      author: boardData.author || '',
      brand: boardData.brand || '',
      url: boardData.url || '',
      compatibility: boardData.compatibility || '',
      img: boardData.img || '',
      disabled: Boolean(boardData.disabled),
      ...boardData
    };
  }

  /**
   * 验证库数据
   */
  private validateLibraryData(libraryData: any): any {
    if (!libraryData || typeof libraryData !== 'object') {
      throw new Error('Invalid library data: must be an object');
    }

    return {
      name: libraryData.name || 'Unknown Library',
      nickname: libraryData.nickname || libraryData.name || 'Unknown Library',
      version: libraryData.version || '1.0.0',
      description: libraryData.description || '',
      author: libraryData.author || '',
      compatibility: libraryData.compatibility || {},
      keywords: Array.isArray(libraryData.keywords) ? libraryData.keywords : [],
      tested: Boolean(libraryData.tested),
      icon: libraryData.icon || 'fa-light fa-cube',
      ...libraryData
    };
  }

  transform(value: any, ...args: any[]): Observable<SafeHtml> {
    if (!value) {
      return of(this.sanitizer.bypassSecurityTrustHtml(''));
    }

    const markdownText = String(value);

    return from(this.marked.parse(markdownText)).pipe(
      map((html: string) => {
        // 在这里，HTML 已经包含了组件占位符
        // 后续需要通过指令或其他机制将占位符替换为真正的组件
        return this.sanitizer.bypassSecurityTrustHtml(html);
      }),
      catchError((error) => {
        console.error('Markdown parsing error:', error);
        // 如果解析失败，返回原始文本
        return of(this.sanitizer.bypassSecurityTrustHtml(markdownText));
      })
    );
  }
}

/**
 * 安全的 Base64 编码工具函数，支持 UTF-8 字符
 */
export function safeBase64Encode(str: string): string {
  try {
    // 使用 TextEncoder 将字符串转换为 UTF-8 字节数组
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);

    // 将字节数组转换为二进制字符串
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }

    // 使用 btoa 对二进制字符串进行 Base64 编码
    return btoa(binaryString);
  } catch (error) {
    console.warn('Base64 encoding failed, using fallback:', error);
    // 降级方案：使用 encodeURIComponent
    return encodeURIComponent(str);
  }
}

/**
 * 安全的 Base64 解码工具函数，支持 UTF-8 字符
 */
export function safeBase64Decode(encodedStr: string): string {
  try {
    // 尝试 Base64 解码
    const binaryString = atob(encodedStr);

    // 将二进制字符串转换为字节数组
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 使用 TextDecoder 将字节数组转换为 UTF-8 字符串
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  } catch (error) {
    console.warn('Base64 decoding failed, using fallback:', error);
    // 降级方案：尝试 decodeURIComponent
    try {
      return decodeURIComponent(encodedStr);
    } catch {
      return encodedStr; // 如果都失败，返回原始字符串
    }
  }
}
