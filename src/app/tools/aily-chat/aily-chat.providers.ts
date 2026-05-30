import type { Provider } from '@angular/core';

import { ChatEngineService } from './services/chat-engine.service';
import { ChatRuntimeInteractionHostService } from './services/chat-runtime-interaction-host.service';
import { ChatSessionActionsService } from './services/chat-session-actions.service';
import { ChatSessionItemsService } from './services/chat-session-items.service';
import { ChatSessionRuntimeRegistryService } from './services/chat-session-runtime-registry.service';
import { ChatSessionRuntimeStoreService } from './services/chat-session-runtime-store.service';
import { ChatSessionsControlService } from './services/chat-sessions-control.service';
import { ChatSetupSuggestionService } from './services/chat-setup-suggestion.service';
import { ChatViewService } from './services/chat-view.service';
import { EditCheckpointService } from './services/edit-checkpoint.service';
import { GitWorkspaceCheckpointProviderService } from './services/git-workspace-checkpoint-provider.service';
import { MenuManagerService } from './services/menu-manager.service';
import { ResourceManagerService } from './services/resource-manager.service';
import { ScrollManagerService } from './services/scroll-manager.service';

// Background-session alignment: these owners must outlive the chat pane component.
export const AILY_CHAT_RUNTIME_PROVIDERS: Provider[] = [
  ScrollManagerService,
  ResourceManagerService,
  ChatSessionRuntimeStoreService,
  ChatSessionRuntimeRegistryService,
  ChatSessionItemsService,
  ChatSessionActionsService,
  MenuManagerService,
  ChatSessionsControlService,
  ChatSetupSuggestionService,
  ChatViewService,
  EditCheckpointService,
  GitWorkspaceCheckpointProviderService,
  ChatEngineService,
  ChatRuntimeInteractionHostService,
];
