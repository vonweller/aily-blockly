import { Component } from '@angular/core';
import { version } from '../../../../package.json';
import { GUIDE_HEADER_MENU } from '../../configs/header.config';
import { UiService } from '../../services/ui.service';
import { ProjectService } from '../../services/project.service';

@Component({
  selector: 'app-guide',
  imports: [],
  templateUrl: './guide.component.html',
  styleUrl: './guide.component.scss'
})
export class GuideComponent {
  version = version;
  headerMenu = GUIDE_HEADER_MENU;
  showMenu = true;

  get projectData() {
    return this.projectService.projectData;
  }

  constructor(
    private uiService: UiService,
    private projectService: ProjectService
  ) {}

  onMenuClick(e: any) {
    this.process(e);
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
      this.projectService.project_open(path).then((res) => {
        if (res) {
          console.log('打开项目成功');
        } else {
          console.log('打开项目失败');
        }
      })
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
    }
  }
}
