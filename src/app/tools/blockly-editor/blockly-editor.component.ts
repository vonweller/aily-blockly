import { Component } from '@angular/core';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { ProjectBtnComponent } from '../../components/project-btn/project-btn.component';

@Component({
  selector: 'app-blockly-editor',
  imports: [
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
