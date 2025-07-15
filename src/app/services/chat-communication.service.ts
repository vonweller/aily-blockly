import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface ChatTextMessage {
  text: string;
  sender?: string;
  timestamp?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ChatCommunicationService {
  private textSubject = new Subject<ChatTextMessage>();
  private static instance: ChatCommunicationService;

  constructor() {
    // 将实例赋值给静态变量，方便全局访问
    ChatCommunicationService.instance = this;
  }

  /**
   * 发送文本到聊天组件
   * @param text 要发送的文本内容
   * @param sender 发送者标识（可选）
   */
  sendTextToChat(text: string, sender?: string): void {
    const message: ChatTextMessage = {
      text,
      sender,
      timestamp: Date.now()
    };
    this.textSubject.next(message);
  }

  /**
   * 获取文本消息的Observable，供聊天组件订阅
   */
  getTextMessages(): Observable<ChatTextMessage> {
    return this.textSubject.asObservable();
  }

  /**
   * 静态方法，提供全局访问
   * @param text 要发送的文本内容
   * @param sender 发送者标识（可选）
   */
  static sendToChat(text: string, sender?: string): void {
    if (ChatCommunicationService.instance) {
      ChatCommunicationService.instance.sendTextToChat(text, sender);
    } else {
      console.warn('ChatCommunicationService 尚未初始化');
    }
  }
}
