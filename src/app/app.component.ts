import { ChangeDetectorRef, Component, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  TranslateService,
  TranslatePipe,
  TranslateDirective,
} from '@ngx-translate/core';
import { HeaderComponent } from './components/header/header.component';
import { BlocklyComponent } from './blockly/blockly.component';
import { ProjectBtnComponent } from './components/project-btn/project-btn.component';
import { ProjectManagerComponent } from './components/project-manager/project-manager.component';
import { AilyChatComponent } from './tools/aily-chat/aily-chat.component';
import { SerialMonitorComponent } from './tools/serial-monitor/serial-monitor.component';
import { CodeViewerComponent } from './tools/code-viewer/code-viewer.component';
import { CommonModule } from '@angular/common';
import { IwindowService } from './services/iwindow.service';
import { InnerWindowComponent } from './components/inner-window/inner-window.component';
import { TerminalComponent } from './tools/terminal/terminal.component';
import { DataChartComponent } from './tools/data-chart/data-chart.component';
import { BlocklyEditorComponent } from './tools/blockly-editor/blockly-editor.component';
import { ElectronService } from './services/electron.service';
import { FileTreeComponent } from './components/file-tree/file-tree.component';
import { FooterComponent } from './components/footer/footer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    BlocklyComponent,
    TranslatePipe,
    TranslateDirective,
    HeaderComponent,
    FooterComponent,
    ProjectBtnComponent,
    ProjectManagerComponent,
    AilyChatComponent,
    CodeViewerComponent,
    SerialMonitorComponent,
    CommonModule,
    InnerWindowComponent,
    TerminalComponent,
    DataChartComponent,
    BlocklyEditorComponent,
    FileTreeComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'aily-blockly';

  showProjectManager = false;

  @ViewChild('WindowsBounds') windowsBounds;

  get windows() {
    return this.iwindowService.windows;
  }

  constructor(
    private translate: TranslateService,
    private iwindowService: IwindowService,
    private electronService: ElectronService,
    private cd:ChangeDetectorRef
  ) {
    this.translate.addLangs(['zh', 'en']);
    this.translate.setDefaultLang('zh');
    this.translate.use('zh');
    this.electronService.init();
  }

  ngAfterViewInit(): void {
    // this.iwindowService.bounds = this.windowsBounds.nativeElement;
    // setTimeout(() => {
    //   this.iwindowService.openWindow({
    //     type: 'blockly-editor',
    //     title: 'Blockly Editor',
    //     size: { width: window.innerWidth, height: window.innerHeight },
    //     position: { x: 0, y: 0 },
    //     zindex: 0
    //   });
    // }, 500);
  }

  openProjectManager() {
    this.showProjectManager = !this.showProjectManager;
  }

  showRbox = false;
  openRbox() {
    this.showRbox = !this.showRbox;
    setTimeout(() => {
      this.cd.detectChanges();
    }, 100);
  }
}
