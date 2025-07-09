import { Component, ChangeDetectorRef } from '@angular/core';
import { FooterComponent } from './components/footer/footer.component';
import { HeaderComponent } from './components/header/header.component';
import { CommonModule } from '@angular/common';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzResizableModule, NzResizeEvent } from 'ng-zorro-antd/resizable';
import { AilyChatComponent } from '../tools/aily-chat/aily-chat.component';
import { TerminalComponent } from '../tools/terminal/terminal.component';
import { UiService } from '../services/ui.service';
import { SerialMonitorComponent } from '../tools/serial-monitor/serial-monitor.component';
import { CodeViewerComponent } from '../tools/code-viewer/code-viewer.component';
import { ProjectService } from '../services/project.service';
import { SimplebarAngularModule } from 'simplebar-angular';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AppStoreComponent } from '../tools/app-store/app-store.component';
import { UpdateService } from '../services/update.service';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NpmService } from '../services/npm.service';
import { SimulatorComponent } from '../tools/simulator/simulator.component';
import { Router, RouterModule } from '@angular/router';
import { ConfigService } from '../services/config.service';
import { UserComponent } from './components/user/user.component';

@Component({
  selector: 'app-main-window',
  imports: [
    CommonModule,
    HeaderComponent,
    FooterComponent,
    NzLayoutModule,
    NzResizableModule,
    AilyChatComponent,
    TerminalComponent,
    SerialMonitorComponent,
    CodeViewerComponent,
    SimplebarAngularModule,
    AppStoreComponent,
    NzModalModule,
    SimulatorComponent,
    RouterModule
  ],
  templateUrl: './main-window.component.html',
  styleUrl: './main-window.component.scss',
})
export class MainWindowComponent {
  showRbox = false;
  showBbox = false;
  terminalTab = 'default';  // error,info,log

  get topTool() {
    return this.uiService.topTool;
  }

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  constructor(
    private uiService: UiService,
    private projectService: ProjectService,
    private message: NzMessageService,
    private cd: ChangeDetectorRef,
    private updateService: UpdateService,
    private npmService: NpmService,
    private router: Router,
    private configService: ConfigService,
  ) { }

  ngOnInit(): void {
    this.uiService.init();
    this.projectService.init();
    this.updateService.init();
    this.npmService.init();

    // 语言设置变化后，重新加载项目
    window['ipcRenderer'].on('setting-changed', async (event, data) => {
      await this.configService.load();
      if (data.action == 'language-changed' && this.router.url.includes('/main/blockly-editor')) {
        console.log('mainwindow setLanguage', data);
        this.projectService.save();
        setTimeout(() => {
          this.projectService.projectOpen();
        }, 100);
      }
    });
  }

  ngAfterViewInit(): void {
    this.uiService.actionSubject.subscribe((e: any) => {
      // console.log(e);
      switch (e.type) {
        case 'tool':
          if (e.action === 'open') {
            this.showRbox = true;
          } else {
            if (this.topTool === null) {
              this.showRbox = false;
            }
          }
          break;
        case 'terminal':
          if (e.action === 'open') {
            this.showBbox = true;
            this.terminalTab = e.data;
          } else {
            this.showBbox = false;
          }
          break;
        default:
          break;
      }
      this.cd.detectChanges();
    });

    this.projectService.stateSubject.subscribe((state) => {
      switch (state) {
        case 'loading':
          // this.loaded = false;
          setTimeout(() => {
            this.message.loading('Project Loading...');
            // this.loaded = true;
          }, 20);
          break;
        case 'loaded':
          this.message.remove();
          this.message.success('Project Loaded');
          break;
        case 'saving':
          this.message.loading('Project Saving...');
          break;
        case 'saved':
          this.message.remove();
          this.message.success('Project Saved');
          break;
        case 'default':
          // this.message.success('Project Closed');
          // this.loaded = false;
          break;
        default:
          break;
      }
      this.cd.detectChanges();
    });
  }

  closeRightBox() {
    this.showRbox = false;
  }

  bottomHeight = 210;
  siderWidth = 400;

  onSideResize({ width }: NzResizeEvent): void {
    this.siderWidth = width!;
  }

  onContentResize({ height }: NzResizeEvent): void {
    this.bottomHeight = height!;
  }
}
