import type { NzModalService } from 'ng-zorro-antd/modal';

import { UnsavedEditsDialogComponent } from '../components/unsaved-edits-dialog/unsaved-edits-dialog.component';

interface EditSummaryLike {
  fileCount: number;
}

interface EditCheckpointServiceLike {
  hasUnsavedEdits(): boolean;
  getEditsSummary(): EditSummaryLike | null;
  acceptAllAsBaseline(): void;
  dismissSummary(): void;
  readonly canUndo: boolean;
  undo(): Promise<unknown>;
}

interface MenuManagerLike {
  openHistoryChat(): void;
  historyActionClick(
    event: { action: string; data: any },
    currentSessionId: string,
    callbacks: {
      onGetHistory: () => void;
      onNewChat: () => void;
      onDetectChanges: () => void;
      onUpdateTitle: (title: string) => void;
      onRefreshHistory: () => void;
    },
  ): void;
  switchToSession(
    sessionId: string,
    currentSessionId: string,
    callbacks: {
      onSaveCurrentSession: () => void;
      onGetHistory: () => void;
      onSetCompleted: () => void;
      onSetServerSessionInactive: () => void;
    },
  ): boolean;
}

interface ChatViewStateLike {
  toggleSettings(): void;
  closeSettings(): void;
}

interface ChatServiceLike {
  currentSessionId: string;
  currentSessionTitle: string;
}

export class ChatSessionShellCoordinator {
  constructor(
    private readonly deps: {
      modal: NzModalService;
      menuManager: MenuManagerLike;
      editCheckpointService: EditCheckpointServiceLike;
      viewState: ChatViewStateLike;
      chatService: ChatServiceLike;
    },
    private readonly callbacks: {
      saveCurrentSession: () => void;
      getHistory: () => void;
      newChat: () => void;
      refreshHistoryList: () => void;
      markForCheck: () => void;
      setCompleted: () => void;
    },
  ) {}

  toggleSettings(): void {
    this.deps.viewState.toggleSettings();
  }

  closeSettings(): void {
    this.deps.viewState.closeSettings();
  }

  openHistoryChat(): void {
    this.callbacks.refreshHistoryList();
    this.deps.menuManager.openHistoryChat();
  }

  menuClick(event: { sessionId: string }): void {
    const onSwitch = () => {
      this.deps.menuManager.switchToSession(event.sessionId, this.deps.chatService.currentSessionId, {
        onSaveCurrentSession: this.callbacks.saveCurrentSession,
        onGetHistory: this.callbacks.getHistory,
        onSetCompleted: this.callbacks.setCompleted,
        onSetServerSessionInactive: () => undefined,
      });
    };

    if (this.deps.editCheckpointService.hasUnsavedEdits()) {
      this.confirmUnsavedEditsBeforeSwitch(onSwitch);
      return;
    }

    onSwitch();
  }

  historyActionClick(event: { action: string; data: any }): void {
    this.deps.menuManager.historyActionClick(event, this.deps.chatService.currentSessionId, {
      onGetHistory: this.callbacks.getHistory,
      onNewChat: this.callbacks.newChat,
      onDetectChanges: this.callbacks.markForCheck,
      onUpdateTitle: (title: string) => {
        this.deps.chatService.currentSessionTitle = title;
      },
      onRefreshHistory: this.callbacks.refreshHistoryList,
    });
  }

  newChat(): void {
    if (this.deps.editCheckpointService.hasUnsavedEdits()) {
      this.confirmUnsavedEditsBeforeSwitch(() => this.callbacks.newChat());
      return;
    }

    this.callbacks.newChat();
  }

  private confirmUnsavedEditsBeforeSwitch(onConfirm: () => void): void {
    const summary = this.deps.editCheckpointService.getEditsSummary();
    if (!summary || summary.fileCount === 0) {
      this.deps.editCheckpointService.acceptAllAsBaseline();
      this.deps.editCheckpointService.dismissSummary();
      onConfirm();
      return;
    }

    const modalRef = this.deps.modal.create({
      nzTitle: null,
      nzFooter: null,
      nzClosable: false,
      nzBodyStyle: { padding: '0' },
      nzWidth: 340,
      nzContent: UnsavedEditsDialogComponent,
      nzData: { fileCount: summary.fileCount },
    });

    modalRef.afterClose.subscribe(async (action: string | null) => {
      if (action === 'keep') {
        this.deps.editCheckpointService.acceptAllAsBaseline();
        this.deps.editCheckpointService.dismissSummary();
        this.callbacks.saveCurrentSession();
        onConfirm();
        return;
      }

      if (action === 'discard') {
        while (this.deps.editCheckpointService.canUndo) {
          await this.deps.editCheckpointService.undo();
        }
        this.deps.editCheckpointService.dismissSummary();
        this.callbacks.saveCurrentSession();
        onConfirm();
      }
    });
  }
}