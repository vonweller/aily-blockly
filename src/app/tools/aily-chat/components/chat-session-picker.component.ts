import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { ChatSessionListItem, MenuPosition } from '../services/menu-manager.service';
import {
  buildChatSessionSearchText,
  groupChatSessionPickerItemsByDate,
  type ChatSessionInventoryGroup,
} from '../helpers/chat-session-presentation';
import { ChatSessionEntriesComponent } from './chat-session-entries.component';

@Component({
  selector: 'aily-chat-session-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, ChatSessionEntriesComponent],
  templateUrl: './chat-session-picker.component.html',
  styleUrl: './chat-session-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatSessionPickerComponent implements AfterViewInit, AfterViewChecked, OnChanges {
  @Input() groups: readonly ChatSessionInventoryGroup[] = [];
  @Input() items: readonly ChatSessionListItem[] = [];
  @Input() selectedSessionId = '';
  @Input() revealSessionId = '';
  @Input() position: MenuPosition = { x: 0, y: 0 };
  @Input() width = 320;
  @Input() maxHeight = 360;

  @Output() selectSession = new EventEmitter<{ sessionId: string; item: ChatSessionListItem }>();
  @Output() actionClick = new EventEmitter<{ action: string; data: ChatSessionListItem }>();
  @Output() closeRequested = new EventEmitter<void>();

  @ViewChild('pickerRoot') pickerRoot?: ElementRef<HTMLElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  filterValue = '';
  private pendingRevealSessionId = '';

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.searchInput?.nativeElement.focus();
      this.searchInput?.nativeElement.select();
    });
    this.scheduleReveal(this.revealSessionId || this.selectedSessionId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['items'] || changes['selectedSessionId'] || changes['revealSessionId']) {
      this.scheduleReveal(this.revealSessionId || this.selectedSessionId);
    }
  }

  ngAfterViewChecked(): void {
    this.flushPendingReveal();
  }

  get sourceGroups(): readonly ChatSessionInventoryGroup[] {
    if (this.groups.length > 0) {
      return this.groups;
    }

    return groupChatSessionPickerItemsByDate(this.items);
  }

  get filteredGroups(): readonly ChatSessionInventoryGroup[] {
    const query = this.filterValue.trim().toLowerCase();
    if (!query) {
      return this.sourceGroups;
    }

    return this.sourceGroups
      .map(group => ({
        ...group,
        items: group.items.filter(item => buildChatSessionSearchText(item).includes(query)),
      }))
      .filter(group => group.items.length > 0);
  }

  get filteredItems(): readonly ChatSessionListItem[] {
    return this.filteredGroups.flatMap(group => group.items);
  }

  trackBySessionId(_: number, item: ChatSessionListItem): string {
    return item.sessionId;
  }

  isSelected(item: ChatSessionListItem): boolean {
    return item.sessionId === this.selectedSessionId;
  }

  selectItem(item: ChatSessionListItem): void {
    this.selectSession.emit({ sessionId: item.sessionId, item });
  }

  handleFilterChanged(): void {
    this.scheduleReveal(this.revealSessionId || this.selectedSessionId);
  }

  @HostListener('document:click', ['$event'])
  @HostListener('document:contextmenu', ['$event'])
  handleDocumentPointer(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (!target) {
      this.closeRequested.emit();
      return;
    }

    if (!this.pickerRoot?.nativeElement.contains(target)) {
      this.closeRequested.emit();
    }
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    this.closeRequested.emit();
  }

  private scheduleReveal(sessionId: string): void {
    this.pendingRevealSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  }

  private flushPendingReveal(): void {
    const sessionId = this.pendingRevealSessionId;
    if (sessionId.length === 0) {
      return;
    }

    if (!this.filteredItems.some(item => item.sessionId === sessionId)) {
      this.pendingRevealSessionId = '';
      return;
    }

    const itemElement = Array.from(this.pickerRoot?.nativeElement.querySelectorAll<HTMLElement>('[data-session-id]') ?? [])
      .find(candidate => candidate.dataset['sessionId'] === sessionId);
    if (!itemElement) {
      return;
    }

    itemElement.scrollIntoView({ block: 'nearest' });
    this.pendingRevealSessionId = '';
  }
}