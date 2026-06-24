import type { Provider } from '@angular/core';

import { ChatEngineService } from './services/chat-engine.service';
import { ChatRuntimeHostBootstrapService } from './services/chat-runtime-host-bootstrap.service';
import { ChatRuntimeOwnerHeadlessProjectionService } from './services/chat-runtime-owner-headless-projection.service';
import { ChatRuntimeOwnerBindingService } from './services/chat-runtime-owner-binding.service';
import { ChatRuntimeOwnerContextService } from './services/chat-runtime-owner-context.service';
import { ChatRuntimeOwnerEndpointService } from './services/chat-runtime-owner-endpoint.service';
import { ChatRuntimeOwnerHostAdapterService } from './services/chat-runtime-owner-host-adapter.service';
import { ChatRuntimeOwnerProjectionService } from './services/chat-runtime-owner-projection.service';
import { ChatRuntimeOwnerRuntimeControllerService } from './services/chat-runtime-owner-runtime-controller.service';
import { ChatRuntimeOwnerRuntimeStateService } from './services/chat-runtime-owner-runtime-state.service';
import { ChatRuntimeOwnerSaveBridgeService } from './services/chat-runtime-owner-save-bridge.service';
import { ChatRuntimeOwnerSaveTargetService } from './services/chat-runtime-owner-save-target.service';
import { ChatRuntimeOwnerSchedulerService } from './services/chat-runtime-owner-scheduler.service';
import { ChatRuntimeOwnerSessionContextService } from './services/chat-runtime-owner-session-context.service';
import { ChatRuntimeOwnerSessionModelService } from './services/chat-runtime-owner-session-model.service';
import { ChatRuntimeOwnerSessionSaveBridgeFactoryService } from './services/chat-runtime-owner-session-save-bridge-factory.service';
import { ChatRuntimeOwnerService } from './services/chat-runtime-owner.service';
import { ChatRuntimeOwnerStateService } from './services/chat-runtime-owner-state.service';
import { ChatRuntimeOwnerSubmittedTurnLifecycleService } from './services/chat-runtime-owner-submitted-turn-lifecycle.service';
import { ChatRuntimeOwnerTurnStartupEditLifecycleService } from './services/chat-runtime-owner-turn-startup-edit-lifecycle.service';
import { ChatRuntimeOwnerViewAttachmentService } from './services/chat-runtime-owner-view-attachment.service';
import { ChatRuntimeOwnerViewRequestService } from './services/chat-runtime-owner-view-request.service';
import { ChatRuntimeOwnerWorkspaceEnvironmentService } from './services/chat-runtime-owner-workspace-environment.service';
import {
  CHAT_RUNTIME_OWNER_BINDING,
  CHAT_RUNTIME_OWNER_CONTEXT_BINDER,
  CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER,
  CHAT_RUNTIME_OWNER_ENDPOINT,
  CHAT_RUNTIME_OWNER_HEADLESS_PROJECTION,
  CHAT_RUNTIME_OWNER_HOST,
  CHAT_RUNTIME_OWNER_HOST_ADAPTER,
  CHAT_RUNTIME_OWNER_INTERACTION_HOST,
  CHAT_RUNTIME_OWNER_PROJECTION,
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  CHAT_RUNTIME_OWNER_SCHEDULER,
  CHAT_RUNTIME_OWNER_SAVE_BRIDGE,
  CHAT_RUNTIME_OWNER_SAVE_TARGET,
  CHAT_RUNTIME_OWNER_SESSION_CONTEXT,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  CHAT_RUNTIME_OWNER_SESSION_SAVE_BRIDGE_FACTORY,
  CHAT_RUNTIME_OWNER_STATE,
  CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE,
  CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT,
  CHAT_RUNTIME_OWNER_VIEW_REQUEST,
  CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT,
} from './services/chat-runtime-owner-ports';
import { ChatRuntimeViewMirrorProjectionService } from './services/chat-runtime-view-mirror-projection.service';
import { ChatRuntimeInteractionHostService } from './services/chat-runtime-interaction-host.service';
import { ChatPendingFollowupQueueService } from './services/chat-pending-followup-queue.service';
import { ChatSessionActionsService } from './services/chat-session-actions.service';
import { ChatSessionItemsService } from './services/chat-session-items.service';
import {
  CHAT_SESSION_LEX_POST_TURN_RESOURCE_FACTORY,
  ChatSessionLexPostTurnResourceFactoryService,
} from './services/chat-session-lex-post-turn-resource-factory.service';
import { ChatSessionModelStoreService } from './services/chat-session-model-store.service';
import { ChatSessionRuntimeRegistryService } from './services/chat-session-runtime-registry.service';
import {
  CHAT_SESSION_RUNTIME_MIRROR_WRITER,
  ChatSessionRuntimeStoreMirrorWriterService,
} from './services/chat-session-runtime-mirror-writer';
import { ChatSessionRuntimeStoreService } from './services/chat-session-runtime-store.service';
import { ChatSessionViewModelStoreService } from './services/chat-session-view-model-store.service';
import { ChatSessionsControlService } from './services/chat-sessions-control.service';
import { ChatSetupSuggestionService } from './services/chat-setup-suggestion.service';
import { ChatViewService } from './services/chat-view.service';
import { EditCheckpointService } from './services/edit-checkpoint.service';
import { GitWorkspaceCheckpointProviderService } from './services/git-workspace-checkpoint-provider.service';
import { MenuManagerService } from './services/menu-manager.service';
import { ResourceManagerService } from './services/resource-manager.service';
import { ScrollManagerService } from './services/scroll-manager.service';

// Background-session alignment: shared session/model stores must outlive the chat pane component.
export const AILY_CHAT_SHARED_PROVIDERS: Provider[] = [
  ScrollManagerService,
  ResourceManagerService,
  ChatSessionRuntimeStoreService,
  ChatSessionRuntimeStoreMirrorWriterService,
  { provide: CHAT_SESSION_RUNTIME_MIRROR_WRITER, useExisting: ChatSessionRuntimeStoreMirrorWriterService },
  ChatSessionModelStoreService,
  ChatRuntimeViewMirrorProjectionService,
  ChatPendingFollowupQueueService,
  ChatSessionViewModelStoreService,
  ChatSessionItemsService,
  ChatSessionActionsService,
  MenuManagerService,
  ChatSessionsControlService,
  ChatSetupSuggestionService,
  ChatViewService,
  EditCheckpointService,
  GitWorkspaceCheckpointProviderService,
  ChatRuntimeInteractionHostService,
];

// Visible Chat is a view/controller adapter and is route-scoped, not a root runtime owner.
export const AILY_CHAT_VIEW_PROVIDERS: Provider[] = [
  ChatEngineService,
];

// Runtime owner providers are installed only by the main-window host route.
export const AILY_CHAT_RUNTIME_OWNER_PROVIDERS: Provider[] = [
  ChatRuntimeOwnerService,
  ChatRuntimeOwnerHeadlessProjectionService,
  { provide: CHAT_RUNTIME_OWNER_HEADLESS_PROJECTION, useExisting: ChatRuntimeOwnerHeadlessProjectionService },
  ChatRuntimeOwnerStateService,
  { provide: CHAT_RUNTIME_OWNER_STATE, useExisting: ChatRuntimeOwnerStateService },
  ChatRuntimeOwnerViewAttachmentService,
  { provide: CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT, useExisting: ChatRuntimeOwnerViewAttachmentService },
  ChatRuntimeOwnerViewRequestService,
  { provide: CHAT_RUNTIME_OWNER_VIEW_REQUEST, useExisting: ChatRuntimeOwnerViewRequestService },
  ChatRuntimeOwnerWorkspaceEnvironmentService,
  { provide: CHAT_RUNTIME_OWNER_WORKSPACE_ENVIRONMENT, useExisting: ChatRuntimeOwnerWorkspaceEnvironmentService },
  ChatRuntimeOwnerBindingService,
  ChatRuntimeOwnerHostAdapterService,
  ChatRuntimeOwnerContextService,
  ChatRuntimeOwnerEndpointService,
  { provide: CHAT_RUNTIME_OWNER_BINDING, useExisting: ChatRuntimeOwnerBindingService },
  { provide: CHAT_RUNTIME_OWNER_CONTEXT_BINDER, useExisting: ChatRuntimeOwnerService },
  { provide: CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER, useExisting: ChatRuntimeOwnerContextService },
  { provide: CHAT_RUNTIME_OWNER_HOST, useExisting: ChatRuntimeOwnerService },
  { provide: CHAT_RUNTIME_OWNER_HOST_ADAPTER, useExisting: ChatRuntimeOwnerHostAdapterService },
  { provide: CHAT_RUNTIME_OWNER_ENDPOINT, useExisting: ChatRuntimeOwnerEndpointService },
  { provide: CHAT_RUNTIME_OWNER_INTERACTION_HOST, useExisting: ChatRuntimeInteractionHostService },
  ChatRuntimeOwnerProjectionService,
  { provide: CHAT_RUNTIME_OWNER_PROJECTION, useExisting: ChatRuntimeOwnerProjectionService },
  ChatRuntimeOwnerRuntimeControllerService,
  { provide: CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER, useExisting: ChatRuntimeOwnerRuntimeControllerService },
  ChatRuntimeOwnerRuntimeStateService,
  { provide: CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER, useExisting: ChatRuntimeOwnerRuntimeStateService },
  ChatRuntimeOwnerSaveBridgeService,
  { provide: CHAT_RUNTIME_OWNER_SAVE_BRIDGE, useExisting: ChatRuntimeOwnerSaveBridgeService },
  ChatRuntimeOwnerSessionSaveBridgeFactoryService,
  {
    provide: CHAT_RUNTIME_OWNER_SESSION_SAVE_BRIDGE_FACTORY,
    useExisting: ChatRuntimeOwnerSessionSaveBridgeFactoryService,
  },
  ChatRuntimeOwnerSaveTargetService,
  { provide: CHAT_RUNTIME_OWNER_SAVE_TARGET, useExisting: ChatRuntimeOwnerSaveTargetService },
  ChatRuntimeOwnerSchedulerService,
  { provide: CHAT_RUNTIME_OWNER_SCHEDULER, useExisting: ChatRuntimeOwnerSchedulerService },
  ChatRuntimeOwnerSessionContextService,
  { provide: CHAT_RUNTIME_OWNER_SESSION_CONTEXT, useExisting: ChatRuntimeOwnerSessionContextService },
  ChatRuntimeOwnerSessionModelService,
  { provide: CHAT_RUNTIME_OWNER_SESSION_MODEL, useExisting: ChatRuntimeOwnerSessionModelService },
  ChatRuntimeOwnerSubmittedTurnLifecycleService,
  { provide: CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE, useExisting: ChatRuntimeOwnerSubmittedTurnLifecycleService },
  ChatRuntimeOwnerTurnStartupEditLifecycleService,
  { provide: CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE, useExisting: ChatRuntimeOwnerTurnStartupEditLifecycleService },
  ChatSessionLexPostTurnResourceFactoryService,
  { provide: CHAT_SESSION_LEX_POST_TURN_RESOURCE_FACTORY, useExisting: ChatSessionLexPostTurnResourceFactoryService },
  ChatSessionRuntimeRegistryService,
  ChatRuntimeHostBootstrapService,
];
