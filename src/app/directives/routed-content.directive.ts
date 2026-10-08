import {Directive, ElementRef, inject, Renderer2} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {RouterOutlet} from '@angular/router';
import {merge} from 'rxjs';

/** Size routed hosts without a sibling wildcard invalidating their SVG trees. */
@Directive({selector: 'router-outlet[ailyRoutedContent]'})
export class RoutedContentDirective {
  constructor() {
    const outlet = inject(RouterOutlet, {self: true});
    const anchor = inject<ElementRef<HTMLElement>>(ElementRef);
    const renderer = inject(Renderer2);
    merge(outlet.activateEvents, outlet.attachEvents)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const host = anchor.nativeElement.nextElementSibling;
        if (host) renderer.addClass(host, 'aily-routed-content');
      });
  }
}
