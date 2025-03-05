import { Component } from '@angular/core';
import { BlocklyComponent } from '../../blockly/blockly.component';
import { ProjectBtnComponent } from '../../components/project-btn/project-btn.component';
import { LibManagerComponent } from './components/lib-manager/lib-manager.component';

@Component({
  selector: 'app-blockly-editor',
  imports: [
    BlocklyComponent,
    ProjectBtnComponent,
    LibManagerComponent
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
