import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, viewChild } from '@angular/core';
import { HEADER_BTNS, HEADER_MENU } from '../../configs/header.config';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';
import { BuilderService } from '../../services/builder.service';
import { UploaderService } from '../../services/uploader.service';

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

  get projectData() {
    return this.projectService.projectData;
  }

  get openToolList() {
    return this.uiService.openToolList;
  }

  get terminalIsOpen() {
    return this.uiService.terminalIsOpen
  }

  constructor(
    private projectService: ProjectService,
    private uiService: UiService,
    private builderService: BuilderService,
    private uploaderService: UploaderService,
  ) { }

  showMenu = false;
  openMenu() {
    this.showMenu = !this.showMenu;
    if (this.showMenu) {
      document.addEventListener('click', this.handleDocumentClick);
    } else {
      this.closeMenu();
    }
  }

  closeMenu() {
    this.showMenu = false;
    document.removeEventListener('click', this.handleDocumentClick);
  }

  handleDocumentClick = (event: MouseEvent) => {
    if (
      this.menuBox &&
      !this.menuBox.nativeElement.contains(event.target as Node)
    ) {
      this.closeMenu();
    }
  };

  onClick(item) {
    this.process(item);
  }

  isOpenTool(btn) {
    if (btn.data.type == 'terminal') {
      return this.terminalIsOpen
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
      await this.projectService.project_open(path);
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
        this.uiService.runCmd(item.data);
        break;
      case 'cmd':
        if (item.data.data === 'compile') {
          this.builderService.build();
        } else if (item.data.data === 'upload') {
          this.uploaderService.upload();
        } else if (item.data.data === 'project-open') {
          // TODO 传入路径
          const path = 'C:\\Users\\stao\\Documents\\aily-project\\test6'
          this.projectService.project_open(path).then((res) => {
            if (res) {
              console.log('打开项目成功');
              // TODO 加载对应的blockly.json文件
            } else {
              console.log('打开项目失败');
            }
          })
        };
        break;
      case 'other':
        if (item.data.action == 'openByExplorer') {
          window['other'].openByExplorer(window['path'].getUserDocuments());
        }else if (item.data.action == 'openByBrowser') {
          window['other'].openByBrowser(item.data.url);
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
