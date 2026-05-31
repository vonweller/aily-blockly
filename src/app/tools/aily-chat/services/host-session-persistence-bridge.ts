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
    const now = Date.now();

    if (entry) {
      entry.title = title;
      entry.updatedAt = now;
      this.options.markIndexDirty();

      const cached = this.sessionCache.get(sessionId);
      if (cached) {
        cached.metadata.title = title;
        cached.metadata.updatedAt = now;
        this.hostRecordStore.write(sessionId, cached);
      } else {
        const persisted = this.hostRecordStore.read(sessionId, entry.projectPath ?? null);
        if (persisted) {
          persisted.metadata.title = title;
          persisted.metadata.updatedAt = now;
          this.sessionCache.set(sessionId, persisted);
          this.hostRecordStore.write(sessionId, persisted);
        } else {
          this.pendingTitles.set(sessionId, title);
        }
      }

      this.options.writeIndex();
      console.log(`[ChatHistory] 标题已更新: ${sessionId} → "${title}"`);
      return;
    }

    const fallbackRecord = this.tryLoadLiveHostRecord(sessionId)
      ?? this.sessionCache.get(sessionId)
      ?? null;
    if (fallbackRecord) {
      const nextRecord: HostSessionRecord = {
        ...fallbackRecord,
        metadata: {
          ...fallbackRecord.metadata,
          title,
          updatedAt: now,
        },
      };
      this.sessionCache.set(sessionId, nextRecord);
      this.hostRecordStore.write(sessionId, nextRecord);

      const messageCount = countHostRecordMessages(nextRecord);
      this.options.upsertIndexEntry(sessionId, nextRecord.metadata, messageCount, true);
      this.options.writeIndex();
      console.log(`[ChatHistory] 标题已更新(补建条目): ${sessionId} → "${title}"`);
      return;
    }

    // Upstream-aligned semantics: generated/custom titles are durable session metadata,
    // even when no turn has been persisted yet.
    const metadata = this.hostRecordStore.createFullMetadata({
      sessionId,
      title,
      updatedAt: now,
    });
    const titleOnlyRecord = this.hostRecordStore.createRecord(metadata);
    this.sessionCache.set(sessionId, titleOnlyRecord);
    this.hostRecordStore.write(sessionId, titleOnlyRecord);
    this.options.upsertIndexEntry(sessionId, metadata, 0, true);
    this.options.writeIndex();
    console.log(`[ChatHistory] 标题已更新(仅标题元数据): ${sessionId} → "${title}"`);
    return;

  }

  markDirty(sessionId: string): void {
    this.dirtySessionIds.add(sessionId);
  }

  loadHostRecord(sessionId: string, projectPathHint?: string | null): HostSessionRecord | null {
    try {
      const liveRecord = this.tryLoadLiveHostRecord(sessionId);
      if (liveRecord) {
        return liveRecord;
      }

      const cached = this.sessionCache.get(sessionId);
      if (cached) {
        return cached;
      }

      this.options.ensureIndexLoaded();
      const entry = this.options.findIndexEntry(sessionId);
      const primaryPath = entry?.projectPath || null;

      const data = this.hostRecordStore.read(sessionId, primaryPath);
      if (data) {
        const hydrated = this.applyPendingTitleToRecord(data);
        if (hydrated !== data) {
          this.hostRecordStore.write(sessionId, hydrated);
        }
        this.sessionCache.set(sessionId, hydrated);
        return hydrated;
      }

      if (projectPathHint && !this.options.isSamePath(projectPathHint, primaryPath)) {
        const fallbackData = this.hostRecordStore.read(sessionId, projectPathHint);
        if (fallbackData) {
          const hydrated = this.applyPendingTitleToRecord(fallbackData);
          if (hydrated !== fallbackData) {
            this.hostRecordStore.write(sessionId, hydrated);
          }
          this.sessionCache.set(sessionId, hydrated);
          return hydrated;
        }
      }

      return null;
    } catch (error) {
      console.warn('[ChatHistory] 读取 session record 失败:', error);
      return null;
    }
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
    return this.hostRecordStore.createRecord(fullMetadata, record.turnResponses, record.sidecar, record.auxiliary);
  }

  private tryLoadLiveHostRecord(sessionId: string): HostSessionRecord | null {
    if (!this.liveSessionProvider) {
      return null;
    }

    try {
      const liveRecord = this.liveSessionProvider();
      if (!liveRecord || liveRecord.sessionId !== sessionId) {
        return null;
      }

      return this.materializeHostRecord(liveRecord);
    } catch (error) {
      console.warn('[ChatHistory] 读取 live session 失败:', error);
      return null;
    }
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

  private applyPendingTitleToRecord(record: HostSessionRecord): HostSessionRecord {
    const pendingTitle = this.pendingTitles.get(record.metadata.sessionId);
    if (!pendingTitle) {
      return record;
    }

    this.pendingTitles.delete(record.metadata.sessionId);
    return {
      ...record,
      metadata: {
        ...record.metadata,
        title: pendingTitle,
        updatedAt: Date.now(),
      },
    };
  }
}