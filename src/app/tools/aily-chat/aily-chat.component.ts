import { Component, ElementRef, ViewChild } from '@angular/core';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { DialogComponent } from './components/dialog/dialog.component';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { ToolContainerComponent } from '../../components/tool-container/tool-container.component';
import { UiService } from '../../services/ui.service';
import { NzResizableModule, NzResizeEvent } from 'ng-zorro-antd/resizable';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ChatService } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SimplebarAngularModule } from 'simplebar-angular';
import { MenuComponent } from '../../components/menu/menu.component';
import { IMenuItem } from '../../configs/menu.config';

@Component({
  selector: 'app-aily-chat',
  imports: [
    SubWindowComponent,
    NzInputModule,
    FormsModule,
    CommonModule,
    DialogComponent,
    NzButtonModule,
    ToolContainerComponent,
    NzResizableModule,
    NzToolTipModule,
    SimplebarAngularModule,
    MenuComponent
  ],
  templateUrl: './aily-chat.component.html',
  styleUrl: './aily-chat.component.scss',
})
export class AilyChatComponent {
  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  @ViewChild('chatContainer') chatContainer: ElementRef;
  @ViewChild('chatList') chatList: ElementRef;

  list: any = [
//     {
//       content: 'Hello, how can I help you?',
//     },
//     {
//       content: 'I want to know the weather today.',
//       role: 'user',
//     },    {
//       content: `哈哈哈哈  

// \`\`\`c
// pinMode(pin, mode);
// \`\`\``,
//     },
//     {
//       content: 'I am in Beijing.',
//       role: 'user',
//     },    {
//       content: `\`\`\`c
// pinMode(pin, mode);
// \`\`\``
//     },
//     {
//       content: 'Thank you!',
//       role: 'user',
//     },
//     {      content: `Arduino Uno上每一个带有数字编号的引脚，都是数字引脚，包括写有"A"编号的模拟输入引脚，如图2-21。使用这些引脚具有输入输出数字信号的功能。

// 图 2‑21 可以进行数字输入输出的引脚

// **数字信号**

// 数字信号是以0、1表示的电平不连续变化的信号，也就是以二进制的形式表示的信号。 在Arduino中数字信号通过高低电平来表示，高电平则为数字信号1，低电平则为数字信号0 （如图2-22）。

// 图2-18 数字信号

// ![](https://arduino.me/storage/v1/object/public/image/dfc9651d61b02a5edb08bb1128cba4ee.webp)

// 图 2‑22 数字信号

// Arduino Uno上每一个带有数字编号的引脚，都是数字引脚，包括写有"A"编号的模拟输入引脚。使用这些引脚，可以完成输入输出数字信号的功能。

// 在使用输入或输出功能前，需要先通过pinMode() 函数配置引脚的模式为输入模式或输出模式。

// \`\`\`c
// pinMode(pin, mode);
// \`\`\`

// 参数pin为指定配置的引脚编号；参数mode为指定的配置模式。

// 可使用的三种模式，如表2-3所示：

// 表 2‑3 Arduino引脚可配置状态

// | 模式宏名称 | 说明 |
// | ----- | --- |
// | INPUT | 输入模式 |
// | OUTPUT | 输出模式 |
// | INPUT\_PULLUP | 输入上拉模式 |
// `
//     },
//     {
//       content: 'Have a nice day!',
//     },
//     {
//       content: 'You too!'
//     },
  ];

  // inputValue =
  //   '帮我生成一组流水灯功能的代码块，包含开后流水灯、关闭流水灯两个块。在开发板的D2~D13引脚上均连接有LED开后流水灯功能块，可以指定流水灯速度，调用后即开启流水关闭流水灯功能块，调用后即停止流水灯。';

  currentUrl;
  inputValue = '';

  windowInfo = 'AI助手';

  get sessionId() {
    return this.chatService.currentSessionId;
  }

  constructor(
    private uiService: UiService,
    private router: Router,
    private chatService: ChatService,
  ) { }

  ngOnInit() {
    this.currentUrl = this.router.url;
  }

  close() {
    // 关闭stream连接
    this.closeSession();
    this.uiService.closeTool('aily-chat');
  }

  ngAfterViewInit(): void {
    this.scrollToBottom(true);
    this.startSession();
  }

  appendMessage(role, text) {
    console.log('append message', role, text);
    this.list.push({
      "role": role,
      "content": text
    })
  }

  startSession(): void {
    this.chatService.startSession().subscribe((res: any) => {
      if (res.status === 'success') {
        this.chatService.currentSessionId = res.data;
        this.streamConnect();
        this.getHistory();
      }
    });
  }

  closeSession(): void {
    if (!this.sessionId) return;

    this.chatService.closeSession(this.sessionId).subscribe((res: any) => {
      console.log('close session', res);
    });
  }

  send(): void {
    if (!this.sessionId || !this.inputValue.trim()) return;

    const text = this.inputValue.trim();
    this.appendMessage('user', text);
    this.inputValue = '';

    this.chatService.sendMessage(this.sessionId, text).subscribe((res: any) => {
      console.log('send message', res);
      if (res.status === 'success') {
        this.appendMessage('aily', res.data);
      }
    });
  }

  streamConnect(): void {
    console.log("streeam connect sessionId: ", this.sessionId);
    if (!this.sessionId) return;

    this.chatService.streamConnect(this.sessionId).subscribe({
      next: (data: any) => {
        console.log("收到消息: ", data);

        try {
          if (data.type === 'agent_response') {
            this.appendMessage('助手', data.data);
          } else if (data.type === 'processing_started') {
            console.log('助手正在思考...');
          } else if (data.type === 'error') {
            console.error('助手出错:', data.data);
          }
          this.scrollToBottom();
        } catch (e) {
          console.error('解析消息出错:', e);
        }
      },
      error: (err) => {
        console.error('流连接出错:', err);
        this.appendMessage('错误', '连接中断，请刷新页面重试');
      }
    });
  }

  getHistory(): void {
    if (!this.sessionId) return;

    this.chatService.getHistory(this.sessionId).subscribe((res: any) => {
      console.log('get history', res);
      if (res.status === 'success') {
        this.list = res.data;
        this.scrollToBottom();
      } else {
        this.appendMessage('错误', res.message);
      }
    });
  }

  bottomHeight = 180;
  onContentResize({ height }: NzResizeEvent): void {
    this.bottomHeight = height!;
  }

  onKeyDown(event: KeyboardEvent) {
    // if (this.serialMonitorService.inputMode.sendByEnter) {
    //   if (event.key === 'Enter') {
    //     this.send();
    //     event.preventDefault();
    //   }
    //   return;
    // }
    // if (event.ctrlKey && event.key === 'Enter') {
    //   this.send();
    //   event.preventDefault();
    // }
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

  //   send() {
  //     console.log(this.inputValue);
  //     const msg = {
  //       content: this.inputValue,
  //       session_id: '',
  //       role: 'user',
  //     };
  //     this.list.push(msg);

  //     const uuid = this.getRandomString();

  // TODO 内容暂时须返回 toolbox 格式的json字符串方可解析，待沟通交流 解析的blockly格式
  //     const content = `
  // ## 这是一个测试标题  
  // testttttt
  // \`\`\`blockly
  // {
  //   "kind": "flyoutToolbox",
  //   "contents": [
  //     {
  //       "kind": "block",
  //       "type": "controls_if"
  //     },
  //     {
  //       "kind": "block",
  //       "type": "controls_whileUntil"
  //     }
  //   ]
  // }
  // \`\`\`

  // // # 好嘛

  // // | 什么

  // // \`\`\`blockly
  // // {
  // //   "kind": "flyoutToolbox",
  // //   "contents": [
  // //     {
  // //       "kind": "block",
  // //       "type": "controls_if"
  // //     }
  // //   ]
  // // }
  // // \`\`\`

  // // ## 这个是二级标题
  // // `;

  //     const segments = this.splitContent(content);

  //     const contentList: any = [];

  //     const ruleView = /```blockly\s([\s\S]*?)\s```/;
  //     segments.forEach((match, index) => {
  //       const exec: any = ruleView.exec(match);
  //       if (exec) {
  //         try {
  //           const data = JSON.parse(exec[1]);
  //           exec.push(data);
  //         } catch (err) { }
  //         contentList.push(exec);
  //       } else {
  //         contentList.push(match);
  //       }
  //     });

  //     this.list.push({
  //       uuid,
  //       content,
  //       contentList,
  //       role: 'system',
  //     });

  //     this.scrollToBottom();

  //     return;

  //     // TODO 临时走本地代理，需要后端处理跨域问题后更改为完整域名 @stao
  //     fetchEventSource('/api/v1/chat', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify(msg),
  //       onmessage: (event) => {
  //         const obj = this.list.find((v: any) => v.uuid === uuid);
  //         if (obj.isDone) return;
  //         obj.content += event.data;
  //         // TODO 生成内容块类型异常 @stao，需要处理后继续完善 @downey
  //         if (event.data.includes('[DONE]')) {
  //           obj.role = 'system';
  //           obj.isDone = true;
  //           console.log(obj.content);
  //         }

  //         this.scrollToBottom();
  //       },
  //       onerror(event) {
  //         console.log('服务异常', event);
  //       },
  //       onclose() {
  //         console.log('服务关闭');
  //       },
  //     }).then();
  //   }

  splitContent(content: any) {
    // 正则表达式，匹配```blockly到下一个```之间的内容
    const regex = /```blockly([\s\S]*?)```/g;

    // 使用正则表达式进行匹配
    const matches = content.match(regex);

    // 处理匹配结果，将每次```blockly前面的内容也作为一个分段
    let segments: any = [];
    let lastIndex = 0;

    if (matches) {
      matches.forEach((match) => {
        const startIndex = content.indexOf(match, lastIndex);

        // 添加```blockly前面的内容
        if (startIndex > 0) {
          segments.push(content.slice(lastIndex, startIndex));
        }

        // 添加```blockly到```之间的内容
        segments.push(match);

        // 更新lastIndex
        lastIndex = startIndex + match.length;
      });

      // 添加最后一段内容（如果有）
      if (lastIndex < content.length) {
        segments.push(content.slice(lastIndex));
      }
    } else {
      // 如果没有匹配到```blockly，则整个content作为一段
      segments.push(content);
    }

    return segments;
  }

  scrollToBottom(offset: any = -30) {
    if (this.chatList?.nativeElement && this.chatContainer?.nativeElement) {
      setTimeout(() => {
        // if (
        //   offset != true &&
        //   this.chatContainer.nativeElement.scrollTop +
        //     this.chatContainer.nativeElement.clientHeight -
        //     this.chatContainer.nativeElement.scrollHeight <
        //     offset
        // ) {
        //   return;
        // }
        this.chatContainer.nativeElement.scrollTop =
          this.chatList.nativeElement.scrollHeight;
      }, 20);
    }
  }

  HistoryList: IMenuItem[] = [
    {
      name: '如何学习arduino如何学习arduino如何学习arduino'
    },
    {
      name: '制作一个ros小车'
    },
    {
      name: '历史记录3',
    },
    {
      name: '历史记录4',
    },
    {
      name: '历史记录5',
    },
    {
      name: '历史记录6',
    },
    {
      name: '历史记录7',
    },
    {
      name: '历史记录8',
    }
  ]

  newChat() {
    this.list = [];
  }

  addFile() {
    // 添加参考文件
  }

  showHistoryList = false;
  historyListPosition = { x: 0, y: 0 };
  openHistoryChat(e) {
    // 设置菜单的位置
    this.historyListPosition = { x: window.innerWidth - 302, y: 72 };
    console.log(this.historyListPosition);

    this.showHistoryList = !this.showHistoryList;
  }

  closeMenu() {
    this.showHistoryList = false;
  }

  menuClick(e) {

  }
}
