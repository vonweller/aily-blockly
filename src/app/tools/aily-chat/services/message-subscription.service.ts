import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface ChatMessage {
  content: string;
  role?: 'user' | 'assistant';
  sessionId?: string;
  metadata?: any;
}

export interface MessageSubscriptionOptions {
  autoSend?: boolean; // 是否自动发送消息，默认为true
  showInChat?: boolean; // 是否在聊天界面显示，默认为true
  createNewSession?: boolean; // 是否创建新会话，默认为false
}

@Injectable({
  providedIn: 'root'
})
export class MessageSubscriptionService {
  private messageSubject = new Subject<{ message: ChatMessage, options?: MessageSubscriptionOptions }>();
  
  constructor() { }

  /**
   * 发送消息到AI聊天组件
   * @param message 消息内容
   * @param options 消息选项
   */
  sendMessage(message: ChatMessage, options?: MessageSubscriptionOptions): void {
    const defaultOptions: MessageSubscriptionOptions = {
      autoSend: true,
      showInChat: true,
      createNewSession: false
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    this.messageSubject.next({ message, options: finalOptions });
  }

  /**
   * 订阅消息
   */
  getMessageObservable(): Observable<{ message: ChatMessage, options?: MessageSubscriptionOptions }> {
    return this.messageSubject.asObservable();
  }

  /**
   * 便捷方法：发送文本消息
   * @param content 消息内容
   * @param options 消息选项
   */
  sendTextMessage(content: string, options?: MessageSubscriptionOptions): void {
    this.sendMessage({ content, role: 'user' }, options);
  }

  /**
   * 便捷方法：发送代码消息
   * @param code 代码内容
   * @param language 代码语言
   * @param options 消息选项
   */
  sendCodeMessage(code: string, language: string = 'blockly', options?: MessageSubscriptionOptions): void {
    const content = `\`\`\`${language}\n${code}\n\`\`\``;
    this.sendMessage({ content, role: 'user' }, options);
  }

  /**
   * 便捷方法：发送带上下文的消息
   * @param content 主要内容
   * @param context 上下文信息
   * @param options 消息选项
   */
  sendContextMessage(content: string, context: any, options?: MessageSubscriptionOptions): void {
    const message: ChatMessage = {
      content,
      role: 'user',
      metadata: { context }
    };
    this.sendMessage(message, options);
  }
}
