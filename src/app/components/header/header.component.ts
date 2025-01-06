import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { HEADER_MENU } from '../../configs/header.config';
import { IwindowService } from '../../services/iwindow.service';

@Component({
  selector: 'app-header',
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent {

  headerMenu = HEADER_MENU;

  constructor(
    private iwindowService: IwindowService
  ) {

  }

  onClick(btn) {
    // console.log(btn);
    switch (btn.action) {
      case 'open-aily-chat':
        this.iwindowService.openWindow({ type: 'aily-chat', title: 'AI助手' });
        break;
      case 'open-code-viewer':
        this.iwindowService.openWindow({ type: 'code-viewer', title: '菜单' });
        break;
      case 'open-serial-monitor':
        this.iwindowService.openWindow({ type: 'serial-monitor', title: '串口助手' });
        break
    }
  }
}
