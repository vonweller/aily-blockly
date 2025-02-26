import { Component, ChangeDetectorRef } from '@angular/core';
import { BlocklyEditorComponent } from '../tools/blockly-editor/blockly-editor.component';
import { FooterComponent } from './components/footer/footer.component';
import { HeaderComponent } from './components/header/header.component';
import { CommonModule } from '@angular/common';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzResizableModule, NzResizeEvent } from 'ng-zorro-antd/resizable';
import { AilyChatComponent } from '../tools/aily-chat/aily-chat.component';
import { TerminalComponent } from '../tools/terminal/terminal.component';
import { ToolContainerComponent } from '../components/tool-container/tool-container.component';
import { UiService } from '../services/ui.service';
import { SerialMonitorComponent } from '../tools/serial-monitor/serial-monitor.component';
import { CodeViewerComponent } from '../tools/code-viewer/code-viewer.component';
import { ProjectService } from '../services/project.service';
import { GuideComponent } from './components/guide/guide.component';
import { SimplebarAngularModule } from 'simplebar-angular';

@Component({
  selector: 'app-main-window',
  imports: [
    CommonModule,
    HeaderComponent,
    FooterComponent,
    BlocklyEditorComponent,
    NzLayoutModule,
    NzResizableModule,
    AilyChatComponent,
    TerminalComponent,
    ToolContainerComponent,
    GuideComponent,
    SerialMonitorComponent,
    CodeViewerComponent,
    SimplebarAngularModule
  ],
  templateUrl: './main-window.component.html',
  styleUrl: './main-window.component.scss',
})
export class MainWindowComponent {
  showRbox = false;
  showBbox = false;
  terminalTab = 'default';

  loaded = false;

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  get topTool() {
    return this.uiService.topTool;
  }

  constructor(
    private uiService: UiService,
    private projectService: ProjectService,
    private cd: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.uiService.init();
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

    this.projectService.loaded.subscribe((loaded) => {
      this.loaded = loaded;
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
