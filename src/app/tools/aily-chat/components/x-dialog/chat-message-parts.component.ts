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
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { TurnResponseTurn } from 'aily-lex/browser';

import { isProgressMessageDisplayPart, type RenderableChatPart } from './chat-render-parts';
import {
  buildActivityPartRevision,
  buildChatRenderItems,
  type ActivityGroupRenderItem,
  type ChatRenderItem,
} from './chat-subagent-group-projection';
import { ChatActivityGroupComponent } from './chat-activity-group.component';
import { ChatMessagePartItemComponent } from './chat-message-part-item.component';
import { ChatPerformanceTracer } from '../../services/chat-perf-tracer';

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
        <aily-chat-activity-group
          [renderItemId]="item.id"
          [parts]="item.parts"
          [doing]="item.live"
          [sessionId]="sessionId"
          [turnResponse]="turnResponse"
          [impliedWordLoadRate]="impliedWordLoadRate"
          [detailProjectionEnabled]="detailProjectionEnabled"
          (contentDelta)="contentDelta.emit()"
        />
      } @else {
        <!-- 独立 Part：路由至专用 viewer -->
        <div class="chat-part" [attr.data-part-type]="item.part.type">
          <aily-chat-message-part-item
            [renderItemId]="item.id"
            [part]="item.part"
            [doing]="doing"
            [sessionId]="sessionId"
            [turnResponse]="turnResponse"
            [impliedWordLoadRate]="impliedWordLoadRate" />
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

    .chat-part:first-child { margin-top: 0; }
    .chat-part:last-child  { margin-bottom: 0; }
  `],
})
export class ChatMessagePartsComponent implements OnChanges {
  @Input() parts: readonly RenderableChatPart[] | null = null;
  @Input() doing = false;
  @Input() sessionId = '';
  @Input() turnResponse: TurnResponseTurn | null = null;
  @Input() impliedWordLoadRate: number | undefined;
  @Input() detailProjectionEnabled = true;
  @Output() contentDelta = new EventEmitter<void>();
  @ViewChildren(ChatMessagePartItemComponent) private partRenderers!: QueryList<ChatMessagePartItemComponent>;
  @ViewChildren(ChatActivityGroupComponent) private groupRenderers!: QueryList<ChatActivityGroupComponent>;

  renderItems: ChatRenderItem[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['parts'] || changes['doing']) {
      this._refresh();
    }
  }

  isGroupItem(item: ChatRenderItem): item is ActivityGroupRenderItem {
    return item.kind === 'group';
  }

  applyVisiblePartsPatch(input: {
    readonly parts: readonly RenderableChatPart[];
    readonly doing: boolean;
    readonly turnResponse: TurnResponseTurn | null;
    readonly impliedWordLoadRate?: number;
    readonly detailProjectionEnabled: boolean;
  }): boolean {
    return ChatPerformanceTracer.runWithSurface(
      'chat_projection',
      () => this.applyVisiblePartsPatchInternal(input),
      'message_parts_incremental_patch',
    );
  }

  private applyVisiblePartsPatchInternal(input: {
    readonly parts: readonly RenderableChatPart[];
    readonly doing: boolean;
    readonly turnResponse: TurnResponseTurn | null;
    readonly impliedWordLoadRate?: number;
    readonly detailProjectionEnabled: boolean;
  }): boolean {
    const nextItems = buildChatRenderItems(input.parts, input.doing);
    if (!canPatchRenderItemsInPlace(this.renderItems, nextItems)) {
      return false;
    }

    const previousDoing = this.doing;
    const previousRate = this.impliedWordLoadRate;
    const previousDetailProjectionEnabled = this.detailProjectionEnabled;
    const previousContinuation = buildContinuationRevision(this.turnResponse);
    const nextContinuation = buildContinuationRevision(input.turnResponse);
    const changedItemIds = new Set<string>();
    for (let index = 0; index < nextItems.length; index += 1) {
      const previous = this.renderItems[index];
      const next = nextItems[index];
      if (!previous || !next || hasRenderItemRevisionChanged(previous, next)) {
        if (next) {
          changedItemIds.add(next.id);
        }
        continue;
      }
      if (next.kind === 'group') {
        if (previousRate !== input.impliedWordLoadRate
          || previousDetailProjectionEnabled !== input.detailProjectionEnabled
          || previousContinuation !== nextContinuation) {
          changedItemIds.add(next.id);
        }
        continue;
      }
      if (previousDoing !== input.doing
        || (next.part.type === 'markdown' && previousRate !== input.impliedWordLoadRate)) {
        changedItemIds.add(next.id);
      }
    }

    const partRenderers = new Map(
      this.partRenderers?.map((renderer) => [renderer.renderItemId, renderer] as const) ?? [],
    );
    const groupRenderers = new Map(
      this.groupRenderers?.map((renderer) => [renderer.renderItemId, renderer] as const) ?? [],
    );
    if (nextItems.some((item) => item.kind === 'part'
      ? !partRenderers.has(item.id)
      : !groupRenderers.has(item.id))) {
      return false;
    }

    this.parts = input.parts;
    this.doing = input.doing;
    this.turnResponse = input.turnResponse;
    this.impliedWordLoadRate = input.impliedWordLoadRate;
    this.detailProjectionEnabled = input.detailProjectionEnabled;
    this.renderItems = reuseStableRenderItems(this.renderItems, nextItems);

    for (const item of this.renderItems) {
      if (!changedItemIds.has(item.id)) {
        continue;
      }
      if (item.kind === 'part') {
        if (!partRenderers.get(item.id)?.applyVisiblePartPatch({
          part: item.part,
          doing: input.doing,
          sessionId: this.sessionId,
          turnResponse: input.turnResponse,
          impliedWordLoadRate: input.impliedWordLoadRate,
        })) {
          return false;
        }
        continue;
      }

      if (!groupRenderers.get(item.id)?.applyVisibleGroupPatch({
        parts: item.parts,
        doing: item.live,
        sessionId: this.sessionId,
        turnResponse: input.turnResponse,
        impliedWordLoadRate: input.impliedWordLoadRate,
        detailProjectionEnabled: input.detailProjectionEnabled,
      })) {
        return false;
      }
    }
    return true;
  }

  private _refresh(): void {
    ChatPerformanceTracer.runWithSurface('chat_projection', () => {
      const parts = this.parts || [];
      const startedAt = performance.now();
      this.renderItems = reuseStableRenderItems(this.renderItems, buildChatRenderItems(parts, this.doing));
      ChatPerformanceTracer.recordDuration(
        'message_parts_component_refresh',
        performance.now() - startedAt,
        `parts=${parts.length},items=${this.renderItems.length},doing=${this.doing}`,
        { slowThresholdMs: 8 },
      );
      ChatPerformanceTracer.recordJankSnapshot('message_parts_component', {
        parts: parts.length,
        renderItems: this.renderItems.length,
        doing: this.doing,
      });
    }, 'message_parts_component_refresh');
  }
}

function canPatchRenderItemsInPlace(
  previousItems: readonly ChatRenderItem[],
  nextItems: readonly ChatRenderItem[],
): boolean {
  if (previousItems.length === 0 || previousItems.length !== nextItems.length) {
    return false;
  }

  for (let index = 0; index < previousItems.length; index += 1) {
    const previous = previousItems[index];
    const next = nextItems[index];
    if (!previous || !next || previous.id !== next.id || previous.kind !== next.kind) {
      return false;
    }
  }

  return true;
}

function reuseStableRenderItems(
  previousItems: readonly ChatRenderItem[],
  nextItems: readonly ChatRenderItem[],
): ChatRenderItem[] {
  if (previousItems.length === 0 || nextItems.length === 0) {
    return [...nextItems];
  }

  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  return nextItems.map((nextItem) => {
    const previousItem = previousById.get(nextItem.id);
    if (!previousItem || previousItem.kind !== nextItem.kind) {
      return nextItem;
    }

    if (nextItem.kind === 'part') {
      if (previousItem.kind !== 'part') {
        return nextItem;
      }
      previousItem.part = nextItem.part;
      return previousItem;
    }

    if (previousItem.kind !== 'group') {
      return nextItem;
    }

    previousItem.parts = nextItem.parts;
    previousItem.revision = nextItem.revision;
    previousItem.live = nextItem.live;
    return previousItem;
  });
}

function hasRenderItemRevisionChanged(previous: ChatRenderItem, next: ChatRenderItem): boolean {
  if (previous.id !== next.id || previous.kind !== next.kind) {
    return true;
  }
  if (previous.kind === 'group' && next.kind === 'group') {
    return previous.revision !== next.revision || previous.live !== next.live;
  }
  if (previous.kind === 'part' && next.kind === 'part') {
    if (isProgressMessageDisplayPart(previous.part) || isProgressMessageDisplayPart(next.part)) {
      return !isProgressMessageDisplayPart(previous.part)
        || !isProgressMessageDisplayPart(next.part)
        || previous.part.progressKind !== next.part.progressKind
        || previous.part.content !== next.part.content;
    }
    return buildActivityPartRevision(previous.part, 0) !== buildActivityPartRevision(next.part, 0);
  }
  return true;
}

function buildContinuationRevision(turnResponse: TurnResponseTurn | null): string {
  const continuation = turnResponse?.response?.continuation;
  if (!continuation) {
    return '';
  }
  return [
    continuation.interactionId ?? '',
    continuation.stepIndex ?? '',
    continuation.lease ?? '',
    continuation.status ?? '',
    continuation.stopReason ?? '',
    continuation.hardStopReason ?? '',
    continuation.pendingState?.['kind'] ?? '',
  ].join(':');
}
