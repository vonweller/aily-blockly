import { Component } from '@angular/core';
import { FileTreeComponent } from './components/file-tree/file-tree.component';

@Component({
  selector: 'app-code-ide',
  imports: [FileTreeComponent],
  templateUrl: './code-editor.component.html',
  styleUrl: './code-editor.component.scss'
})
export class CodeEditorComponent {

}
