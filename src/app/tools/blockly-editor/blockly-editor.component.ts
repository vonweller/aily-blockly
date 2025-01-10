import { Component } from '@angular/core';
import { HeaderComponent } from '../../components/header/header.component';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { ProjectBtnComponent } from '../../components/project-btn/project-btn.component';

@Component({
  selector: 'app-blockly-editor',
  imports: [
    HeaderComponent,
    BlocklyComponent,
    ProjectBtnComponent
  ],
  templateUrl: './blockly-editor.component.html',
  styleUrl: './blockly-editor.component.scss'
})
export class BlocklyEditorComponent {
  showProjectManager = false;

  openProjectManager() {
    this.showProjectManager = !this.showProjectManager;
  }
}
