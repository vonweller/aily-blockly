import type { IMenuItem } from '../../../configs/menu.config';

import { resolveChatSurfaceModeId } from '../core/chat-mode';
import { CHAT_PICKER_CONFIGURE_CUSTOM_AGENTS_ACTION_ID } from './chat-configure-custom-agents-action';
import type { ModelConfig } from '../services/chat.service';

interface MenuManagerLike {
  showMode: boolean;
  showModelMenu: boolean;
  toggleModeMenu(event: MouseEvent): void;
  toggleModelMenu(event: MouseEvent, modelItems: IMenuItem[]): void;
}

interface ChatViewStateLike {
  closeSessionPicker(): void;
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
      viewState: ChatViewStateLike;
      getCurrentMode: () => string | undefined;
      getCurrentModeId: () => string | undefined;
      getCurrentCustomAgentTarget: () => string | undefined;
      getCurrentModel: () => ModelConfig | null | undefined;
    },
    private readonly callbacks: {
      switchToMode: (mode: string) => void | Promise<void>;
      switchToCustomAgent: (selection: { readonly modeId?: string; readonly customAgentTarget?: string }) => void | Promise<void>;
      configureCustomAgents: () => void | Promise<void>;
      switchToModel: (model: ModelConfig) => void | Promise<void>;
      switchToModelConfiguration: (
        model: ModelConfig,
        update: { key: string; value: unknown },
      ) => void | Promise<void>;
    },
  ) {}

  toggleModeMenu(event: MouseEvent): void {
    this.deps.viewState.closeSessionPicker();
    this.deps.menuManager.toggleModeMenu(event);
  }

  toggleModelMenu(event: MouseEvent, modelItems: IMenuItem[]): void {
    this.deps.viewState.closeSessionPicker();
    this.deps.menuManager.toggleModelMenu(event, modelItems);
  }

  modeMenuClick(item: IMenuItem): void {
    this.deps.menuManager.showMode = false;

    if (item.action === CHAT_PICKER_CONFIGURE_CUSTOM_AGENTS_ACTION_ID) {
      void this.callbacks.configureCustomAgents();
      return;
    }

    const customModeId = typeof item.data?.modeId === 'string'
      ? item.data.modeId.trim()
      : '';
    const customAgentTarget = typeof item.data?.customAgentTarget === 'string'
      ? item.data.customAgentTarget.trim()
      : '';
    if (customModeId) {
      const currentModeId = typeof this.deps.getCurrentModeId() === 'string'
        ? this.deps.getCurrentModeId()!.trim()
        : '';
      if (this.deps.getCurrentMode() !== 'agent' || currentModeId !== customModeId) {
        void this.callbacks.switchToCustomAgent({
          modeId: customModeId,
        });
      }
      return;
    }

    if (customAgentTarget) {
      if (this.deps.getCurrentMode() !== 'agent' || this.deps.getCurrentCustomAgentTarget() !== customAgentTarget) {
        void this.callbacks.switchToCustomAgent({
          customAgentTarget,
        });
      }
      return;
    }

    const mode = resolveChatSurfaceModeId(item.data?.mode);
    if (mode && mode !== this.deps.getCurrentMode()) {
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
}