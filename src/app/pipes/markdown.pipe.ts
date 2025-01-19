import { Pipe, PipeTransform } from '@angular/core';
import { Marked, Renderer } from 'marked';
// import { CONFIG } from '../doc.config';
import { DomSanitizer } from '@angular/platform-browser';
import { markedHighlight } from 'marked-highlight';
import { codeToHtml } from 'shiki';
@Pipe({
  name: 'markdown',
  standalone: true,
})
export class MarkdownPipe implements PipeTransform {
  marked;
  constructor(private sanitizer: DomSanitizer) {
    this.marked = new Marked();
    this.marked.setOptions(
      markedHighlight({
        async: true,
        highlight: (code, lang) => {
          return codeToHtml(code, {
            lang: lang,
            theme: 'github-light',
          }).then((html) => {
            return html;
          });
        },
      }),
    );
    const renderer = new Renderer();
    renderer.heading = (e) => {
      return `<h${e.depth} id="${e.text}">${e.text}</h${e.depth}>`;
    };
    renderer.code = (e) => {
      return e.text;
    };
    this.marked.setOptions({
      renderer: renderer,
    });
  }

  async transform(value: string) {
    if (!value) {
      return '';
    }
    try {
      value = value.replace(/(```[a-z]*)(?!\n)(?![a-z])/g, '$1\n');
      value = await this.marked.parse(value || '');
    } catch (err) {
      console.error(err);
    }
    // 替换图片url路径
    // result = result.replace(/src=".\//g, `src="` + CONFIG.BASE_URL).replace(/src="..\//g, `src="` + CONFIG.BASE_URL)
    return this.sanitizer.bypassSecurityTrustHtml(value);
  }
}
