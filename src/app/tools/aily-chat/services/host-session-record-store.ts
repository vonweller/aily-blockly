import { AilyHost } from '../core/host';

import type { ChatListItem, HostSessionRecord, SessionMetadata } from './chat-history.service';

export interface HostSessionRecordStoreOptions {
  projectChatDir: string;
  getGlobalChatDataDir: () => string;
  getGlobalProjectRootPath: () => string | null;
  joinPath: (...parts: string[]) => string;
  isSamePath: (a: string | null | undefined, b: string | null | undefined) => boolean;
}

/**
 * Host-side persistence adapter for chat history records.
 *
 * Keeps host record disk IO and compatibility normalization out of ChatHistoryService.
 */
export class HostSessionRecordStore {
  constructor(private readonly options: HostSessionRecordStoreOptions) {}

  createFullMetadata(metadata: Partial<SessionMetadata> & { sessionId: string }): SessionMetadata {
    const now = Date.now();
    return {
      sessionId: metadata.sessionId,
      title: metadata.title || '',
      projectPath: metadata.projectPath ?? null,
      createdAt: metadata.createdAt || now,
      updatedAt: now,
      mode: metadata.mode || 'agent',
      model: metadata.model ?? null,
      contextBudget: metadata.contextBudget,
      toolCallingIteration: metadata.toolCallingIteration || 0,
    };
  }

  createRecord(chatList: ChatListItem[], metadata: SessionMetadata): HostSessionRecord {
    return {
      chatList,
      metadata,
    };
  }

  write(sessionId: string, data: HostSessionRecord): void {
    if (!this.hasFs()) return;

    let projectPath = data.metadata.projectPath;
    if (projectPath) {
      const rootPath = this.options.getGlobalProjectRootPath();
      if (rootPath && this.options.isSamePath(projectPath, rootPath)) {
        console.warn(`[ChatHistory] 检测到 projectPath 等于 projectRootPath，降级为全局兜底: ${projectPath}`);
        projectPath = null;
        data.metadata.projectPath = null;
      }
    }

    try {
      if (projectPath) {
        const dir = this.options.joinPath(projectPath, this.options.projectChatDir);
        this.ensureDir(dir);
        const filePath = this.options.joinPath(dir, `${sessionId}.json`);
        this.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return;
      }

      const dir = this.options.getGlobalChatDataDir();
      this.ensureDir(dir);
      const filePath = this.options.joinPath(dir, `${sessionId}.json`);
      this.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[ChatHistory] 写入宿主持久化记录失败 (${sessionId}):`, error);
    }
  }

  read(sessionId: string, projectPath: string | null): HostSessionRecord | null {
    if (!this.hasFs()) return null;

    const paths: string[] = [];
    if (projectPath) {
      paths.push(this.options.joinPath(projectPath, this.options.projectChatDir, `${sessionId}.json`));
    }
    paths.push(this.options.joinPath(this.options.getGlobalChatDataDir(), `${sessionId}.json`));

    for (const filePath of paths) {
      try {
        if (!this.fileExists(filePath)) {
          continue;
        }

        const content = this.readFileSync(filePath);
        const parsed = JSON.parse(content);

        if (Array.isArray(parsed)) {
          return {
            chatList: parsed,
            metadata: this.normalizeMetadata(undefined, sessionId, projectPath),
          };
        }

        if (parsed.chatList && parsed.metadata) {
          return this.normalizeRecord(parsed, sessionId, projectPath);
        }
      } catch (error) {
        console.warn(`[ChatHistory] 读取宿主持久化记录失败 (${filePath}):`, error);
      }
    }

    return null;
  }

  private normalizeRecord(raw: any, sessionId: string, projectPath: string | null): HostSessionRecord | null {
    if (!raw || !Array.isArray(raw.chatList)) {
      return null;
    }

    const hostRecord: HostSessionRecord = {
      chatList: raw.chatList,
      metadata: this.normalizeMetadata(raw.metadata, sessionId, projectPath),
    };

    if (Object.prototype.hasOwnProperty.call(raw, 'turns')) {
      hostRecord.turns = raw.turns;
    }

    return hostRecord;
  }

  private normalizeMetadata(raw: any, sessionId: string, projectPath: string | null): SessionMetadata {
    const now = Date.now();
    const metadata = raw && typeof raw === 'object' ? raw : {};
    return {
      sessionId: typeof metadata.sessionId === 'string' && metadata.sessionId ? metadata.sessionId : sessionId,
      title: typeof metadata.title === 'string' ? metadata.title : '',
      projectPath: metadata.projectPath ?? projectPath ?? null,
      createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : now,
      mode: typeof metadata.mode === 'string' && metadata.mode ? metadata.mode : 'agent',
      model: typeof metadata.model === 'string' ? metadata.model : null,
      contextBudget: metadata.contextBudget && typeof metadata.contextBudget === 'object'
        ? {
            currentTokens: typeof metadata.contextBudget.currentTokens === 'number' ? metadata.contextBudget.currentTokens : 0,
            maxContextTokens: typeof metadata.contextBudget.maxContextTokens === 'number'
              ? metadata.contextBudget.maxContextTokens
              : 0,
            usagePercent: typeof metadata.contextBudget.usagePercent === 'number' ? metadata.contextBudget.usagePercent : 0,
          }
        : undefined,
      toolCallingIteration: typeof metadata.toolCallingIteration === 'number' ? metadata.toolCallingIteration : 0,
    };
  }

  private hasFs(): boolean {
    return typeof window !== 'undefined' && !!AilyHost.get().fs;
  }

  private fileExists(path: string): boolean {
    try {
      return AilyHost.get().fs.existsSync(path);
    } catch {
      return false;
    }
  }

  private readFileSync(path: string): string {
    return AilyHost.get().fs.readFileSync(path, 'utf-8');
  }

  private writeFileSync(path: string, content: string): void {
    AilyHost.get().fs.writeFileSync(path, content, 'utf-8');
  }

  private ensureDir(dirPath: string): void {
    if (!this.fileExists(dirPath)) {
      AilyHost.get().fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}