import { ChangeDetectorRef, Component } from '@angular/core';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { LibManagerComponent } from '../../components/lib-manager/lib-manager.component';
import { NotificationComponent } from '../../components/notification/notification.component';
import { ProjectService } from '../../services/project.service';
import { UiService } from '../../services/ui.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-blockly-editor',
  imports: [
    BlocklyComponent,
    LibManagerComponent,
    NotificationComponent,
    TranslateModule
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
}
