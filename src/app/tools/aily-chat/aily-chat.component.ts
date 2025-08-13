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
import { ChatService, ChatTextOptions } from './services/chat.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { MenuComponent } from '../../components/menu/menu.component';
import { IMenuItem } from '../../configs/menu.config';
import { McpService } from './services/mcp.service';
import { ProjectService } from '../../services/project.service';
import { CmdOutput, CmdService } from '../../services/cmd.service';
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
import { NzModalService } from 'ng-zorro-antd/modal';

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

export interface ChatMessage {
  role: string;
  content: string;
  state: 'doing' | 'done';
}

import { NzMessageService } from 'ng-zorro-antd/message';
import { TOOLS } from './tools/tools';
import { AuthService } from '../../services/auth.service';
import { resolveObjectURL } from 'buffer';
import { reloadAbiJsonTool, reloadAbiJsonToolSimple } from './tools';

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
  @ViewChild('chatList') chatList: ElementRef;
  @ViewChild('chatTextarea') chatTextarea: ElementRef;

  defaultList: ChatMessage[] = [{
    "role": "system",
    "content": "欢迎使用AI助手服务，我可以帮助你 分析项目、转换blockly库、修复错误、生成程序，告诉我你需要什么帮助吧~🤓\n\n >当前为测试版本，可能会有不少问题，如遇故障，群里呼叫`奈何col`哦",
    "state": "done"
  }];

  list: ChatMessage[] = [...this.defaultList.map(item => ({...item}))];
  // list = ChatListExamples  // 示例数据

  currentUrl;
  inputValue = '';
  prjRootPath = '';
  prjPath = '';

  windowInfo = 'AI助手';

  isCompleted = false;

  private textMessageSubscription: Subscription;
  private loginStatusSubscription: Subscription;

  get sessionId() {
    return this.chatService.currentSessionId;
  }

  get currentMode() {
    return this.chatService.currentMode;
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
  tools: Tool[] = TOOLS;

  constructor(
    private uiService: UiService,
    private chatService: ChatService,
    private mcpService: McpService,
    private projectService: ProjectService,
    private cmdService: CmdService,
    private blocklyService: BlocklyService,
    private fetchToolService: FetchToolService,
    private router: Router,
    private message: NzMessageService,
    private authService: AuthService,
    private modal: NzModalService
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
    this.textMessageSubscription = this.chatService.getTextMessages().subscribe(
      message => {
        this.receiveTextFromExternal(message.text, message.options);
      }
    );

    // 订阅登录状态变化
    this.loginStatusSubscription = this.authService.isLoggedIn$.subscribe(
      isLoggedIn => {
        this.startSession().then(() => {
          this.getHistory();
        });
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

    if (options?.type === 'button') {
      this.send("user", text, false);
      return;
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
    }, 100);
  }

  async disconnect() {
    try {
      // 先停止会话
      if (this.sessionId) {
        await new Promise<void>((resolve) => {
          this.chatService.stopSession(this.sessionId).subscribe({
            next: (res: any) => {
              console.log('关闭时会话已停止:', res);
              resolve();
            },
            error: (err) => {
              console.error('关闭时停止会话失败:', err);
              resolve(); // 即使失败也继续
            }
          });
        });

        // 然后关闭连接
        await new Promise<void>((resolve) => {
          this.chatService.closeSession(this.sessionId).subscribe({
            next: (res: any) => {
              console.log('关闭时会话连接已关闭:', res);
              resolve();
            },
            error: (err) => {
              console.error('关闭时关闭会话失败:', err);
              resolve(); // 即使失败也继续
            }
          });
        });
      }
    } catch (error) {
      console.error('关闭会话过程中出错:', error);
    }
  }

  async close() {
    // 最后关闭工具窗口
    this.uiService.closeTool('aily-chat');
  }

  ngAfterViewInit(): void {
    this.scrollToBottom();
    // this.mcpService.init().then(() => {
    //   this.startSession();
    // })

    // 测试数据
    //     setTimeout(() => {
    //       this.list.push({
    //         role: 'bot',
    //         content: `\`\`\`aily-mermaid
    // flowchart TD
    //     subgraph "桌面时钟摆件"
    //         direction LR
    //         subgraph "核心控制"
    //             MCU[主控芯片 ESP32<br>内置Wi-Fi]
    //         end

    //         subgraph "外围设备"
    //             MATRIX[LED点阵屏<br>MAX7219驱动]
    //             RTC[实时时钟模块<br>DS3231]
    //             SENSOR[温湿度传感器<br>DHT22]
    //             BUTTON[物理按键]
    //         end

    //         subgraph "网络服务"
    //             NTP[NTP网络时间服务]
    //             WEATHER_API[天气信息API]
    //         end

    //         subgraph "电源"
    //             POWER[USB 5V供电]
    //         end
    //     end

    //     MCU -- SPI --> MATRIX
    //     MCU -- I2C --> RTC
    //     MCU -- GPIO --> SENSOR
    //     MCU -- GPIO --> BUTTON
    //     MCU -- Wi-Fi --> NTP
    //     MCU -- Wi-Fi --> WEATHER_API
    //     POWER --> MCU
    //     POWER --> MATRIX
    // \`\`\`\n\n`
    //       });
    //     }, 2000);
  }

  appendMessage(role, text) {
    // console.log("添加消息: ", role, text);

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
      // 如果是AI角色且正在输出，保持doing状态
      if (role === 'aily' && this.isWaiting) {
        this.list[this.list.length - 1].state = 'doing';
      }
    } else {
      // console.log("添加新消息: ", role);
      // 如果是不同的role或列表为空，创建新的消息
      const state = (role === 'aily' && this.isWaiting) ? 'doing' : 'done';
      this.list.push({
        "role": role,
        "content": text,
        "state": state
      });
    }
  }

  startSession(): Promise<void> {
    // tools + mcp tools
    this.isCompleted = false;
    let tools = this.tools;
    let mcpTools = this.mcpService.tools.map(tool => {
      tool.name = "mcp_" + tool.name;
      return tool;
    });
    if (mcpTools && mcpTools.length > 0) {
      tools = tools.concat(mcpTools);
    }

    return new Promise<void>((resolve, reject) => {
      this.chatService.startSession(this.currentMode, tools).subscribe({
        next: (res: any) => {
          if (res.status === 'success') {
            this.chatService.currentSessionId = res.data;
            this.streamConnect();
            resolve();
          } else {
            this.appendMessage('错误', `
\`\`\`aily-error
{
  "message": ${res.message || '启动会话失败，请稍后重试。'}
}
\`\`\`\n\n

            `)
            reject(new Error(res.message || '启动会话失败'));
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
          reject(err);
        }
      });
    });
  }

  closeSession(): void {
    if (!this.sessionId) return;

    this.chatService.closeSession(this.sessionId).subscribe((res: any) => {
      // console.log('close session', res);
    });
  }

  isWaiting = false;
  autoScrollEnabled = true; // 控制是否自动滚动到底部

  async sendButtonClick(): Promise<void> {
    if (this.isWaiting) {
      this.stop();
      return;
    }

    // 发送消息时重新启用自动滚动
    this.autoScrollEnabled = true;

    if (this.isCompleted) {
      console.log('上次会话已完成，需要重新启动会话');
      await this.resetChat();
    }

    this.send('user', this.inputValue.trim(), true);
    this.inputValue = ''; // 发送后清空输入框
    this.selectContent = [];
  }

  resetChat(): Promise<void> {
    return this.startSession();
  }

  send(sender: string, content: string, clear: boolean = true): void {
    let text = content.trim();
    if (!this.sessionId || !text) return;

    if (sender === 'user') {
      if (this.isWaiting) {
        return;
      }

      const resourcesText = this.getResourcesText();
      if (resourcesText) {
        text = resourcesText + '\n\n' + text;
      }

      this.appendMessage('user', text);
      this.appendMessage('aily', '[thinking...]');
    } else if (sender === 'tool') {
      if (!this.isWaiting) {
        return;
      }
    } else {
      console.warn('未知发送者类型:', sender);
      return;
    }

    this.isWaiting = true;

    this.chatService.sendMessage(this.sessionId, text, sender).subscribe((res: any) => {
      if (res.status === 'success') {
        if (res.data) {
          this.appendMessage('aily', res.data);
        }

        if (clear) {
          this.inputValue = ''; // 发送后清空输入框
        }
      }
    });
  }

  // 这里写停止发送信号
  stop() {
    // 设置最后一条AI消息状态为done（如果存在）
    if (this.list.length > 0 && this.list[this.list.length - 1].role === 'aily') {
      this.list[this.list.length - 1].state = 'done';
    }

    this.chatService.cancelTask(this.sessionId).subscribe((res: any) => {
      if (res.status === 'success') {
        console.log('任务已取消:', res);
      } else {
        console.error('取消任务失败:', res);
      }
    });

    // this.chatService.stopSession(this.sessionId).subscribe((res: any) => {
    //   // 处理停止会话的响应
    //   if (res.status == 'success') {
    //     console.log('会话已停止:', res);
    //     return;
    //   }
    //   console.error('停止会话失败:', res);
    // });
  }

  streamConnect(): void {
    console.log("stream connect sessionId: ", this.sessionId);
    if (!this.sessionId) return;

    this.chatService.streamConnect(this.sessionId).subscribe({
      next: async (data: any) => {
        if (!this.isWaiting) {
          return; // 如果不在等待状态，直接返回
        }
        
        console.log("=============== start ==========")
        console.log("Rev: ", data);
        console.log("=============== end ==========")

        try {
          if (data.type === 'ModelClientStreamingChunkEvent') {
            // 处理流式数据
            if (data.content) {
              this.appendMessage('aily', data.content);
            }
          } else if (data.type === 'ToolCallRequestEvent') {
            // 处理工具调用请求
          } else if (data.type === 'ToolCallExecutionEvent') {
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
            // 设置最后一条AI消息状态为done（如果存在）
            if (this.list.length > 0 && this.list[this.list.length - 1].role === 'aily') {
              this.list[this.list.length - 1].state = 'done';
            }
            this.appendMessage('错误', '助手出错: ' + (data.message || '未知错误'));
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
                  this.send("tool", JSON.stringify({
                    "type": "tool_result",
                    "tool_id": data.tool_id,
                    "content": `参数解析失败: ${e.message}`,
                    "is_error": true
                  }, null, 2), false);
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
                    // console.log('[获取上下文信息工具被调用]', toolArgs);
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
                    // console.log('[列出目录工具被调用]', toolArgs);
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
                    // console.log('[读取文件工具被调用]', toolArgs);
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
                    // console.log('[创建文件工具被调用]', toolArgs);
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
                    // console.log('[创建文件夹工具被调用]', toolArgs);
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
                    // console.log('[编辑文件工具被调用]', toolArgs);
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
                    // console.log('[删除文件工具被调用]', toolArgs);
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
                    // console.log('[删除文件夹工具被调用]', toolArgs);
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
                    // console.log('[检查存在性工具被调用]', toolArgs);
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
                    // console.log('[获取目录树工具被调用]', toolArgs);
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
                    // console.log('[网络请求工具被调用]', toolArgs);
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
                    toolResult = await askApprovalTool(toolArgs);
                    // 不显示状态信息，因为这是用户交互操作
                    break;
                  case 'reload_project':
                    // console.log('[重新加载项目工具被调用]', toolArgs);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在重新加载项目...",
  "id": "${toolCallId}"
}
\`\`\`\n\n

                      `)
                    break;
                  case 'reload_abi_json':
                    console.log('[重新加载ABI JSON工具被调用]', toolArgs);
                    this.appendMessage('aily', `

\`\`\`aily-state
{
  "state": "doing",
  "text": "正在重新加载Blockly工作区数据...",
  "id": "${toolCallId}"
}
\`\`\`\n\n
                    `);
                    // 导入工具函数
                    const { ReloadAbiJsonToolService } = await import('./tools/reloadAbiJsonTool');
                    const reloadAbiJsonService = new ReloadAbiJsonToolService(this.blocklyService, this.projectService);
                    const reloadResult = await reloadAbiJsonService.executeReloadAbiJson(toolArgs);
                    toolResult = {
                      content: reloadResult.content,
                      is_error: reloadResult.is_error
                    };
                    if (toolResult.is_error) {
                      resultState = "error";
                      resultText = 'ABI数据重新加载失败: ' + (toolResult.content || '未知错误');
                    } else {
                      resultText = 'ABI数据重新加载成功';
                    }
                    break;
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
            this.send("tool", JSON.stringify({
              "type": "tool",
              "tool_id": data.tool_id,
              "content": toolResult?.content || '',
              "resultText": this.makeJsonSafe(resultText),
              "is_error": toolResult.is_error
            }, null, 2), false);
          } else if (data.type === 'user_input_required') {
            // 处理用户输入请求 - 需要用户补充消息时停止等待状态
            // 设置最后一条消息状态为done
            if (this.list.length > 0 && this.list[this.list.length - 1].role === 'aily') {
              this.list[this.list.length - 1].state = 'done';
            }
            this.isWaiting = false;
          }
          this.scrollToBottom();
        } catch (e) {
          console.error('处理流数据时出错:', e);
          this.appendMessage('错误', `

\`\`\`aily-error
{
  "message": "服务异常，请稍后重试。"
}
\`\`\`\n\n

          `);
          // 设置最后一条AI消息状态为done（如果存在）
          if (this.list.length > 1 && this.list[this.list.length - 2].role === 'aily') {
            this.list[this.list.length - 2].state = 'done';
          }
          this.isWaiting = false;
        }
      },
      complete: () => {
        console.log('streamConnect complete: ', this.list[this.list.length - 1]);
        // 设置最后一条消息状态为done（输出完成）
        if (this.list.length > 0 && this.list[this.list.length - 1].role === 'aily') {
          this.list[this.list.length - 1].state = 'done';
        }
        this.isWaiting = false;
        this.isCompleted = true;

        // TODO: 处理停止原因
      },
      error: (err) => {
        console.error('流连接出错:', err);
        // 设置最后一条AI消息状态为done（如果存在）
        if (this.list.length > 0 && this.list[this.list.length - 1].role === 'aily') {
          this.list[this.list.length - 1].state = 'done';
        }
        this.appendMessage('错误', `

\`\`\`aily-error
{
  "message": "连接中断。"
}
\`\`\`\n\n

`);
        this.isWaiting = false;
      }
    });
  }

  getHistory(): void {
    if (!this.sessionId) return;

    console.log('获取历史消息，sessionId:', this.sessionId);
    this.chatService.getHistory(this.sessionId).subscribe((res: any) => {
      console.log('get history', res);
      if (res.status === 'success') {
        // 为历史消息添加状态，如果没有state属性则默认为done
        const historyData = res.data.map(item => {
          if (!item.hasOwnProperty('state')) {
            item.state = 'done';
          }
          return item;
        });
        // 合并历史消息和当前消息列表
        this.list = [...this.list, ...historyData];

        // console.log('历史消息:', this.list);

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
  async onKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
      if (this.isWaiting) {
        return;
      }
      
      if (this.isCompleted) {
        console.log('上次会话已完成，需要重新启动会话');
        await this.resetChat();
      }

      this.send("user", this.inputValue.trim(), true);
      this.selectContent = [];
      this.inputValue = "";
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
    // 只在自动滚动启用时才滚动到底部
    if (!this.autoScrollEnabled) {
      return;
    }

    setTimeout(() => {
      try {
        if (this.chatContainer?.nativeElement) {
          const element = this.chatContainer.nativeElement;
          const currentScrollTop = element.scrollTop;
          const maxScrollTop = element.scrollHeight - element.clientHeight;

          // 只有当不在底部时才滚动，避免不必要的滚动
          if (currentScrollTop < maxScrollTop - 2) {
            // 使用 scrollTo 方法实现平滑滚动
            element.scrollTo({
              top: element.scrollHeight,
              behavior: 'smooth'
            });
          }
        }
      } catch (error) {
        console.warn('滚动到底部失败:', error);
      }
    }, 100);
  }

  /**
   * 检查用户是否手动向上滚动，如果是则禁用自动滚动
   */
  checkUserScroll() {
    if (!this.chatContainer?.nativeElement) {
      return;
    }

    const element = this.chatContainer.nativeElement;
    const threshold = 30; // 减小容差值，提高检测精度
    const isAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;

    // 如果用户不在底部，说明手动向上滚动了，禁用自动滚动
    if (!isAtBottom && this.autoScrollEnabled) {
      this.autoScrollEnabled = false;
      console.log('用户手动滚动，已禁用自动滚动');
    }
    // 如果用户滚动到底部附近，重新启用自动滚动
    else if (isAtBottom && !this.autoScrollEnabled) {
      this.autoScrollEnabled = true;
      console.log('用户滚动到底部，已启用自动滚动');
    }
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

  // AI模式列表
  ModeList: IMenuItem[] = [
    {
      name: '代理模式',
      action: 'agent-mode',
      icon: 'fa-light fa-user-astronaut',
      data: { mode: 'agent' }
    },
    {
      name: '问答模式',
      action: 'qa-mode',
      icon: 'fa-light fa-comment-smile',
      data: { mode: 'qa' }
    }
  ]

  // 当前AI模式
  // currentMode = 'agent'; // 默认为代理模式

  async newChat() {
    console.log('启动新会话');
    this.list = [...this.defaultList.map(item => ({...item}))];

    console.log("CurrentList: ", this.list);
    // 新会话时重新启用自动滚动
    this.autoScrollEnabled = true;
    this.isCompleted = false;

    try {
      // 等待停止操作完成
      await new Promise<void>((resolve) => {
        if (!this.sessionId) {
          resolve();
          return;
        }

        this.chatService.stopSession(this.sessionId).subscribe({
          next: (res: any) => {
            console.log('会话已停止:', res);
            this.isWaiting = false;
            resolve();
          },
          error: (err) => {
            console.error('停止会话失败:', err);
            resolve(); // 即使失败也继续
          }
        });
      });

      // 等待关闭会话完成
      await new Promise<void>((resolve) => {
        if (!this.sessionId) {
          resolve();
          return;
        }

        this.chatService.closeSession(this.sessionId).subscribe({
          next: (res: any) => {
            console.log('会话已关闭:', res);
            resolve();
          },
          error: (err) => {
            console.error('关闭会话失败:', err);
            resolve(); // 即使失败也继续
          }
        });
      });

      this.chatService.currentSessionId = '';
      // 最后启动新会话
      await this.startSession();
    } catch (error) {
      console.error('重新启动会话失败:', error);
      // 即使出错也尝试启动新会话
      try {
        await this.startSession();
      } catch (retryError) {
        console.error('重试启动会话也失败:', retryError);
      }
    }
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
  showMode = false;
  historyListPosition = { x: 0, y: 0 };
  modeListPosition = { x: 0, y: 0 };

  openHistoryChat(e) {
    // 设置菜单的位置
    this.historyListPosition = { x: window.innerWidth - 302, y: 72 };
    console.log(this.historyListPosition);

    this.showHistoryList = !this.showHistoryList;
  }

  closeMenu() {
    this.showHistoryList = false;
    this.showMode = false;
  }

  menuClick(e) {

  }

  // 模式选择相关方法
  switchMode(event: MouseEvent) {
    // 获取点击的按钮元素
    const target = event.currentTarget as HTMLElement;
    if (target) {
      // 获取按钮的位置信息
      const rect = target.getBoundingClientRect();

      // 计算菜单位置：在按钮上方显示，并且考虑右对齐
      const menuWidth = 130; // 菜单宽度
      const menuHeight = 68; // 预估菜单高度

      // 计算水平位置：右对齐到按钮右边缘
      let x = rect.left;

      // 计算垂直位置：在按钮上方显示
      let y = rect.top - menuHeight - 1;

      // 边界检查：如果菜单会超出屏幕左边界，则左对齐到按钮左边缘
      if (x < 0) {
        x = rect.left;
      }

      // 边界检查：如果菜单会超出屏幕上边界，则显示在按钮下方
      if (y < 0) {
        y = rect.bottom - 1;
      }

      // 设置菜单位置
      this.modeListPosition = { x: Math.max(0, x), y: Math.max(0, y) };
    } else {
      // 如果无法获取按钮位置，使用默认位置
      this.modeListPosition = { x: window.innerWidth - 302, y: window.innerHeight - 280 };
    }

    // 阻止事件冒泡，避免触发其他点击事件
    event.preventDefault();
    event.stopPropagation();

    this.showMode = !this.showMode;
  }

  modeMenuClick(item: IMenuItem) {
    if (item.data?.mode) {
      if (this.currentMode != item.data.mode) {
        // 判断是否已经有对话内容产生，有则提醒切换模式会创建新的session
        if (this.list.length > 1) {
          // 显示确认弹窗
          this.modal.confirm({
            nzTitle: '确认切换模式',
            nzContent: '切换AI模式会创建新的对话会话, 是否继续？',
            nzOkText: '确认',
            nzCancelText: '取消',
            nzOnOk: () => {
              this.switchToMode(item.data.mode);
            },
            nzOnCancel: () => {
              console.log('用户取消了模式切换');
            }
          });
          return;
        }

        this.switchToMode(item.data.mode);
      }
    }
    this.showMode = false;
  }

  /**
   * 切换AI模式并创建新会话
   * @param mode 要切换到的模式
   */
  private switchToMode(mode: string) {
    this.chatService.currentMode = mode;
    console.log('切换AI模式为:', this.currentMode);
    this.newChat();
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

    // 清理登录状态订阅
    if (this.loginStatusSubscription) {
      this.loginStatusSubscription.unsubscribe();
    }

    this.disconnect();
  }

  // 添加订阅管理
  private messageSubscription: any;

  // 工具调用状态管理
  toolCallStates: { [key: string]: string } = {};


  demandEdit() {

  }
}
