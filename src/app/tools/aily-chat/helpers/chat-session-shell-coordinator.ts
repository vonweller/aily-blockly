import type { NzModalService } from 'ng-zorro-antd/modal';
import type { DialogTurnContext } from '../core/user-turn-action-target';

import { UnsavedEditsDialogComponent } from '../components/unsaved-edits-dialog/unsaved-edits-dialog.component';

interface EditSummaryLike {
  fileCount: number;
  turnContext?: DialogTurnContext | null;
}

interface EditCheckpointServiceLike {
  hasUnsavedEdits(): boolean;
  getEditsSummary(): Promise<EditSummaryLike | null>;
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
      onGetHistory: () => void | Promise<void>;
      onNewChat: () => void | Promise<void>;
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
      onGetHistory: () => void | Promise<void>;
      onSetCompleted: () => void;
      onSetServerSessionInactive: () => void;
    },
  ): Promise<boolean>;
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
      getHistory: () => void | Promise<void>;
      newChat: () => void | Promise<void>;
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
      void this.deps.menuManager.switchToSession(event.sessionId, this.deps.chatService.currentSessionId, {
        onSaveCurrentSession: this.callbacks.saveCurrentSession,
        onGetHistory: this.callbacks.getHistory,
        onSetCompleted: this.callbacks.setCompleted,
        onSetServerSessionInactive: () => undefined,
      });
    };

    if (this.deps.editCheckpointService.hasUnsavedEdits()) {
      void this.confirmUnsavedEditsBeforeSwitch(onSwitch);
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
      void this.confirmUnsavedEditsBeforeSwitch(() => this.callbacks.newChat());
      return;
    }

    void this.callbacks.newChat();
  }

  private async confirmUnsavedEditsBeforeSwitch(onConfirm: () => void | Promise<void>): Promise<void> {
    const summary = await this.deps.editCheckpointService.getEditsSummary();
    if (!summary || summary.fileCount === 0) {
      this.deps.editCheckpointService.acceptAllAsBaseline();
      this.deps.editCheckpointService.dismissSummary();
      await onConfirm();
      return;
    }

    const modalRef = this.deps.modal.create({
      nzTitle: null,
      nzFooter: null,
      nzClosable: false,
      nzBodyStyle: { padding: '0' },
      nzWidth: 340,
      nzContent: UnsavedEditsDialogComponent,
      nzData: { fileCount: summary.fileCount, turnContext: summary.turnContext },
    });

    modalRef.afterClose.subscribe(async (action: string | null) => {
      if (action === 'keep') {
        this.deps.editCheckpointService.acceptAllAsBaseline();
        this.deps.editCheckpointService.dismissSummary();
        this.callbacks.saveCurrentSession();
        await onConfirm();
        return;
      }

      if (action === 'discard') {
        while (this.deps.editCheckpointService.canUndo) {
          await this.deps.editCheckpointService.undo();
        }
        this.deps.editCheckpointService.dismissSummary();
        this.callbacks.saveCurrentSession();
        await onConfirm();
      }
    });
  }
}