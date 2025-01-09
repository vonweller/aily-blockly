import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { AngularDraggableModule, AngularResizableDirective } from 'angular2-draggable';
import { IWindowOpt, IwindowService } from '../../services/iwindow.service';
@Component({
  selector: 'app-inner-window',
  imports: [
    AngularDraggableModule,
    CommonModule
  ],
  templateUrl: './inner-window.component.html',
  styleUrl: './inner-window.component.scss'
})
export class InnerWindowComponent {

  @Input() opt: IWindowOpt;

  optDefault = {
    position: { x: 0, y: 0 },
    size: { width: 400, height: 600, minWidth: 400, minHeight: 600 },
    zindex: 0,
  }

  @ViewChild('block') block: AngularResizableDirective;

  get windowsBounds() {
    return this.iwindowService.bounds;
  }

  isMinimize = false;
  isMaximize = false;
  isClose = false;

  constructor(
    private iwindowService: IwindowService
  ) { }

  ngOnInit(): void {
    console.log(this.opt);
    this.opt = Object.assign(this.optDefault, this.opt);
  }

  ngAfterViewInit(): void {
  }

  minimize() {
    this.isMinimize = true;
    this.opt.zindex = -999;
  }

  oldSize;
  oldPosition;
  maximize() {
    if (this.isMaximize) {
      // 恢复size
      this.isMaximize = false;
      this.opt.size = JSON.parse(JSON.stringify(this.oldSize));
      this.opt.position = JSON.parse(JSON.stringify(this.oldPosition));
    } else {
      // 最大化size
      this.isMaximize = true;
      this.oldSize = JSON.parse(JSON.stringify(this.opt.size));
      this.oldPosition = JSON.parse(JSON.stringify(this.opt.position));
      this.opt.position = { x: 0, y: 0 };
      this.opt.size = { width: window.innerWidth, height: window.innerHeight };
      // }, 300);
    }
  }

  close() {
    this.isClose = true;
    setTimeout(() => {
      this.iwindowService.closeWindow(this.opt);
    }, 300);
  }

  onFoucs(event) {
    this.opt.zindex = this.iwindowService.getMaxZindex() + 1;
  }

  onMoveEnd(event) {
    this.opt.position.x = event.x;
    this.opt.position.y = event.y;
  }

}
