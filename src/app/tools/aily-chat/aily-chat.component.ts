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
import { ChatService } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SimplebarAngularModule } from 'simplebar-angular';
import { MenuComponent } from '../../components/menu/menu.component';
import { IMenuItem } from '../../configs/menu.config';
import { McpService } from './services/mcp.service';
import { ProjectService } from '../../services/project.service';
import { CmdOutput, CmdService } from '../../services/cmd.service';
import { ElectronService } from '../../services/electron.service';

const { pt } = (window as any)['electronAPI'].platform;

export interface Tool {
  name: string;
  description: string;
  input_schema: { [key: string]: any };
}

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

  isUserInputRequired = false;

  list: any = [
    {
      content: `以下为可用的系统提示信息：
\`\`\`aily-state
{"state":"doing","text":"正在查询开发板文档"}
\`\`\`
\`\`\`aily-state
{"state":"done","text":"开发板文档查阅完成"}
\`\`\`
\`\`\`aily-state
{"state":"warn","text":"没有找到相关的开发板文档"}
\`\`\`
\`\`\`aily-state
{"state":"error","text":"发生错误，请稍后再试"}
\`\`\`
\`\`\`aily-button
[
{"text":"创建项目","action":"create_project"},
{"text":"补充说明","action":"more_info","type":"default"}
]
\`\`\`
`,
    },
    {
      content: 'I want to know the weather today.',
      role: 'user',
    }, {
      content: `推荐使用如下控制器：  
\`\`\`aily-board
{
    "name": "@aily-project/board-jinniu_board",
    "nickname": "金牛创翼板",
    "version": "0.0.1",
    "description": "金牛创翼板是一款集成多种常用传感器的开发板，包括电机、WS2812灯、LED灯、超声波、DHT11、自锁和按键开关、电位器、无源蜂鸣器和电机驱动",
    "author": "",
    "brand": "OpenJumper",
    "url": "",
    "compatibility": "",
    "img": "jinniu_board.png",
    "disabled": false
}
\`\`\``,
    },
    {
      content: 'I am in Beijing.',
      role: 'user',
    }, {
      content: `推荐使用如下扩展库
\`\`\`aily-library
{
    "name": "@aily-project/lib-servo360",
    "nickname": "360舵机驱动",
    "version": "1.0.0",
    "description": "360舵机控制支持库，支持Arduino UNO、MEGA、ESP32等开发板",
    "author": "aily Project",
    "compatibility": {
      "core": [
        "arduino:avr",
        "esp32:esp32"
      ],
      "voltage": [
        3.3,
        5
      ]
    },
    "keywords": [
      "aily",
      "blockly",
      "servo",
      "servo_attach",
      "servo_write",
      "执行器"
    ],
    "tested": true,
    "icon": "iconfont icon-servo"
}
\`\`\`
\`\`\`aily-library
{
    "name": "@aily-project/lib-sht3x",
    "nickname": "SHT3x温湿度传感器库",
    "version": "0.0.1",
    "description": "支持Arduino SHT30、SHT31和SHT35温湿度传感器的控制库",
    "author": "Danil",
    "compatibility": {
      "core": [
        "arduino:avr",
        "esp32:esp32"
      ],
      "voltage": [
        3.3,
        5
      ]
    },
    "keywords": [
      "aily",
      "blockly",
      "sht3x",
      "温湿度传感器",
      "sensor",
      "humidity",
      "temperature"
    ],
    "tested": false,
    "icon": "iconfont icon-dht22"
}
\`\`\`
\`\`\`aily-library
{
    "name": "@aily-project/lib-core-custom",
    "nickname": "自定义代码",
    "version": "1.0.0",
    "description": "允许在Blockly中插入自定义Arduino代码、宏定义、函数等的库",
    "author": "aily Project",
    "compatibility": {
      "core": []
    },
    "keywords": [
      "aily",
      "blockly",
      "lib",
      "custom",
      "code"
    ],
    "tested": true,
    "icon": "fa-light fa-code"
}
\`\`\`
`
    },
    {
      content: 'Thank you!',
      role: 'user',
    },
    {
      content: `Arduino Uno上每一个带有数字编号的引脚，都是数字引脚，包括写有"A"编号的模拟输入引脚，如图2-21。使用这些引脚具有输入输出数字信号的功能。

\`\`\`aily-state
{"state":"doing","text":"正在查询开发板文档"}
\`\`\`

\`\`\`aily-state
{"state":"done","text":"开发板文档查阅完成"}
\`\`\`

\`\`\`c
pinMode(pin, mode);
\`\`\`

参数pin为指定配置的引脚编号；参数mode为指定的配置模式。

可使用的三种模式，如表2-3所示：

表 2‑3 Arduino引脚可配置状态

| 模式宏名称 | 说明 |
| ----- | --- |
| INPUT | 输入模式 |
| OUTPUT | 输出模式 |
| INPUT\_PULLUP | 输入上拉模式 |
`
    },
    {
      content: 'Have a nice day!',
    },
    {
      content: 'You too!'
    },
  ];

  // inputValue =
  //   '帮我生成一组流水灯功能的代码块，包含开后流水灯、关闭流水灯两个块。在开发板的D2~D13引脚上均连接有LED开后流水灯功能块，可以指定流水灯速度，调用后即开启流水关闭流水灯功能块，调用后即停止流水灯。';

  currentUrl;
  inputValue = '';
  prjPath = '';

  windowInfo = 'AI助手';

  get sessionId() {
    return this.chatService.currentSessionId;
  }

  // 内置工具
  tools: Tool[] = [
    {
      name: 'create_project',
      description: `
        ## create_project
### Description
创建一个新项目，返回项目路径。

### Parameters
- board: (required) 开发板信息，包含名称、昵称和版本号
    - name: 开发板名称
    - nickname: 开发板信息
    - version: 开发板版本号

### Usage
<create_project>
<board>
    <name>Board name</name>
    <nickname>Board nickname</nickname>
    <version>Board version</version>
</board>
</create_project>

### Example
<create_project>
<board>
    <name>@aily-project/board-jinniu_board</name>
    <nickname>金牛创翼板</nickname>
    <version>0.0.1</version>
</board>
</create_project>

      `,
      input_schema: {
        type: 'object',
        properties: {
          board: { 
            type: 'object', 
            properties: {
              name: { type: 'string', description: '板子名称' },
              nickname: { type: 'string', description: '板子昵称' },
              version: { type: 'string', description: '版本号' }
            },
            description: '开发板信息'
          },
        },
        required: ['board']
      }
    },
    {
      name: 'execute_command',
      description: `
      ## execute_command
### Description
Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Prefer relative commands and paths that avoid location sensitivity for terminal consistency, e.g: \`touch ./testdata/example.file\`, \`dir ./examples/model1/data/yaml\`, or \`go test ./cmd/front --config ./cmd/front/config.yml\`. If directed by the user, you may open a terminal in a different directory by using the \`cwd\` parameter.
### Parameters
- command: (required) The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.
- cwd: (optional) The working directory to execute the command in.
### Usage
<execute_command>
<command>Your command here</command>
<cwd>Working directory path (optional)</cwd>
</execute_command>

### Examples
#### Example: Requesting to execute npm install
<execute_command>
<command>npm i @aily-project/board-jinniu_board<command>
</execute_command>

#### Example: Requesting to execute ls in a specific directory if directed
<execute_command>
<command>ls -la</command>
<cwd>/home/user/projects</cwd>
</execute_command>
      `,
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '执行的命令' },
          cwd: { type: 'string', description: '工作目录，可选' }
        },
        required: ['command']
      }
    }
  ]


  constructor(
    private uiService: UiService,
    private router: Router,
    private chatService: ChatService,
    private mcpService: McpService,
    private projectService: ProjectService,
    private cmdService: CmdService,
    private electronService: ElectronService
  ) { }

  ngOnInit() {
    this.currentUrl = this.router.url;
    if (this.electronService.isElectron) {
      this.prjPath = window['path'].getUserDocuments() + `${pt}aily-project${pt}`;
    }
    // this.testNew().then(() => {
    //   console.log('测试项目创建完成');
    // }).catch(err => {
    //   console.error('测试项目创建失败', err);
    // });
  }

  close() {
    // 关闭stream连接
    this.closeSession();
    this.uiService.closeTool('aily-chat');
  }

  ngAfterViewInit(): void {
    this.scrollToBottom(true);

    this.mcpService.init().then(() => {
      this.startSession();
    })
  }

  appendMessage(role, text) {
    console.log('append message', role, text);
    // 判断是否是JSON格式的字符串
    try {
      const parsedText = JSON.parse(text);
      if (typeof parsedText === 'object') {
        text = parsedText.content || JSON.stringify(parsedText, null, 2);
      }
    } catch (e) {
      // 如果解析失败，说明不是JSON格式的字符串
      // 保持原样
    }

    this.list.push({
      "role": role,
      "content": text
    })
  }

  startSession(): void {
    // tools + mcp tools
    let tools = this.tools;
    let mcpTools = this.mcpService.tools.map(tool => {
      tool.name = "mcp_" + tool.name;
      return tool;
    });
    if (mcpTools && mcpTools.length > 0) {
      tools = tools.concat(mcpTools);
    }

    this.chatService.startSession(tools).subscribe((res: any) => {
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

  send(show: boolean = true): void {
    if (!this.sessionId || !this.inputValue.trim()) return;

    let text = this.inputValue.trim();
    if (show) this.appendMessage('user', text);
    this.inputValue = '';

    if (this.isUserInputRequired) {
      this.isUserInputRequired = false;
      text = JSON.stringify({
        "type": "user_input",
        "content": text
      }, null, 2);
    }

    this.chatService.sendMessage(this.sessionId, text).subscribe((res: any) => {
      console.log('send message', res);
      if (res.status === 'success') {
        if (res.data) {
          this.appendMessage('aily', res.data);
        }
      }
    });
  }

  streamConnect(): void {
    console.log("streeam connect sessionId: ", this.sessionId);
    if (!this.sessionId) return;

    this.chatService.streamConnect(this.sessionId).subscribe({
      next: async (data: any) => {
        console.log("收到消息: ", data);
        try {
          if (data.type === 'agent_response') {
            if (data.data) {
              this.appendMessage('助手', data.data);
            }
          } else if (data.type === 'processing_started') {
            console.log('助手正在思考...');
          } else if (data.type === 'error') {
            console.error('助手出错:', data.data);
          } else if (data.type === 'user_input_required') {
            this.isUserInputRequired = true;
          } else if (data.type === 'tool_call_request') {
            // 处理工具调用请求
            // {type: 'tool_call_request', tool_id: 'call_MUkyOCjghtJHq9hvmH37ysrf', tool_name: 'frontend_fetch_library_json', tool_args: {…}}

            let toolArgs = data.tool_args;
            if (typeof toolArgs === 'string') {
              try {
                toolArgs = JSON.parse(toolArgs);
                data.tool_args = toolArgs;
              } catch (e) {
                console.error('Failed to parse tool_args as JSON:', e);
                // Keep original value if parsing fails
              }
            }

            let toolResult = null;
            // 需要先去除工具name中的mcp_前缀
            if (data.tool_name.startsWith('mcp_')) {
              data.tool_name = data.tool_name.substring(4);
              toolResult = await this.mcpService.use_tool(data.tool_name, data.tool_args);
              console.log('工具调用结果:', toolResult);
              this.inputValue = JSON.stringify({
                "type": "tool_result",
                "tool_id": data.tool_id,
                "content": toolResult,
                "is_error": false
              }, null, 2);
            } else {
              switch (data.tool_name) {
                case 'create_project':
                  console.log('创建项目工具被调用', data.tool_args);
                  try {
                    const prjName = this.projectService.generateUniqueProjectName(this.prjPath)
                    await this.projectService.projectNew({
                      name: prjName,
                      path: this.prjPath,
                      board: JSON.parse(data.tool_args.board)
                    })
                    toolResult = `项目 "${prjName}" 创建成功！项目路径为${this.prjPath}\\${prjName}`;
                    this.inputValue = JSON.stringify({
                      "type": "tool_result",
                      "tool_id": data.tool_id,
                      "content": toolResult,
                      "is_error": false
                    }, null, 2);
                  } catch (e) {
                    console.error('创建项目失败:', e);
                    toolResult = `创建项目失败: ${e.message}`;
                    this.inputValue = JSON.stringify({
                      "type": "tool_result",
                      "tool_id": data.tool_id,
                      "content": toolResult,
                      "is_error": true
                    }, null, 2);
                  }
                  
                  break;
                case 'execute_command':
                  console.log('执行command命令工具被调用', data.tool_args);
                  try {
                    await this.cmdService.runAsync(data.tool_args.command, data.tool_args.cwd)
                    toolResult = `执行command命令 "${data.tool_args.command}" 成功！`
                    this.inputValue = JSON.stringify({
                      "type": "tool_result",
                      "tool_id": data.tool_id,
                      "content": toolResult,
                      "is_error": false
                    }, null, 2);
                  } catch (e) {
                    console.error('执行command命令失败:', e);
                    toolResult = `执行command命令失败: ${e.message}`;
                    this.inputValue = JSON.stringify({
                      "type": "tool_result",
                      "tool_id": data.tool_id,
                      "content": toolResult,
                      "is_error": true
                    }, null, 2);
                  }
                  break;
              }
            }
            this.send();
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

  async testNew() {
    const testName = 'test';
    const testPath = 'C:\\Users\\stao\\Documents\\aily-project';
    await this.projectService.projectNew({
      name: testName,
      path: testPath,
      board: {
        name: '@aily-project/board-arduino_uno',
        nickname: 'arduino uno',
        version: '0.0.1'
      }
    });
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

  getRandomString() {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

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
    this.chatService.currentSessionId = '';
    this.startSession();
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

  /**
   * 通用XML工具调用解析器
   * 解析各种工具调用的XML格式，返回工具名称和参数对象
   */
  parseToolCallXml(xml: string): { toolName: string, params: any } {
    const result: { toolName: string, params: any } = { toolName: '', params: {} };
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      
      // 获取根元素作为工具名称
      const rootElement = doc.documentElement;
      if (rootElement && rootElement.tagName !== 'parsererror') {
        result.toolName = rootElement.tagName;
        result.params = this.xmlNodeToObject(rootElement);
      }
    } catch (e) {
      console.error('XML工具调用解析失败:', e);
    }
    
    return result;
  }

  /**
   * 递归将XML节点转换为JavaScript对象
   */
  private xmlNodeToObject(node: Element): any {
    const result: any = {};
    
    // 处理子节点
    Array.from(node.children).forEach(child => {
      const tagName = child.tagName;
      
      // 如果子节点还有子节点，递归处理
      if (child.children.length > 0) {
        result[tagName] = this.xmlNodeToObject(child);
      } else {
        // 叶子节点，直接获取文本内容
        const textContent = child.textContent?.trim() || '';
        result[tagName] = textContent;
      }
    });
    
    return result;
  }
}
