import { Component } from '@angular/core';
import { NgxDragResizeModule, NgxResizeHandleType } from 'ngx-drag-resize';
import { AilyCodingComponent } from '../aily-coding/aily-coding.component';

@Component({
  selector: 'app-aily-chat',
  imports: [NgxDragResizeModule, AilyCodingComponent],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss',
})
export class AilyChatComponent {
  readonly handleType = NgxResizeHandleType;

  // private isDragging = false;
  // private startX: number;
  // private startWidth: number;

  ngOnInit() {}

  ngAfterViewInit(): void {
    // console.log(this.dragHandle);
    // this.dragHandle.nativeElement.addEventListener('mousedown', (e: MouseEvent) => {
    //   console.log('mousedown');
    //   this.isDragging = true;
    //   this.startX = e.clientX;
    //   this.startWidth = this.resizableDiv.nativeElement.getBoundingClientRect().width;
    //   this.dragHandle.nativeElement.addEventListener('mousemove', this.handleMouseMove);
    //   this.dragHandle.nativeElement.addEventListener('mouseup', this.handleMouseUp);
    // });
  }

  // private handleMouseMove = (e: MouseEvent) => {
  //   if (!this.isDragging) return;
  //   const width = this.startWidth - (e.clientX - this.startX);
  //   this.resizableDiv.nativeElement['style'].width = `${width}px`;
  // }

  // private handleMouseUp = () => {
  //   this.isDragging = false;
  //   this.dragHandle.nativeElement.removeEventListener('mousemove', this.handleMouseMove);
  //   this.dragHandle.nativeElement.removeEventListener('mouseup', this.handleMouseUp);
  // }
}
