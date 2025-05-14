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

    // const langBlockly = {
    //   extensions: [
    //     {
    //       name: 'blockly-json',
    //       level: 'block',
    //       start(src) {
    //         return src.indexOf('```blockly');
    //       },
    //       tokenizer(src) {
    //         const rule = /^```blockly\s([\s\S]*?)\s```\s/;
    //         const match = rule.exec(src);
    //         if (match) {
    //           return {
    //             type: 'blockly-json',
    //             raw: match[0],
    //             data: match[1],
    //             html: ``,
    //           };
    //         }
    //       },
    //       renderer: (token) => {
    //         // const html = await codeToHtml(token.data, {
    //         //   lang: 'json',
    //         //   theme: 'github-light',
    //         // });
    //         // TODO 无法使用异步转同步，待完善
    //         return token.data;
    //       },
    //     },
    //   ],
    //   async: true,
    //   async walkTokens(token) {
    //     if (token.type === 'blockly-json') {
    //     }
    //   },
    // };
    //
    // this.marked.use(langBlockly);

    this.marked.setOptions(
      markedHighlight({
        async: true,
        highlight: (code, lang) => {
          if (lang === 'blockly') {
            return codeToHtml(code, {
              lang: 'javascript', // TODO json 格式转 blockly 动态创建 toolbox 块
              theme: 'github-dark',
            }).then((html) => {
              return html;
            });
          }
          return codeToHtml(code, {
            lang: lang,
            theme: 'github-dark',
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
