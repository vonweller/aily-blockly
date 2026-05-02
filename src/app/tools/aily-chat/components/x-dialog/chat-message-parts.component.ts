/**
 * ChatMessagePartsComponent — Part-based 消息渲染容器
 *
 * 直接消费 ChatPart[] 数组，按类型路由到对应的渲染器。
 *
 * 架构对齐 Copilot ChatThinkingContentPart：
 *   - 连续的 thinking/tool_call/state Part → aily-chat-activity-group（统一可折叠组）
 *   - 单独 Part → aily-chat-message-part-item（按类型路由至专用 viewer）
 */

import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatPart } from '../../core/chat-parts';
import {
  buildActivityGroupIdentity,
  buildChatPartIdentity,
  isGroupableActivityPart,
  isSubagentToolCall,
} from './chat-activity-group-projection';
import { ChatActivityGroupComponent } from './chat-activity-group.component';
import { ChatMessagePartItemComponent } from './chat-message-part-item.component';

interface PartRenderItem {
  kind: 'part';
  id: string;
  part: ChatPart;
}

interface ActivityGroupRenderItem {
  kind: 'group';
  id: string;
  parts: readonly ChatPart[];
}

type ChatRenderItem = PartRenderItem | ActivityGroupRenderItem;

@Component({
  selector: 'aily-chat-message-parts',
  standalone: true,
  imports: [
    CommonModule,
    ChatActivityGroupComponent,
    ChatMessagePartItemComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of renderItems; track item.id) {
      @if (isGroupItem(item)) {
        <!-- 统一活动组：对齐 Copilot ChatThinkingContentPart -->
        <aily-chat-activity-group [parts]="item.parts" [doing]="doing" />
      } @else {
        <!-- 独立 Part：路由至专用 viewer -->
        <div class="chat-part" [attr.data-part-type]="item.part.type">
          <aily-chat-message-part-item [part]="item.part" [doing]="doing" />
        </div>
      }
    }
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
    }

    .chat-part {
      margin-top: 3px;
      margin-bottom: 3px;
    }
    .chat-part:first-child { margin-top: 0; }
    .chat-part:last-child  { margin-bottom: 0; }
  `],
})
export class ChatMessagePartsComponent implements OnChanges {
  @Input() parts: readonly ChatPart[] | null = null;
  @Input() doing = false;

  renderItems: ChatRenderItem[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parts']) {
      this._refresh();
    }
  }

  isGroupItem(item: ChatRenderItem): item is ActivityGroupRenderItem {
    return item.kind === 'group';
  }

  private _refresh(): void {
    this.renderItems = this._buildRenderItems(this.parts || []);
  }

  private _buildRenderItems(parts: readonly ChatPart[]): ChatRenderItem[] {
    const items: ChatRenderItem[] = [];
    let buffer: ChatPart[] = [];

    const flushBuffer = (): void => {
      if (buffer.length >= 1) {
        items.push({
          kind: 'group',
          id: buildActivityGroupIdentity(buffer),
          parts: buffer,
        });
      }
      buffer = [];
    };

    parts.forEach((part, index) => {
      if (isSubagentToolCall(part)) {
        flushBuffer();
        items.push({ kind: 'part', id: buildChatPartIdentity(part, index), part });
        return;
      }

      if (isGroupableActivityPart(part)) {
        buffer.push(part);
        return;
      }
      flushBuffer();
      items.push({ kind: 'part', id: buildChatPartIdentity(part, index), part });
    });

    flushBuffer();
    return items;
  }
}
