import { Component } from '@angular/core';
import { BlocklyEditorComponent } from '../tools/blockly-editor/blockly-editor.component';
import { FooterComponent } from '../components/footer/footer.component';
import { HeaderComponent } from '../components/header/header.component';
import { CommonModule } from '@angular/common';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzResizableModule, NzResizeEvent } from 'ng-zorro-antd/resizable';
import { AilyChatComponent } from '../tools/aily-chat/aily-chat.component';
import { TerminalComponent } from '../tools/terminal/terminal.component';
import { ToolContainerComponent } from '../components/tool-container/tool-container.component';
import { GuideComponent } from '../components/guide/guide.component';
import { ToolContainerService } from '../components/tool-container/tool-container.service';

@Component({
  selector: 'app-main-window',
  imports: [
    CommonModule,
    HeaderComponent,
    FooterComponent,
    BlocklyEditorComponent,
    NzLayoutModule,
    NzResizableModule,
    AilyChatComponent,
    TerminalComponent,
    ToolContainerComponent,
    GuideComponent,
  ],
  templateUrl: './main-window.component.html',
  styleUrl: './main-window.component.scss',
})
export class MainWindowComponent {
  constructor(
    private toolContainerService: ToolContainerService
  ) {}


  ngAfterViewInit(): void {
    this.toolContainerService.actionSubject.subscribe((action: string) => {
      console.log(action);
    });
  }

  showRbox = false;
  showBbox = false;

  openRbox() {
    this.showRbox = !this.showRbox;
    setTimeout(() => {
      // this.cd.detectChanges();
    }, 100);
  }

  openBbox() {
    this.showBbox = !this.showBbox;
    setTimeout(() => {
      // this.cd.detectChanges();
    }, 100);
  }

  bottomHeight = 210;
  siderWidth = 350;

  onSideResize({ width }: NzResizeEvent): void {
    this.siderWidth = width!;
  }

  onContentResize({ height }: NzResizeEvent): void {
    this.bottomHeight = height!;
  }
}
