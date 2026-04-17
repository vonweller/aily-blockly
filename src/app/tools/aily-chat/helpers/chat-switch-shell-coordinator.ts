import type { IMenuItem } from '../../../configs/menu.config';

import type { ModelConfig } from '../services/chat.service';

interface MenuManagerLike {
  showMode: boolean;
  showModelMenu: boolean;
  toggleModeMenu(event: MouseEvent): void;
  toggleModelMenu(event: MouseEvent, modelCount: number): void;
}

export class ChatSwitchShellCoordinator {
  constructor(
    private readonly deps: {
      menuManager: MenuManagerLike;
      getCurrentMode: () => string | undefined;
      getCurrentModel: () => ModelConfig | null | undefined;
    },
    private readonly callbacks: {
      switchToMode: (mode: string) => void | Promise<void>;
      switchToModel: (model: ModelConfig) => void | Promise<void>;
    },
  ) {}

  toggleModeMenu(event: MouseEvent): void {
    this.deps.menuManager.toggleModeMenu(event);
  }

  toggleModelMenu(event: MouseEvent, modelCount: number): void {
    this.deps.menuManager.toggleModelMenu(event, modelCount);
  }

  modeMenuClick(item: IMenuItem): void {
    this.deps.menuManager.showMode = false;

    const mode = item.data?.mode;
    if (typeof mode === 'string' && mode !== this.deps.getCurrentMode()) {
      void this.callbacks.switchToMode(mode);
    }
  }

  modelMenuClick(item: IMenuItem): void {
    this.deps.menuManager.showModelMenu = false;

    const model = item.data?.model as ModelConfig | undefined;
    if (model?.model && model.model !== this.deps.getCurrentModel()?.model) {
      void this.callbacks.switchToModel(model);
    }
  }
}