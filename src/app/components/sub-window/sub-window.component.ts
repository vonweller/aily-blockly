import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sub-window',
  imports: [],
  templateUrl: './sub-window.component.html',
  styleUrl: './sub-window.component.scss'
})
export class SubWindowComponent {
  @Input() title = 'sub-window';
  @Input() winBtns = [
    'minimize', 
    'maximize', 
    'close'
  ];


  minimize() {
    window['iWindow'].minimize();
  }

  maximize() {
    window['iWindow'].maximize();
  }

  close() {
    window['iWindow'].close();
  }
}
