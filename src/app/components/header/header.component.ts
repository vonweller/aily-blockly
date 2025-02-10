import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { HEADER_MENU } from '../../configs/header.config';
import { IwindowService } from '../../services/iwindow.service';
import { arduinoGenerator, DEFAULT_DATA } from '../../blockly/generators/arduino/arduino';
import { ArduinoCliService } from '../../services/arduino-cli.service';
import { BlocklyService } from '../../blockly/blockly.service';

@Component({
  selector: 'app-header',
  imports: [CommonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent {

  headerMenu = HEADER_MENU;

  constructor(
    private iwindowService: IwindowService,
    private arduinoCliService: ArduinoCliService,
    private blocklyService: BlocklyService
  ) {

  }

  onClick(btn) {
    // console.log(btn);
    switch (btn.action) {
      case 'open-aily-chat':
        this.iwindowService.openWindow({
          type: 'aily-chat', title: 'AI助手',
          size: { width: 600, height: 500 },
          position: { x: window.innerWidth / 2 - 300, y: window.innerHeight / 2 - 200 }
        });
        break;
      case 'open-code-viewer':
        this.iwindowService.openWindow({
          type: 'code-viewer', title: '代码预览',
          size: { width: 400, height: window.innerHeight - 65 - 200 },
          position: { x: window.innerWidth - 400, y: 65 }
        });
        break;
      case 'open-serial-monitor':
        this.iwindowService.openWindow({ type: 'serial-monitor', title: '串口助手' });
        // 显示串口图表
        // setTimeout(() => {
        //   this.iwindowService.openWindow({ type: 'data-chart', title: '数据图表' });
        // }, 50);
        break
      case 'open-terminal':
        this.iwindowService.openWindow({
          type: 'terminal', title: '终端',
          size: { width: window.innerWidth - 180, height: 200 },
          position: { x: 180, y: window.innerHeight - 200 }
        });
        break
      case 'open-prj-builder':
        this.iwindowService.openWindow({
          type: 'terminal', title: '终端',
          size: { width: window.innerWidth - 180, height: 200 },
          position: { x: 180, y: window.innerHeight - 200 }
        });
        let code = arduinoGenerator.workspaceToCode(this.blocklyService.workspace);
        this.arduinoCliService.build(code).then(() => {});
        break
      case 'open-prj-uploader':
        this.iwindowService.openWindow({
          type: 'terminal', title: '终端',
          size: { width: window.innerWidth - 180, height: 200 },
          position: { x: 180, y: window.innerHeight - 200 }
        });
        this.arduinoCliService.upload().then(() => {});
        break
    }
  }
}
