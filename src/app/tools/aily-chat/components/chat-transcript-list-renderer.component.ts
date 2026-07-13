import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { Subscription } from 'rxjs';

import type { ResourceItem } from '../core/chat-types';
import type { ChatSelectedMode } from '../core/chat-mode';
import type {
  ChatVisibleTranscriptDialogItem,
  ChatVisibleTranscriptDialogItemPatch,
} from '../core/chat-visible-transcript-model';
import type { DialogTurnContext } from '../core/user-turn-action-target';
import type { ChatTaskActionDetail } from '../helpers/chat-task-action-coordinator';
import type { WorkspaceCheckpointPresentationMode } from '../services/edit-checkpoint.service';
import {
  XDialogComponent,
  type ChatDialogItemHeightChange,
} from './x-dialog/x-dialog.component';

export interface ChatTranscriptPatchResult {
  readonly applied: boolean;
  readonly requiresRowMeasurement: boolean;
}

@Component({
  selector: 'aily-chat-transcript-list-renderer',
  standalone: true,
  imports: [XDialogComponent],
  template: `
    @if (topSpacerHeight > 0) {
      <div class="dialog-virtual-spacer" [style.height.px]="topSpacerHeight" aria-hidden="true"></div>
    }
    @for (item of renderedItems; track item.id) {
      <div
        class="dialog-virtual-row"
        #dialogVirtualRow
        [attr.data-chat-item-id]="item.id"
        [attr.data-turn-id]="item.turnId || null"
        [attr.data-response-id]="item.responseId || null">
        <aily-x-dialog
          [item]="item"
          [sessionId]="sessionId"
          [currentMode]="currentMode"
          [selectedMode]="selectedMode"
          [currentModelName]="currentModelName"
          [currentModelChipLabel]="currentModelChipLabel"
          [currentModelBillingLabel]="currentModelBillingLabel"
          [workspaceCheckpointPresentationMode]="workspaceCheckpointPresentationMode"
          [exclusiveEditTurnId]="exclusiveEditTurnId"
          [showModeMenu]="showModeMenu"
          [showModelMenu]="showModelMenu"
          (editSessionOpened)="editSessionOpened.emit($event)"
          (editSessionClosed)="editSessionClosed.emit()"
          (dismissSessionMenus)="dismissSessionMenus.emit()"
          (editAndResend)="editAndResend.emit($event)"
          (editModeToggle)="editModeToggle.emit($event)"
          (editModelToggle)="editModelToggle.emit($event)"
          (editAddFile)="editAddFile.emit($event)"
          (editAddFolder)="editAddFolder.emit($event)"
          (taskAction)="taskAction.emit($event)"
          (contentDelta)="contentDelta.emit($event)" />
      </div>
    }
    @if (bottomSpacerHeight > 0) {
      <div class="dialog-virtual-spacer" [style.height.px]="bottomSpacerHeight" aria-hidden="true"></div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .dialog-virtual-row {
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }
    .dialog-virtual-spacer {
      width: 100%;
      min-width: 0;
      flex: 0 0 auto;
      pointer-events: none;
      contain: strict;
    }
    aily-x-dialog {
      display: block;
      min-width: 0;
      max-width: 100%;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatTranscriptListRendererComponent implements AfterViewInit, OnDestroy {
  private _renderedItems: readonly ChatVisibleTranscriptDialogItem[] = [];
  private readonly mountedDialogRenderers = new Map<string, XDialogComponent>();
  private readonly mountedUserDialogRenderersByTurnId = new Map<string, XDialogComponent>();
  private mountedDialogRenderersSubscription: Subscription | null = null;

  @Input({ required: true })
  set items(value: readonly ChatVisibleTranscriptDialogItem[] | null | undefined) {
    this._renderedItems = value ?? [];
  }
  get renderedItems(): readonly ChatVisibleTranscriptDialogItem[] {
    return this._renderedItems;
  }

  @Input() topSpacerHeight = 0;
  @Input() bottomSpacerHeight = 0;
  @Input() sessionId = '';
  @Input() currentMode = 'agent';
  @Input() selectedMode: Pick<ChatSelectedMode, 'modeId' | 'customAgentTarget'> | null | undefined;
  @Input() currentModelName = '';
  @Input() currentModelChipLabel = '';
  @Input() currentModelBillingLabel = '';
  @Input() workspaceCheckpointPresentationMode: WorkspaceCheckpointPresentationMode = 'unknown';
  @Input() exclusiveEditTurnId: string | undefined;
  @Input() showModeMenu = false;
  @Input() showModelMenu = false;

  @Output() editSessionOpened = new EventEmitter<string>();
  @Output() editSessionClosed = new EventEmitter<void>();
  @Output() dismissSessionMenus = new EventEmitter<void>();
  @Output() editAndResend = new EventEmitter<{ target: DialogTurnContext; newText: string; resources: ResourceItem[] }>();
  @Output() editModeToggle = new EventEmitter<{ event: MouseEvent; type: 'mode' }>();
  @Output() editModelToggle = new EventEmitter<{ event: MouseEvent; type: 'model' }>();
  @Output() editAddFile = new EventEmitter<DialogTurnContext>();
  @Output() editAddFolder = new EventEmitter<DialogTurnContext>();
  @Output() taskAction = new EventEmitter<ChatTaskActionDetail>();
  @Output() contentDelta = new EventEmitter<ChatDialogItemHeightChange>();

  @ViewChildren(XDialogComponent) private xDialogComponents!: QueryList<XDialogComponent>;
  @ViewChildren('dialogVirtualRow', { read: ElementRef }) private dialogVirtualRows!: QueryList<ElementRef<HTMLElement>>;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.syncMountedDialogRenderers();
    this.mountedDialogRenderersSubscription = this.xDialogComponents.changes.subscribe(() => {
      this.syncMountedDialogRenderers();
    });
  }

  ngOnDestroy(): void {
    this.mountedDialogRenderersSubscription?.unsubscribe();
    this.mountedDialogRenderersSubscription = null;
    this.mountedDialogRenderers.clear();
    this.mountedUserDialogRenderersByTurnId.clear();
  }

  applyPatches(
    patches: readonly ChatVisibleTranscriptDialogItemPatch[],
    canSkipRowDetect: (
      previousItem: ChatVisibleTranscriptDialogItem | null | undefined,
      nextItem: ChatVisibleTranscriptDialogItem,
    ) => boolean,
  ): ChatTranscriptPatchResult {
    if (patches.length === 0) {
      return { applied: false, requiresRowMeasurement: false };
    }

    const nextItems = [...this._renderedItems];
    let requiresListDetect = false;
    let requiresRowMeasurement = false;
    const rowPatches: ChatVisibleTranscriptDialogItemPatch[] = [];

    for (const patch of patches) {
      const existingIndex = nextItems.findIndex(item => item.id === patch.itemId);
      if (patch.kind === 'added') {
        if (existingIndex >= 0) {
          nextItems[existingIndex] = patch.item;
          rowPatches.push({ ...patch, index: existingIndex, kind: 'updated' });
          continue;
        }
        if (patch.index < 0 || patch.index > nextItems.length) {
          return { applied: false, requiresRowMeasurement: false };
        }
        nextItems.splice(patch.index, 0, patch.item);
        requiresListDetect = true;
        requiresRowMeasurement = true;
        continue;
      }

      if (existingIndex < 0) {
        return { applied: false, requiresRowMeasurement: false };
      }
      nextItems[existingIndex] = patch.item;
      rowPatches.push({ ...patch, index: existingIndex });
    }

    this._renderedItems = nextItems;
    if (requiresListDetect) {
      this.cdr.detectChanges();
      this.syncMountedDialogRenderers();
    }

    for (const patch of rowPatches) {
      const component = this.mountedDialogRenderers.get(patch.itemId);
      if (!component) {
        return { applied: false, requiresRowMeasurement };
      }
      const detectChanges = !canSkipRowDetect(component.item, patch.item);
      requiresRowMeasurement ||= detectChanges;
      if (!component.applyVisibleTranscriptItemPatch(patch.item, { detectChanges })) {
        return { applied: false, requiresRowMeasurement };
      }
    }

    return { applied: true, requiresRowMeasurement };
  }

  findDialogByTurnId(turnId: string): XDialogComponent | undefined {
    return this.xDialogComponents?.find(dialog => dialog.role === 'user' && dialog.actionTurnId === turnId);
  }

  readVirtualRows(): readonly ElementRef<HTMLElement>[] {
    return this.dialogVirtualRows?.toArray() ?? [];
  }

  applySessionRequestState(activeTurnId: string | null, requestInProgress: boolean): void {
    const targetTurnId = typeof activeTurnId === 'string' ? activeTurnId.trim() : '';
    if (!targetTurnId) {
      return;
    }
    this.mountedUserDialogRenderersByTurnId
      .get(targetTurnId)
      ?.applySessionRequestState(requestInProgress);
  }

  private syncMountedDialogRenderers(): void {
    this.mountedDialogRenderers.clear();
    this.mountedUserDialogRenderersByTurnId.clear();
    for (const component of this.xDialogComponents?.toArray() ?? []) {
      const itemId = component.item?.id;
      if (itemId) {
        this.mountedDialogRenderers.set(itemId, component);
      }
      const turnId = component.role === 'user' ? component.actionTurnId?.trim() : '';
      if (turnId) {
        this.mountedUserDialogRenderersByTurnId.set(turnId, component);
      }
    }
  }
}
