import { Component, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  TranslateService,
  TranslatePipe,
  TranslateDirective
} from "@ngx-translate/core";
import { HeaderComponent } from './components/header/header.component';
import { BlocklyComponent } from './blockly/blockly.component';
import { ProjectBtnComponent } from './components/project-btn/project-btn.component';
import { ProjectManagerComponent } from './components/project-manager/project-manager.component';
import { AilyChatComponent } from './tools/aily-chat/aily-chat.component';
import { SerialMonitorComponent } from './tools/serial-monitor/serial-monitor.component';
import { CodeViewerComponent } from './tools/code-viewer/code-viewer.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { CommonModule } from '@angular/common';
import { IwindowService } from './services/iwindow.service';
import { InnerWindowComponent } from './components/inner-window/inner-window.component';
import { TerminalComponent } from './tools/terminal/terminal.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet,
    BlocklyComponent,
    TranslatePipe,
    TranslateDirective,
    HeaderComponent,
    ProjectBtnComponent,
    ProjectManagerComponent,
    AilyChatComponent,
    CodeViewerComponent,
    SerialMonitorComponent,
    // BrowserAnimationsModule,
    CommonModule,
    InnerWindowComponent,
    TerminalComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'aily-blockly';

  showProjectManager = false;

  @ViewChild('WindowsBounds') windowsBounds;

  get windows() {
    return this.iwindowService.windows
  }

  constructor(
    private translate: TranslateService,
    private iwindowService: IwindowService
  ) {
    this.translate.addLangs(['zh', 'en']);
    this.translate.setDefaultLang('zh');
    this.translate.use('zh');
  }

  ngAfterViewInit(): void {
    this.iwindowService.bounds = this.windowsBounds.nativeElement;
  }

  openProjectManager() {
    this.showProjectManager = !this.showProjectManager;
  }
}
