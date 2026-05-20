import { Injectable } from '@angular/core';

import { buildImportedDebugSessionViewModel, type ImportedDebugSessionViewModel } from '../helpers/chat-debug-viewer-state';
import {
  resolveHostSessionDebugEventContent,
  type HostSessionDebugEvent,
  type HostSessionDebugResolvedEventContent,
} from './host-session-debug-events';
import type { ImportedDebugSessionRecord } from './chat-history.service';
import { ChatHistoryService } from './chat-history.service';

export enum ChatDebugBrowserViewState {
  Home = 'home',
  Overview = 'overview',
  Logs = 'logs',
  FlowChart = 'flowchart',
  CacheExplorer = 'cache',
}

export interface ImportedDebugResourceSummary {
  readonly sessionId: string;
  readonly sourceSessionId: string;
  readonly title: string;
  readonly displayTitle: string;
  readonly importedAt: number;
}

@Injectable({
  providedIn: 'root',
})
export class ChatDebugBrowserService {
  private isDebugBrowserOpen = false;
  private currentViewState = ChatDebugBrowserViewState.Home;
  private currentImportedResource: ImportedDebugSessionRecord | null = null;
  private lastOpenedImportedSessionId: string | null = null;

  constructor(
    private readonly chatHistoryService: ChatHistoryService,
  ) {}

  get isOpen(): boolean {
    return this.isDebugBrowserOpen;
  }

  get viewState(): ChatDebugBrowserViewState {
    return this.currentViewState;
  }

  get activeSessionId(): string | null {
    return this.currentImportedResource?.sessionId ?? null;
  }

  get activeImportedResource(): ImportedDebugSessionRecord | null {
    return this.currentImportedResource;
  }

  get activeImportedDebugView(): ImportedDebugSessionViewModel | null {
    const currentSession = this.currentImportedResource;
    return currentSession ? buildImportedDebugSessionViewModel(currentSession) : null;
  }

  get activeImportedDebugEvents(): readonly HostSessionDebugEvent[] {
    return this.currentImportedResource?.debugEvents ?? [];
  }

  get activeImportedResourceSummary(): ImportedDebugResourceSummary | null {
    return this.currentImportedResource ? summarizeImportedDebugResource(this.currentImportedResource) : null;
  }

  resolveActiveImportedDebugEventContent(eventId: string): HostSessionDebugResolvedEventContent | null {
    const currentSession = this.currentImportedResource;
    if (!currentSession) {
      return null;
    }

    return resolveHostSessionDebugEventContent(currentSession.hostRecord, eventId, {
      events: currentSession.debugEvents,
      readCompanionFile: currentSession.debugCompanionFiles
        ? (fileName: string) => currentSession.debugCompanionFiles?.[fileName]
        : undefined,
    }) ?? null;
  }

  listAvailableResources(): readonly ImportedDebugResourceSummary[] {
    const resources = this.chatHistoryService.listImportedDebugSnapshots().map(summarizeImportedDebugResource);
    return bubbleImportedResourcesToTop(resources, this.lastOpenedImportedSessionId, this.activeSessionId);
  }

  openHome(): void {
    this.isDebugBrowserOpen = true;
    this.currentImportedResource = null;
    this.currentViewState = ChatDebugBrowserViewState.Home;
  }

  openImportedRecord(
    record: ImportedDebugSessionRecord,
    viewState: ChatDebugBrowserViewState = ChatDebugBrowserViewState.Overview,
  ): void {
    this.isDebugBrowserOpen = true;
    this.currentImportedResource = record;
    this.lastOpenedImportedSessionId = record.sessionId;
    this.currentViewState = viewState;
  }

  openImportedSession(
    sessionId: string,
    viewState: ChatDebugBrowserViewState = ChatDebugBrowserViewState.Overview,
  ): boolean {
    const record = this.chatHistoryService.getImportedDebugSnapshot(sessionId);
    if (!record) {
      return false;
    }

    this.openImportedRecord(record, viewState);
    return true;
  }

  close(): void {
    this.isDebugBrowserOpen = false;
    this.currentImportedResource = null;
    this.currentViewState = ChatDebugBrowserViewState.Home;
  }

  showView(viewState: ChatDebugBrowserViewState): void {
    if (viewState === ChatDebugBrowserViewState.Home) {
      this.openHome();
      return;
    }

    if (!this.currentImportedResource) {
      return null;
    }

    this.currentViewState = viewState;
  }
}

function summarizeImportedDebugResource(record: ImportedDebugSessionRecord): ImportedDebugResourceSummary {
  return {
    sessionId: record.sessionId,
    sourceSessionId: record.sourceSessionId,
    title: record.title,
    displayTitle: getImportedResourceDisplayTitle(record.title),
    importedAt: record.importedAt,
  };
}

function getImportedResourceDisplayTitle(title: string): string {
  const normalizedTitle = title.trim();
  return normalizedTitle ? `导入: ${normalizedTitle}` : '新聊天';
}

function bubbleImportedResourcesToTop(
  resources: readonly ImportedDebugResourceSummary[],
  lastOpenedSessionId: string | null,
  activeSessionId: string | null,
): readonly ImportedDebugResourceSummary[] {
  const nextResources = [...resources];

  const bubbleToTop = (sessionId: string | null) => {
    if (!sessionId) {
      return;
    }

    const index = nextResources.findIndex(resource => resource.sessionId === sessionId);
    if (index > 0) {
      const [resource] = nextResources.splice(index, 1);
      nextResources.unshift(resource);
    }
  };

  bubbleToTop(lastOpenedSessionId);
  bubbleToTop(activeSessionId);

  return nextResources;
}