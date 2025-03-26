import { ChangeDetectorRef, Component, HostListener, Input } from '@angular/core';
import { MenuComponent } from '../../../../components/menu/menu.component';
import { CommonModule } from '@angular/common';
import { RIGHT_MENU } from '../../right-menu.config';
import { SerialMonitorService } from '../../serial-monitor.service';
import { ShowNRPipe } from './show-nr.pipe';
import { ShowHexPipe } from './show-hex.pipe';
import { AddNewLinePipe } from './add-newline.pipe';
import { NzMessageService } from 'ng-zorro-antd/message';

@Component({
  selector: 'app-data-item',
  imports: [MenuComponent, CommonModule, ShowNRPipe, ShowHexPipe, AddNewLinePipe],
  templateUrl: './data-item.component.html',
  styleUrl: './data-item.component.scss',
})
export class DataItemComponent {
  rightMenu = JSON.parse(JSON.stringify(RIGHT_MENU));

  @Input() data;

  position = { x: 0, y: 0 };
  showMenu = false;

  get viewMode() {
    return this.serialMonitorService.viewMode;
  }

  @HostListener('contextmenu', ['$event'])
  onRightClick(event: MouseEvent) {
    if (this.viewMode.showTimestamp) {
      event.preventDefault();
      this.position.x = event.clientX;
      this.position.y = event.clientY;
      this.viewMode.autoScroll = false;
      setTimeout(() => {
        this.showMenu = true;
        this.cd.detectChanges();
      });
    }
    return false;
  }

  constructor(
    private serialMonitorService: SerialMonitorService,
    private cd: ChangeDetectorRef,
    private message: NzMessageService
  ) { }


  closeMenu() {
    this.showMenu = false;
  }

  menuClick(item) {
    console.log(item.data.action);
    switch (item.data.action) {
      case 'copy':
        this.copyText();
        break;
      case 'hex':
        this.toggleHex();
        break;
      case 'highlight':
        this.toggleHighlight();
        break;
    }
    this.closeMenu()
    this.cd.detectChanges();
  }

  copyText() {
    const text = this.data.data;
    navigator.clipboard.writeText(text).then(() => {
      this.message.info('已复制到剪贴板');
    });
  }

  showHex = false;
  toggleHex() {
    this.showHex = !this.showHex;
    if (this.showHex) {
      this.rightMenu[1].name = '文本显示';
    } else {
      this.rightMenu[1].name = 'Hex显示';
    }
  }

  showHighlight = false;
  toggleHighlight() {
    this.showHighlight = !this.showHighlight;
    if (this.showHighlight) {
      this.rightMenu[2].name = '取消高亮';
    } else {
      this.rightMenu[2].name = '高亮标记';
    }
  }
}
