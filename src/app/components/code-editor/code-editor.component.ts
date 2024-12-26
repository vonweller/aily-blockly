import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCodeEditorModule, NzCodeEditorComponent } from 'ng-zorro-antd/code-editor';


@Component({
  selector: 'app-code-editor',
  imports: [
    NzCodeEditorModule,
    CommonModule,
    FormsModule
  ],
  templateUrl: './code-editor.component.html',
  styleUrl: './code-editor.component.scss'
})
export class CodeEditorComponent {

  @ViewChild(NzCodeEditorComponent) codeEditor: NzCodeEditorComponent;
  private resizeObserver: ResizeObserver;

  code = 'console.log("Hello, World!")';

  constructor(
    private elementRef: ElementRef
  ) { }

  ngOnInit() {
    this.resizeObserver = new ResizeObserver(() => {
      console.log('resize');
      if (this.codeEditor) {
        this.codeEditor.layout();
      }
    });
  }

  ngAfterViewInit(): void {
    
    this.resizeObserver.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy() {
    this.resizeObserver.disconnect();
  }

}
