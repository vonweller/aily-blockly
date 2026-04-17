import type { EditActionsHelper } from './edit-actions.helper';

export interface ChatTaskActionDetail {
  action?: string;
  checkpointId?: string;
  listIndex?: number;
  filePath?: string;
  [key: string]: unknown;
}

interface TaskActionCallbacks {
  continueConversation: () => Promise<void> | void;
  retryLastAction: () => Promise<void> | void;
  newChat: () => Promise<void> | void;
  warnUnknownAction: (action: string | undefined) => void;
}

/**
 * Routes task action payloads from UI events to the appropriate helpers.
 */
export class ChatTaskActionCoordinator {
  constructor(
    private readonly editActions: EditActionsHelper,
    private readonly callbacks: TaskActionCallbacks,
  ) {}

  handle(detail?: ChatTaskActionDetail): void {
    const action = detail?.action;

    switch (action) {
      case 'continue':
        void this.callbacks.continueConversation();
        return;
      case 'retry':
        void this.callbacks.retryLastAction();
        return;
      case 'regenerate':
        void this.editActions.regenerateTurn(detail?.checkpointId);
        return;
      case 'undoEdits':
        void this.editActions.undoLastEdits();
        return;
      case 'redoEdits':
        void this.editActions.redoEdits();
        return;
      case 'keepEdits':
        this.editActions.onKeepEdits(detail);
        return;
      case 'acceptFile':
        this.editActions.onAcceptFile(detail?.filePath);
        return;
      case 'rejectFile':
        this.editActions.onRejectFile(detail?.filePath);
        return;
      case 'restoreCheckpoint':
        void this.editActions.restoreToCheckpoint(detail?.listIndex);
        return;
      case 'newChat':
        void this.callbacks.newChat();
        return;
      case 'dismiss':
        return;
      default:
        this.callbacks.warnUnknownAction(action);
    }
  }
}