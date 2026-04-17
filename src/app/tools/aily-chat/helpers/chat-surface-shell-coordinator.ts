import type { ResourceItem } from '../core/chat-types';

export const DEFAULT_AILY_USAGE_GUIDE_URL = 'https://aily.pro/doc/ai-usage-guide';

export interface EditAndResendEvent {
  msgIndex: number;
  newText: string;
  resources: ResourceItem[];
}

export class ChatSurfaceShellCoordinator {
  constructor(
    private readonly callbacks: {
      editAndResendFromTurn: (msgIndex: number, newText: string, resources: ResourceItem[]) => Promise<void>;
      closeTool: (toolId: string) => void;
      openUrl: (url: string) => void;
    },
  ) {}

  async editAndResend(event: EditAndResendEvent): Promise<void> {
    await this.callbacks.editAndResendFromTurn(event.msgIndex, event.newText, event.resources);
  }

  close(toolId: string = 'aily-chat'): void {
    this.callbacks.closeTool(toolId);
  }

  openUrl(url: string = DEFAULT_AILY_USAGE_GUIDE_URL): void {
    this.callbacks.openUrl(url);
  }
}