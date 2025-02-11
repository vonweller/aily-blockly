import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, viewChild } from '@angular/core';
import { HEADER_BTNS, HEADER_MENU } from '../../configs/header.config';
import { IwindowService } from '../../services/iwindow.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-header',
  imports: [CommonModule, FormsModule, NzToolTipModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  headerBtns = HEADER_BTNS;
  headerMenu = HEADER_MENU;

  @ViewChild('menuBox') menuBox: ElementRef;

  constructor(private iwindowService: IwindowService) {}

  showMenu = false;
  openMenu() {
    this.showMenu = !this.showMenu;
    if (this.showMenu) {
      document.addEventListener('click', this.handleDocumentClick);
    } else {
      document.removeEventListener('click', this.handleDocumentClick);
    }
  }

  handleDocumentClick = (event: MouseEvent) => {
    if (
      this.menuBox &&
      !this.menuBox.nativeElement.contains(event.target as Node)
    ) {
      this.showMenu = false;
      document.removeEventListener('click', this.handleDocumentClick);
    }
  };

  onClick(btn) {
    // console.log(btn);
    switch (btn.action) {
      case 'open-aily-chat':
        this.iwindowService.openWindow({
          type: 'aily-chat',
          title: 'AI助手',
          size: { width: 600, height: 500 },
          position: {
            x: window.innerWidth / 2 - 300,
            y: window.innerHeight / 2 - 200,
          },
        });
        break;
      case 'open-code-viewer':
        this.iwindowService.openWindow({
          type: 'code-viewer',
          title: '代码预览',
          size: { width: 400, height: window.innerHeight - 65 - 200 },
          position: { x: window.innerWidth - 400, y: 65 },
        });
        break;
      case 'open-serial-monitor':
        this.iwindowService.openWindow({
          type: 'serial-monitor',
          title: '串口助手',
        });
        // 显示串口图表
        // setTimeout(() => {
        //   this.iwindowService.openWindow({ type: 'data-chart', title: '数据图表' });
        // }, 50);
        break;
      case 'open-terminal':
        this.iwindowService.openWindow({
          type: 'terminal',
          title: '终端',
          size: { width: window.innerWidth - 180, height: 200 },
          position: { x: 180, y: window.innerHeight - 200 },
        });
        break;
    }
  }
}
