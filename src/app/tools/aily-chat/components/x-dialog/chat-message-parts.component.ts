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
import type { TurnResponseTurn } from 'aily-lex/browser';

import { ChatPart } from '../../core/chat-parts';
import { isProgressMessageDisplayPart, type RenderableChatPart } from './chat-render-parts';
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
  part: RenderableChatPart;
}

interface ActivityGroupRenderItem {
  kind: 'group';
  id: string;
  parts: readonly ChatPart[];
  live: boolean;
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
        <aily-chat-activity-group [parts]="item.parts" [doing]="item.live" [sessionId]="sessionId" [turnResponse]="turnResponse" />
      } @else {
        <!-- 独立 Part：路由至专用 viewer -->
        <div class="chat-part" [attr.data-part-type]="item.part.type">
          <aily-chat-message-part-item [part]="item.part" [doing]="doing" [sessionId]="sessionId" [turnResponse]="turnResponse" />
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
  @Input() parts: readonly RenderableChatPart[] | null = null;
  @Input() doing = false;
  @Input() sessionId = '';
  @Input() turnResponse: TurnResponseTurn | null = null;

  renderItems: ChatRenderItem[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parts'] || changes['doing']) {
      this._refresh();
    }
  }

  isGroupItem(item: ChatRenderItem): item is ActivityGroupRenderItem {
    return item.kind === 'group';
  }

  private _refresh(): void {
    this.renderItems = this._markLiveGroups(this._buildRenderItems(this.parts || []));
  }

  private _buildRenderItems(parts: readonly RenderableChatPart[]): ChatRenderItem[] {
    const items: ChatRenderItem[] = [];
    let buffer: ChatPart[] = [];

    const flushBuffer = (): void => {
      if (buffer.length >= 1) {
        items.push({
          kind: 'group',
          id: buildActivityGroupIdentity(buffer),
          parts: buffer,
          live: false,
        });
      }
      buffer = [];
    };

    parts.forEach((part, index) => {
      if (this._isIgnorablePart(part)) {
        return;
      }

      if (isProgressMessageDisplayPart(part)) {
        flushBuffer();
        items.push({ kind: 'part', id: `progress:${part.progressKind}:${index}:${part.content}`, part });
        return;
      }

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

  private _markLiveGroups(items: readonly ChatRenderItem[]): ChatRenderItem[] {
    if (!this.doing || items.length === 0) {
      return items.map((item) => item.kind === 'group' ? { ...item, live: false } : item);
    }

    return items.map((item, index) => item.kind === 'group'
      ? { ...item, live: !this._hasLookAheadBoundary(items, index) }
      : item);
  }

  private _hasLookAheadBoundary(items: readonly ChatRenderItem[], groupIndex: number): boolean {
    for (let index = groupIndex + 1; index < items.length; index++) {
      if (items[index].kind === 'part') {
        return true;
      }
    }

    return false;
  }

  private _isIgnorablePart(part: RenderableChatPart): boolean {
    if (isProgressMessageDisplayPart(part)) {
      return part.content.trim().length === 0;
    }

    return part.type === 'markdown' && part.content.trim().length === 0;
  }
}
