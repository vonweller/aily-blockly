import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FancyAnsi } from 'fancy-ansi';

@Pipe({
  name: 'ansi',
  standalone: true
})
export class AnsiPipe implements PipeTransform {
  private fancyAnsi = new FancyAnsi();

  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }
    
    const htmlString = this.fancyAnsi.toHtml(value);
    return this.sanitizer.bypassSecurityTrustHtml(htmlString);
  }
}