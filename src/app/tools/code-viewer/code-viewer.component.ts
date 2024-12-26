import { Component } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
import { CodeEditorComponent } from '../../components/code-editor/code-editor.component';

@Component({
  selector: 'app-code-viewer',
  imports: [
    CodeEditorComponent,
    InnerWindowComponent
  ],
  templateUrl: './code-viewer.component.html',
  styleUrl: './code-viewer.component.scss'
})
export class CodeViewerComponent {

}
