import { HostSessionRecordStore } from './host-session-record-store';

import type {
  HostSessionRecord,
  LiveHostSessionRecord,
  SessionIndexEntry,
  SessionMetadata,
} from './chat-history.service';
import { countHostRecordMessages } from './chat-history.service';

type LiveSessionProvider = () => LiveHostSessionRecord | null;

export interface HostSessionPersistenceBridgeOptions {
  ensureIndexLoaded: () => void;
  findIndexEntry: (sessionId: string) => SessionIndexEntry | undefined;
  upsertIndexEntry: (sessionId: string, metadata: SessionMetadata, messageCount: number, updateTimestamp?: boolean) => void;
  writeIndex: () => void;
  markIndexDirty: () => void;
  hasDirtyIndex: () => boolean;
  isSamePath: (a: string | null | undefined, b: string | null | undefined) => boolean;
}

/**
 * Host-side session persistence coordinator.
 *
 * Keeps cache/dirty tracking/title persistence/flush behavior out of ChatHistoryService.
 */
export class HostSessionPersistenceBridge {
  private readonly dirtySessionIds = new Set<string>();
  private readonly sessionCache = new Map<string, HostSessionRecord>();
  private readonly pendingTitles = new Map<string, string>();
  private liveSessionProvider: LiveSessionProvider | null = null;

  constructor(
    private readonly hostRecordStore: HostSessionRecordStore,
    private readonly options: HostSessionPersistenceBridgeOptions,
  ) {}

  setLiveSessionProvider(provider: LiveSessionProvider | null): void {
    this.liveSessionProvider = provider;
  }

  saveHostRecord(
    record: LiveHostSessionRecord,
  ): void {
    const { sessionId } = record;
    if (!sessionId) {
      return;
    }

    this.options.ensureIndexLoaded();

    const hostRecord = this.materializeHostRecord(record);
    const messageCount = countHostRecordMessages(hostRecord);
    if (messageCount === 0) {
      return;
    }

    this.sessionCache.set(sessionId, hostRecord);

    const existingEntry = this.options.findIndexEntry(sessionId);
    const messageCountChanged = !existingEntry || existingEntry.messageCount !== messageCount;
    this.options.upsertIndexEntry(sessionId, hostRecord.metadata, messageCount, messageCountChanged);

    this.hostRecordStore.write(sessionId, hostRecord);
    this.options.writeIndex();
    this.dirtySessionIds.delete(sessionId);
  }

  updateTitle(sessionId: string, title: string): void {
    this.options.ensureIndexLoaded();
    const entry = this.options.findIndexEntry(sessionId);

    if (entry) {
      entry.title = title;
      entry.updatedAt = Date.now();
      this.options.markIndexDirty();

      const cached = this.sessionCache.get(sessionId);
      if (cached) {
        cached.metadata.title = title;
        cached.metadata.updatedAt = Date.now();
        this.hostRecordStore.write(sessionId, cached);
      }

      this.options.writeIndex();
      console.log(`[ChatHistory] 标题已更新: ${sessionId} → "${title}"`);
      return;
    }

    this.pendingTitles.set(sessionId, title);
    console.log(`[ChatHistory] 标题暂存(条目未创建): ${sessionId} → "${title}"`);
  }

  markDirty(sessionId: string): void {
    this.dirtySessionIds.add(sessionId);
  }

  loadHostRecord(sessionId: string, projectPathHint?: string | null): HostSessionRecord | null {
    const cached = this.sessionCache.get(sessionId);
    if (cached) {
      return cached;
    }

    this.options.ensureIndexLoaded();
    const entry = this.options.findIndexEntry(sessionId);
    const primaryPath = entry?.projectPath || null;

    const data = this.hostRecordStore.read(sessionId, primaryPath);
    if (data) {
      this.sessionCache.set(sessionId, data);
      return data;
    }

    if (projectPathHint && !this.options.isSamePath(projectPathHint, primaryPath)) {
      const fallbackData = this.hostRecordStore.read(sessionId, projectPathHint);
      if (fallbackData) {
        this.sessionCache.set(sessionId, fallbackData);
        return fallbackData;
      }
    }

    return null;
  }

  flushAll(): void {
    let liveRecord: LiveHostSessionRecord | null = null;
    if (this.liveSessionProvider) {
      try {
        liveRecord = this.liveSessionProvider();
      } catch (error) {
        console.warn('[ChatHistory] 获取 live session 失败:', error);
      }
    }

    for (const sessionId of this.dirtySessionIds) {
      let hostRecord = this.sessionCache.get(sessionId);

      if (liveRecord && liveRecord.sessionId === sessionId && countHostRecordMessages(liveRecord) > 0) {
        hostRecord = this.materializeHostRecord(liveRecord);
        this.sessionCache.set(sessionId, hostRecord);
      }

      if (hostRecord) {
        this.hostRecordStore.write(sessionId, hostRecord);
        this.options.upsertIndexEntry(sessionId, hostRecord.metadata, countHostRecordMessages(hostRecord));
      }
    }
    this.dirtySessionIds.clear();

    if (this.options.hasDirtyIndex()) {
      this.options.writeIndex();
    }
  }

  hasDirtySessions(): boolean {
    return this.dirtySessionIds.size > 0;
  }

  getDirtySessionCount(): number {
    return this.dirtySessionIds.size;
  }

  getSessionCache(): Map<string, HostSessionRecord> {
    return this.sessionCache;
  }

  clearSessionState(sessionId: string): void {
    this.sessionCache.delete(sessionId);
    this.dirtySessionIds.delete(sessionId);
    this.pendingTitles.delete(sessionId);
  }

  private materializeHostRecord(record: LiveHostSessionRecord): HostSessionRecord {
    const fullMetadata = this.applyPendingTitle(this.hostRecordStore.createFullMetadata(record.metadata));
    return this.hostRecordStore.createRecord(fullMetadata, record.turnResponses, record.sidecar);
  }

  private applyPendingTitle(metadata: SessionMetadata): SessionMetadata {
    const pendingTitle = this.pendingTitles.get(metadata.sessionId);
    if (!pendingTitle) {
      return metadata;
    }

    this.pendingTitles.delete(metadata.sessionId);
    return {
      ...metadata,
      title: pendingTitle,
    };
  }
}