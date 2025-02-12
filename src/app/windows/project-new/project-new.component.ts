import { Component } from '@angular/core';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzStepsModule } from 'ng-zorro-antd/steps';
import { ElectronService } from '../../services/electron.service';

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

  boards = [
    { value: 'arduino', name: 'Arduino', img: 'assets/arduino.png' },
    { value: 'esp8266', name: 'ESP8266', img: 'assets/arduino.png' },
    { value: 'esp32', name: 'ESP32', img: 'assets/arduino.png' },
    { value: 'raspberry', name: 'Raspberry', img: 'assets/arduino.png' },
    { value: 'stm32', name: 'STM32', img: 'assets/arduino.png' },
    { value: 'other', name: 'Other', img: 'assets/arduino.png' },
  ]

  projectData = {
    name: 'new project',
    path: '',
    description: '',
    board: 'arduino',
    type: 'web',
    framework: 'angular',
    version: '1.0.0',
  }

  constructor(
    private electronService: ElectronService
  ) {

  }

  ngOnInit() {
    if (this.electronService.isElectron) {
      this.projectData.path = window['path'].getUserDocuments();
    }
  }

  selectBoard(board){
    
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
