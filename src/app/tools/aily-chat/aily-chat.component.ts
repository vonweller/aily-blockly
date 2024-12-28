import { Component } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-aily-chat',
  imports: [
    InnerWindowComponent,
    NzInputModule,
    FormsModule
  ],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss'
})
export class AilyChatComponent {


  // private isDragging = false;
  // private startX: number;
  // private startWidth: number;
  inputValue = '';

  ngOnInit() {
  }

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
