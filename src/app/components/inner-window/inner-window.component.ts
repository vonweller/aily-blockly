import { CommonModule } from '@angular/common';
import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import {
  AngularDraggableModule,
  AngularResizableDirective,
} from 'angular2-draggable';
import { IWindowOpt, IwindowService } from '../../services/iwindow.service';
@Component({
  selector: 'app-inner-window',
  imports: [AngularDraggableModule, CommonModule],
  templateUrl: './inner-window.component.html',
  styleUrl: './inner-window.component.scss',
})
export class InnerWindowComponent {
  @Input() opt: IWindowOpt;

  optDefault = {
    position: { x: 0, y: 0 },
    size: { width: 400, height: 600, minWidth: 400, minHeight: 600 },
    zindex: 0,
  };

  @ViewChild('block') block: AngularResizableDirective;

  isMinimize = false;
  isMaximize = false;
  isClose = false;

  constructor(private iwindowService: IwindowService) {}

  ngOnInit(): void {
    console.log(this.opt);
    this.opt.position = this.opt.position || this.optDefault.position;
    this.opt.size = this.opt.size || this.optDefault.size;
    this.opt.zindex = this.opt.zindex || this.optDefault.zindex;
    // this.sourcePosition = JSON.parse(JSON.stringify(this.opt.position));
  }

  ngAfterViewInit(): void {}

  oldSize;
  oldPosition;
  offsetPosition = { x: 0, y: 0 };

  maximize() {
    console.log(JSON.stringify(this.opt.position));

    if (
      this.opt.size.width == window.innerWidth &&
      this.opt.size.height == window.innerHeight &&
      this.opt.position.x == 0 - this.offsetPosition.x &&
      this.opt.position.y == 0 - this.offsetPosition.y
    ) {
      this.isMaximize = true;
    } else {
      this.isMaximize = false;
    }

    if (this.isMaximize) {
      // 恢复size
      console.log(
        '恢复 ' + this.opt.title,
        JSON.parse(JSON.stringify(this.oldSize)),
      );
      this.isMaximize = false;
      this.opt.size = JSON.parse(JSON.stringify(this.oldSize));
      this.opt.position = JSON.parse(JSON.stringify(this.oldPosition));
    } else {
      // 最大化size
      console.log('最大化 ' + this.opt.title);
      this.isMaximize = true;
      this.oldSize = JSON.parse(JSON.stringify(this.opt.size));
      this.oldPosition = JSON.parse(JSON.stringify(this.opt.position));
      this.opt.position = {
        x: 0 - this.offsetPosition.x,
        y: 0 - this.offsetPosition.y,
      };
      this.opt.size.width = window.innerWidth;
      this.opt.size.height = window.innerHeight;
    }
  }

  minimize() {
    this.isMinimize = true;
    this.opt.zindex = -999;
  }

  close() {
    this.isClose = true;
    setTimeout(() => {
      this.iwindowService.closeWindow(this.opt);
    }, 300);
  }

  onFoucs(event) {
    if (this.opt.zindex > 0)
      this.opt.zindex = this.iwindowService.getMaxZindex() + 1;
  }

  onMoveEnd(event) {
    this.opt.position.x = event.x;
    this.opt.position.y = event.y;
  }

  onResizeStop(event) {
    console.log(event);
    this.opt.size.width = event.size.width;
    this.opt.size.height = event.size.height;
    this.offsetPosition = { x: event.position.left, y: event.position.top };
  }
}
