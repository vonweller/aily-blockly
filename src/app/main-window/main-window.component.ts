import { Component } from '@angular/core';
import { BlocklyEditorComponent } from '../tools/blockly-editor/blockly-editor.component';
import { FooterComponent } from '../components/footer/footer.component';
import { HeaderComponent } from '../components/header/header.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-main-window',
  imports: [
    CommonModule,
    HeaderComponent, FooterComponent, BlocklyEditorComponent],
  templateUrl: './main-window.component.html',
  styleUrl: './main-window.component.scss',
})
export class MainWindowComponent {



  showRbox = false;
  openRbox() {
    this.showRbox = !this.showRbox;
    setTimeout(() => {
      // this.cd.detectChanges();
    }, 100);
  }
}
