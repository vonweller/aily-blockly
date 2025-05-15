import { Pipe, PipeTransform } from '@angular/core';
import { Marked, Renderer } from 'marked';
import { DomSanitizer } from '@angular/platform-browser';
import { markedHighlight } from 'marked-highlight';
import { codeToHtml } from 'shiki';
import * as Blockly from 'blockly'; // 确保已导入Blockly

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
          if (lang === 'blockly') {
            return this.renderBlockly(code).then(html => {
              return html;
            }).catch(err => {
              console.error('解析Blockly配置失败:', err);
              // 解析失败时回退到代码高亮
              return codeToHtml(code, {
                lang: 'json',
                theme: 'github-dark',
              });
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

  /**
   * 将Blockly JSON配置渲染为Blockly块的HTML表示
   * @param code Blockly JSON配置字符串
   * @returns 渲染后的HTML
   */
  async renderBlockly(code: string): Promise<string> {
    try {
      // 提取JSON部分（处理可能有"blockly"前缀的情况）
      const jsonMatch = code.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('无效的Blockly JSON格式');
      }
      
      const jsonStr = jsonMatch[0];
      const toolboxConfig = JSON.parse(jsonStr);
      
      // 创建一个临时div用于渲染Blockly
      const tempDiv = document.createElement('div');
      tempDiv.style.width = '100%';
      tempDiv.style.height = '300px'; // 可调整高度
      tempDiv.style.overflow = 'hidden';
      tempDiv.style.marginBottom = '1rem';
      tempDiv.className = 'blockly-preview';
      
      // 创建唯一ID以避免冲突
      const workspaceId = 'blockly-workspace-' + Math.random().toString(36).substring(2, 9);
      tempDiv.id = workspaceId;
      
      // 创建页面上不可见的临时元素（用于获取HTML）
      document.body.appendChild(tempDiv);
      
      // 初始化Blockly工作区
      const workspace = Blockly.inject(workspaceId, {
        readOnly: true, // 只读模式
        scrollbars: true,
        zoom: {
          controls: true,
          wheel: true,
          startScale: 1.0,
          maxScale: 3,
          minScale: 0.3,
          scaleSpeed: 1.2
        },
        toolbox: toolboxConfig
      });
      
      // 如果是flyout类型工具箱，则渲染其中的块
      if (toolboxConfig.kind === 'flyoutToolbox' && toolboxConfig.contents) {
        // 计算适当的排布位置
        let curY = 10;
        for (const item of toolboxConfig.contents) {
          if (item.kind === 'block') {
            const block = workspace.newBlock(item.type);
            block.initSvg();
            block.moveBy(10, curY);
            block.render();
            curY += block.getHeightWidth().height + 20;
          }
        }
      }
      
      // 调整工作区大小以适应所有块
      workspace.setScale(1.0);
      workspace.scrollCenter();
      
      // 等待DOM渲染完成
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 获取渲染后的HTML内容
      const blocklyHtml = tempDiv.outerHTML;
      
      // 清理DOM
      document.body.removeChild(tempDiv);
      
      // 返回带有包装的HTML
      return `<div class="blockly-container">${blocklyHtml}</div>`;
    } catch (error) {
      console.error('Blockly渲染错误:', error);
      throw error;
    }
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
