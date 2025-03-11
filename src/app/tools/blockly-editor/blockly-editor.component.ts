import { ChangeDetectorRef, Component } from '@angular/core';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { ProjectBtnComponent } from '../../components/project-btn/project-btn.component';
import { LibManagerComponent } from './components/lib-manager/lib-manager.component';
import { NotificationComponent } from './components/notification/notification.component';
import { NoticeService } from '../../services/notice.service';

@Component({
  selector: 'app-blockly-editor',
  imports: [
    BlocklyComponent,
    ProjectBtnComponent,
    LibManagerComponent,
    NotificationComponent
  ],
  templateUrl: './blockly-editor.component.html',
  styleUrl: './blockly-editor.component.scss'
})
export class BlocklyEditorComponent {
  showProjectManager = false;

  constructor(
    private notice: NoticeService,
    private cd: ChangeDetectorRef
  ) { }

  openProjectManager() {
    this.showProjectManager = !this.showProjectManager;
    this.cd.detectChanges();
  }

  progress = 0;
  test(e) {
    switch (e) {
      case '+':
        this.progress += 10;
        this.notice.update({ title: '编译中...', text: '正在编译 oneButton lib', state: 'doing', progress: this.progress, setTimeout: 0 });
        break;
      case '-':
        this.progress -= 10;
        this.notice.update({ title: 'test', text: 'test', state: 'doing', progress: this.progress, setTimeout: 0 });
        break;
      case 'done':
        this.notice.update({ title: 'test', text: 'test', state: 'done', setTimeout: 55000 });
        break;
      case 'error':
        this.notice.update({ title: '编译失败', text: 'fdasfdasfasdfdasfasdfasdfasdfasdfasfsdafasdsdfasdfasdfasdfasfsdafasdf', state: 'error', setTimeout: 0 });
        break;
      case 'warn':
        this.notice.update({ title: '正在编译', text: '开发板Arduino UNO R4 Minima', state: 'warn', setTimeout: 155000 });
        break;
      default:
        break;
    }
  }
}
