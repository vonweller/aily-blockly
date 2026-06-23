import { ChatMemoryStorage } from './memory-storage';
import type {
  ChatMemoryEntry,
  ChatMemoryNavigationItem,
  ChatMemoryScope,
} from './memory-manager.types';

export class ChatMemoryManagerState {
  activeScope: ChatMemoryScope = 'global';
  searchTerm = '';

  private readonly globalEntries: ChatMemoryEntry[] = [];
  private readonly projectEntriesByTargetId = new Map<string, ChatMemoryEntry[]>();
  private readonly sessionEntriesByTargetId = new Map<string, ChatMemoryEntry[]>();
  private readonly selectedTargetIdByScope: Record<'project' | 'session', string | null> = {
    project: null,
    session: null,
  };
  private readonly draftContentByPath = new Map<string, string>();

  constructor(
    private readonly storage: ChatMemoryStorage,
    private readonly projectItems: readonly ChatMemoryNavigationItem[],
    private readonly sessionItems: readonly ChatMemoryNavigationItem[],
  ) {}

  initialize(): void {
    this.reloadGlobalEntries();
    this.ensureNavigationSelection('project');
    this.ensureNavigationSelection('session');
    this.reloadScopedEntries('project');
    this.reloadScopedEntries('session');
  }

  get hasSplitLayout(): boolean {
    return this.activeScope !== 'global';
  }

  get navigationItems(): readonly ChatMemoryNavigationItem[] {
    if (this.activeScope === 'project') {
      return this.projectItems;
    }

    if (this.activeScope === 'session') {
      return this.sessionItems;
    }

    return [];
  }

  get selectedNavigationItem(): ChatMemoryNavigationItem | undefined {
    if (!this.hasSplitLayout) {
      return undefined;
    }

    const selectedId = this.selectedTargetIdByScope[this.activeScope];
    if (!selectedId) {
      return undefined;
    }

    return this.navigationItems.find((item) => item.id === selectedId);
  }

  get visibleEntries(): readonly ChatMemoryEntry[] {
    return this.filterEntries(this.readActiveEntries());
  }

  switchScope(scope: ChatMemoryScope): void {
    if (scope === this.activeScope) {
      return;
    }

    this.flushScope(this.activeScope);
    this.activeScope = scope;
    this.searchTerm = '';

    if (scope === 'project' || scope === 'session') {
      this.ensureNavigationSelection(scope);
      this.reloadScopedEntries(scope);
    }
  }

  setSearchTerm(value: string): void {
    this.searchTerm = value ?? '';
  }

  createEntry(): ChatMemoryEntry {
    const created = this.storage.createEntry(
      this.activeScope,
      this.getActiveContext(),
    );

    this.reloadEntriesForScope(this.activeScope);
    return this.findEntry(created.absolutePath) ?? created;
  }

  selectNavigationItem(item: ChatMemoryNavigationItem): void {
    if (!this.hasSplitLayout || this.activeScope === 'global') {
      return;
    }

    if (this.selectedNavigationItem?.id === item.id) {
      return;
    }

    this.flushScope(this.activeScope);
    this.selectedTargetIdByScope[this.activeScope] = item.id;
    this.reloadScopedEntries(this.activeScope);
  }

  updateDraft(entry: ChatMemoryEntry, content: string): void {
    this.draftContentByPath.set(entry.absolutePath, content);
  }

  getDraftValue(entry: ChatMemoryEntry): string {
    return this.draftContentByPath.get(entry.absolutePath) ?? entry.content;
  }

  hasDraft(entry: ChatMemoryEntry): boolean {
    return this.getDraftValue(entry) !== entry.content;
  }

  flushEntry(entry: ChatMemoryEntry): ChatMemoryEntry {
    if (!this.hasDraft(entry)) {
      return entry;
    }

    const updatedEntry = this.storage.saveEntry(entry, this.getDraftValue(entry));
    this.replaceEntry(updatedEntry);
    this.draftContentByPath.delete(entry.absolutePath);
    return updatedEntry;
  }

  flushScope(scope: ChatMemoryScope): void {
    for (const entry of this.readEntriesByScope(scope)) {
      if (this.draftContentByPath.has(entry.absolutePath)) {
        this.flushEntry(entry);
      }
    }
  }

  flushAll(): void {
    this.flushScope('global');
    this.flushScope('project');
    this.flushScope('session');
  }

  deleteEntry(entry: ChatMemoryEntry): void {
    this.draftContentByPath.delete(entry.absolutePath);
    this.storage.deleteEntry(entry);
    this.reloadEntriesForScope(entry.scope);
  }

  private reloadEntriesForScope(scope: ChatMemoryScope): void {
    if (scope === 'global') {
      this.reloadGlobalEntries();
      return;
    }

    this.reloadScopedEntries(scope);
  }

  private reloadGlobalEntries(): void {
    this.globalEntries.splice(
      0,
      this.globalEntries.length,
      ...this.storage.listEntries('global'),
    );
  }

  private reloadScopedEntries(scope: 'project' | 'session'): void {
    const target = this.readSelectedNavigationItem(scope);
    if (!target) {
      return;
    }

    const entries = this.storage.listEntries(scope, {
      projectPath: target.projectPath,
      sessionId: target.sessionId,
    });

    if (scope === 'project') {
      this.projectEntriesByTargetId.set(target.id, entries);
      return;
    }

    this.sessionEntriesByTargetId.set(target.id, entries);
  }

  private ensureNavigationSelection(scope: 'project' | 'session'): void {
    const items = scope === 'project' ? this.projectItems : this.sessionItems;
    const selectedId = this.selectedTargetIdByScope[scope];
    const hasSelected = selectedId
      ? items.some((item) => item.id === selectedId)
      : false;

    if (hasSelected) {
      return;
    }

    this.selectedTargetIdByScope[scope] = items[0]?.id ?? null;
  }

  private filterEntries(entries: readonly ChatMemoryEntry[]): ChatMemoryEntry[] {
    const keyword = this.searchTerm.trim().toLocaleLowerCase();
    if (!keyword) {
      return [...entries];
    }

    return entries.filter((entry) => {
      const haystacks = [entry.content, entry.publicPath, entry.fileName];
      return haystacks.some((value) =>
        value.toLocaleLowerCase().includes(keyword),
      );
    });
  }

  private replaceEntry(entry: ChatMemoryEntry): void {
    const items = this.readEntriesByScope(entry.scope);
    const index = items.findIndex(
      (item) => item.absolutePath === entry.absolutePath,
    );
    if (index === -1) {
      return;
    }

    const nextItems = [...items];
    nextItems[index] = entry;
    nextItems.sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      return left.fileName.localeCompare(right.fileName);
    });

    this.writeEntries(entry.scope, nextItems);
  }

  private findEntry(absolutePath: string): ChatMemoryEntry | undefined {
    return this.readActiveEntries().find(
      (entry) => entry.absolutePath === absolutePath,
    );
  }

  private readActiveEntries(): readonly ChatMemoryEntry[] {
    return this.readEntriesByScope(this.activeScope);
  }

  private readEntriesByScope(scope: ChatMemoryScope): readonly ChatMemoryEntry[] {
    if (scope === 'global') {
      return this.globalEntries;
    }

    const target = this.readSelectedNavigationItem(scope);
    if (!target) {
      return [];
    }

    if (scope === 'project') {
      return this.projectEntriesByTargetId.get(target.id) ?? [];
    }

    return this.sessionEntriesByTargetId.get(target.id) ?? [];
  }

  private writeEntries(
    scope: ChatMemoryScope,
    entries: readonly ChatMemoryEntry[],
  ): void {
    if (scope === 'global') {
      this.globalEntries.splice(0, this.globalEntries.length, ...entries);
      return;
    }

    const target = this.readSelectedNavigationItem(scope);
    if (!target) {
      return;
    }

    if (scope === 'project') {
      this.projectEntriesByTargetId.set(target.id, [...entries]);
      return;
    }

    this.sessionEntriesByTargetId.set(target.id, [...entries]);
  }

  private readSelectedNavigationItem(
    scope: 'project' | 'session',
  ): ChatMemoryNavigationItem | undefined {
    const items = scope === 'project' ? this.projectItems : this.sessionItems;
    const selectedId = this.selectedTargetIdByScope[scope];
    return items.find((item) => item.id === selectedId);
  }

  private getActiveContext():
    | { projectPath?: string; sessionId?: string }
    | undefined {
    if (this.activeScope === 'global') {
      return undefined;
    }

    return {
      projectPath: this.selectedNavigationItem?.projectPath,
      sessionId: this.selectedNavigationItem?.sessionId,
    };
  }
}
