import { AilyHost } from '../core/host';

import type { HostSessionRecord, ProjectIndexEntry, SessionIndexEntry } from './chat-history.service';

export interface ChatHistoryIndexStoreOptions {
  indexFile: string;
  projectChatDir: string;
  getGlobalAilyDir: () => string;
  getCurrentProjectPath: () => string | null;
  joinPath: (...parts: string[]) => string;
  extractProjectName: (projectPath: string | null) => string | null;
  isSamePath: (a: string | null | undefined, b: string | null | undefined) => boolean;
  readHostRecord: (sessionId: string, projectPath: string | null) => HostSessionRecord | null;
}

/**
 * Host-side index persistence adapter for chat history.
 *
 * Keeps global/project index IO and project-index reconstruction out of ChatHistoryService.
 */
export class ChatHistoryIndexStore {
  constructor(private readonly options: ChatHistoryIndexStoreOptions) {}

  loadMergedIndex(): SessionIndexEntry[] {
    const globalIndex = this.loadGlobalIndex();
    return this.mergeProjectIndex(globalIndex);
  }

  mergeProjectIndex(index: SessionIndexEntry[], projectPath?: string | null): SessionIndexEntry[] {
    if (!this.hasFs()) return index;

    const prjPath = projectPath ?? this.options.getCurrentProjectPath();
    if (!prjPath) return index;

    const chatDir = this.options.joinPath(prjPath, this.options.projectChatDir);
    const projectIndexPath = this.options.joinPath(chatDir, this.options.indexFile);

    if (this.fileExists(projectIndexPath)) {
      return this.mergeProjectIndexFromFile(index, prjPath, projectIndexPath);
    }
    if (this.fileExists(chatDir)) {
      return this.rebuildProjectIndexFromDataFiles(index, prjPath, chatDir);
    }
    return index;
  }

  writeGlobalIndex(index: SessionIndexEntry[]): boolean {
    if (!this.hasFs()) return false;

    try {
      const globalDir = this.options.getGlobalAilyDir();
      const indexPath = this.options.joinPath(globalDir, this.options.indexFile);
      this.ensureDir(globalDir);
      this.writeFileSync(indexPath, JSON.stringify(index, null, 2));
      return true;
    } catch (error) {
      console.warn('[ChatHistory] 写入全局索引失败:', error);
      return false;
    }
  }

  writeProjectIndex(index: SessionIndexEntry[], projectPath?: string | null): void {
    if (!this.hasFs()) return;

    const prjPath = projectPath ?? this.options.getCurrentProjectPath();
    if (!prjPath) return;

    try {
      const projectEntries: ProjectIndexEntry[] = index
        .filter((entry) => this.options.isSamePath(entry.projectPath, prjPath))
        .map(({ projectPath: _pp, projectName: _pn, ...rest }) => rest);

      if (projectEntries.length === 0) return;

      const dir = this.options.joinPath(prjPath, this.options.projectChatDir);
      this.ensureDir(dir);
      const projectIndexPath = this.options.joinPath(dir, this.options.indexFile);
      this.writeFileSync(projectIndexPath, JSON.stringify(projectEntries, null, 2));
    } catch (error) {
      console.warn('[ChatHistory] 写入项目索引失败:', error);
    }
  }

  private loadGlobalIndex(): SessionIndexEntry[] {
    if (!this.hasFs()) return [];

    try {
      const indexPath = this.options.joinPath(this.options.getGlobalAilyDir(), this.options.indexFile);
      if (!this.fileExists(indexPath)) {
        return [];
      }

      const content = this.readFileSync(indexPath);
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        console.log(`[ChatHistory] 全局索引已加载, ${parsed.length} 条记录`);
        return parsed;
      }
    } catch (error) {
      console.warn('[ChatHistory] 加载全局索引失败:', error);
    }

    return [];
  }

  private mergeProjectIndexFromFile(
    index: SessionIndexEntry[],
    prjPath: string,
    projectIndexPath: string,
  ): SessionIndexEntry[] {
    try {
      const content = this.readFileSync(projectIndexPath);
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) return index;

      const projectEntries: ProjectIndexEntry[] = parsed;
      const projectName = this.options.extractProjectName(prjPath);
      const indexMap = new Map<string, SessionIndexEntry>();
      for (const entry of index) {
        indexMap.set(entry.sessionId, entry);
      }

      for (const entry of projectEntries) {
        indexMap.set(entry.sessionId, {
          ...entry,
          projectPath: prjPath,
          projectName,
        });
      }

      const merged = Array.from(indexMap.values());
      console.log(`[ChatHistory] 已合并项目索引 (${projectEntries.length} 条), 总计 ${merged.length} 条`);
      return merged;
    } catch (error) {
      console.warn('[ChatHistory] 加载项目索引失败:', error);
      return index;
    }
  }

  private rebuildProjectIndexFromDataFiles(
    index: SessionIndexEntry[],
    prjPath: string,
    chatDir: string,
  ): SessionIndexEntry[] {
    try {
      const files: string[] = AilyHost.get().fs.readdirSync(chatDir);
      const sessionFiles = files.filter((file) => file.endsWith('.json') && file !== this.options.indexFile);
      if (sessionFiles.length === 0) return index;

      const projectName = this.options.extractProjectName(prjPath);
      const indexMap = new Map<string, SessionIndexEntry>();
      for (const entry of index) {
        indexMap.set(entry.sessionId, entry);
      }

      let rebuilt = 0;
      for (const file of sessionFiles) {
        const sessionId = file.replace(/\.json$/, '');
        const existing = indexMap.get(sessionId);
        if (existing && this.options.isSamePath(existing.projectPath, prjPath)) {
          continue;
        }

        const data = this.options.readHostRecord(sessionId, prjPath);
        if (!data?.metadata) {
          continue;
        }

        indexMap.set(sessionId, {
          sessionId,
          title: data.metadata.title || '',
          projectPath: prjPath,
          projectName,
          createdAt: data.metadata.createdAt || Date.now(),
          updatedAt: data.metadata.updatedAt || Date.now(),
          messageCount: data.chatList?.length || 0,
          mode: data.metadata.mode || 'agent',
          model: data.metadata.model ?? null,
          dataAvailable: true,
        });
        rebuilt++;
      }

      const rebuiltIndex = Array.from(indexMap.values());
      if (rebuilt > 0) {
        this.writeProjectIndex(rebuiltIndex, prjPath);
        console.log(`[ChatHistory] 已从数据文件重建项目索引 (${rebuilt} 条), 总计 ${rebuiltIndex.length} 条`);
      }
      return rebuiltIndex;
    } catch (error) {
      console.warn('[ChatHistory] 重建项目索引失败:', error);
      return index;
    }
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