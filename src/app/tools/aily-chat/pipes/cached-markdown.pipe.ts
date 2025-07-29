import { Pipe, PipeTransform } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarkdownPipe } from './markdown.pipe';

/**
 * 缓存型 Markdown 管道 - 避免重复渲染相同内容的简化优化方案
 */
@Pipe({
  name: 'cachedMarkdown',
  standalone: true,
  pure: false // 设为 impure 以便控制缓存逻辑
})
export class CachedMarkdownPipe implements PipeTransform {
  private cache = new Map<string, SafeHtml>();
  private markdownPipe: MarkdownPipe;
  private lastInput: any = null;
  private lastOutput: Observable<SafeHtml> | null = null;

  constructor(private sanitizer: DomSanitizer) {
    this.markdownPipe = new MarkdownPipe(this.sanitizer);
  }

  transform(value: any): Observable<SafeHtml> {
    if (!value) {
      return of(this.sanitizer.bypassSecurityTrustHtml(''));
    }

    const inputStr = String(value);
    
    // 如果输入没有变化，返回上次的结果
    if (this.lastInput === inputStr && this.lastOutput) {
      return this.lastOutput;
    }

    // 检查缓存
    if (this.cache.has(inputStr)) {
      const cachedResult = of(this.cache.get(inputStr)!);
      this.lastInput = inputStr;
      this.lastOutput = cachedResult;
      return cachedResult;
    }

    // 渲染新内容
    const result = this.markdownPipe.transform(value).pipe(
      map(rendered => {
        // 缓存结果
        this.cache.set(inputStr, rendered);
        
        // 限制缓存大小
        if (this.cache.size > 50) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        
        return rendered;
      })
    );

    this.lastInput = inputStr;
    this.lastOutput = result;
    return result;
  }

  // 清理缓存的方法
  clearCache(): void {
    this.cache.clear();
    this.lastInput = null;
    this.lastOutput = null;
  }
}
