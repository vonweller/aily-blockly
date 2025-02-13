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
    NzStepsModule,
  ],
  templateUrl: './project-new.component.html',
  styleUrl: './project-new.component.scss',
})
export class ProjectNewComponent {
  currentStep = 0;

  boards = [
    {
      value: '@blockly/board/arduino_uno@1.0.0',
      name: 'Arduino UNO R3',
      img: 'board/arduino_uno/arduino_uno.png',
      desc: 'Arduino UNO R3 是一款基于ATmega328P的开源电子原型平台，包含数字I/O口14个（其中6个支持PWM输出），模拟输入口6个，16MHz晶振，USB接口，电源接口，ICSP接口等。',
    },
    {
      value: '@blockly/board/arduino_mega@1.0.0',
      name: 'Arduino MEGA',
      img: 'board/arduino_mega/arduino_mega.png',
      desc: 'Arduino MEGA 是一款基于ATmega2560的开源电子原型平台，包含数字I/O口54个（其中14个支持PWM输出），模拟输入口16个，16MHz晶振，USB接口，电源接口，ICSP接口等。',
    },
    {
      value: '@blockly/board/esp32c3@1.0.0',
      name: 'esp32c3',
      img: 'board/esp32c3/esp32c3.png',
      desc: 'esp32c3 是一款基于ESP32-C3的开源电子原型平台，包含数字I/O口14个（其中6个支持PWM输出），模拟输入口6个，2.4GHz Wi-Fi，蓝牙5.0，USB接口，电源接口，ICSP接口等。',
    },
    {
      value: '@blockly/board/raspberrypi_pico@1.0.0',
      name: 'RaspberryPi Pico',
      img: 'board/raspberrypi_pico/raspberrypi_pico.png',
      desc: 'RaspberryPi Pico 是一款基于RP2040的开源电子原型平台，包含数字I/O口26个（其中16个支持PWM输出），模拟输入口3个，133MHz主频，USB接口，电源接口，ICSP接口等。',
    },
    {
      value: '@blockly/board/wifiduino32@1.0.0',
      name: 'Wifiduino32',
      img: 'board/wifiduino32/wifiduino32.png',
      desc: 'Wifiduino32 是一款基于ESP32的开源电子原型平台，包含数字I/O口38个（其中6个支持PWM输出），模拟输入口6个，2.4GHz Wi-Fi，蓝牙4.2，USB接口，电源接口，ICSP接口等。',
    },
  ];

  projectData = {
    name: 'new project',
    path: '',
    description: '',
    board: this.boards[0].value,
    type: 'web',
    framework: 'angular',
    version: '1.0.0',
  };

  constructor(private electronService: ElectronService) {}

  ngOnInit() {
    if (this.electronService.isElectron) {
      this.projectData.path = window['path'].getUserDocuments();
    }
  }

  currentBoard = this.boards[0];
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

  createProject() {}
}
