import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'showHex',
  standalone: true
})
export class ShowHexPipe implements PipeTransform {
  transform(value: Uint8Array | string): string {
    if (!value) return '';
    let bytes: Uint8Array;
    
    // 如果输入是字符串，将其转换为Uint8Array
    if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value);
    } else {
      bytes = value;
    }
    
    // 转换为十六进制并添加HTML格式
    const hexArray = Array.from(bytes).map(byte => 
      `<span class="hex">${byte.toString(16).padStart(2, '0').toUpperCase()}</span>`
    );
    
    return hexArray.join('');
  }
}