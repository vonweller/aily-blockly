import { Injectable, inject } from '@angular/core';

import type { LexOwnerContext } from '../helpers/lex-stream.helper';
import { AilyChatConfigService } from './aily-chat-config.service';
import { ChatService } from './chat.service';
import { ContextBudgetService } from './context-budget.service';
import { EditCheckpointService } from './edit-checkpoint.service';
import { McpService } from './mcp.service';
import { RepetitionDetectionService } from './repetition-detection.service';
import { UserInteractionHelper } from '../helpers/user-interaction.helper';
import {
  ChatRuntimeOwnerContextCore,
  createChatRuntimeOwnerContext,
  normalizeRuntimeOwnerSessionId,
  resolveRuntimeOwnerDefaultSessionId,
  type ChatRuntimeOwnerContextAdapter,
} from './chat-runtime-owner-context-core';
import {
  CHAT_RUNTIME_OWNER_HEADLESS_PROJECTION,
  type ChatRuntimeOwnerHeadlessProjectionPort,
  CHAT_RUNTIME_OWNER_INTERACTION_HOST,
  type ChatRuntimeOwnerInteractionHostPort,
  CHAT_RUNTIME_OWNER_PROJECTION,
  type ChatRuntimeOwnerProjectionPort,
  CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER,
  type ChatRuntimeOwnerContextMaterializerPort,
  type ChatRuntimeOwnerRuntimeControllerPort,
  CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  type ChatRuntimeOwnerRuntimeStateReaderPort,
  CHAT_RUNTIME_OWNER_SCHEDULER,
  type ChatRuntimeOwnerSchedulerPort,
  CHAT_RUNTIME_OWNER_SAVE_TARGET,
  type ChatRuntimeOwnerSaveTargetPort,
  CHAT_RUNTIME_OWNER_SESSION_CONTEXT,
  type ChatRuntimeOwnerSessionContextPort,
  CHAT_RUNTIME_OWNER_SESSION_MODEL,
  type ChatRuntimeOwnerSessionModelPort,
  CHAT_RUNTIME_OWNER_STATE,
  type ChatRuntimeOwnerStatePort,
  CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  type ChatRuntimeOwnerTurnStartupEditLifecyclePort,
  CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT,
  type ChatRuntimeOwnerViewAttachmentPort,
  CHAT_RUNTIME_OWNER_VIEW_REQUEST,
  type ChatRuntimeOwnerViewRequestPort,
} from './chat-runtime-owner-ports';

export type { ChatRuntimeOwnerContextAdapter } from './chat-runtime-owner-context-core';

@Injectable()
export class ChatRuntimeOwnerContextService implements ChatRuntimeOwnerContextMaterializerPort {
  private readonly chatService = inject(ChatService);
  private readonly ailyChatConfigService = inject(AilyChatConfigService);
  private readonly mcpService = inject(McpService);
  private readonly runtimeInteractionHost = inject<ChatRuntimeOwnerInteractionHostPort>(
    CHAT_RUNTIME_OWNER_INTERACTION_HOST,
  );
  private readonly editCheckpointService = inject(EditCheckpointService);
  private readonly ownerScheduler = inject<ChatRuntimeOwnerSchedulerPort>(CHAT_RUNTIME_OWNER_SCHEDULER);
  private readonly contextBudgetService = inject(ContextBudgetService);
  private readonly repetitionDetectionService = inject(RepetitionDetectionService);
  private readonly runtimeState = inject<ChatRuntimeOwnerRuntimeStateReaderPort>(
    CHAT_RUNTIME_OWNER_RUNTIME_STATE_READER,
  );
  private readonly runtimeController = inject<ChatRuntimeOwnerRuntimeControllerPort>(CHAT_RUNTIME_OWNER_RUNTIME_CONTROLLER);
  private readonly headlessProjection = inject<ChatRuntimeOwnerHeadlessProjectionPort>(CHAT_RUNTIME_OWNER_HEADLESS_PROJECTION);
  private readonly ownerState = inject<ChatRuntimeOwnerStatePort>(CHAT_RUNTIME_OWNER_STATE);
  private readonly viewAttachments = inject<ChatRuntimeOwnerViewAttachmentPort>(CHAT_RUNTIME_OWNER_VIEW_ATTACHMENT);
  private readonly viewRequests = inject<ChatRuntimeOwnerViewRequestPort>(CHAT_RUNTIME_OWNER_VIEW_REQUEST);
  private readonly ownerSessionModel = inject<ChatRuntimeOwnerSessionModelPort>(CHAT_RUNTIME_OWNER_SESSION_MODEL);
  private readonly ownerProjection = inject<ChatRuntimeOwnerProjectionPort>(CHAT_RUNTIME_OWNER_PROJECTION);
  private readonly ownerSaveTarget = inject<ChatRuntimeOwnerSaveTargetPort>(CHAT_RUNTIME_OWNER_SAVE_TARGET);
  private readonly ownerSessionContext = inject<ChatRuntimeOwnerSessionContextPort>(CHAT_RUNTIME_OWNER_SESSION_CONTEXT);
  private readonly turnStartupEditLifecycle = inject<ChatRuntimeOwnerTurnStartupEditLifecyclePort>(
    CHAT_RUNTIME_OWNER_TURN_STARTUP_EDIT_LIFECYCLE,
  );
  private readonly contextCore = new ChatRuntimeOwnerContextCore();
  private ownerInteraction: UserInteractionHelper | null = null;

  bindAdapter(adapter: ChatRuntimeOwnerContextAdapter): LexOwnerContext {
    return this.contextCore.bindAdapter(adapter, boundAdapter => this.createContext(boundAdapter));
  }

  private createContext(adapter: ChatRuntimeOwnerContextAdapter): LexOwnerContext {
    const service = this;

    return createChatRuntimeOwnerContext(
      adapter,
      {
        get prjPath() { return service.ownerSessionContext.prjPath; },
        get prjRootPath() { return service.ownerSessionContext.prjRootPath; },
        get currentModel() { return service.ownerSessionContext.currentModel; },
        get currentAgentRuntimeMode() { return service.ownerSessionContext.currentAgentRuntimeMode; },
        get currentAgentRuntimeModeSource() { return service.ownerSessionContext.currentAgentRuntimeModeSource; },
        selectAgentRuntimeMode: (mode, source, reason, sessionId) =>
          service.ownerSessionContext.selectAgentRuntimeMode(mode, source, reason, sessionId),
        get sessionTitle() { return service.ownerSessionContext.sessionTitle; },
        get chatService() { return service.chatService; },
        currentSessionPath: sessionId => service.ownerSessionContext.currentSessionPath(sessionId),
        currentSessionPermissionMode: sessionId => service.ownerSessionContext.currentSessionPermissionMode(sessionId),
        currentSessionApprovalsReviewer: sessionId => service.ownerSessionContext.currentSessionApprovalsReviewer(sessionId),
        currentSessionApprovalPolicy: sessionId => service.ownerSessionContext.currentSessionApprovalPolicy(sessionId),
        get ailyChatConfigService() { return service.ailyChatConfigService; },
        get mcpService() { return service.mcpService; },
        buildExecutionSaveTarget: sessionId => service.ownerSaveTarget.buildExecutionSaveTarget(sessionId),
        resolveActiveRuntimeSessionId: defaultSessionId => service.ownerState.resolveActiveRuntimeSessionId(defaultSessionId),
        runWithRuntimeSessionOwner: (sessionId, action) => service.ownerState.runWithRuntimeSessionOwner(sessionId, action),
        get runtimeInteractionHost() { return service.runtimeInteractionHost; },
        handleToolApproval: request => service.resolveOwnerInteraction(adapter).handleToolApproval(request as never),
        get editCheckpointService() { return service.editCheckpointService; },
        get ownerScheduler() { return service.ownerScheduler; },
        get viewRequests() { return service.viewRequests; },
        get list() { return service.headlessProjection.list; },
        setList: value => service.headlessProjection.setList(value as never),
        get partStore() { return service.headlessProjection.partStore; },
        get viewAdapter() { return service.headlessProjection.viewAdapter; },
        get scrollManager() { return service.headlessProjection.scrollManager; },
        invalidateHostRequestGraph: () => service.headlessProjection.invalidateHostRequestGraph(),
        triggerSyncDetectChanges: () => service.headlessProjection.triggerSyncDetectChanges(),
        get currentMessageSource() { return service.ownerState.currentMessageSource; },
        setCurrentMessageSource: value => { service.ownerState.currentMessageSource = value as never; },
        get toolCallingIteration() { return service.ownerState.toolCallingIteration; },
        setToolCallingIteration: value => { service.ownerState.toolCallingIteration = value as never; },
        get contextBudgetService() { return service.contextBudgetService; },
        get isWaiting() { return service.ownerState.isWaiting; },
        setIsWaiting: value => { service.ownerState.isWaiting = value as never; },
        get isCompleted() { return service.ownerState.isCompleted; },
        setIsCompleted: value => { service.ownerState.isCompleted = value as never; },
        readSessionRuntimeState: sessionId => service.runtimeState.readSessionRuntimeState(sessionId),
        readSessionTurnResponses: sessionId => service.ownerSessionModel.readTurnResponses(sessionId),
        appendSessionModelTurnResponse: (sessionId, turnResponse, ownerPolicy) =>
          service.ownerSessionModel.appendOrReplaceTurnResponse(sessionId, turnResponse as never, ownerPolicy as never),
        syncRuntimeHostSubmitReadiness: sessionId => service.syncRuntimeHostSubmitReadiness(sessionId),
        syncRuntimeAgentEntryReady: (sessionId, disposeSession) =>
          service.syncRuntimeAgentEntryReady(sessionId, disposeSession),
        releaseRuntimeHandle: sessionId => service.releaseRuntimeHandle(sessionId),
        setRuntimeAbortController: (sessionId, controller) =>
          service.setRuntimeAbortController(sessionId, controller),
        getOrCreateLexPostTurnResources: (sessionId, cwd) =>
          service.getOrCreateLexPostTurnResources(sessionId, cwd),
        scheduleLexRequestCompleted: input => service.runtimeController.scheduleLexRequestCompleted(input as never),
        isRuntimeViewAttached: sessionId => service.viewAttachments.hasAttachedView(sessionId),
        readRuntimeViewAttachmentGeneration: sessionId => service.viewAttachments.readVisibleAttachmentGeneration(sessionId),
        isRuntimeViewAttachmentCurrent: (sessionId, generation) =>
          service.viewAttachments.isVisibleAttachmentCurrent(sessionId, generation as never),
        syncExecutionRuntimeState: saveTarget =>
          service.ownerProjection.projectExecutionRuntimeState({ saveTarget: saveTarget as never }),
        syncExecutionRuntimeTurnResponses: (sessionId, turnResponses, options) => {
          const handleMetadata = service.runtimeState.readHandleMetadata(sessionId);
          service.ownerProjection.syncTurnResponses({
            sessionId,
            turnResponses: turnResponses as never,
            hostProjectionState: service.ownerProjection.buildHostProjectionState(turnResponses as never),
            capabilities: handleMetadata.capabilities,
            concurrencyScope: handleMetadata.concurrencyScope,
            projection: options as never,
          });
        },
        get repetitionDetectionService() { return service.repetitionDetectionService; },
        get turnStartupEditLifecycle() { return service.turnStartupEditLifecycle; },
        get isCancelled() { return service.ownerState.isCancelled; },
        setIsCancelled: value => { service.ownerState.isCancelled = value as never; },
        get activeToolExecutions() { return service.ownerState.activeToolExecutions; },
        setActiveToolExecutions: value => { service.ownerState.activeToolExecutions = value as never; },
        get currentStatelessMode() { return service.ownerState.currentStatelessMode; },
        setCurrentStatelessMode: value => { service.ownerState.currentStatelessMode = value as never; },
      },
      () => service.resolveDefaultRuntimeSessionId(adapter),
    );
  }

  private resolveDefaultRuntimeSessionId(adapter: ChatRuntimeOwnerContextAdapter): string {
    return resolveRuntimeOwnerDefaultSessionId(adapter, this.chatService.currentSessionId);
  }

  private normalizeSessionId(sessionId: unknown): string {
    return normalizeRuntimeOwnerSessionId(sessionId);
  }

  private syncRuntimeHostSubmitReadiness(sessionId: unknown): void {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      return;
    }

    this.ownerProjection.syncHandleState({
      sessionId: targetSessionId,
      patch: {
        capabilities: this.ownerSessionContext.resolveRuntimeCapabilities(targetSessionId),
        concurrencyScope: this.ownerSessionContext.resolveRuntimeConcurrencyScope(targetSessionId) ?? null,
      },
    });
  }

  private syncRuntimeAgentEntryReady(sessionId: unknown, disposeSession: () => void): void {
    const targetSessionId = this.normalizeSessionId(sessionId);
    if (!targetSessionId) {
      return;
    }

    this.runtimeController.syncAgentEntryReady({
      sessionId: targetSessionId,
      disposeSession,
    });
  }

  private releaseRuntimeHandle(sessionId: unknown): boolean {
    const targetSessionId = this.normalizeSessionId(sessionId);
    return targetSessionId ? this.runtimeController.releaseRuntimeHandle(targetSessionId) : false;
  }

  private setRuntimeAbortController(sessionId: unknown, controller: AbortController | null): boolean {
    const targetSessionId = this.normalizeSessionId(sessionId);
    return targetSessionId
      ? this.runtimeController.setRuntimeAbortController(targetSessionId, controller)
      : false;
  }

  private getOrCreateLexPostTurnResources(sessionId: unknown, cwd: unknown) {
    const targetSessionId = this.normalizeSessionId(sessionId);
    return targetSessionId
      ? this.runtimeController.getOrCreateLexPostTurnResources(
        targetSessionId,
        typeof cwd === 'string' ? cwd : null,
      )
      : undefined;
  }

  private resolveOwnerInteraction(adapter: ChatRuntimeOwnerContextAdapter): UserInteractionHelper {
    if (this.ownerInteraction) {
      return this.ownerInteraction;
    }

    const service = this;
    this.ownerInteraction = new UserInteractionHelper({
      get lexStream() { return adapter.lexStream; },
      get isLoggedIn() { return false; },
      getCurrentProjectPath: () => service.normalizeSessionId(service.ownerSessionContext.prjPath),
      get sessionId() { return adapter.sessionId; },
      resolveActiveRuntimeSessionId: () => service.ownerState.resolveActiveRuntimeSessionId(
        service.resolveDefaultRuntimeSessionId(adapter),
      ),
      get runtimeInteractionHost() { return service.runtimeInteractionHost; },
      get ailyChatConfigService() { return service.ailyChatConfigService; },
    });
    return this.ownerInteraction;
  }

}
