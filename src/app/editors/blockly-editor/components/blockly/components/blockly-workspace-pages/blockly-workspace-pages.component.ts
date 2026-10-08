import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzMenuModule } from 'ng-zorro-antd/menu';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { TranslateModule } from '@ngx-translate/core';
import { BlocklyPageSnapshot } from '../../../../services/blockly.service';
import { BlocklyFunctionViewState, emptyBlocklyFunctionView } from '../../../../utils/blockly-function-view';

@Component({
  selector: 'app-blockly-workspace-pages',
  imports: [
    CommonModule,
    NzButtonModule,
    NzDropDownModule,
    NzMenuModule,
    NzTabsModule,
    TranslateModule,
  ],
  templateUrl: './blockly-workspace-pages.component.html',
  styleUrl: './blockly-workspace-pages.component.scss',
})
export class BlocklyWorkspacePagesComponent {
  @Input() pages: BlocklyPageSnapshot[] = [];
  @Input() closedPages: BlocklyPageSnapshot[] = [];
  @Input() activePageId = '';
  @Input() aiWriting = false;
  @Input() showSpinOverlay = false;
  @Input() isFadingOut = false;
  @Input() functionView: BlocklyFunctionViewState = emptyBlocklyFunctionView();
  @Input() functionViewDisabled = false;
  @Output() functionSelected = new EventEmitter<string>();

  @Output() pageSelected = new EventEmitter<string>();
  @Output() pageAdded = new EventEmitter<void>();
  @Output() pageClosed = new EventEmitter<string>();
  @Output() pageReopened = new EventEmitter<string>();

  @ViewChild('blocklyDiv', { static: true }) blocklyDiv!: ElementRef<HTMLDivElement>;

  get blocklyHostElement(): HTMLDivElement {
    return this.blocklyDiv.nativeElement;
  }

  get selectedIndex(): number {
    const activeIndex = this.pages.findIndex((page) => page.id === this.activePageId);
    return activeIndex === -1 ? 0 : activeIndex;
  }

  trackPage(_index: number, page: BlocklyPageSnapshot): string {
    return page.id;
  }

  onTabChange(index: number) {
    const page = this.pages[index];
    if (page) {
      this.pageSelected.emit(page.id);
    }
  }

  onTabClose({ index }: { index: number }) {
    const page = this.pages[index];
    if (page) {
      this.pageClosed.emit(page.id);
    }
  }

  onReopenPage(pageId: string) {
    this.pageReopened.emit(pageId);
  }
}
