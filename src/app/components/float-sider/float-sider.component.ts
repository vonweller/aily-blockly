import { Component, Input } from '@angular/core';
import { PinmapComponent } from '../../app-store/pinmap/pinmap.component';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { CommonModule } from '@angular/common';
@Component({
  selector: 'app-float-sider',
  imports: [
    NzModalModule,
    NzToolTipModule,
    CommonModule
  ],
  templateUrl: './float-sider.component.html',
  styleUrl: './float-sider.component.scss'
})
export class FloatSiderComponent {
  @Input() show = false;

  constructor(
    private modal: NzModalService
  ) { }

  showPinmap() {
    const modalRef = this.modal.create({
      nzTitle: null,
      nzFooter: null,
      nzClosable: false,
      nzBodyStyle: {
        padding: '0',
      },
      nzContent: PinmapComponent,
      nzData: {
        boardPackage: 'arduino_uno'
      },
      nzWidth: '650px',
    });
  }
}
