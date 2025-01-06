import { CommonModule } from '@angular/common';
import { Component, input, Input } from '@angular/core';
import { AngularDraggableModule } from 'angular2-draggable';
import { IWindowOpt, IwindowService } from '../../services/iwindow.service';
@Component({
  selector: 'app-inner-window',
  imports: [AngularDraggableModule,
    CommonModule
  ],
  templateUrl: './inner-window.component.html',
  styleUrl: './inner-window.component.scss'
})
export class InnerWindowComponent {

  @Input() width: number = 400;
  @Input() height: number = 600;

  @Input() top: number = 65;
  @Input() right: number = 0;

  @Input() opt: IWindowOpt;

  isMinimize = false;
  isClose = false;

  constructor(
    private iwindowService: IwindowService
  ) {

  }

  minimize() {
    this.isMinimize = true;
  }

  maximize() {

  }

  close() {
    this.isClose = true;
    this.iwindowService.closeWindow(this.opt);
  }

}
