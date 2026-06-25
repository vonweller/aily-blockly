import type { Provider } from '@angular/core';

import { ChatEngineService } from './services/chat-engine.service';
import { ChatRuntimeHostBootstrapService } from './services/chat-runtime-host-bootstrap.service';
import { ChatRuntimeOwnerContextService } from './services/chat-runtime-owner-context.service';
import { ChatRuntimeOwnerEndpointService } from './services/chat-runtime-owner-endpoint.service';
import { ChatRuntimeOwnerHostAdapterService } from './services/chat-runtime-owner-host-adapter.service';
import { ChatRuntimeOwnerRuntimeControllerService } from './services/chat-runtime-owner-runtime-controller.service';
import { ChatRuntimeOwnerSaveBridgeService } from './services/chat-runtime-owner-save-bridge.service';
import { ChatRuntimeOwnerSaveTargetService } from './services/chat-runtime-owner-save-target.service';
import { ChatRuntimeOwnerSchedulerService } from './services/chat-runtime-owner-scheduler.service';
import { ChatRuntimeOwnerSessionContextService } from './services/chat-runtime-owner-session-context.service';
import { ChatRuntimeOwnerSessionModelService } from './services/chat-runtime-owner-session-model.service';
import { ChatRuntimeOwnerService } from './services/chat-runtime-owner.service';
import { ChatRuntimeOwnerStateService } from './services/chat-runtime-owner-state.service';
import { ChatRuntimeOwnerSubmittedTurnLifecycleService } from './services/chat-runtime-owner-submitted-turn-lifecycle.service';
import { ChatRuntimeOwnerSubmittedTurnTitleService } from './services/chat-runtime-owner-submitted-turn-title.service';
import { ChatRuntimeOwnerToolApprovalPolicyService } from './services/chat-runtime-owner-tool-approval-policy.service';
import { ChatRuntimeOwnerToolApprovalService } from './services/chat-runtime-owner-tool-approval.service';
import { ChatRuntimeOwnerTurnStartupEditLifecycleService } from './services/chat-runtime-owner-turn-startup-edit-lifecycle.service';
import { ChatRuntimeOwnerWorkspaceEditLifecycleResourceService } from './services/chat-runtime-owner-workspace-edit-lifecycle-resource.service';
import {
  CHAT_RUNTIME_OWNER_CONTEXT_BINDER,
  CHAT_RUNTIME_OWNER_CONTEXT_BUDGET,
  type ChatRuntimeOwnerContextBudgetPort,
  CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER,
  CHAT_RUNTIME_OWNER_EDIT_CHECKPOINT,
  type ChatRuntimeOwnerEditCheckpointPort,
  CHAT_RUNTIME_OWNER_ENDPOINT,
  CHAT_RUNTIME_OWNER_HOST,
  CHAT_RUNTIME_OWNER_HOST_ADAPTER,
  CHAT_RUNTIME_OWNER_INTERACTION_HOST,
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  CHAT_RUNTIME_OWNER_SCHEDULER,
  CHAT_RUNTIME_OWNER_SAVE_BRIDGE,
  CHAT_RUNTIME_OWNER_SAVE_TARGET,
  CHAT_RUNTIME_OWNER_SESSION_CONTEXT,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  CHAT_RUNTIME_OWNER_STATE,
  CHAT_RUNTIME_OWNER_SUBMITTED_TURN_LIFECYCLE,
  CHAT_RUNTIME_OWNER_SUBMITTED_TURN_TITLE,
  CHAT_RUNTIME_OWNER_TOOL_APPROVAL,
  CHAT_RUNTIME_OWNER_TOOL_APPROVAL_POLICY,
  CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  CHAT_RUNTIME_OWNER_WORKSPACE_EDIT_LIFECYCLE_RESOURCE,
} from './services/chat-runtime-owner-ports';
import {
  CHAT_RUNTIME_OWNER_RUNTIME_REGISTRY,
} from './services/chat-runtime-owner-runtime-registry';
import { ChatRuntimeViewMirrorProjectionService } from './services/chat-runtime-view-mirror-projection.service';
import { ChatRuntimeInteractionHostService } from './services/chat-runtime-interaction-host.service';
import { ChatRuntimeHostInventoryService } from './services/chat-runtime-host-inventory.service';
import { ChatRuntimeHostResourceOperationHandlerService } from './services/chat-runtime-host-resource-operation-handler.service';
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
import { ContextBudgetService } from './services/context-budget.service';
import { EditCheckpointService } from './services/edit-checkpoint.service';
import { GitWorkspaceCheckpointProviderService } from './services/git-workspace-checkpoint-provider.service';
import { MenuManagerService } from './services/menu-manager.service';
import { ResourceManagerService } from './services/resource-manager.service';
import { ScrollManagerService } from './services/scroll-manager.service';

function createRuntimeOwnerContextBudgetPort(
  service: ContextBudgetService,
): ChatRuntimeOwnerContextBudgetPort {
  return {
    getSnapshot: () => service.getSnapshot(),
    get budget$() { return service.budget$; },
    get maxContextTokens() { return service.maxContextTokens; },
    get compressionThreshold() { return service.compressionThreshold; },
    get summarizationThreshold() { return service.summarizationThreshold; },
    updateModelContextSize: model => service.updateModelContextSize(model),
    refreshLocalEstimate: (messages, tools) => service.refreshLocalEstimate(messages, tools),
    applyLexBudgetEvent: (maxTokens, usedTokens, extra) =>
      service.applyLexBudgetEvent(maxTokens, usedTokens, extra),
    reset: () => service.reset(),
  };
}

function createRuntimeOwnerEditCheckpointPort(
  service: EditCheckpointService,
): ChatRuntimeOwnerEditCheckpointPort {
  return {
    get autoSaveEdits() { return service.autoSaveEdits; },
    set autoSaveEdits(value) { service.autoSaveEdits = value; },
    get canUndo() { return service.canUndo; },
    get canRedo() { return service.canRedo; },
    setFileHistory: fileHistory => service.setFileHistory(fileHistory as never),
    setTimelineContext: (sessionId, workspaceRoot) => service.setTimelineContext(sessionId, workspaceRoot),
    startTurn: (
      turnIndex,
      turnStartListIndex,
      responseStartListIndex,
      turnId,
      requestContent,
      displayContent,
      checkpointId,
      requestMetadata,
    ) => service.startTurn(
      turnIndex,
      turnStartListIndex,
      responseStartListIndex,
      turnId,
      requestContent,
      displayContent,
      checkpointId,
      requestMetadata as never,
    ),
    recordAdditionalRepositoryRootCandidates: paths => service.recordAdditionalRepositoryRootCandidates(paths),
    recordEdit: (filePath, type) => service.recordEdit(filePath, type),
    publishCurrentSummary: () => service.publishCurrentSummary(),
    commitCurrentTurn: () => service.commitCurrentTurn(),
    hasEditsInCurrentTurn: () => service.hasEditsInCurrentTurn(),
    getEditsSummary: checkpointId => service.getEditsSummary(checkpointId ?? undefined),
    requestDiffPreview: summary => service.requestDiffPreview(summary as never),
    acceptAllAsBaseline: () => service.acceptAllAsBaseline(),
    dismissSummary: () => service.dismissSummary(),
    publishSummary: summary => service.publishSummary(summary as never),
    getSnapshotByRoundId: roundId => service.getSnapshotByRoundId(roundId),
    getSnapshotByTurnId: turnId => service.getSnapshotByTurnId(turnId),
    isSnapshotActive: snapshot => service.isSnapshotActive(snapshot as never),
    getTurnContextForSnapshot: (snapshot, fallbackTurnId) =>
      service.getTurnContextForSnapshot(snapshot as never, fallbackTurnId),
    getTurnStartListIndexForSnapshot: snapshot =>
      service.getTurnStartListIndexForSnapshot(snapshot as never),
    getResponseStartListIndexForSnapshot: snapshot =>
      service.getResponseStartListIndexForSnapshot(snapshot as never),
    rebuildFromTurnResponses: turnResponses => service.rebuildFromTurnResponses(turnResponses),
    undo: () => service.undo(),
    redo: () => service.redo(),
    acceptFile: filePath => service.acceptFile(filePath),
    rejectFile: filePath => service.rejectFile(filePath),
    getLatestSnapshot: () => service.getLatestSnapshot(),
    restoreRebuildState: snapshot => service.restoreRebuildState(snapshot as never),
    restorePublishedSummary: summary => service.restorePublishedSummary(summary as never),
    applyRebuildStateWithSummary: (snapshot, summary) =>
      service.applyRebuildStateWithSummary(snapshot as never, summary as never),
    applyRebuildState: snapshot => service.applyRebuildState(snapshot as never),
    truncateStateFromCheckpoint: checkpointId => service.truncateStateFromCheckpoint(checkpointId),
    captureRebuildState: () => service.captureRebuildState(),
    capturePublishedSummary: () => service.capturePublishedSummary(),
    buildRebuildStateFromTurnResponses: turnResponses =>
      service.buildRebuildStateFromTurnResponses(turnResponses),
    buildPublishedSummaryForRebuildState: snapshot =>
      service.buildPublishedSummaryForRebuildState(snapshot as never),
    getRequestCheckpointMetadataByCheckpointId: checkpointId =>
      service.getRequestCheckpointMetadataByCheckpointId(checkpointId),
    forkRequestCheckpointMetadata: input => service.forkRequestCheckpointMetadata(input),
    setWorkspaceCheckpointProvider: provider => service.setWorkspaceCheckpointProvider(provider as never),
    waitForCheckpointMetadataSettled: () => service.waitForCheckpointMetadataSettled(),
    getInitialContent: filePath => service.getInitialContent(filePath),
    getTotalEditCount: () => service.getTotalEditCount(),
    getRequestEditsSummarySync: turnId => service.getRequestEditsSummarySync(turnId),
    clear: () => service.clear(),
  };
}

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
  ChatRuntimeHostInventoryService,
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
  ChatRuntimeHostResourceOperationHandlerService,
];

// Runtime owner providers are installed only by the host-created hidden execution-worker route.
export const AILY_CHAT_RUNTIME_OWNER_PROVIDERS: Provider[] = [
  ChatRuntimeOwnerService,
  ChatRuntimeOwnerStateService,
  { provide: CHAT_RUNTIME_OWNER_STATE, useExisting: ChatRuntimeOwnerStateService },
  ChatRuntimeOwnerWorkspaceEditLifecycleResourceService,
  {
    provide: CHAT_RUNTIME_OWNER_WORKSPACE_EDIT_LIFECYCLE_RESOURCE,
    useExisting: ChatRuntimeOwnerWorkspaceEditLifecycleResourceService,
  },
  ChatRuntimeOwnerHostAdapterService,
  ChatRuntimeOwnerContextService,
  ChatRuntimeOwnerEndpointService,
  {
    provide: CHAT_RUNTIME_OWNER_CONTEXT_BUDGET,
    deps: [ContextBudgetService],
    useFactory: createRuntimeOwnerContextBudgetPort,
  },
  {
    provide: CHAT_RUNTIME_OWNER_EDIT_CHECKPOINT,
    deps: [EditCheckpointService],
    useFactory: createRuntimeOwnerEditCheckpointPort,
  },
  { provide: CHAT_RUNTIME_OWNER_CONTEXT_BINDER, useExisting: ChatRuntimeOwnerService },
  { provide: CHAT_RUNTIME_OWNER_CONTEXT_MATERIALIZER, useExisting: ChatRuntimeOwnerContextService },
  { provide: CHAT_RUNTIME_OWNER_HOST, useExisting: ChatRuntimeOwnerService },
  { provide: CHAT_RUNTIME_OWNER_HOST_ADAPTER, useExisting: ChatRuntimeOwnerHostAdapterService },
  { provide: CHAT_RUNTIME_OWNER_ENDPOINT, useExisting: ChatRuntimeOwnerEndpointService },
  { provide: CHAT_RUNTIME_OWNER_INTERACTION_HOST, useExisting: ChatRuntimeInteractionHostService },
  ChatRuntimeOwnerRuntimeControllerService,
  { provide: CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER, useExisting: ChatRuntimeOwnerRuntimeControllerService },
  ChatRuntimeOwnerSaveBridgeService,
  { provide: CHAT_RUNTIME_OWNER_SAVE_BRIDGE, useExisting: ChatRuntimeOwnerSaveBridgeService },
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
  ChatRuntimeOwnerSubmittedTurnTitleService,
  { provide: CHAT_RUNTIME_OWNER_SUBMITTED_TURN_TITLE, useExisting: ChatRuntimeOwnerSubmittedTurnTitleService },
  ChatRuntimeOwnerToolApprovalPolicyService,
  { provide: CHAT_RUNTIME_OWNER_TOOL_APPROVAL_POLICY, useExisting: ChatRuntimeOwnerToolApprovalPolicyService },
  ChatRuntimeOwnerToolApprovalService,
  { provide: CHAT_RUNTIME_OWNER_TOOL_APPROVAL, useExisting: ChatRuntimeOwnerToolApprovalService },
  ChatRuntimeOwnerTurnStartupEditLifecycleService,
  { provide: CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE, useExisting: ChatRuntimeOwnerTurnStartupEditLifecycleService },
  ChatSessionLexPostTurnResourceFactoryService,
  { provide: CHAT_SESSION_LEX_POST_TURN_RESOURCE_FACTORY, useExisting: ChatSessionLexPostTurnResourceFactoryService },
  ChatSessionRuntimeRegistryService,
  { provide: CHAT_RUNTIME_OWNER_RUNTIME_REGISTRY, useExisting: ChatSessionRuntimeRegistryService },
  ChatRuntimeHostBootstrapService,
];
