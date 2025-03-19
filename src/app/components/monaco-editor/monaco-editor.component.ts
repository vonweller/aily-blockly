import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCodeEditorModule, NzCodeEditorComponent } from 'ng-zorro-antd/code-editor';


@Component({
  selector: 'app-monaco-editor',
  imports: [
    NzCodeEditorModule,
    CommonModule,
    FormsModule
  ],
  templateUrl: './monaco-editor.component.html',
  styleUrl: './monaco-editor.component.scss'
})
export class MonacoEditorComponent {

  @ViewChild(NzCodeEditorComponent) codeEditor: NzCodeEditorComponent;

  editorOption: any = {
    language: 'cpp',
    theme: 'vs-dark',
    lineNumbers: 'on',
    automaticLayout: true
  }

  @Input() code = '';
  @Output() codeChange = new EventEmitter<string>();

  constructor(
  ) { }

  ngOnInit() {
  }

  ngAfterViewInit() {
  }

  ngOnDestroy() {
  }

  onCodeChange(newCode: string): void {
    this.codeChange.emit(newCode);
  }
}
