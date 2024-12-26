import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {
  TranslateService,
  TranslatePipe,
  TranslateDirective
} from "@ngx-translate/core";
import { HeaderComponent } from './components/header/header.component';
import { BlocklyComponent } from './blockly/blockly.component';
import { ProjectBtnComponent } from './components/project-btn/project-btn.component';
import { ProjectManagerComponent } from './components/project-mangager/project-manager.component';
import { AilyChatComponent } from './tools/aily-chat/aily-chat.component';
import { SerialMonitorComponent } from './tools/serial-monitor/serial-monitor.component';
import { CodeViewerComponent } from './tools/code-viewer/code-viewer.component';

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
    SerialMonitorComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'aily-blockly';

  showProjectManager = false;

  constructor(private translate: TranslateService) {
    this.translate.addLangs(['zh', 'en']);
    this.translate.setDefaultLang('zh');
    this.translate.use('zh');
  }

  openProjectManager(){
    this.showProjectManager = !this.showProjectManager;
  }
}
