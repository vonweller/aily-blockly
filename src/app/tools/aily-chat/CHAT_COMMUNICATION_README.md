# 聊天组件全局文本发送功能

这个功能允许其他组件向聊天组件的 textarea 发送文本内容。

## 核心组件

### 1. ChatCommunicationService
位置：`src/app/services/chat-communication.service.ts`

这是一个全局服务，用于管理组件间的聊天文本通信。

#### 主要方法：

- `sendTextToChat(text: string, sender?: string)`: 发送文本到聊天组件
- `getTextMessages(): Observable<ChatTextMessage>`: 获取文本消息的 Observable
- `static sendToChat(text: string, sender?: string)`: 静态方法，可以不依赖注入直接调用

### 2. 修改后的 AilyChatComponent
位置：`src/app/tools/aily-chat/aily-chat.component.ts`

聊天组件现在订阅 `ChatCommunicationService` 的消息，接收外部发送的文本。

#### 新增功能：
- 订阅外部文本消息
- 自动将接收到的文本显示在输入框中
- 自动聚焦到输入框并将光标移到末尾
- 支持文本追加（如果输入框已有内容）

### 3. 全局工具函数
位置：`src/app/utils/global-chat.utils.ts`

提供全局的 `window.sendToAilyChat` 方法，可以在任何地方调用。

## 使用方法

### 1. 最简单的方法：全局函数

```typescript
// 在任何地方都可以直接调用
window.sendToAilyChat('帮我生成Arduino代码');

// 或者带发送者标识
window.sendToAilyChat('如何使用传感器？', 'BlocklyComponent');
```

### 2. 静态方法调用

```typescript
import { ChatCommunicationService } from '../../services/chat-communication.service';

// 不需要注入服务，直接调用静态方法
ChatCommunicationService.sendToChat('Hello from static method!');
```

### 3. 服务注入方式（推荐用于 Angular 组件）

```typescript
import { ChatCommunicationService } from '../../services/chat-communication.service';

constructor(private chatCommunicationService: ChatCommunicationService) {}

// 发送文本到聊天组件
sendText() {
  this.chatCommunicationService.sendTextToChat('Hello from another component!');
}
```

### 4. 与UI服务结合使用

```typescript
import { ChatCommunicationService } from '../../services/chat-communication.service';
import { UiService } from '../../services/ui.service';

constructor(
  private chatCommunicationService: ChatCommunicationService,
  private uiService: UiService
) {}

// 打开聊天工具并发送文本
openChatAndSend() {
  // 先打开聊天工具
  this.uiService.openTool('aily-chat');
  
  // 延迟发送文本，确保组件已加载
  setTimeout(() => {
    this.chatCommunicationService.sendTextToChat(
      '帮我生成Arduino代码',
      'MyComponent'
    );
  }, 500);
}

// 或者使用全局方法
openChatAndSendGlobal() {
  this.uiService.openTool('aily-chat');
  setTimeout(() => {
    window.sendToAilyChat('帮我生成Arduino代码', 'MyComponent');
  }, 500);
}
```

### 5. 示例组件

创建了一个示例组件 `ChatSenderExampleComponent`，展示了如何使用这个功能：

- 自定义文本发送
- 预定义文本快速发送
- 打开聊天工具并发送文本

## 在不同场景中的使用

### 在 Blockly 组件中使用
```typescript
// 当用户生成代码后，自动发送到聊天组件请求优化
onCodeGenerated(code: string) {
  window.sendToAilyChat(`请帮我优化这段Arduino代码：\n\n${code}`, 'BlocklyEditor');
}
```

### 在错误处理中使用
```typescript
// 当编译出错时，自动发送错误信息到聊天组件寻求帮助
onCompileError(error: string) {
  window.sendToAilyChat(`编译时遇到错误，请帮我解决：\n${error}`, 'Compiler');
}
```

### 在菜单项中使用
```typescript
// 在菜单中添加快捷助手选项
menuItems = [
  {
    label: '询问AI助手',
    click: () => {
      this.uiService.openTool('aily-chat');
      setTimeout(() => {
        window.sendToAilyChat('我需要帮助，请问有什么可以为我做的？', 'Menu');
      }, 500);
    }
  }
];
```

## 特性

1. **多种调用方式**：支持全局函数、静态方法、服务注入等多种调用方式
2. **非侵入性**：不影响聊天组件的现有功能
3. **类型安全**：使用 TypeScript 接口定义消息格式
4. **发送者标识**：可选的发送者标识，用于调试和日志
5. **自动聚焦**：接收文本后自动聚焦到输入框
6. **文本追加**：支持在现有文本基础上追加新文本
7. **响应式**：使用 RxJS Observable 模式
8. **全局可用**：通过 window 对象在任何地方都可以调用

## 接口定义

```typescript
export interface ChatTextMessage {
  text: string;        // 文本内容
  sender?: string;     // 发送者标识（可选）
  timestamp?: number;  // 时间戳（可选）
}
```

## 注意事项

1. 发送文本前确保聊天组件已经加载
2. 如果需要打开聊天工具，建议使用 `setTimeout` 延迟发送
3. 服务会自动处理内存清理（OnDestroy 时取消订阅）
4. 支持换行文本和特殊字符
5. 全局方法已在 `main.ts` 中自动注册

## 测试

可以使用以下方式测试功能：

1. 在浏览器控制台中直接调用：
   ```javascript
   window.sendToAilyChat('这是一个测试消息');
   ```

2. 使用 `ChatSenderExampleComponent` 来测试：
   - 在应用中添加示例组件
   - 输入自定义文本或使用预定义示例
   - 观察聊天组件的响应

这个功能为应用中的其他组件提供了一个简单而强大的方式来与聊天组件进行交互，支持多种使用场景和调用方式。
