import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  Output,
  QueryList,
  ViewChildren,
  forwardRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChatActivityItemComponent } from './chat-activity-item.component';
import type { ActivityGroupDisplayItem } from './chat-activity-group.types';

@Component({
  selector: 'aily-chat-activity-list',
  standalone: true,
  imports: [CommonModule, forwardRef(() => ChatActivityItemComponent)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cag-list">
      @for (item of items; track item.id; let first = $first; let last = $last; let count = $count) {
        <aily-chat-activity-item
          [item]="item"
          [sessionId]="sessionId"
          [impliedWordLoadRate]="impliedWordLoadRate"
          [first]="first"
          [last]="last"
          [only]="count === 1"
          (contentDelta)="contentDelta.emit()" />
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
    }

    .cag-list {
      position: relative;
      border: none;
      border-radius: 0;
      padding: 0;
      margin-top: 0;
      margin-left: 8px;
      display: flex;
      flex-direction: column;
      overflow: visible;
    }
  `],
})
export class ChatActivityListComponent {
  @Input() items: readonly ActivityGroupDisplayItem[] = [];
  @Input() sessionId = '';
  @Input() impliedWordLoadRate: number | undefined;
  @Output() contentDelta = new EventEmitter<void>();

  @ViewChildren(forwardRef(() => ChatActivityItemComponent))
  private itemRenderers!: QueryList<ChatActivityItemComponent>;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  /** Apply a response-part revision without checking the parent group subtree. */
  applyItemsPatch(
    items: readonly ActivityGroupDisplayItem[],
    sessionId: string,
    impliedWordLoadRate: number | undefined,
  ): boolean {
    const sameStructure = this.items.length === items.length
      && this.items.every((item, index) => item.id === items[index]?.id);

    this.items = items;
    this.sessionId = sessionId;
    this.impliedWordLoadRate = impliedWordLoadRate;

    if (!sameStructure) {
      this.cdr.detectChanges();
      return true;
    }

    const renderers = this.itemRenderers?.toArray() ?? [];
    if (renderers.length !== items.length) {
      return false;
    }

    for (let index = 0; index < items.length; index += 1) {
      if (!renderers[index]?.applyVisibleActivityItemPatch({
        item: items[index],
        sessionId,
        impliedWordLoadRate,
        first: index === 0,
        last: index === items.length - 1,
        only: items.length === 1,
      })) {
        return false;
      }
    }
    return true;
  }
}
