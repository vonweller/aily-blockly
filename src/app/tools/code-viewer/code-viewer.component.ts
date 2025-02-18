import { Component } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
import { CodeEditorComponent } from '../../components/code-editor/code-editor.component';
import { BlocklyService } from '../../blockly/blockly.service';
import { ToolContainerComponent } from '../../components/tool-container/tool-container.component';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-code-viewer',
  imports: [
    CodeEditorComponent,
    InnerWindowComponent,
    ToolContainerComponent
  ],
  templateUrl: './code-viewer.component.html',
  styleUrl: './code-viewer.component.scss'
})
export class CodeViewerComponent {

  code = '';

  constructor(
    private blocklyService: BlocklyService,
    private uiService: UiService
  ) { }

  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
    this.blocklyService.codeSubject.subscribe(code => {
      setTimeout(() => {
        this.code = code;
      }, 100);
    })
  }

  close() {
    this.uiService.closeTool('code-viewer');
  }
}
