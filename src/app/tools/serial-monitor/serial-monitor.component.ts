import { ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ToolContainerComponent } from '../../components/tool-container/tool-container.component';
import { UiService } from '../../services/ui.service';
import { NzResizableModule, NzResizeEvent } from 'ng-zorro-antd/resizable';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { DataItemComponent } from './components/data-item/data-item.component';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { PortItem, SerialService } from '../../services/serial.service';
import { ProjectService } from '../../services/project.service';
import { MenuComponent } from '../../components/menu/menu.component';
import { SerialMonitorService } from './serial-monitor.service';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';

@Component({
  selector: 'app-serial-monitor',
  imports: [
    // InnerWindowComponent,
    NzSelectModule,
    NzInputModule,
    NzButtonModule,
    FormsModule,
    NzToolTipModule,
    ToolContainerComponent,
    NzResizableModule,
    SubWindowComponent,
    CommonModule,
    DataItemComponent,
    NzSwitchModule,
    MenuComponent,
    SimplebarAngularModule
  ],
  templateUrl: './serial-monitor.component.html',
  styleUrl: './serial-monitor.component.scss',
})
export class SerialMonitorComponent {

  @ViewChild(SimplebarAngularComponent) simplebar: SimplebarAngularComponent;

  options = {
    autoHide: false,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  switchValue = false;

  get windowInfo() {
    if (this.currentPort) {
      return `串口监视器（${this.currentPort} - ${this.currentBaudRate}）`;
    } else {
      return '串口监视器';
    }
  }

  get dataList() {
    return this.SerialMonitorService.dataList;
  }

  // dataList = [
  //   {
  //     time: '12:12:12',
  //     data: 'testtest testtest testtest testtesst testtest testtest testtesst testt\nest testtest test\rtesst testtest testtest te\n\rsttesst testtest testtest testtest',
  //     dir: '>',
  //   },
  //   {
  //     time: '12:12:13',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },
  //   {
  //     time: '12:12:14',
  //     data: "error: WiFi connection failed, password incorrect",
  //     dir: '<',
  //   },
  //   {
  //     time: '12:12:15',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },
  //   {
  //     time: '12:12:16',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },
  //   {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },    {
  //     time: '12:12:17',
  //     data: 'testtest testtest testtest testtest',
  //     dir: '<',
  //   },
  // ];

  get autoScroll() {
    return this.SerialMonitorService.viewMode.autoScroll;
  }

  get autoWarp() {
    return this.SerialMonitorService.viewMode.autoWarp;
  }

  get showTimestamp() {
    return this.SerialMonitorService.viewMode.showTimestamp;
  }

  get showHex() {
    return this.SerialMonitorService.viewMode.showHex;
  }

  get showCtrlChar() {
    return this.SerialMonitorService.viewMode.showCtrlChar;
  }


  serialList = [];

  inputValue;

  currentPort;
  currentBaudRate = '9600';
  currentUrl;


  get projectData() {
    return this.projectService.currentPackageData;
  }

  get currentBoard() {
    return this.projectData.board;
  }

  constructor(
    private projectService: ProjectService,
    private serialService: SerialService,
    private SerialMonitorService: SerialMonitorService,
    private uiService: UiService,
    private router: Router,
    private cd: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.currentUrl = this.router.url;
    if (this.serialService.currentPort) {
      // this.windowInfo = this.serialService.currentPort;
      this.currentPort = this.serialService.currentPort;
    }
  }

  ngAfterViewInit() {
    this.SerialMonitorService.dataUpdated.subscribe(() => {
      this.cd.detectChanges();
      if (this.autoScroll) {
        this.simplebar.SimpleBar.getScrollElement().scrollTop = this.simplebar.SimpleBar.getScrollElement().scrollHeight;
      }
    });
  }

  ngOnDestroy() {
    this.SerialMonitorService.disconnect();
  }

  close() {
    this.uiService.closeTool('serial-monitor');
  }

  bottomHeight = 180;
  onContentResize({ height }: NzResizeEvent): void {
    this.bottomHeight = height!;
  }

  openMore() { }

  // 串口选择列表相关 
  showPortList = false;
  portList: PortItem[] = []
  boardKeywords = []; // 这个用来高亮显示正确开发板，如['arduino uno']，则端口菜单中如有包含'arduino uno'的串口则高亮显示
  position = { x: 0, y: 0 }; // 右键菜单位置
  openPortList(el) {
    // console.log(el.srcElement);
    // 获取元素左下角位置
    let rect = el.srcElement.getBoundingClientRect();
    this.position.x = rect.left;
    this.position.y = rect.bottom + 2;

    if (this.currentBoard) {
      let boardname = this.currentBoard.replace(' 2560', ' ').replace(' R3', '');
      this.boardKeywords = [boardname];
    }
    this.showPortList = !this.showPortList;
    this.getDevicePortList();
  }

  async getDevicePortList() {
    this.portList = await this.serialService.getSerialPorts();
    this.cd.detectChanges();
  }

  closePortList() {
    this.showPortList = false;
    this.cd.detectChanges();
  }

  selectPort(portItem) {
    this.currentPort = portItem.name;
    this.closePortList();
  }

  // 波特率选择列表相关 
  showBaudList = false;
  baudList = [
    { name: '4800' },
    { name: '9600' },
    { name: '19200' },
    { name: '38400' },
    { name: '57600' },
    { name: '115200' },
    { name: '230400' },
    { name: '460800' },
    { name: '921600' },
    { name: '1000000' },
    { name: '2000000' }
  ]
  openBaudList(el) {
    // console.log(el.srcElement);
    // 获取元素左下角位置
    let rect = el.srcElement.getBoundingClientRect();
    this.position.x = rect.left;
    this.position.y = rect.bottom + 2;
    this.showBaudList = !this.showBaudList;
  }

  closeBaudList() {
    this.showBaudList = false;
    this.cd.detectChanges();
  }

  selectBaud(item) {
    this.currentBaudRate = item.name;
    this.closeBaudList();
  }

  switchPort() {
    if (!this.switchValue) {
      return
    }
    this.SerialMonitorService.connect({
      path: this.currentPort,
      baudRate: parseInt(this.currentBaudRate)
    });
  }

  changeViewMode(name) {
    this.SerialMonitorService.viewMode[name] = !this.SerialMonitorService.viewMode[name];
  }

  send(e = '') { }

  // 清除显示
  clean() {

  }
}
