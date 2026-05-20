import { buildDialogTurnContext } from '../core/user-turn-action-target';
import type { ChatDialogViewItem } from './chat-dialog-view-items';
import { buildHostProjectionStateFromPersistedRecord } from './host-turn-response-state';
import type { ImportedDebugSessionRecord } from '../services/chat-history.service';

export interface ImportedDebugSessionViewModel {
  readonly metadata: ImportedDebugSessionRecord['hostRecord']['metadata'];
  readonly turnCount: number;
  readonly messageCount: number;
  readonly dialogItems: readonly ChatDialogViewItem[];
}

export function buildImportedDebugSessionViewModel(
  record: ImportedDebugSessionRecord,
): ImportedDebugSessionViewModel {
  const projection = buildHostProjectionStateFromPersistedRecord(record.hostRecord);

  return {
    metadata: record.hostRecord.metadata,
    turnCount: projection.turnResponses.length,
    messageCount: projection.dialogItems.length,
    dialogItems: projection.dialogItems.map(disableDialogItemActions),
  };
}

function disableDialogItemActions(item: ChatDialogViewItem): ChatDialogViewItem {
  return {
    ...item,
    isLastAily: false,
    showCheckpointRestore: false,
    turnContext: item.turnContext
      ? buildDialogTurnContext({
        turnId: item.turnContext.turnId,
        turnResponse: item.turnContext.turnResponse,
        request: item.turnContext.request,
        response: item.turnContext.response,
        rounds: item.turnContext.rounds,
        requestDisabled: true,
        requestContent: item.turnContext.requestContent,
        displayContent: item.turnContext.displayContent,
      })
      : null,
  };
}