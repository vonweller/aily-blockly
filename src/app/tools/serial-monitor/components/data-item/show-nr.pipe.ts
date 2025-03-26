import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'showNR',
  standalone: true
})
export class ShowNRPipe implements PipeTransform {
  transform(value: Uint8Array | string): string {
    if (!value) return '';

    // 如果输入是 Uint8Array，先转换为字符串
    let strValue = '';
    if (value instanceof Uint8Array) {
      // 使用 TextDecoder 将 Uint8Array 转换为字符串
      strValue = new TextDecoder('utf-8').decode(value);
    } else {
      strValue = value;
    }

    // 替换换行符
    strValue = strValue.replace(/\n/g, '<span class="zf">\\n</span>');

    // 替换回车符
    strValue = strValue.replace(/\r/g, '<span class="zf">\\r</span>');

    // 替换制表符
    strValue = strValue.replace(/\t/g, '<span class="zf">\\t</span>');

    // 替换其他控制字符和不可见字符
    strValue = strValue.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, (char) => {
      return `<span class="zf">\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}</span>`;
    });

    return strValue;
  }
}