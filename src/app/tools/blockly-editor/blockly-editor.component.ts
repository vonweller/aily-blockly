import { ChangeDetectorRef, Component } from '@angular/core';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { LibManagerComponent } from '../../components/lib-manager/lib-manager.component';
import { NotificationComponent } from '../../components/notification/notification.component';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-blockly-editor',
  imports: [
    BlocklyComponent,
    LibManagerComponent,
    NotificationComponent
  ],
  templateUrl: './blockly-editor.component.html',
  styleUrl: './blockly-editor.component.scss'
})
export class BlocklyEditorComponent {
  showProjectManager = false;

  constructor(
    private cd: ChangeDetectorRef,
    private projectService: ProjectService,
    private uiService: UiService
  ) { }

  openProjectManager() {
    this.uiService.closeToolAll();
    this.showProjectManager = !this.showProjectManager;
    this.cd.detectChanges();
  }

  // 测试用
  reload() {
    this.projectService.projectOpen(this.projectService.currentProjectPath);
  }

  // progress = 0;
  // test(e) {
  //   switch (e) {
  //     case '+':
  //       this.progress += 10;
  //       this.notice.update({ title: '编译中...', text: '正在编译 oneButton lib', state: 'doing', progress: this.progress, setTimeout: 0 });
  //       break;
  //     case '-':
  //       this.progress -= 10;
  //       this.notice.update({ title: '编译中', text: '预处理文件中', state: 'doing', progress: this.progress, setTimeout: 0 });
  //       break;
  //     case 'done':
  //       this.notice.update({ title: '编译完成', text: '固件1.1MB', state: 'done', setTimeout: 55000 });
  //       break;
  //     case 'error':
  //       this.notice.update({ title: '编译失败', text: 'Generating function prototypes...', state: 'error', setTimeout: 0 });
  //       break;
  //     case 'warn':
  //       this.notice.update({ title: '正在编译', text: '开发板Arduino UNO R4 Minima', state: 'warn', setTimeout: 155000 });
  //       break;
  //     default:
  //       break;
  //   }
  // }
}
