import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, ViewChild, viewChild } from '@angular/core';
import { HEADER_BTNS, HEADER_MENU } from '../../../configs/menu.config';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../../services/project.service';
import { UiService } from '../../../services/ui.service';
import { BuilderService } from '../../../services/builder.service';
import { UploaderService } from '../../../services/uploader.service';
import { MenuComponent } from '../../../components/menu/menu.component';
import { PortItem, SerialService } from '../../../services/serial.service';
import { ActBtnComponent } from '../act-btn/act-btn.component';

@Component({
  selector: 'app-header',
  imports: [CommonModule, FormsModule, NzToolTipModule, MenuComponent, ActBtnComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  headerBtns = HEADER_BTNS;
  headerMenu = HEADER_MENU;

  // @ViewChild('menuBox') menuBox: ElementRef;

  get projectData() {
    return this.projectService.currentPackageData;
  }

  get openToolList() {
    return this.uiService.openToolList;
  }

  get terminalIsOpen() {
    return this.uiService.terminalIsOpen;
  }

  get currentPort() {
    return this.serialService.currentPort;
  }

  set currentPort(port) {
    this.serialService.currentPort = port;
  }

  get currentBoard() {
    return this.projectData.board;
  }

  loaded = false;

  constructor(
    private projectService: ProjectService,
    private uiService: UiService,
    private builderService: BuilderService,
    private uploaderService: UploaderService,
    private serialService: SerialService,
    private cd: ChangeDetectorRef,

  ) { }

  ngAfterViewInit(): void {
    this.projectService.stateSubject.subscribe((state) => {
      this.loaded = state == 'loaded';
      this.cd.detectChanges();
    });
  }

  showMenu = false;
  openMenu() {
    this.showMenu = !this.showMenu;
  }

  closeMenu() {
    this.showMenu = false;
  }

  showPortList = false;
  portList: PortItem[] = []
  boardKeywords = []; // 这个用来高亮显示正确开发板，如['arduino uno']，则端口菜单中如有包含'arduino uno'的串口则高亮显示
  openPortList() {
    let boardname = this.currentBoard.replace(' 2560', ' ').replace(' R3', '');
    this.boardKeywords = [boardname];
    this.showPortList = !this.showPortList;
    this.getDevicePortList();
  }

  closePortList() {
    this.showPortList = false;
    this.cd.detectChanges();
  }

  selectPort(portItem) {
    this.currentPort = portItem.name;
    this.closePortList();
  }

  async getDevicePortList() {
    this.portList = await this.serialService.getSerialPorts();
    this.cd.detectChanges();
  }

  onClick(item) {
    this.process(item);
  }

  isOpenTool(btn) {
    if (btn.data.type == 'terminal') {
      return this.terminalIsOpen;
    } else if (btn.data && btn.data.data) {
      return this.openToolList.indexOf(btn.data.data) !== -1;
    }
    return false;
  }

  onMenuClick(item) {
    this.process(item);
    this.closeMenu();
  }

  async selectFolder() {
    const folderPath = await window['ipcRenderer'].invoke('select-folder', {
      path: this.projectData.path,
    });
    console.log('选中的文件夹路径：', folderPath);
    return folderPath;
  }

  async openProject(data) {
    const path = await this.selectFolder();
    if (path) {
      await this.projectService.projectOpen(path);
    }
  }

  process(item) {
    switch (item.data.type) {
      case 'window':
        this.uiService.openWindow(item.data);
        break;
      case 'explorer':
        this.openProject(item.data);
        break;
      case 'tool':
        this.uiService.turnTool(item.data);
        break;
      case 'terminal':
        this.uiService.turnTerminal(item.data);
        break;
      case 'run-cmd':
        // this.uiService.runCmd(item.data);
        break;
      case 'cmd':
        if (item.data.data === 'compile') {
          if(item.state === 'doing') return;
          item.state = 'doing';
          this.builderService.build().then(result => {
            item.state = 'doing';
          }).catch(err => {
            item.state = 'done';
          })
        } else if (item.data.data === 'upload') {
          if(item.state === 'doing') return;
          item.state = 'doing';
          this.uploaderService.upload().then(result => {
            item.state = 'doing';
          }).catch(err => {
            item.state = 'error';
          })
        } else if (item.data.data === 'project-open') {
          // TODO 传入路径
          const path = 'C:\\Users\\stao\\Documents\\aily-project\\test6';
          this.projectService.projectOpen(path).then((res) => {
            if (res) {
              console.log('打开项目成功');
              // TODO 加载对应的blockly.json文件
            } else {
              console.log('打开项目失败');
            }
          });
        }
        break;
      case 'other':
        if (item.data.action == 'openByExplorer') {
          window['other'].openByExplorer(window['path'].getUserDocuments());
        } else if (item.data.action == 'openByBrowser') {
          window['other'].openByBrowser(item.data.url);
        } else if (item.data.action == 'exitApp') {
          window['other'].exitApp();
        }
        break;
      default:
        break;
    }
  }

  minimize() {
    window['iWindow'].minimize();
  }

  maximize() {
    window['iWindow'].maximize();
  }

  close() {
    window['iWindow'].close();
  }
}


export interface RunState{
  state: 'default' | 'doing' | 'done' | 'error' | 'warn';
  text: string;
}