import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AngularDraggableModule } from 'angular2-draggable';
@Component({
  selector: 'app-inner-window',
  imports: [AngularDraggableModule,
    CommonModule
  ],
  templateUrl: './inner-window.component.html',
  styleUrl: './inner-window.component.scss'
})
export class InnerWindowComponent {

  @Input() title: string;

  isMinimize = false;
  isClose = false;

  minimize() {
    this.isMinimize = true;
  }

  maximize() {

  }

  close() {
    this.isClose = true;
  }

}
