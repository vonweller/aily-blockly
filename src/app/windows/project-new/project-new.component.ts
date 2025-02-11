import { Component } from '@angular/core';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzStepsModule } from 'ng-zorro-antd/steps';

@Component({
  selector: 'app-project-new',
  imports: [
    CommonModule,
    FormsModule,
    SubWindowComponent,
    NzButtonModule,
    NzInputModule,
    NzStepsModule
  ],
  templateUrl: './project-new.component.html',
  styleUrl: './project-new.component.scss'
})
export class ProjectNewComponent {

  currentStep = 0;

  projectData = {
    name: 'new project',
    path: '',
    description: '',
    board: 'arduino',
    type: 'web',
    framework: 'angular',
    version: '1.0.0',
  }

  ngOnInit() {
    this.projectData.path = window['path'].getUserDocuments();
  }

  async selectFolder() {
    const folderPath = await window['ipcRenderer'].invoke("select-folder", { path: this.projectData.path });
    console.log("选中的文件夹路径：", folderPath);
    this.projectData.path = folderPath;
    // 在这里对返回的 folderPath 进行后续处理
  }

  createProject() {

  }
}
