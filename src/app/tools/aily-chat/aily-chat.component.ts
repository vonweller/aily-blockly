import { Component, ElementRef, ViewChild, OnDestroy } from '@angular/core';
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
import { Observable, tap, Subscription } from 'rxjs';
import { ChatService } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { MenuComponent } from '../../components/menu/menu.component';
import { IMenuItem } from '../../configs/menu.config';
import { McpService } from './services/mcp.service';
import { ProjectService } from '../../services/project.service';
import { CmdOutput, CmdService } from '../../services/cmd.service';
import { ElectronService } from '../../services/electron.service';
// import { ChatListExamples } from './chat.example';
import { BlocklyService } from '../../blockly/blockly.service';

import { newProjectTool } from './tools/createProjectTool';
import { executeCommandTool } from './tools/executeCommandTool';
import { askApprovalTool } from './tools/askApprovalTool';
import { getContextTool } from './tools/getContextTool';
import { listDirectoryTool } from './tools/listDirectoryTool';
import { readFileTool } from './tools/readFileTool';
import { createFileTool } from './tools/createFileTool';
import { createFolderTool } from './tools/createFolderTool';
import { editFileTool } from './tools/editFileTool';
import { deleteFileTool } from './tools/deleteFileTool';
import { deleteFolderTool } from './tools/deleteFolderTool';
import { checkExistsTool } from './tools/checkExistsTool';
import { getDirectoryTreeTool } from './tools/getDirectoryTreeTool';
import { fetchTool, FetchToolService } from './tools/fetchTool';

const { pt } = (window as any)['electronAPI'].platform;

export interface Tool {
  name: string;
  description: string;
  input_schema: { [key: string]: any };
}

export interface ResourceItem {
  type: 'file' | 'folder' | 'url';
  path?: string;
  url?: string;
  name: string;
}

import { ChatCommunicationService, ChatTextOptions } from '../../services/chat-communication.service';
import { NzMessageService } from 'ng-zorro-antd/message';

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
export class AilyChatComponent implements OnDestroy {
  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  @ViewChild('chatContainer') chatContainer: ElementRef;
  @ViewChild('simplebarRef') simplebarRef: SimplebarAngularComponent;
  @ViewChild('chatList') chatList: ElementRef;
  @ViewChild('chatTextarea') chatTextarea: ElementRef;

  isUserInputRequired = false;

  list: any = [];
  // list = ChatListExamples  // 示例数据

  currentUrl;
  inputValue = '';
  prjRootPath = '';
  prjPath = '';

  windowInfo = 'AI助手';

  private textMessageSubscription: Subscription;

  get sessionId() {
    return this.chatService.currentSessionId;
  }

  /**
   * 确保字符串在 JSON 中是安全的，转义特殊字符
   */
  private makeJsonSafe(str: string): string {
    if (!str) return str;
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  }

  /**
   * 获取路径中最后一个文件夹的名称
   * @param path 路径字符串
   * @returns 最后一个文件夹名称，如果路径无效则返回空字符串
   */
  getLastFolderName(path: string): string {
    if (!path) return '';

    // 标准化路径分隔符（处理Windows和Unix路径）
    const normalizedPath = path.replace(/\\/g, '/');

    // 移除末尾的斜杠
    const trimmedPath = normalizedPath.endsWith('/')
      ? normalizedPath.slice(0, -1)
      : normalizedPath;

    // 分割路径并获取最后一个非空元素
    const parts = trimmedPath.split('/').filter(Boolean);

    return parts.length > 0 ? parts[parts.length - 1] : '';
  }

  /**
   * 获取路径中的文件名（不包含路径）
   * @param path 文件的完整路径
   * @returns 文件名，如果路径无效则返回空字符串
   */
  getFileName(path: string): string {
    if (!path) return '';

    // 标准化路径分隔符（处理Windows和Unix路径）
    const normalizedPath = path.replace(/\\/g, '/');

    // 获取路径的最后一部分（文件名）
    const parts = normalizedPath.split('/');
    return parts.length > 0 ? parts[parts.length - 1] : '';
  }

  /**
 * 获取URL中的文件名或有意义的部分
 * @param url 完整的URL地址
 * @returns 简化的URL名称，如果无法解析则返回原URL
 */
  getUrlDisplayName(url: string): string {
    if (!url) return '';

    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // 如果路径为空或只是根路径，返回域名
      if (!pathname || pathname === '/') {
        return urlObj.hostname;
      }

      // 获取路径的最后一部分（可能是文件名）
      const pathParts = pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        let lastPart = pathParts[pathParts.length - 1];

        // 对URL编码的字符串进行解码（如 %E5%BA%93%E8%A7%84%E8%8C%83.md -> 库规范.md）
        try {
          lastPart = decodeURIComponent(lastPart);
        } catch (decodeError) {
          // 如果解码失败，保持原样
          console.warn('URL解码失败:', decodeError);
        }

        // 如果最后一部分看起来像文件名（包含扩展名），直接返回
        if (lastPart.includes('.')) {
          return lastPart;
        }

        // 否则返回最后两个路径段（如果存在）
        if (pathParts.length >= 2) {
          let secondLastPart = pathParts[pathParts.length - 2];
          // 同样对倒数第二部分进行解码
          try {
            secondLastPart = decodeURIComponent(secondLastPart);
          } catch (decodeError) {
            console.warn('URL解码失败:', decodeError);
          }
          return `${secondLastPart}/${lastPart}`;
        }

        return lastPart;
      }

      // 回退到域名
      return urlObj.hostname;
    } catch (error) {
      // 如果URL解析失败，尝试简单的字符串处理
      const parts = url.split('/').filter(Boolean);
      if (parts.length > 0) {
        let lastPart = parts[parts.length - 1];
        // 对最后一部分进行URL解码
        try {
          lastPart = decodeURIComponent(lastPart);
        } catch (decodeError) {
          console.warn('URL解码失败:', decodeError);
        }
        return lastPart;
      }
      return url;
    }
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
    {
      name: "ask_approval",
      description: "向用户请求确认或批准某个操作。此工具用于需要用户确认的场景，确保用户明确同意后才进行后续操作。",
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '消息描述' }
        },
        required: ['message']
      }
    },
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
        },
        required: ['info_type']
      }
    },
    {
      name: "list_directory",
      description: `列出指定目录的内容，包括文件和文件夹信息。返回每个项目的名称、类型、大小和修改时间。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要列出内容的目录路径'
          }
        },
        required: ['path']
      }
    },
    {
      name: "read_file",
      description: `读取指定文件的内容。支持文本文件的读取，可指定编码格式。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件路径'
          },
          encoding: {
            type: 'string',
            description: '文件编码格式',
            default: 'utf-8'
          }
        },
        required: ['path']
      }
    },
    {
      name: "create_file",
      description: `创建新文件并写入内容。如果目录不存在会自动创建。可选择是否覆盖已存在的文件。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要创建的文件路径'
          },
          content: {
            type: 'string',
            description: '文件内容',
            default: ''
          },
          encoding: {
            type: 'string',
            description: '文件编码格式',
            default: 'utf-8'
          },
          overwrite: {
            type: 'boolean',
            description: '是否覆盖已存在的文件',
            default: false
          }
        },
        required: ['path']
      }
    },
    {
      name: "create_folder",
      description: `创建新文件夹。支持递归创建多级目录。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要创建的文件夹路径'
          },
          recursive: {
            type: 'boolean',
            description: '是否递归创建父目录',
            default: true
          }
        },
        required: ['path']
      }
    },
    {
      name: "edit_file",
      description: `编辑已存在的文件内容。可选择当文件不存在时是否创建新文件。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要编辑的文件路径'
          },
          content: {
            type: 'string',
            description: '新的文件内容'
          },
          encoding: {
            type: 'string',
            description: '文件编码格式',
            default: 'utf-8'
          },
          createIfNotExists: {
            type: 'boolean',
            description: '如果文件不存在是否创建',
            default: false
          }
        },
        required: ['path', 'content']
      }
    },
    {
      name: "delete_file",
      description: `删除指定文件。可选择是否在删除前创建备份。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要删除的文件路径'
          },
          createBackup: {
            type: 'boolean',
            description: '删除前是否创建备份',
            default: true
          }
        },
        required: ['path']
      }
    },
    {
      name: "delete_folder",
      description: `删除指定文件夹及其内容。可选择是否在删除前创建备份。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要删除的文件夹路径'
          },
          createBackup: {
            type: 'boolean',
            description: '删除前是否创建备份',
            default: true
          },
          recursive: {
            type: 'boolean',
            description: '是否递归删除',
            default: true
          }
        },
        required: ['path']
      }
    },
    {
      name: "check_exists",
      description: `检查指定路径的文件或文件夹是否存在，返回详细信息包括类型、大小、修改时间等。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要检查的路径'
          },
          type: {
            type: 'string',
            description: '期望的类型：file(文件)、folder(文件夹)或any(任意类型)',
            enum: ['file', 'folder', 'any'],
            default: 'any'
          }
        },
        required: ['path']
      }
    },
    {
      name: "get_directory_tree",
      description: `获取指定目录的树状结构，可控制遍历深度和是否包含文件。适合了解项目结构。`,
      input_schema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要获取树状结构的目录路径'
          },
          maxDepth: {
            type: 'number',
            description: '最大遍历深度',
            default: 3
          },
          includeFiles: {
            type: 'boolean',
            description: '是否包含文件（false时只显示文件夹）',
            default: true
          }
        },
        required: ['path']
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
    private blocklyService: BlocklyService,
    private fetchToolService: FetchToolService,
    private chatCommunicationService: ChatCommunicationService,
    private router: Router,
    private message: NzMessageService
  ) { }

  ngOnInit() {
    // if (this.electronService.isElectron) {
    //   this.prjPath = window['path'].getUserDocuments() + `${pt}aily-project${pt}`;
    // }

    this.prjPath = this.projectService.currentProjectPath === this.projectService.projectRootPath ? "" : this.projectService.currentProjectPath;
    this.prjRootPath = this.projectService.projectRootPath;

    // 订阅消息
    this.currentUrl = this.router.url;
    // 订阅外部文本消息
    this.textMessageSubscription = this.chatCommunicationService.getTextMessages().subscribe(
      message => {
        this.receiveTextFromExternal(message.text, message.options);
      }
    );
  }

  /**
   * 接收来自外部组件的文本并显示在输入框中
   * @param text 接收到的文本
   * @param options 发送选项，包含 sender、type、cover 等参数
   */
  receiveTextFromExternal(text: string, options?: ChatTextOptions): void {
    console.log('接收到外部文本:', text, '选项:', options);

    if (options?.type === 'tool') {
      // 判断是否是 JSON 格式的字符串
      try {
        const parsedText = JSON.parse(text);
        // 判断是否包含id字段，有则提取id
        if (parsedText && typeof parsedText === 'object' && parsedText.id) {
          // 提取id
          const id = parsedText.id;

          this.inputValue = JSON.stringify({
            "type": "tool_result",
            "tool_id": id,
            "content": parsedText.text,
            "is_error": false
          })
          this.send(false, true);
          return;
        } else {
          // 否则保持原样
          text = JSON.stringify(parsedText, null, 2);
        }
      } catch (e) {
        // 如果解析失败，说明不是JSON格式的字符串
        // 保持原样
        console.warn('接收到的文本不是有效的JSON格式:', text);
        return;
      }
    }

    // cover 默认为 true，只有明确设置为 false 时才追加
    if (options?.cover === false) {
      // 如果明确设置为不覆盖，则追加到末尾
      if (this.inputValue) {
        this.inputValue += '\n' + text;
      } else {
        this.inputValue = text;
      }
    } else {
      // 默认行为：覆盖输入框内容
      this.inputValue = text;
    }

    // 自动聚焦到输入框并将光标移到末尾
    setTimeout(() => {
      if (this.chatTextarea?.nativeElement) {
        const textarea = this.chatTextarea.nativeElement;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }

      // 如果设置了自动发送，则立即发送
      if (options?.autoSend) {
        this.send();
      }
    }, 100);
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
    // if (role != 'user') {
    //   console.log('收到数据:');
    //   console.log(text);
    // }

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
    // console.log("listRole: ", this.list[this.list.length - 1]?.role, role);
    if (this.list.length > 0 && this.list[this.list.length - 1].role === role) {
      // 如果是同一个role，追加内容到最后一条消息
      this.list[this.list.length - 1].content += text;
    } else {
      // console.log("添加新消息: ", role);
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
          this.appendMessage('错误', `
\`\`\`aily-error
${res.message || '启动会话失败，请稍后重试。'}
\`\`\`\n\n

            `)
        }
      },
      error: (err) => {
        console.error('启动会话失败:', err);
        let errData = {
          status: err.status,
          message: err.message
        }
        this.appendMessage('error', `
\`\`\`aily-error
${JSON.stringify(errData)}
\`\`\`\n\n
            `)
      }
    });
  }

  closeSession(): void {
    if (!this.sessionId) return;

    this.chatService.closeSession(this.sessionId).subscribe((res: any) => {
      // console.log('close session', res);
    });
  }

  isWaiting = false;

  sendButtonClick(): void {
    if (this.isWaiting) {
      this.isWaiting = false;
      this.stop();
      return;
    }

    this.send();
  }

  send(show: boolean = true, toolCallRes: boolean = false): void {
    if (!this.sessionId || !this.inputValue.trim()) return;
    let text = this.inputValue.trim();

    if (!toolCallRes) {
      // 如果有资源列表，自动添加到消息前面
      const resourcesText = this.getResourcesText();
      if (resourcesText) {
        text = resourcesText + '\n\n' + text;
      }
    } else {
      if (!this.isWaiting) {
        return;
      }
    }

    if (show) {
      this.appendMessage('user', text);
      this.isWaiting = true;
    }

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

  // 这里写停止发送信号
  stop() {
    this.chatService.stopSession(this.sessionId).subscribe((res: any) => {
      // 处理停止会话的响应
      if (res.status == 'success') {
        console.log('会话已停止:', res);
        this.isWaiting = false;
        return;
      }
    });
  }

  streamConnect(): void {
    console.log("streeam connect sessionId: ", this.sessionId);
    if (!this.sessionId) return;

    this.chatService.streamConnect(this.sessionId).subscribe({
      next: async (data: any) => {
        // console.log("收到消息: ", data);
        // Replace "to_user" with empty string in data.data if it exists
        if (data.data && typeof data.data === 'string') {
          data.data = data.data.replace(/to_user/g, '');
        }

        if (!this.isWaiting) {
          return; // 如果不在等待状态，直接返回
        }

        try {
          if (data.type === 'ModelClientStreamingChunkEvent') {
            // 处理流式数据
            if (data.content) {
              this.appendMessage('aily', data.content);
            }
          } else if (data.type === 'ToolCallRequestEvent') {
            // 处理工具调用请求
          } else if (data.type === 'ToolCallExecutionEvent') {
            console.log("工具执行事件: ", data);
            // 处理工具执行完成事件
            if (data.content && Array.isArray(data.content)) {
              for (const result of data.content) {
                if (result.call_id && result?.name !== "ask_approval") {
                  // 根据工具名称和结果状态确定显示文本
                  const resultState = result.is_error ? "error" : "done";
                  const resultText = this.toolCallStates[result.call_id];
                  if (resultText) {
                    this.appendMessage('aily', `
  \`\`\`aily-state
  {
    "state": "${resultState}",
    "text": "${this.makeJsonSafe(resultText)}",
    "id": "${result.call_id}"
  }
  \`\`\`\n\n
`);
                  }

                  // 清除状态
                  delete this.toolCallStates[result.call_id];
                } else {
                  this.appendMessage('aily', "\n\n");
                }
              }
            }
          } else if (data.type === 'error') {
            console.error('助手出错:', data.data);
            this.appendMessage('错误', '助手出错: ' + (data.message || '未知错误'));
            this.isWaiting = false;
          } else if (data.type === 'TaskCompleted') {
            console.log("任务已完成: ", data.stop_reason);
            this.isWaiting = false;
          } else if (data.type === 'tool_call_request') {
            let toolArgs;

            if (typeof data.tool_args === 'string') {
              try {
                // 在JSON解析前，先处理Windows路径中的反斜杠问题
                // 将Windows路径中的单个反斜杠替换为双反斜杠，避免被当作转义字符
                let processedString = data.tool_args;

                // 查找所有可能的路径字段，并在它们的值中修复反斜杠
                processedString = processedString.replace(
                  /"(path|cwd|directory|folder|filepath|dirpath)"\s*:\s*"([^"]*[\\][^"]*)"/g,
                  (match, fieldName, pathValue) => {
                    // 将路径中的单个反斜杠替换为双反斜杠（除非已经是双反斜杠）
                    const fixedPath = pathValue.replace(/(?<!\\)\\(?!\\)/g, '\\\\');
                    return `"${fieldName}":"${fixedPath}"`;
                  }
                );

                toolArgs = JSON.parse(processedString);
              } catch (e) {
                console.error('JSON解析失败，尝试备用方法:', e);
                try {
                  // 备用方案：使用Function构造器
                  toolArgs = new Function('return ' + data.tool_args)();
                } catch (e2) {
                  console.error('所有解析方法都失败:', e2);
                  this.inputValue = JSON.stringify({
                    "type": "tool_result",
                    "tool_id": data.tool_id,
                    "content": `参数解析失败: ${e.message}`,
                    "is_error": true
                  }, null, 2);
                  this.send(false, true);
                  return;
                }
              }
            } else if (typeof data.tool_args === 'object' && data.tool_args !== null) {
              toolArgs = data.tool_args;
            } else {
              console.warn('意外的工具参数类型:', typeof data.tool_args, data.tool_args);
              toolArgs = data.tool_args;
            }

            // console.log("toolArgsJson: ", toolArgs);

            // 生成随机ID用于状态跟踪
            const toolCallId = `${data.tool_id}`;

            let toolResult = null;
            let resultState = "done";
            let resultText = '';

            try {
              if (data.tool_name.startsWith('mcp_')) {
                data.tool_name = data.tool_name.substring(4);
                toolResult = await this.mcpService.use_tool(data.tool_name, toolArgs);
              } else {

                switch (data.tool_name) {
                  case 'create_project':
                    console.log('[创建项目工具被调用]', toolArgs);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在创建项目...",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await newProjectTool(this.projectService, this.prjRootPath, toolArgs);
                    if (toolResult.is_error) {
                      this.uiService.updateFooterState({ state: 'error', text: '项目创建失败' });
                      resultState = "error"
                      resultText = '项目创建失败: ' + (toolResult.content || '未知错误');
                    } else {
                      resultText = `项目创建成功`;
                    }
                    break;
                  case 'execute_command':
                    console.log('[执行命令工具被调用]', toolArgs);
                    // Extract the command main body for display
                    const commandParts = toolArgs.command.split(' ');
                    let displayCommand = toolArgs.command;

                    if (commandParts.length > 1) {
                      // 对于 npm 命令，显示前两个词（如 "npm install"）
                      if (commandParts[0].toLowerCase() === 'npm') {
                        displayCommand = `${commandParts[0]} ${commandParts[1]}`;
                      } else {
                        // 其他命令只显示第一个词
                        displayCommand = `${commandParts[0]}`;
                      }
                    }

                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在执行: ${displayCommand}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    // Check if cwd is specified, otherwise use project paths
                    if (!toolArgs.cwd) {
                      toolArgs.cwd = this.projectService.currentProjectPath || this.projectService.projectRootPath;
                    }
                    toolResult = await executeCommandTool(this.cmdService, toolArgs);
                    // Get project path from command args or default
                    const projectPath = toolArgs.cwd || this.prjPath;
                    if (!toolResult.is_error) {
                      // Check if this is an npm install command
                      const command = toolArgs.command;
                      if (command.includes('npm i') || command.includes('npm install')) {
                        console.log('检测到 npm install 命令，尝试加载库');
                        // Extract the package name for @aily-project/ packages only
                        const npmRegex = /npm (i|install)\s+(@aily-project\/[a-zA-Z0-9-_]+)/;
                        const match = command.match(npmRegex);

                        console.log('npmRegex match:', match);

                        if (match && match[2]) {
                          const libPackageName = match[2];
                          console.log('Installing library:', libPackageName);

                          // Load the library into blockly
                          try {
                            await this.blocklyService.loadLibrary(libPackageName, projectPath);
                          } catch (e) {
                            //
                            console.log("加载库失败:", e);
                          }
                        } else {
                          console.log("projectOpen: ", projectPath);
                          this.projectService.projectOpen(projectPath);
                        }
                      }
                      resultText = `命令${displayCommand}执行成功`
                    } else {
                      resultState = "error";
                      resultText = `命令${displayCommand}执行失败: ` + (toolResult.content || '未知错误');
                    }
                    break;
                  case 'get_context':
                    console.log('[获取上下文信息工具被调用]', toolArgs);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在获取上下文信息...",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await getContextTool(this.projectService, toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error"
                      resultText = '获取上下文信息失败: ' + (toolResult.content || '未知错误');
                    } else {
                      resultText = `上下文信息获取成功`;
                    }
                    break;
                  case 'list_directory':
                    console.log('[列出目录工具被调用]', toolArgs);
                    const distFolderName = this.getLastFolderName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在获取${distFolderName}目录内容",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await listDirectoryTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `获取${distFolderName}目录内容失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `获取${distFolderName}目录内容成功`;
                    }
                    break;
                  case 'read_file':
                    console.log('[读取文件工具被调用]', toolArgs);
                    let readFileName = this.getFileName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在读取: ${readFileName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await readFileTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `读取${readFileName}文件失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `读取${readFileName}文件成功`;
                    }
                    break;
                  case 'create_file':
                    console.log('[创建文件工具被调用]', toolArgs);
                    let createFileName = this.getFileName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在创建: ${createFileName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await createFileTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `创建${createFileName}文件失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `创建${createFileName}文件成功`;
                    }
                    break;
                  case 'create_folder':
                    console.log('[创建文件夹工具被调用]', toolArgs);
                    let createFolderName = this.getLastFolderName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在创建: ${createFolderName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await createFolderTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `创建${createFolderName}文件夹失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `创建${createFolderName}文件夹成功`;
                    }
                    break;
                  case 'edit_file':
                    console.log('[编辑文件工具被调用]', toolArgs);
                    let editFileName = this.getFileName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在编辑: ${editFileName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await editFileTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `编辑${editFileName}文件失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `编辑${editFileName}文件成功`;
                    }
                    break;
                  case 'delete_file':
                    console.log('[删除文件工具被调用]', toolArgs);
                    let deleteFileName = this.getFileName(toolArgs.path);
                    this.appendMessage('aily', `
\`\`\`aily-state
{
  "state": "doing",
  "text": "正在删除: ${deleteFileName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await deleteFileTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `删除${deleteFileName}文件失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `删除${deleteFileName}文件成功`;
                    }
                    break;
                  case 'delete_folder':
                    console.log('[删除文件夹工具被调用]', toolArgs);
                    let deleteFolderName = this.getLastFolderName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在删除: ${deleteFolderName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await deleteFolderTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `删除${deleteFolderName}文件夹失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `删除${deleteFolderName}文件夹成功`;
                    }
                    break;
                  case 'check_exists':
                    console.log('[检查存在性工具被调用]', toolArgs);
                    // Determine if the path is likely a file or folder
                    let stateText = "正在检查路径是否存在";
                    let checkFileName = this.getFileName(toolArgs.path);
                    let checkFolderName = this.getLastFolderName(toolArgs.path);

                    const doingText = checkFileName ? `正在检查文件是否存在: ${checkFileName}` : `正在检查文件夹是否存在: ${checkFolderName}`;
                    const errText = checkFileName ? `检查文件 ${checkFileName} 是否存在失败: ` : `检查文件夹 ${checkFolderName} 是否存在失败: `;
                    const successText = checkFileName ? `文件 ${checkFileName} 存在` : `文件夹 ${checkFolderName} 存在`;

                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "${doingText}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await checkExistsTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = errText + (toolResult.content || '未知错误');
                    } else {
                      resultText = successText;
                    }
                    break;
                  case 'get_directory_tree':
                    console.log('[获取目录树工具被调用]', toolArgs);
                    let treeFolderName = this.getLastFolderName(toolArgs.path);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在获取目录树: ${treeFolderName}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await getDirectoryTreeTool(toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = `获取目录树 ${treeFolderName} 失败: ` + (toolResult.content || '未知错误');
                    } else {
                      resultText = `获取目录树 ${treeFolderName} 成功`;
                    }
                    break;
                  case 'fetch':
                    console.log('[网络请求工具被调用]', toolArgs);
                    const fetchUrl = this.getUrlDisplayName(toolArgs.url);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在进行网络请求: ${fetchUrl}",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    toolResult = await fetchTool(this.fetchToolService, toolArgs);
                    if (toolResult.is_error) {
                      resultState = "error";
                    } else {
                      resultText = `网络请求 ${fetchUrl} 成功`;
                    }
                    break;
                  case 'ask_approval':
                    console.log('[请求确认工具被调用]', toolArgs);
                    this.appendMessage('aily', `
\n\n${toolArgs.message}

\`\`\`aily-button
[
{"text":"同意","action":"approve","type":"primary", "id": "${toolCallId}"},
{"text":"拒绝","action":"reject","type":"default", "id": "${toolCallId}"}
]
\`\`\`\n\n
                    `);
                    return;
                }
              }

              // 根据执行结果确定状态
              if (toolResult && toolResult.is_error) {
                resultState = "error";
              } else if (toolResult && toolResult.warning) {
                resultState = "warn";
              }
            } catch (error) {
              console.error('工具执行出错:', error);
              resultState = "error";
              toolResult = {
                is_error: true,
                content: `工具执行出错: ${error.message || '未知错误'}`
              };
            }

            this.toolCallStates[data.tool_id] = resultText;

            this.inputValue = JSON.stringify({
              "type": "tool_result",
              "tool_id": data.tool_id,
              "content": toolResult?.content || '',
              "resultText": this.makeJsonSafe(resultText),
              "is_error": toolResult.is_error
            }, null, 2);
            this.send(false, true);
          } else if (data.type === 'user_input_required') {
            // 处理用户输入请求 - 需要用户补充消息时停止等待状态
            this.isUserInputRequired = true;
            this.isWaiting = false;
          }
          this.scrollToBottom();

        } catch (e) {
          console.error('处理流数据时出错:', e);
          this.appendMessage('错误', `

\`\`\`aily-error
服务异常，请稍后重试。
\`\`\`\n\n

          `);
          this.isWaiting = false;
        }
      },
      error: (err) => {
        console.error('流连接出错:', err);
        this.appendMessage('错误', `

\`\`\`aily-error
连接中断。
\`\`\`\n\n

`);
      }
    });
  }

  getHistory(): void {
    if (!this.sessionId) return;

    this.chatService.getHistory(this.sessionId).subscribe((res: any) => {
      console.log('get history', res);
      if (res.status === 'success') {
        this.list = res.data;
        this.list.unshift({
          "role": "system",
          "content": "欢迎使用AI助手服务，我可以帮助你 分析项目、转换blockly库、修复错误、生成程序，告诉我你需要什么帮助吧~🤓\n\n >当前为测试版本，可能会有不少问题，如遇故障，群里呼叫`奈何col`哦"
        });

        console.log('历史消息:', this.list);

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
      if (this.isWaiting) {
        return;
      }
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
    }, 200); // 增加延迟时间
  }

  HistoryList: IMenuItem[] = [
    // {
    //   name: '如何学习arduino如何学习arduino如何学习arduino'
    // },
    // {
    //   name: '制作一个ros小车'
    // },
    // {
    //   name: '历史记录3',
    // }
  ]

  newChat() {
    this.list = [];
    this.chatService.currentSessionId = '';
    this.closeSession();
    this.startSession();
  }

  selectContent: ResourceItem[] = []
  showAddList = false;
  openAddList() {
    this.showAddList = !this.showAddList;
  }

  async addFile() {
    const options = {
      title: '选择文件或文件夹',
      properties: ['multiSelections'],
      filters: [
        { name: '所有文件', extensions: ['*'] }
      ]
    };
    const result = await window['dialog'].selectFiles(options);
    console.log('文件选择结果:', result);
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      // 处理选中的文件/文件夹
      const selectedPaths = result.filePaths;

      // 将选中的文件添加到资源数组中
      selectedPaths.forEach(path => {
        // 检查是否已经存在
        const exists = this.selectContent.some(item =>
          item.type === 'file' && item.path === path
        );

        if (!exists) {
          const fileName = path.split(/[/\\]/).pop() || path;
          this.selectContent.push({
            type: 'file',
            path: path,
            name: fileName
          });
        }
      });

      console.log('已添加的文件:', selectedPaths);
      console.log('当前资源列表:', this.selectContent);
    } else {
      console.log('用户取消了文件选择或没有选择文件');
    }
  }

  async addFolder() {
    const options = {
      title: '选择文件夹',
      properties: ['openDirectory']
    };
    const result = await window['dialog'].selectFiles(options);
    console.log('文件夹选择结果:', result);
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      // 处理选中的文件夹
      const selectedPath = result.filePaths[0];

      // 检查是否已经存在
      const exists = this.selectContent.some(item =>
        item.type === 'folder' && item.path === selectedPath
      );

      if (!exists) {
        const folderName = selectedPath.split(/[/\\]/).pop() || selectedPath;
        this.selectContent.push({
          type: 'folder',
          path: selectedPath,
          name: folderName
        });
      }

      console.log('已添加的文件夹:', selectedPath);
      console.log('当前资源列表:', this.selectContent);
    } else {
      console.log('用户取消了文件夹选择或没有选择文件夹');
    }
  }


  addUrl() {
    // 可以添加一个对话框让用户输入URL
    const url = prompt('请输入URL地址:');
    if (url && url.trim()) {
      // 检查是否已经存在
      const exists = this.selectContent.some(item =>
        item.type === 'url' && item.url === url.trim()
      );

      if (!exists) {
        try {
          const urlObj = new URL(url.trim());
          const urlName = urlObj.hostname + urlObj.pathname;
          this.selectContent.push({
            type: 'url',
            url: url.trim(),
            name: urlName
          });
          console.log('已添加的URL:', url.trim());
          console.log('当前资源列表:', this.selectContent);
        } catch (error) {
          this.message.error('无效的URL格式');
        }
      } else {
        this.message.warning('该URL已经存在');
      }
    }
  }

  /**
   * 移除资源项
   * @param index 要移除的资源项索引
   */
  removeResource(index: number) {
    if (index >= 0 && index < this.selectContent.length) {
      this.selectContent.splice(index, 1);
    }
  }

  /**
   * 清空所有资源
   */
  clearAllResources() {
    this.selectContent = [];
  }

  /**
   * 获取资源列表的文本描述，用于发送给AI
   */
  getResourcesText(): string {
    if (this.selectContent.length === 0) {
      return '';
    }

    const fileItems = this.selectContent.filter(item => item.type === 'file');
    const folderItems = this.selectContent.filter(item => item.type === 'folder');
    const urlItems = this.selectContent.filter(item => item.type === 'url');

    let text = '';

    if (fileItems.length > 0) {
      text += '参考文件:\n';
      text += fileItems.map(item => `- ${item.path}`).join('\n');
      text += '\n\n';
    }

    if (folderItems.length > 0) {
      text += '参考文件夹:\n';
      text += folderItems.map(item => `- ${item.path}`).join('\n');
      text += '\n\n';
    }

    if (urlItems.length > 0) {
      text += '参考URL:\n';
      text += urlItems.map(item => `- ${item.url}`).join('\n');
      text += '\n\n';
    }

    return text.trim();
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
   * 清理订阅
   */
  ngOnDestroy() {
    // 清理消息订阅
    if (this.messageSubscription) {
      this.messageSubscription.unsubscribe();
    }
    if (this.textMessageSubscription) {
      this.textMessageSubscription.unsubscribe();
    }
  }

  // 添加订阅管理
  private messageSubscription: any;

  // 工具调用状态管理
  toolCallStates: { [key: string]: string } = {};
}
