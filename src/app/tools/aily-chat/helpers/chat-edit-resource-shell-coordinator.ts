import type { IDialog } from '../core/host-api';
import type { ResourceItem } from '../core/chat-types';
import { pickFileResources, pickFolderResource } from './chat-resource-picker';

interface EditResourceTargetLike {
  addEditResource(item: ResourceItem): void;
}

export class ChatEditResourceShellCoordinator {
  constructor(
    private readonly deps: {
      getDialog: () => Pick<IDialog, 'selectFiles'> | null | undefined;
      resolveTarget: (msgIndex: number) => EditResourceTargetLike | undefined;
    },
  ) {}

  async addFile(msgIndex: number): Promise<void> {
    const dialog = this.deps.getDialog();
    if (!dialog) {
      return;
    }

    const items = await pickFileResources(dialog);
    if (items.length === 0) {
      return;
    }

    const target = this.deps.resolveTarget(msgIndex);
    if (!target) {
      return;
    }

    for (const item of items) {
      target.addEditResource(item);
    }
  }

  async addFolder(msgIndex: number): Promise<void> {
    const dialog = this.deps.getDialog();
    if (!dialog) {
      return;
    }

    const item = await pickFolderResource(dialog);
    if (!item) {
      return;
    }

    const target = this.deps.resolveTarget(msgIndex);
    if (!target) {
      return;
    }

    target.addEditResource(item);
  }
}