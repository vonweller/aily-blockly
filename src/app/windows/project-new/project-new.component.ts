import { Component } from '@angular/core';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzStepsModule } from 'ng-zorro-antd/steps';
import { ElectronService } from '../../services/electron.service';
import { ProjectService } from '../../services/project.service';
import { ConfigService } from '../../services/config.service';
import { UiService } from '../../services/ui.service';
import { generateDateString } from '../../func/func';

@Component({
  selector: 'app-project-new',
  imports: [
    CommonModule,
    FormsModule,
    SubWindowComponent,
    NzButtonModule,
    NzInputModule,
    NzStepsModule,
  ],
  templateUrl: './project-new.component.html',
  styleUrl: './project-new.component.scss',
})
export class ProjectNewComponent {
  currentStep = 0;

  boardList: any[] = [];
  currentBoard: any = null;
  projectData = {
    name: '',
    path: '',
    description: '',
    board: null,
    boardValue: null,
    type: 'web',
    framework: 'angular',
    version: '1.0.0',
  };

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private configService: ConfigService,
    private uiService: UiService,
  ) { }

  async ngOnInit() {
    if (this.electronService.isElectron) {
      this.projectData.path = window['path'].getUserDocuments();
    }
    await this.configService.init();
    this.boardList = this.configService.boardList;
    this.currentBoard = this.boardList[0];
    this.projectData.board = this.currentBoard.name;
    this.projectData.boardValue = this.currentBoard.value;
    this.projectData.name = 'project_' + generateDateString();
  }

  selectBoard(board) {
    this.currentBoard = board;
    this.projectData.board = board.name;
    this.projectData.boardValue = board.value;
  }

  async selectFolder() {
    const folderPath = await window['ipcRenderer'].invoke('select-folder', {
      path: this.projectData.path,
    });
    // console.log('选中的文件夹路径：', folderPath);
    this.projectData.path = folderPath;
    // 在这里对返回的 folderPath 进行后续处理
  }

  // 检查路径是否存在
  showIsExist = false;
  async checkPathIsExist(): Promise<boolean> {
    let isExist = await this.projectService.project_exist(this.projectData);
    if (isExist) {
      this.showIsExist = true;
    } else {
      this.showIsExist = false;
    }
    return isExist;
  }

  async createProject() {
    // 判断是否有同名项目
    if (await this.checkPathIsExist()) {
      return;
    }
    this.currentStep = 2;

    // 这里prjPath有啥用？
    const prjPath = await this.projectService.project_new(this.projectData);

    setTimeout(() => {
      window['subWindow'].close();
    }, 1000);
  }

  openUrl(url) {
    if (this.electronService.isElectron) {
      window['other'].openByBrowser(url);
    }
  }
}
