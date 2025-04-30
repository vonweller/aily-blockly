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
import { IMenuItem } from '../../../configs/menu.config';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { UnsaveDialogComponent } from '../unsave-dialog/unsave-dialog.component';
import { TranslateModule } from '@ngx-translate/core';
import { UpdateService } from '../../../services/update.service';

@Component({
  selector: 'app-header',
  imports: [CommonModule, NzToolTipModule, MenuComponent, ActBtnComponent, TranslateModule],
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
    private message: NzMessageService,
    private modal: NzModalService,
    private updateService: UpdateService
  ) { }

  ngAfterViewInit(): void {
    this.projectService.stateSubject.subscribe((state) => {
      if (state == 'loaded' || state == 'saved') {
        this.loaded = true;
        // 将headerMenu中有disabled的按钮置为可用
        this.headerMenu.forEach((menu) => {
          if (menu.disabled) {
            menu.disabled = false;
          }
        });
      } else {
        this.loaded = false;
        // 将headerMenu中有disabled的按钮置禁用
        this.headerMenu.forEach((menu) => {
          if (menu.disabled === false) {
            menu.disabled = true;
          }
        });
      }
      this.cd.detectChanges();
    });
this.av


    this.listenShortcutKeys();
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
    if (item.disabled) return;
    this.process(item);
    this.closeMenu();
  }

  async selectFolder() {
    const folderPath = await window['ipcRenderer'].invoke('select-folder', {
      path: this.projectData.path,
    });
    // console.log('选中的文件夹路径：', folderPath);
    return folderPath;
  }

  async selectSaveAsFolder() {
    const folderPath = await window['ipcRenderer'].invoke('select-folder-saveAs', {
      path: this.projectData.path,
      suggestedName: this.projectData.name + '_new',
    });
    // console.log('选中的文件夹路径：', folderPath);
    return folderPath;
  }

  async openProject() {
    const path = await this.selectFolder();
    if (path) {
      await this.projectService.projectOpen(path);
    }
  }

  updateSubscription: any = null;

  async process(item: IMenuItem) {
    switch (item.action) {
      case 'project-new':
        if (this.loaded) { // 只在已加载项目时检查
          const canContinue = await this.checkUnsavedChanges('new');
          if (!canContinue) return;
        }
        this.uiService.openWindow(item.data);
        break;
      case 'project-open':
        if (this.loaded) { // 只在已加载项目时检查
          const canContinue = await this.checkUnsavedChanges('open');
          if (!canContinue) return;
        }
        this.openProject();
        break;
      case 'project-save':
        this.projectService.save();
        break;
      case 'project-save-as':
        const path = await this.selectSaveAsFolder();
        if (path) {
          this.projectService.saveAs(path);
        }
        break;
      case 'project-close':
        if (this.loaded) { // 只在已加载项目时检查
          const canContinue = await this.checkUnsavedChanges('close');
          if (!canContinue) return;
        }
        this.projectService.close();
        break;
      case 'project-open-by-explorer':
        window['other'].openByExplorer(this.projectService.currentProjectPath);
        break;
      case 'tool-open':
        if (['MENU.APP_STORE'].includes(item.name)) {
          this.message.warning('功能暂未开放');
          break;
        }
        this.uiService.turnTool(item.data);
        break;
      case 'terminal':
        this.uiService.turnTerminal(item.data);
        break;
      case 'compile':
        if (item.state === 'doing') return;
        item.state = 'doing';
        this.builderService.build().then(result => {
          item.state = 'done';
        }).catch(err => {
          console.error("编译失败: ", err);
          item.state = 'error';
        })
        break;
      case 'upload':
        if (item.state === 'doing') return;
        item.state = 'doing';
        this.uploaderService.upload().then(result => {
          item.state = 'done';
        }).catch(err => {
          item.state = 'error';
        });
        break;
      case 'settings-open':
        this.uiService.openWindow(item.data);
        break;
      case 'check-update':
        this.updateService.clearSkipVersions();
        if (!this.updateSubscription) {
          this.updateSubscription = this.updateService.updateStatus.subscribe((status) => {
            // console.log('更新状态:', status);
            if (status === 'not-available') {
              this.message.info('当前已是最新版本');
            }
          });
        }
        this.updateService.checkForUpdates();
        break;
      case 'browser-open':
        window['other'].openByBrowser(item.data.url);
        break;
      case 'app-exit':
        this.close();
        break;
      default:
        console.log('未处理的操作:', item.action);
        break;
    }
  }

  minimize() {
    window['iWindow'].minimize();
  }

  maximize() {
    window['iWindow'].maximize();
  }

  async close() {
    const canClose = await this.checkUnsavedChanges('close');
    if (canClose) {
      window['iWindow'].close();
    }
  }

  // 快捷键功能，监听键盘事件,执行对应的操作
  private shortcutMap: Map<string, IMenuItem> = new Map();
  private initShortcutMap(): void {
    for (const item of HEADER_MENU) {
      if (item.text) {
        // 将快捷键文本转换成标准格式(如: "ctrl+s")
        const shortcutKey = this.normalizeShortcutKey(item.text);
        if (shortcutKey) {
          this.shortcutMap.set(shortcutKey, item);
        }
      }
    }
    // console.log('已初始化快捷键映射:', Array.from(this.shortcutMap.keys()));
  }

  // 转换快捷键文本为标准格式
  private normalizeShortcutKey(shortcutText: string): string {
    if (!shortcutText) return '';

    return shortcutText.toLowerCase().split('+')
      .map(part => part.trim())
      .sort((a, b) => {
        // 保证修饰键的顺序：ctrl 在前，shift 在后，其他按字母顺序
        if (a === 'ctrl') return -1;
        if (b === 'ctrl') return 1;
        if (a === 'shift') return -1;
        if (b === 'shift') return 1;
        return a.localeCompare(b);
      })
      .join('+');
  }

  // 从键盘事件生成标准化的快捷键字符串
  private getShortcutFromEvent(event: KeyboardEvent): string {
    const parts: string[] = [];

    if (event.ctrlKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');

    // 添加主键，忽略修饰键本身
    const key = event.key.toLowerCase();
    if (!['control', 'shift', 'alt'].includes(key)) {
      parts.push(key);
    }

    return parts.join('+');
  }

  // 监听快捷键
  listenShortcutKeys() {
    this.initShortcutMap();
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      // 只处理包含修饰键的组合键
      if (event.ctrlKey || event.shiftKey || event.altKey) {
        const shortcutKey = this.getShortcutFromEvent(event);
        const menuItem = this.shortcutMap.get(shortcutKey);

        if (menuItem) {
          event.preventDefault(); // 阻止默认行为
          console.log('快捷键触发:', menuItem.name, shortcutKey);

          // 执行对应的操作
          if (menuItem.data && menuItem.data.type) {
            this.process(menuItem);
          } else if (menuItem.action) {
            // 如果需要处理action类型的菜单项，可以在这里添加逻辑
            // this.handleMenuAction(menuItem);
            console.log('需要处理action:', menuItem.action);
          }
        }
      }
    });
  }

  async checkUnsavedChanges(action: 'close' | 'open' | 'new'): Promise<boolean> {
    // 检查项目是否有未保存的更改
    if (!await this.projectService.hasUnsavedChanges()) {
      return true;
    }

    // 根据不同操作设置不同的提示文本
    let title = '有未保存的更改';
    let text = '是否保存当前项目？';
    if (action === 'open') {
      text = '在打开新项目前，是否保存当前项目的更改？';
    } else if (action === 'new') {
      text = '在创建新项目前，是否保存当前项目的更改？';
    } else if (action === 'close') {
      text = '是否在关闭前保存更改？';
    }

    return new Promise<boolean>((resolve) => {
      const modalRef = this.modal.create({
        nzTitle: null,
        nzFooter: null,
        nzClosable: false,
        nzBodyStyle: {
          padding: '0',
        },
        nzWidth: '320px',
        nzContent: UnsaveDialogComponent,
        nzData: { title, text },
        // nzDraggable: true,
      });

      modalRef.afterClose.subscribe(async result => {
        if (!result) {
          // 用户直接关闭对话框，视为取消操作
          resolve(false);
          return;
        }
        switch (result.result) {
          case 'save':
            // 保存项目并继续
            await this.projectService.save();
            resolve(true);
            break;
          case 'continue':
            // 不保存，但继续操作
            resolve(true);
            break;
          case 'cancel':
          default:
            // 取消操作
            resolve(false);
            break;
        }
      });
    });
  }
}


export interface RunState {
  state: 'default' | 'doing' | 'done' | 'error' | 'warn';
  text: string;
}