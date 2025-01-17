import { Component } from '@angular/core';
import { InnerWindowComponent } from '../../components/inner-window/inner-window.component';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { InputBoxComponent } from './components/input-box/input-box.component';
import { DialogComponent } from './components/dialog/dialog.component';
import { fetchEventSource } from '@microsoft/fetch-event-source';

@Component({
  selector: 'app-aily-chat',
  imports: [NzInputModule, FormsModule, DialogComponent],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss',
})
export class AilyChatComponent {
  list: any = [
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
      content:
        'The weather in Beijing today is sunny, with a maximum temperature of 30 degrees and a minimum temperature of 20 degrees.',
    },
  ];
  inputValue =
    '帮我生成一组流水灯功能的代码块，包含开后流水灯、关闭流水灯两个块。在开发板的D2~D13引脚上均连接有LED开后流水灯功能块，可以指定流水灯速度，调用后即开启流水关闭流水灯功能块，调用后即停止流水灯。';

  constructor() {}

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

  getRandomString() {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  send() {
    console.log(this.inputValue);
    const msg = {
      content: this.inputValue,
      session_id: '',
      role: 'user',
    };
    this.list.push(msg);

    const uuid = this.getRandomString();

    this.list.push({
      uuid,
      content: '',
      role: 'system',
    });

    // TODO 临时走本地代理，需要后端处理跨域问题后更改为完整域名 @stao
    fetchEventSource('/api/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(msg),
      onmessage: (event) => {
        this.list.find((v: any) => v.uuid === uuid).content += event.data;
        // TODO 生成内容块类型异常 @stao，需要处理后继续完善 @downey
        // if (event.data === '[DONE]') {
        //   this.list.find((v: any) => v.uuid === uuid).role = 'system';
        //   this.list.find((v: any) => v.uuid === uuid).isDone = true;
        // }
        // TODO 滚动细节处理 @downey
      },
      onerror(event) {
        console.log('服务异常', event);
      },
      onclose() {
        console.log('服务关闭');
      },
    }).then();
  }
}
