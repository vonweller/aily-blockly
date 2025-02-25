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
    type: 'web',
    framework: 'angular',
    version: '1.0.0',
  };

  constructor(
    private electronService: ElectronService,
    private projectService: ProjectService,
    private configService: ConfigService,
    private uiService: UiService,
  ) {}

  async ngOnInit() {
    if (this.electronService.isElectron) {
      this.projectData.path = window['path'].getUserDocuments();
    }
    await this.configService.init();
    this.boardList = this.configService.boardList;
    this.currentBoard = this.boardList[0];
    this.projectData.board = this.currentBoard.value;
    this.projectData.name ='project_' + generateDateString();
  }

  selectBoard(board) {
    this.currentBoard = board;
    this.projectData.board = board.value;
  }

  async selectFolder() {
    const folderPath = await window['ipcRenderer'].invoke('select-folder', {
      path: this.projectData.path,
    });
    console.log('选中的文件夹路径：', folderPath);
    this.projectData.path = folderPath;
    // 在这里对返回的 folderPath 进行后续处理
  }

  async createProject() {
    // 判断是否有同名项目
    const isExist = await this.projectService.project_exist(this.projectData);
    console.log('isExist: ', isExist);
    if (isExist) {
      console.log('项目已存在');
      // TODO 反馈项目已存在
      return;
    }

    this.currentStep = 2;
    const prjPath = await this.projectService.project_new(this.projectData);

    setTimeout(() => {
      this.currentStep = 3;
      // 关闭窗口
      window['subWindow'].close();
    }, 1000);
  }

  openUrl(url) {
    if (this.electronService.isElectron) {
      window['other'].openByBrowser(url);
    }
  }
}
