import { Component } from '@angular/core';
import { FileTreeComponent } from './components/file-tree/file-tree.component';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { MonacoEditorComponent } from '../../components/monaco-editor/monaco-editor.component';

@Component({
  selector: 'app-code-editor',
  imports: [FileTreeComponent, NzTabsModule, MonacoEditorComponent],
  templateUrl: './code-editor.component.html',
  styleUrl: './code-editor.component.scss'
})
export class CodeEditorComponent {

  selectedIndex = 0;
  tabs = ['Tab 1', 'Tab 2'];

  closeTab({ index }: { index: number }): void {
    this.tabs.splice(index, 1);
  }
}
