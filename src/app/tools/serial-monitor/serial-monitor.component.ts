import { Component, ElementRef, ViewChild, viewChild } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ElectronService } from '../../services/electron.service';

@Component({
  selector: 'app-serial-monitor',
  imports: [
    InnerWindowComponent,
    NzSelectModule,
    NzInputModule,
    FormsModule,
    NzToolTipModule,
  ],
  templateUrl: './serial-monitor.component.html',
  styleUrl: './serial-monitor.component.scss',
})
export class SerialMonitorComponent {
  // 波特率
  baudRate = '115200';
  // 自动滚动
  autoScroll = true;
  // 自动换行
  autoWrap = true;
  // 显示时间戳
  showTimestamp = true;
  // HEX显示
  showHex = false;
  // 异常捕获
  showError = false;

  serialPort;

  serialList = [];

  constructor(private electronService: ElectronService) {
    this.serialPort = this.electronService.serialPort;
  }

  ngOnInit() {}

  ngAfterViewInit(): void {}

  openMore() {}

  async openPortList() {
    this.serialList = (await this.serialPort.list()).map((item) => item.path);
    console.log(this.serialList);
  }
}
