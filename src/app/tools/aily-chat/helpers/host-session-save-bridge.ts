import type {
  IAgentLifecycle,
  IChatCoordination,
  IChatServiceAccess,
  IProjectContext,
  ISessionAccess,
  IChatViewAccess,
} from '../core/chat-context';
import type { TurnResponseCommand, TurnResponseFollowup, TurnResponseTurn } from 'aily-lex/browser';
import type {
  LiveHostSessionRecord,
  PersistedHostResponseData,
  PersistedHostTurnResponse,
} from '../services/chat-history.service';
import { AilyHost } from '../core/host';
import {
  type HostRequestModel,
  type HostResponseProjection,
  type HostTurnResponseState,
  hasHostResponseConversationContent,
} from './host-turn-response-state';
import { createChatMessageHandle } from './chat-message-handle';

function cloneTurnResponseModelSidecar(
  responseModel: TurnResponseTurn['responseModel'] | undefined,
): TurnResponseTurn['responseModel'] | undefined {
  if (!responseModel) {
    return undefined;
  }

  const modelName = typeof responseModel.modelName === 'string' && responseModel.modelName.trim()
    ? responseModel.modelName.trim()
    : undefined;
  const modelBillingLabel = typeof responseModel.modelBillingLabel === 'string' && responseModel.modelBillingLabel.trim()
    ? responseModel.modelBillingLabel.trim()
    : undefined;

  if (!responseModel.slashCommand && !responseModel.followups && !modelName && !modelBillingLabel) {
    return undefined;
  }

  return {
    ...(responseModel.slashCommand ? { slashCommand: { ...responseModel.slashCommand } } : {}),
    ...(responseModel.followups ? { followups: responseModel.followups.map((followup: TurnResponseFollowup) => ({ ...followup })) } : {}),
    ...(modelName ? { modelName } : {}),
    ...(modelBillingLabel ? { modelBillingLabel } : {}),
  };
}

type HostSessionSaveContext = Pick<IAgentLifecycle, 'toolCallingIteration'>
  & Pick<IProjectContext, 'currentMode' | 'currentModel'>
  & Pick<ISessionAccess, 'sessionId' | 'sessionTitle' | 'chatService' | 'chatHistoryService'>
  & Pick<IChatServiceAccess, 'contextBudgetService' | 'editCheckpointService'>
  & Pick<IChatCoordination, 'lexStream'>
  & Pick<IChatViewAccess, 'list' | 'partStore'>
  & {
    readonly hostRequestModel?: HostRequestModel | null;
    readonly hostResponseProjection?: HostResponseProjection | null;
    invalidateHostRequestGraph?(): void;
  };

/**
 * Host-side save bridge for session lifecycle.
 *
 * Keeps host record building and save flow out of SessionLifecycleHelper.
 */
export class HostSessionSaveBridge {
  constructor(private readonly ctx: HostSessionSaveContext) {}

  buildHostSessionRecord(previousHostProjection?: HostResponseProjection | null): LiveHostSessionRecord | null {
    if (!this.ctx.sessionId) {
      return null;
    }

    const projectPath = this.resolveProjectPath();
    const budgetSnapshot = this.ctx.contextBudgetService?.getSnapshot();
    const currentHostProjection = this.ctx.hostResponseProjection ?? null;
    const turnResponses = resolveTurnResponsesForSave(
      this.ctx.lexStream.turnResponses,
      currentHostProjection,
      previousHostProjection ?? null,
    );
    if (!hasHostResponseConversationContent(currentHostProjection ?? previousHostProjection ?? null) && turnResponses.length === 0) {
      return null;
    }

    const visibleChatList = buildVisibleChatListForSave(
      previousHostProjection?.chatList ?? [],
      currentHostProjection?.chatList ?? [],
      this.ctx.list,
      this.ctx.partStore,
    );
    const canonicalTurnResponses = applyVisibleRequestDisplayContentToTurnResponses(
      visibleChatList,
      turnResponses,
    );
    const persistedTurnResponses = persistResponseDataOnTurnResponses(
      canonicalTurnResponses,
      currentHostProjection,
      previousHostProjection ?? null,
      this.ctx.hostRequestModel ?? null,
    );
    const record: LiveHostSessionRecord = {
      sessionId: this.ctx.sessionId,
      turnResponses: persistedTurnResponses,
      metadata: {
        sessionId: this.ctx.sessionId,
        title: this.ctx.sessionTitle || '',
        projectPath,
        mode: this.ctx.currentMode,
        model: this.ctx.currentModel?.model || null,
        contextBudget: budgetSnapshot ? {
          currentTokens: budgetSnapshot.currentTokens,
          maxContextTokens: budgetSnapshot.maxContextTokens,
          usagePercent: budgetSnapshot.usagePercent,
          systemTokens: budgetSnapshot.systemTokens,
          baseSystemTokens: budgetSnapshot.baseSystemTokens,
          instructionTokens: budgetSnapshot.instructionTokens,
          skillTokens: budgetSnapshot.skillTokens,
          toolsTokens: budgetSnapshot.toolsTokens,
          toolSourceTokens: budgetSnapshot.toolSourceTokens,
          messagesTokens: budgetSnapshot.messagesTokens,
          toolResultsTokens: budgetSnapshot.toolResultsTokens,
          messageCount: budgetSnapshot.messageCount,
        } : undefined,
        toolCallingIteration: this.ctx.toolCallingIteration || 0,
      },
    };

    return record;
  }

  saveCurrentSession(): boolean {
    try {
      if (this.ctx.editCheckpointService?.getTotalEditCount() > 0) {
        try {
          this.ctx.editCheckpointService.commitCurrentTurn();
        } catch (error) {
          console.warn('[SessionLifecycle] checkpoint commit failed:', error);
        }
      }

      this.ctx.lexStream.session.save();
      const previousHostProjection = this.ctx.hostResponseProjection ?? null;
      this.ctx.invalidateHostRequestGraph?.();
      const record = this.buildHostSessionRecord(previousHostProjection);
      if (!record) {
        return false;
      }

      this.ctx.chatHistoryService.saveHostRecord(record);
      return true;
    } catch (error) {
      console.warn('保存会话失败:', error);
      return false;
    }
  }

  private resolveProjectPath(): string | null {
    const currentPath = AilyHost.get().project.currentProjectPath;
    const rootPath = AilyHost.get().project.projectRootPath;
    const cachedPath = this.ctx.chatService.currentSessionPath;

    if (cachedPath && !this.isSameAsRoot(cachedPath, rootPath)) {
      return cachedPath;
    }
    if (currentPath && !this.isSameAsRoot(currentPath, rootPath)) {
      return currentPath;
    }
    return null;
  }

  private isSameAsRoot(path: string | null, rootPath: string | null): boolean {
    if (!path || !rootPath) {
      return false;
    }
    return this.normalizePath(path) === this.normalizePath(rootPath);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }
}

function applyVisibleRequestDisplayContentToTurnResponses(
  visibleChatList: readonly HostSessionSaveContext['list'][number][],
  turnResponses: readonly TurnResponseTurn[],
) : TurnResponseTurn[] {
  if (visibleChatList.length === 0 || turnResponses.length === 0) {
    return [...turnResponses];
  }

  const visibleContentByTurnId = new Map<string, string>();
  for (const message of visibleChatList) {
    if (message.role !== 'user' || typeof message.turnId !== 'string' || message.content.length === 0) {
      continue;
    }

    visibleContentByTurnId.set(message.turnId, message.content);
  }

  if (visibleContentByTurnId.size === 0) {
    return [...turnResponses];
  }

  return turnResponses.map((turn) => {
    const visibleDisplayContent = visibleContentByTurnId.get(turn.turnId);
    if (!visibleDisplayContent) {
      return turn;
    }

    if (typeof turn.request.displayContent === 'string' && turn.request.displayContent.length > 0) {
      return turn;
    }

    if (visibleDisplayContent === turn.request.content) {
      return turn;
    }

    return {
      ...turn,
      request: {
        ...turn.request,
        displayContent: visibleDisplayContent,
      },
    };
  });
}

function buildVisibleChatListForSave(
  previousProjectedChatList: HostResponseProjection['chatList'],
  currentProjectedChatList: HostResponseProjection['chatList'],
  liveChatList: HostSessionSaveContext['list'] | undefined,
  partStore: HostSessionSaveContext['partStore'] | undefined,
): HostSessionSaveContext['list'] {
  const projectedChatList = mergeProjectedChatListsForSave(
    previousProjectedChatList,
    currentProjectedChatList,
  );

  if (!liveChatList?.length) {
    return projectedChatList.map(message => ({ ...message })) as HostSessionSaveContext['list'];
  }

  const serializedLiveChatList = liveChatList.map((message, msgIndex) => {
    const handle = createChatMessageHandle(message, msgIndex);
    const content = partStore?.hasPartsForHandle(handle)
      ? (partStore.serializeToContentHandle(handle) || message.content)
      : message.content;

    return {
      ...message,
      content,
    };
  }) as HostSessionSaveContext['list'];

  if (projectedChatList.length === 0) {
    return serializedLiveChatList;
  }

  const consumedLiveIndexes = new Set<number>();
  const mergedChatList = projectedChatList.map((projectedMessage) => {
    const matchedLiveIndex = serializedLiveChatList.findIndex((liveMessage, liveIndex) => {
      if (consumedLiveIndexes.has(liveIndex)) {
        return false;
      }

      if (typeof projectedMessage.turnId === 'string' && projectedMessage.turnId.length > 0) {
        return liveMessage.turnId === projectedMessage.turnId && liveMessage.role === projectedMessage.role;
      }

      return liveMessage.turnId === projectedMessage.turnId
        && liveMessage.role === projectedMessage.role
        && liveMessage.content === projectedMessage.content
        && liveMessage.state === projectedMessage.state;
    });

    if (matchedLiveIndex === -1) {
      return { ...projectedMessage };
    }

    consumedLiveIndexes.add(matchedLiveIndex);
    return { ...serializedLiveChatList[matchedLiveIndex] };
  });

  serializedLiveChatList.forEach((liveMessage, liveIndex) => {
    if (consumedLiveIndexes.has(liveIndex)) {
      return;
    }

    mergedChatList.push({ ...liveMessage });
  });

  return mergedChatList as HostSessionSaveContext['list'];
}

function mergeProjectedChatListsForSave(
  previousProjectedChatList: HostResponseProjection['chatList'],
  currentProjectedChatList: HostResponseProjection['chatList'],
): HostResponseProjection['chatList'] {
  if (previousProjectedChatList.length === 0) {
    return currentProjectedChatList.map(message => ({ ...message }));
  }

  if (currentProjectedChatList.length === 0) {
    return previousProjectedChatList.map(message => ({ ...message }));
  }

  const consumedCurrentIndexes = new Set<number>();
  const mergedChatList = previousProjectedChatList.map((previousMessage) => {
    const matchedCurrentIndex = currentProjectedChatList.findIndex((currentMessage, currentIndex) => {
      if (consumedCurrentIndexes.has(currentIndex)) {
        return false;
      }

      if (typeof previousMessage.turnId === 'string' && previousMessage.turnId.length > 0) {
        return currentMessage.turnId === previousMessage.turnId && currentMessage.role === previousMessage.role;
      }

      return currentMessage.turnId === previousMessage.turnId
        && currentMessage.role === previousMessage.role
        && currentMessage.content === previousMessage.content
        && currentMessage.state === previousMessage.state;
    });

    if (matchedCurrentIndex === -1) {
      return { ...previousMessage };
    }

    consumedCurrentIndexes.add(matchedCurrentIndex);
    return { ...currentProjectedChatList[matchedCurrentIndex] };
  });

  currentProjectedChatList.forEach((currentMessage, currentIndex) => {
    if (consumedCurrentIndexes.has(currentIndex)) {
      return;
    }

    mergedChatList.push({ ...currentMessage });
  });

  return mergedChatList;
}

function resolveTurnResponsesForSave(
  liveTurnResponses: readonly TurnResponseTurn[] | undefined,
  hostProjection: HostResponseProjection | null,
  previousHostProjection: HostResponseProjection | null,
): TurnResponseTurn[] {
  const baseTurnResponses = (liveTurnResponses?.length
    ? liveTurnResponses
    : hostProjection?.turnResponses ?? []).map(turn => cloneTurnResponse(turn));

  return mergeStableTurnResponsesForSave(
    previousHostProjection?.turnResponses ?? [],
    baseTurnResponses,
  );
}

function mergeStableTurnResponsesForSave(
  previousTurnResponses: readonly TurnResponseTurn[],
  currentTurnResponses: readonly TurnResponseTurn[],
): TurnResponseTurn[] {
  if (previousTurnResponses.length === 0) {
    return [...currentTurnResponses];
  }

  if (currentTurnResponses.length === 0) {
    return previousTurnResponses
      .filter(turn => turn.response.status !== 'streaming')
      .map(turn => cloneTurnResponse(turn));
  }

  if (isExplicitTurnTailTruncation(previousTurnResponses, currentTurnResponses)) {
    return currentTurnResponses.map(turn => cloneTurnResponse(turn));
  }

  const currentTurnsById = new Map(currentTurnResponses.map(turn => [turn.turnId, cloneTurnResponse(turn)] as const));
  const missingStableTurnIds = previousTurnResponses
    .filter(turn => !currentTurnsById.has(turn.turnId) && turn.response.status !== 'streaming')
    .map(turn => turn.turnId);

  if (missingStableTurnIds.length === 0) {
    return [...currentTurnsById.values()];
  }

  const mergedTurnResponses: TurnResponseTurn[] = [];
  const seenTurnIds = new Set<string>();

  for (const turn of previousTurnResponses) {
    const replacement = currentTurnsById.get(turn.turnId);
    if (replacement) {
      mergedTurnResponses.push(replacement);
      currentTurnsById.delete(turn.turnId);
      seenTurnIds.add(turn.turnId);
      continue;
    }

    if (turn.response.status === 'streaming') {
      continue;
    }

    mergedTurnResponses.push(cloneTurnResponse(turn));
    seenTurnIds.add(turn.turnId);
  }

  for (const turn of currentTurnResponses) {
    if (seenTurnIds.has(turn.turnId)) {
      continue;
    }

    mergedTurnResponses.push(cloneTurnResponse(turn));
    seenTurnIds.add(turn.turnId);
  }

  return mergedTurnResponses;
}

function isExplicitTurnTailTruncation(
  previousTurnResponses: readonly TurnResponseTurn[],
  currentTurnResponses: readonly TurnResponseTurn[],
): boolean {
  if (currentTurnResponses.length === 0 || currentTurnResponses.length >= previousTurnResponses.length) {
    return false;
  }

  for (let index = 0; index < currentTurnResponses.length; index += 1) {
    if (previousTurnResponses[index]?.turnId !== currentTurnResponses[index]?.turnId) {
      return false;
    }
  }

  return true;
}

function normalizePersistedSlashCommand(
  slashCommand: TurnResponseCommand | null | undefined,
): TurnResponseCommand | undefined {
  if (!slashCommand || typeof slashCommand.name !== 'string') {
    return undefined;
  }

  const normalizedName = slashCommand.name.trim();
  if (!normalizedName) {
    return undefined;
  }

  return { ...slashCommand, name: normalizedName };
}

function cloneTurnResponse(turn: TurnResponseTurn): TurnResponseTurn {
  const responseModel = cloneTurnResponseModelSidecar(turn.responseModel);
  const {
    slashCommand: _slashCommand,
    responseId: _responseId,
    responseMarkdownInfo: _responseMarkdownInfo,
    modelState: _modelState,
    vote: _vote,
    timestamp: _timestamp,
    elapsedMs: _elapsedMs,
    timeSpentWaiting: _timeSpentWaiting,
    completionTokens: _completionTokens,
    ...responseWithoutPersistedData
  } = turn.response as TurnResponseTurn['response'] & PersistedHostResponseData;

  return {
    ...turn,
    request: { ...turn.request },
    rounds: [...turn.rounds],
    ...(turn.usage ? { usage: { ...turn.usage } } : {}),
    response: {
      ...responseWithoutPersistedData,
      ...(turn.response.usedContext
        ? {
          usedContext: {
            ...turn.response.usedContext,
            documents: turn.response.usedContext.documents.map(document => ({
              ...document,
              ranges: document.ranges.map(range => ({ ...range })),
            })),
          },
        }
        : {}),
      contentReferences: (turn.response.contentReferences ?? []).map(reference => ({
        ...reference,
        ...(reference.options
          ? {
            options: {
              ...reference.options,
              ...(reference.options.status ? { status: { ...reference.options.status } } : {}),
              ...(reference.options.diffMeta ? { diffMeta: { ...reference.options.diffMeta } } : {}),
            },
          }
          : {}),
      })),
      codeCitations: (turn.response.codeCitations ?? []).map(citation => ({ ...citation })),
      progressMessages: (turn.response.progressMessages ?? []).map(message => ({ ...message })),
      parts: [...turn.response.parts],
    },
    ...(responseModel ? { responseModel } : {}),
  };
}

function persistResponseDataOnTurnResponses(
  turnResponses: readonly TurnResponseTurn[],
  hostProjection: HostResponseProjection | null,
  previousHostProjection: HostResponseProjection | null,
  hostRequestModel: HostRequestModel | null,
): PersistedHostTurnResponse[] {
  const responseDataByTurnId = new Map<string, PersistedHostResponseData>();

  collectResponseSidecarFromProjection(responseDataByTurnId, previousHostProjection);
  collectResponseSidecarFromProjection(responseDataByTurnId, hostProjection);

  if (hostRequestModel?.turnId && hostRequestModel.response) {
    const response = hostRequestModel.response;
    responseDataByTurnId.set(
      hostRequestModel.turnId,
      {
        ...(normalizePersistedSlashCommand(response.slashCommand) ? { slashCommand: normalizePersistedSlashCommand(response.slashCommand) } : {}),
        ...(typeof response.id === 'string' && response.id.length > 0 ? { responseId: response.id } : {}),
        ...(Array.isArray(response.responseMarkdownInfo) && response.responseMarkdownInfo.length > 0
          ? { responseMarkdownInfo: response.responseMarkdownInfo.map(info => ({ ...info })) }
          : {}),
        ...(response.followups.length > 0
          ? { followups: response.followups.map(followup => ({ ...followup })) }
          : {}),
        ...(response.modelState ? { modelState: { ...response.modelState } } : {}),
        ...(response.vote === 0 || response.vote === 1 ? { vote: response.vote } : {}),
        ...(typeof response.timestamp === 'number' ? { timestamp: response.timestamp } : {}),
        ...(typeof response.elapsedMs === 'number' ? { elapsedMs: response.elapsedMs } : {}),
        ...(typeof response.confirmationAdjustedTimestamp === 'number' && typeof response.timestamp === 'number'
          ? { timeSpentWaiting: Math.max(0, response.confirmationAdjustedTimestamp - response.timestamp) }
          : {}),
        ...(typeof response.completionTokenCount === 'number' ? { completionTokens: response.completionTokenCount } : {}),
      },
    );
  }

  return turnResponses.map((turn) => {
    const persistedResponseData = responseDataByTurnId.get(turn.turnId);
    const clonedTurn = cloneTurnResponse(turn);
    if (!persistedResponseData) {
      return clonedTurn as PersistedHostTurnResponse;
    }

    return {
      ...clonedTurn,
      response: {
        ...clonedTurn.response,
        ...persistedResponseData,
      },
    } satisfies PersistedHostTurnResponse;
  });
}

function collectResponseSidecarFromProjection(
  target: Map<string, PersistedHostResponseData>,
  hostProjection: HostResponseProjection | null,
): void {
  const state = isHostTurnResponseState(hostProjection) ? hostProjection : null;
  if (!state) {
    return;
  }

  for (const entry of state.entries) {
    const responseSidecar = entry.runtimeState?.responseSidecar;
    if (!responseSidecar) {
      continue;
    }

    target.set(entry.turnId, {
      ...(normalizePersistedSlashCommand(responseSidecar.slashCommand) ? { slashCommand: normalizePersistedSlashCommand(responseSidecar.slashCommand) } : {}),
      ...(typeof responseSidecar.responseId === 'string' && responseSidecar.responseId.length > 0
        ? { responseId: responseSidecar.responseId }
        : (typeof entry.turnResponse?.response.id === 'string' && entry.turnResponse.response.id.length > 0
          ? { responseId: entry.turnResponse.response.id }
          : {})),
      ...(Array.isArray(responseSidecar.responseMarkdownInfo) && responseSidecar.responseMarkdownInfo.length > 0
        ? { responseMarkdownInfo: responseSidecar.responseMarkdownInfo.map(info => ({ ...info })) }
        : {}),
      ...(responseSidecar.followups ? { followups: responseSidecar.followups.map(followup => ({ ...followup })) } : {}),
      ...(responseSidecar.modelState ? { modelState: { ...responseSidecar.modelState } } : {}),
      ...(responseSidecar.vote === 0 || responseSidecar.vote === 1 ? { vote: responseSidecar.vote } : {}),
      ...(typeof responseSidecar.timestamp === 'number' ? { timestamp: responseSidecar.timestamp } : {}),
      ...(typeof responseSidecar.elapsedMs === 'number' ? { elapsedMs: responseSidecar.elapsedMs } : {}),
      ...(typeof responseSidecar.timeSpentWaiting === 'number' ? { timeSpentWaiting: responseSidecar.timeSpentWaiting } : {}),
      ...(typeof responseSidecar.completionTokens === 'number' ? { completionTokens: responseSidecar.completionTokens } : {}),
    });
  }
}

function stripFollowupsFromTurnResponses(
  turnResponses: readonly TurnResponseTurn[],
): TurnResponseTurn[] {
  return turnResponses.map(turn => cloneTurnResponse(turn));
}

function isHostTurnResponseState(
  value: HostResponseProjection | null,
): value is HostTurnResponseState {
  return Array.isArray((value as HostTurnResponseState | null)?.entries);
}