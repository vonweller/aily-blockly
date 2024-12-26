import { Component, Input } from '@angular/core';
import { AngularDraggableModule } from 'angular2-draggable';
@Component({
  selector: 'app-inner-window',
  imports: [AngularDraggableModule],
  templateUrl: './inner-window.component.html',
  styleUrl: './inner-window.component.scss'
})
export class InnerWindowComponent {

  @Input() title: string;

}
