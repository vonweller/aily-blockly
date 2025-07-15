import { ChatCommunicationService } from '../services/chat-communication.service';

/**
 * 全局方法：发送文本到聊天组件
 * 这个方法会被挂载到 window 对象上，可以在任何地方调用
 * 
 * @param text 要发送的文本内容
 * @param sender 发送者标识（可选）
 * 
 * @example
 * // 在任何组件或脚本中调用
 * window.sendToAilyChat('帮我生成Arduino代码', 'MyScript');
 * 
 * // 或者使用简化的全局函数
 * sendToAilyChat('如何使用传感器？');
 */
declare global {
  interface Window {
    sendToAilyChat: (text: string, sender?: string) => void;
  }
}

// 全局函数
window.sendToAilyChat = function(text: string, sender?: string): void {
  ChatCommunicationService.sendToChat(text, sender);
};

// 导出全局函数，也可以直接导入使用
export const sendToAilyChat = window.sendToAilyChat;

export default {
  sendToAilyChat
};
