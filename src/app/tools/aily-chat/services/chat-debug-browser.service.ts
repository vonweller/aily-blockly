import { Injectable } from '@angular/core';

import { buildImportedDebugSessionViewModel, type ImportedDebugSessionViewModel } from '../helpers/chat-debug-viewer-state';
import {
  resolveHostSessionDebugEventContent,
  type HostSessionDebugEvent,
  type HostSessionDebugResolvedEventContent,
} from './host-session-debug-events';
import type { ImportedDebugSessionRecord } from './chat-history.service';
import { ChatHistoryService } from './chat-history.service';

@Injectable({
  providedIn: 'root',
})
export class ChatDebugBrowserService {
  private isDebugBrowserOpen = false;
  private currentSessionId: string | null = null;
  private currentSubview: 'overview' | 'logs' | 'flow' | 'cache' = 'overview';

  constructor(
    private readonly chatHistoryService: ChatHistoryService,
  ) {}

  get isOpen(): boolean {
    return this.isDebugBrowserOpen;
  }

  get isHomeVisible(): boolean {
    return this.isDebugBrowserOpen && !this.currentSessionId;
  }

  get isOverviewVisible(): boolean {
    return this.isDebugBrowserOpen && !!this.currentSessionId && this.currentSubview === 'overview';
  }

  get isLogsVisible(): boolean {
    return this.isDebugBrowserOpen && !!this.currentSessionId && this.currentSubview === 'logs';
  }

  get isFlowVisible(): boolean {
    return this.isDebugBrowserOpen && !!this.currentSessionId && this.currentSubview === 'flow';
  }

  get isCacheVisible(): boolean {
    return this.isDebugBrowserOpen && !!this.currentSessionId && this.currentSubview === 'cache';
  }

  get activeSessionId(): string | null {
    return this.currentSessionId;
  }

  get activeImportedDebugView(): ImportedDebugSessionViewModel | null {
    const currentSession = this.getActiveImportedSession();
    return currentSession ? buildImportedDebugSessionViewModel(currentSession) : null;
  }

  get activeImportedDebugEvents(): readonly HostSessionDebugEvent[] {
    return this.getActiveImportedSession()?.debugEvents ?? [];
  }

  resolveActiveImportedDebugEventContent(eventId: string): HostSessionDebugResolvedEventContent | null {
    const currentSession = this.getActiveImportedSession();
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

  listImportedSessions(): readonly ImportedDebugSessionRecord[] {
    return this.chatHistoryService.listImportedDebugSnapshots();
  }

  openHome(): void {
    this.isDebugBrowserOpen = true;
    this.currentSessionId = null;
    this.currentSubview = 'overview';
  }

  openImportedRecord(record: ImportedDebugSessionRecord): void {
    this.isDebugBrowserOpen = true;
    this.currentSessionId = record.sessionId;
    this.currentSubview = 'overview';
  }

  openImportedSession(sessionId: string): boolean {
    const record = this.chatHistoryService.getImportedDebugSnapshot(sessionId);
    if (!record) {
      return false;
    }

    this.openImportedRecord(record);
    return true;
  }

  close(): void {
    this.isDebugBrowserOpen = false;
    this.currentSessionId = null;
    this.currentSubview = 'overview';
  }

  showOverview(): void {
    if (!this.currentSessionId) {
      return;
    }

    this.currentSubview = 'overview';
  }

  showLogs(): void {
    if (!this.currentSessionId) {
      return;
    }

    this.currentSubview = 'logs';
  }

  showFlow(): void {
    if (!this.currentSessionId) {
      return;
    }

    this.currentSubview = 'flow';
  }

  showCache(): void {
    if (!this.currentSessionId) {
      return;
    }

    this.currentSubview = 'cache';
  }

  private getActiveImportedSession(): ImportedDebugSessionRecord | null {
    if (!this.currentSessionId) {
      return null;
    }

    return this.chatHistoryService.getImportedDebugSnapshot(this.currentSessionId);
  }
}