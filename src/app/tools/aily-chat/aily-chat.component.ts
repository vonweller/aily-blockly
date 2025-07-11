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
import { ChatService } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { MenuComponent } from '../../components/menu/menu.component';
import { IMenuItem } from '../../configs/menu.config';
import { McpService } from './services/mcp.service';
import { ProjectService } from '../../services/project.service';
import { CmdOutput, CmdService } from '../../services/cmd.service';
import { ElectronService } from '../../services/electron.service';
import { MessageSubscriptionService, ChatMessage, MessageSubscriptionOptions } from './services/message-subscription.service';
// import { ChatListExamples } from './chat.example';
import { BlocklyService } from '../../blockly/blockly.service';

import { newProjectTool } from './tools/createProjectTool';
import { executeCommandTool } from './tools/executeCommandTool';
import { askApprovalTool } from './tools/askApprovalTool';
import { getContextTool } from './tools/getContextTool';
import { fileOperationsTool } from './tools/fileOperationsTool';
import { fetchTool, FetchToolService } from './tools/fetchTool';

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
  @ViewChild('simplebarRef') simplebarRef: SimplebarAngularComponent;

  isUserInputRequired = false;

  list: any = [];
  // list = ChatListExamples  // 示例数据

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
      description: `创建一个新项目，返回项目路径。需要提供开发板信息，包含名称、昵称和版本号。`,
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
      description: `执行系统CLI命令。用于执行系统操作或运行特定命令来完成用户任务中的任何步骤。支持命令链，优先使用相对命令和路径以保持终端一致性。`,
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '执行的命令' },
          cwd: { type: 'string', description: '工作目录，可选' }
        },
        required: ['command']
      }
    },
//     {
//       name: "ask_approval",
//       description: `
//         ## ask_approval
// ### Description
// 向用户请求确认或批准某个操作。此工具用于在执行可能影响用户的操作之前，确保用户明确同意。
// ### Parameters
// - message: (required) 需要用户确认的消息内容。
// ### Usage
// <ask_approval>
// <message>需要用户确认的消息</message>
// </ask_approval>`,
//       input_schema: {
//         type: 'object',
//         properties: {
//           message: { type: 'string', description: '需要用户确认的消息' }
//         },
//         required: ['message']
//       }
//     },
    {
      name: "get_context",
      description: `获取当前的环境上下文信息，包括项目路径、当前平台、系统环境等。可以指定获取特定类型的上下文信息。`,
      input_schema: {
        type: 'object',
        properties: {
          info_type: { 
            type: 'string', 
            description: '要获取的上下文信息类型',
            enum: ['all', 'project', 'platform', 'system'],
            default: 'all'
          }
        }
      }
    },
    {
      name: "file_operations",
      description: `执行文件和文件夹操作，包括创建、读取、编辑、删除、重命名文件或文件夹，以及检查文件是否存在。支持相对路径和绝对路径。`,
      input_schema: {
        type: 'object',
        properties: {
          operation: { 
            type: 'string', 
            description: '要执行的操作类型',
            enum: ['list', 'read', 'create', 'edit', 'delete', 'exists', 'rename']
          },
          path: { 
            type: 'string', 
            description: '文件或文件夹的基础路径'
          },
          name: { 
            type: 'string', 
            description: '文件或文件夹的名称，会与path结合构成完整路径'
          },
          content: { 
            type: 'string', 
            description: '文件内容（用于创建或编辑操作）'
          },
          is_folder: { 
            type: 'boolean', 
            description: '指定目标是否为文件夹',
            default: false
          }
        },
        required: ['operation', 'path']
      }
    },
    {
      name: "fetch",
      description: `获取网络上的信息和资源，支持HTTP/HTTPS请求，能够处理大文件下载。支持多种请求方法和响应类型。`,
      input_schema: {
        type: 'object',
        properties: {
          url: { 
            type: 'string', 
            description: '要请求的URL地址'
          },
          method: { 
            type: 'string', 
            description: 'HTTP请求方法',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            default: 'GET'
          },
          headers: { 
            type: 'object', 
            description: '请求头（键值对）'
          },
          body: { 
            description: '请求体'
          },
          timeout: { 
            type: 'number', 
            description: '请求超时时间（毫秒）',
            default: 30000
          },
          maxSize: { 
            type: 'number', 
            description: '最大文件大小（字节）',
            default: 52428800
          },
          responseType: { 
            type: 'string', 
            description: '响应类型',
            enum: ['text', 'json', 'blob', 'arraybuffer'],
            default: 'text'
          }
        },
        required: ['url']
      }
    }
  ]


  constructor(
    private uiService: UiService,
    private chatService: ChatService,
    private mcpService: McpService,
    private projectService: ProjectService,
    private cmdService: CmdService,
    private electronService: ElectronService,
    private messageSubscriptionService: MessageSubscriptionService,
    private blocklyService: BlocklyService,
    private fetchToolService: FetchToolService
  ) { }

  ngOnInit() {
    if (this.electronService.isElectron) {
      this.prjPath = window['path'].getUserDocuments() + `${pt}aily-project${pt}`;
    }
    
    // 订阅消息
    this.subscribeToMessages();
  }

  close() {
    // 关闭stream连接
    this.closeSession();
    this.uiService.closeTool('aily-chat');
  }

  ngAfterViewInit(): void {
    this.scrollToBottom();
    this.mcpService.init().then(() => {
      this.startSession();
    })
  }

  appendMessage(role, text) {
    // 判断是否是JSON格式的字符串
    if (role != 'user') {
      console.log('收到数据:');
      console.log(text);
    }


    try {
      const parsedText = JSON.parse(text);
      if (typeof parsedText === 'object') {
        text = parsedText.content || JSON.stringify(parsedText, null, 2);
      }
    } catch (e) {
      // 如果解析失败，说明不是JSON格式的字符串
      // 保持原样
    }

    // 检查是否存在消息列表，且最后一条消息的role与当前role相同
    if (this.list.length > 0 && this.list[this.list.length - 1].role === role) {
      // 如果是同一个role，追加内容到最后一条消息
      this.list[this.list.length - 1].content += text;
    } else {
      // 如果是不同的role或列表为空，创建新的消息
      this.list.push({
        "role": role,
        "content": text
      });
    }
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

    this.chatService.startSession(tools).subscribe({
      next: (res: any) => {
        if (res.status === 'success') {
          this.chatService.currentSessionId = res.data;
          this.streamConnect();
          this.getHistory();
        } else {
          this.appendMessage('错误', '启动会话失败: ' + (res.message || '未知错误'));
        }
      },
      error: (err) => {
        console.error('启动会话失败:', err);
        if (err.status === 0) {
          this.appendMessage('错误', '网络连接失败，请检查您的网络连接后重试。');
        } else if (err.status === 408 || err.statusText === 'timeout') {
          this.appendMessage('错误', '连接超时，服务器可能暂时不可用，请稍后重试。');
        } else {
          this.appendMessage('错误', '启动会话失败: ' + (err.message || '网络错误，请检查连接后重试。'));
        }
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
      if (res.status === 'success') {
        if (res.data) {
          this.appendMessage('aily', res.data);
        }
      }
    });
    this.scrollToBottom();
  }

  streamConnect(): void {
    console.log("streeam connect sessionId: ", this.sessionId);
    if (!this.sessionId) return;

    this.chatService.streamConnect(this.sessionId).subscribe({
      next: async (data: any) => {
        console.log("收到消息: ", data);
        // Replace "/toUser" with empty string in data.data if it exists
        if (data.data && typeof data.data === 'string') {
          data.data = data.data.replace(/\/toUser/g, '');
        }
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
                this.inputValue = JSON.stringify({
                  "type": "tool_result",
                  "tool_id": data.tool_id,
                  "content": `工具调用参数解析失败: ${e.message}`,
                  "is_error": true
                }, null, 2);
                this.send();
                return;
              }
            }

            let toolResult = null;
            if (data.tool_name.startsWith('mcp_')) {
              data.tool_name = data.tool_name.substring(4);
              toolResult = await this.mcpService.use_tool(data.tool_name, data.tool_args);
            } else {
              let strToolArgs = JSON.stringify(data.tool_args)
                .replace(/\\\\/g, '/')  // Replace \\ with /
                .replace(/\\/g, '/');   // Replace \ with /

              const toolArgs = JSON.parse(strToolArgs)
              switch (data.tool_name) {
                case 'create_project':
                  console.log('创建项目工具被调用', toolArgs);
                  toolResult = await newProjectTool(this.projectService, this.prjPath, toolArgs);
                  break;
                case 'execute_command':
                  console.log('执行command命令工具被调用', toolArgs);
                  // Check if cwd is specified, otherwise use project paths
                  if (!toolArgs.cwd) {
                    toolArgs.cwd = this.projectService.currentProjectPath || this.projectService.projectRootPath;
                  }
                  toolResult = await executeCommandTool(this.cmdService, toolArgs);
                  if (!toolResult.is_error) {
                    // Check if this is an npm install command
                    const command = toolArgs.command;
                    if (command.includes('npm i') || command.includes('npm install')) {
                      // Extract the package name
                      const npmRegex = /npm (i|install)\s+(@?[a-zA-Z0-9-_/.]+)/;
                      const match = command.match(npmRegex);
                      
                      if (match && match[2]) {
                        const libPackageName = match[2];
                        console.log('Installing library:', libPackageName);
                        
                        // Get project path from command args or default
                        const projectPath = toolArgs.cwd || this.prjPath;
                        
                        // Load the library into blockly
                        try {
                          await this.blocklyService.loadLibrary(libPackageName, projectPath);
                        } catch (e) {
                          console.error('加载库失败:', e);
                          toolResult = {
                            is_error: true,
                            content: `加载库失败: ${e.message}`
                          };
                        }
                      }
                    }
                  }
                  break;
                case 'ask_approval':
                  console.log('请求用户确认工具被调用', toolArgs);
                  toolResult = await askApprovalTool(toolArgs);
                  break;
                case 'get_context':
                  console.log('获取上下文信息工具被调用', toolArgs);
                  toolResult = await getContextTool(this.projectService, toolArgs);
                  break;
                case 'file_operations':
                  console.log("toolArgs: ", toolArgs);
                  toolResult = await fileOperationsTool(toolArgs);
                  break;
                case 'fetch':
                  console.log('网络请求工具被调用', toolArgs);
                  toolResult = await fetchTool(this.fetchToolService, toolArgs);
                  break;
              }
            }

            this.inputValue = JSON.stringify({
              "type": "tool_result",
              "tool_id": data.tool_id,
              "content": toolResult.content,
              "is_error": toolResult.is_error
            }, null, 2);
            this.send(false);
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

  // 当使用ctrl+enter时发送消息
  onKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
      this.send();
      event.preventDefault();
    }
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

  scrollToBottom() {
    setTimeout(() => {
      if (this.simplebarRef) {
        const scrollElement = this.simplebarRef.SimpleBar?.getScrollElement();
        if (scrollElement) {
          scrollElement.scrollTop = scrollElement.scrollHeight;
        }
      }
    }, 50); // 增加延迟时间
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
    this.closeSession();
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
   * 订阅来自其他组件的消息
   */
  private subscribeToMessages(): void {
    this.messageSubscription = this.messageSubscriptionService.getMessageObservable().subscribe({
      next: ({ message, options }) => {
        console.log('收到订阅消息:', message, options);
        this.handleSubscribedMessage(message, options);
      },
      error: (err) => {
        console.error('消息订阅出错:', err);
      }
    });
  }

  /**
   * 处理订阅的消息
   */
  private handleSubscribedMessage(message: ChatMessage, options?: MessageSubscriptionOptions): void {
    // 如果需要创建新会话
    if (options?.createNewSession) {
      this.newChat();
      // 等待新会话创建完成后再发送消息
      setTimeout(() => {
        this.processMessage(message, options);
      }, 1000);
    } else {
      this.processMessage(message, options);
    }
  }

  /**
   * 处理消息内容
   */
  private processMessage(message: ChatMessage, options?: MessageSubscriptionOptions): void {
    // 构建最终的消息内容
    let finalContent = message.content;
    
    // 如果有上下文信息，添加到消息中
    if (message.metadata?.context) {
      finalContent = `上下文信息：\n${JSON.stringify(message.metadata.context, null, 2)}\n\n用户消息：\n${message.content}`;
    }
    
    // 如果指定显示在聊天界面
    if (options?.showInChat !== false) {
      this.appendMessage(message.role || 'user', message.content);
    }
    
    // 如果指定自动发送
    if (options?.autoSend !== false) {
      this.inputValue = finalContent;
      this.send(false); // 不重复显示在聊天界面
    } else {
      // 不自动发送，只填充到输入框
      this.inputValue = finalContent;
    }
  }

  /**
   * 获取消息订阅服务的实例
   * 提供给其他组件使用的便捷方法
   */
  static getMessageSubscriptionService(): MessageSubscriptionService {
    // 这是一个静态方法，可以在没有组件实例的情况下使用
    // 但在实际使用中，建议直接注入服务
    console.warn('建议直接在组件中注入 MessageSubscriptionService 而不是使用静态方法');
    return new MessageSubscriptionService();
  }

  /**
   * 清理订阅
   */
  ngOnDestroy() {
    // 清理消息订阅
    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe();
    }
  }

  // 添加订阅管理
  private messageSubscription: any;
}
