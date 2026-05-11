import type { IMenuItem } from '../../../configs/menu.config';

import {
  CHAT_FOCUS_TODOS_ACTION_ID,
  CHAT_FOCUS_TODOS_ACTION_LABEL,
  canRunChatTodoFocusAction,
} from './chat-todo-focus-action';
import {
  CHAT_MANAGE_MODELS_ACTION_ID,
  CHAT_MANAGE_MODELS_ACTION_LABEL,
  canRunChatManageModelsAction,
  runChatManageModelsAction,
} from './chat-manage-models-action';

export interface ChatActionRegistryContext {
  readonly currentMode: string;
  canRunManageModelsAction(): boolean;
  runManageModelsAction(): boolean;
  runFocusTodosViewAction(): boolean;
  notifyManageModelsUnavailable(): void;
}

interface ChatRegisteredAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly shortcutText?: string;
  readonly showInMenu?: boolean;
  isEnabled(context: ChatActionRegistryContext): boolean;
  run(context: ChatActionRegistryContext): boolean;
}

const CHAT_REGISTERED_ACTIONS: readonly ChatRegisteredAction[] = [
  {
    id: CHAT_MANAGE_MODELS_ACTION_ID,
    label: CHAT_MANAGE_MODELS_ACTION_LABEL,
    icon: 'fa-light fa-gear',
    showInMenu: false,
    isEnabled: context => canRunChatManageModelsAction({
      canOpenLanguageModelsConfiguration: () => context.canRunManageModelsAction(),
    }),
    run: context => runChatManageModelsAction({
      canOpenLanguageModelsConfiguration: () => context.canRunManageModelsAction(),
      openLanguageModelsConfiguration: () => context.runManageModelsAction(),
      notifyUnavailable: () => context.notifyManageModelsUnavailable(),
    }),
  },
  {
    id: CHAT_FOCUS_TODOS_ACTION_ID,
    label: CHAT_FOCUS_TODOS_ACTION_LABEL,
    icon: 'fa-light fa-list-check',
    shortcutText: 'Ctrl/⌘ + Shift + T',
    isEnabled: context => canRunChatTodoFocusAction(context.currentMode),
    run: context => context.runFocusTodosViewAction(),
  },
];

export class ChatActionRegistry {
  constructor(private readonly getContext: () => ChatActionRegistryContext) {}

  getMenuItems(): readonly IMenuItem[] {
    const context = this.getContext();
    return CHAT_REGISTERED_ACTIONS
      .filter(action => action.showInMenu !== false)
      .map(action => ({
      name: action.label,
      action: action.id,
      icon: action.icon,
      text: action.shortcutText,
      disabled: !action.isEnabled(context),
      tooltip: action.label,
      data: { actionId: action.id },
      }));
  }

  runMenuAction(item: Pick<IMenuItem, 'action'>): boolean {
    const actionId = item.action;
    if (typeof actionId !== 'string') {
      return false;
    }

    const action = CHAT_REGISTERED_ACTIONS.find(candidate => candidate.id === actionId);
    if (!action) {
      return false;
    }

    const context = this.getContext();
    if (!action.isEnabled(context)) {
      return false;
    }

    return action.run(context);
  }
}