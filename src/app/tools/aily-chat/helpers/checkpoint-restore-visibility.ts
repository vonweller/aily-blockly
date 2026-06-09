import type { ChatDialogViewItem } from './chat-dialog-view-items';

export function applyCheckpointRestoreVisibility(
  dialogItems: readonly ChatDialogViewItem[],
  canShowCheckpointRestore: boolean,
): ChatDialogViewItem[] {
  if (dialogItems.length === 0 || canShowCheckpointRestore) {
    return [...dialogItems];
  }

  let changed = false;
  const normalizedItems = dialogItems.map(item => {
    if (!item.showCheckpointRestore) {
      return item;
    }

    changed = true;
    return {
      ...item,
      showCheckpointRestore: false,
    };
  });

  return changed ? normalizedItems : [...dialogItems];
}