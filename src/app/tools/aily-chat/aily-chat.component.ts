import { Component } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { InputBoxComponent } from './components/input-box/input-box.component';
import { DialogComponent } from './components/dialog/dialog.component';

@Component({
  selector: 'app-aily-chat',
  imports: [
    InnerWindowComponent,
    NzInputModule,
    FormsModule,
    InputBoxComponent,
    DialogComponent
  ],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss'
})
export class AilyChatComponent {


  list = [
    {
      content: 'Hello, how can I help you?',
    },
    {
      content: 'I want to know the weather today.',
      role: 'user',
    },
    {
      content: 'Where are you now?',
    },
    {
      content: 'I am in Beijing.',
      role: 'user',
    },
    {
      content: 'The weather in Beijing today is sunny, with a maximum temperature of 30 degrees and a minimum temperature of 20 degrees.',
    },
  ]
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
