import type { IMenuItem } from '../../../configs/menu.config';

import type { ModelConfig } from '../services/chat.service';

interface MenuManagerLike {
  showMode: boolean;
  showModelMenu: boolean;
  toggleModeMenu(event: MouseEvent): void;
  toggleModelMenu(event: MouseEvent, modelItems: IMenuItem[]): void;
}

function isSameModelSelection(left: ModelConfig | null | undefined, right: ModelConfig | null | undefined): boolean {
  return left?.model === right?.model
    && left?.presetId === right?.presetId
    && left?.reasoningEffort === right?.reasoningEffort;
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
      switchToModelConfiguration: (
        model: ModelConfig,
        update: { key: string; value: unknown },
      ) => void | Promise<void>;
    },
  ) {}

  toggleModeMenu(event: MouseEvent): void {
    this.deps.menuManager.toggleModeMenu(event);
  }

  toggleModelMenu(event: MouseEvent, modelItems: IMenuItem[]): void {
    this.deps.menuManager.toggleModelMenu(event, modelItems);
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
    if (model?.model && !isSameModelSelection(model, this.deps.getCurrentModel())) {
      void this.callbacks.switchToModel(model);
    }
  }

  modelMenuSubItemClick(item: IMenuItem): void {
    this.deps.menuManager.showModelMenu = false;

    const model = item.data?.model as ModelConfig | undefined;
    const modelConfiguration = item.data?.modelConfiguration as { key?: string; value: unknown } | undefined;
    if (model?.model && typeof modelConfiguration?.key === 'string' && modelConfiguration.key.trim()) {
      void this.callbacks.switchToModelConfiguration(model, {
        key: modelConfiguration.key.trim(),
        value: modelConfiguration.value,
      });
      return;
    }

    if (model?.model && !isSameModelSelection(model, this.deps.getCurrentModel())) {
      void this.callbacks.switchToModel(model);
      return;
    }
  }
}