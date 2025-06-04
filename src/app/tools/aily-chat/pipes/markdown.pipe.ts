import { Pipe, PipeTransform } from '@angular/core';
import { Marked, Renderer } from 'marked';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { markedHighlight } from 'marked-highlight';
import { codeToHtml } from 'shiki';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  private marked: Marked;  constructor(private sanitizer: DomSanitizer) {
    this.marked = new Marked(
      markedHighlight({
        async: true,
        langPrefix: 'hljs language-',
        highlight: async (code: string, lang: string) => {
          try {
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

    // 移除自定义代码块渲染，让 marked-highlight 处理
    // renderer.code = ({ text, lang }) => {
    //   const language = lang || 'text';
    //   return `<pre><code class="hljs language-${language}">${text}</code></pre>`;
    // };

    this.marked.use({ renderer });
  }

  transform(value: any, ...args: any[]): Observable<SafeHtml> {
    if (!value) {
      return of(this.sanitizer.bypassSecurityTrustHtml(''));
    }

    const markdownText = String(value);
    
    return from(this.marked.parse(markdownText)).pipe(
      map((html: string) => this.sanitizer.bypassSecurityTrustHtml(html)),
      catchError((error) => {
        console.error('Markdown parsing error:', error);
        // 如果解析失败，返回原始文本
        return of(this.sanitizer.bypassSecurityTrustHtml(markdownText));
      })
    );
  }

}
