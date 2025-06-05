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
   * 检查是否为特殊的 Aily 代码块类型
   */
  private isAilyCodeBlock(lang: string): boolean {
    const ailyTypes = ['aily-blockly', 'aily-board', 'aily-library', 'aily-state'];
    return ailyTypes.includes(lang);
  }

  /**
   * 渲染 Aily 特殊代码块为组件占位符
   */
  private renderAilyCodeBlockWithComponent(code: string, type: string): string {
    try {
      // 解析代码内容
      const parsedContent = this.parseAilyContent(code, type);

      // 生成唯一的组件 ID
      const componentId = `aily-component-${++MarkdownPipe.componentCounter}`;

      // 将数据编码为 Base64 以避免 HTML 转义问题
      // const encodedData = btoa(JSON.stringify(parsedContent));

      // 返回包含组件占位符的 HTML
      // 这个占位符将在后续的指令处理中被替换为真正的 Angular 组件
      return `<div class="aily-code-block-placeholder" 
                   data-aily-type="${type}" 
                   data-aily-data="${'encodedData'}" 
                   data-component-id="${componentId}"
                   style="
                     border: 1px solid #d9d9d9;
                     border-radius: 6px;
                     margin: 12px 0;
                     background-color: #fafafa;
                     padding: 16px;
                     text-align: center;
                   ">
        <!-- Aily ${type} Component Placeholder -->
        <div class="loading-placeholder" style="
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: #666;
        ">
          <div class="loading-spinner" style="
            width: 20px;
            height: 20px;
            border: 2px solid #f0f0f0;
            border-top: 2px solid #1890ff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          "></div>
          <span style="font-size: 14px;">正在加载 ${type} 组件...</span>
          <style>
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </div>
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
      // 尝试解析为 JSON
      const jsonData = JSON.parse(code);

      // 根据类型验证和规范化数据
      switch (type) {
        case 'aily-blockly':
          return {
            type: 'aily-blockly',
            blocks: jsonData.blocks || jsonData,
            workspace: jsonData.workspace || {},
            metadata: jsonData.metadata || {}
          };        case 'aily-board':
          return {
            type: 'aily-board',
            board: jsonData.board || jsonData,
            config: jsonData.config || {},
            metadata: jsonData.metadata || {}
          };

        case 'aily-library':
          return {
            type: 'aily-library',
            library: jsonData.library || jsonData,
            dependencies: jsonData.dependencies || [],
            metadata: jsonData.metadata || {}
          };

        case 'aily-state':
          return {
            type: 'aily-state',
            state: jsonData.state || jsonData,
            id: jsonData.id || `state-${Date.now()}`,
            text: jsonData.text || jsonData.message || '',
            metadata: jsonData.metadata || {}
          };

        default:
          throw new Error(`Unknown type: ${type}`);
      }
    } catch {
      // 如果不是 JSON，返回原始字符串格式的数据
      return {
        type: type,
        raw: code,
        content: code.trim(),
        metadata: { isRawText: true }
      } as any;
    }
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
