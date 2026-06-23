import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';

import { BaseDialogComponent } from '../../../../components/base-dialog/base-dialog.component';
import type { IAilyHostAPI } from '../../core/host-api';
import type { ChatSessionListItem } from '../../services/menu-manager.service';
import { ChatMemoryManagerState } from './memory-manager.state';
import { ProjectRelatedFileStorage } from './project-related-file-storage';
import type { ProjectRelatedFileEntry } from './project-related-file.types';
import { ChatMemoryStorage } from './memory-storage';
import type {
  ChatMemoryEntry,
  ChatMemoryNavigationItem,
  ChatMemoryScope,
} from './memory-manager.types';

interface RecentProjectItem {
  readonly name: string;
  readonly path: string;
  readonly nickname?: string;
}

interface MemoryManagerDialogData {
  readonly host: IAilyHostAPI;
  readonly projectPath: string;
  readonly sessionId?: string;
  readonly recentProjects: readonly RecentProjectItem[];
  readonly sessionItems: readonly ChatSessionListItem[];
}

interface MemoryScopeOption {
  readonly scope: ChatMemoryScope;
  readonly labelKey: string;
}

@Component({
  selector: 'app-memory-manager-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslateModule,
    NzPopconfirmModule,
    BaseDialogComponent,
  ],
  templateUrl: './memory-manager-dialog.component.html',
  styleUrl: './memory-manager-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemoryManagerDialogComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly modalRef = inject(NzModalRef);
  private readonly message = inject(NzMessageService);
  private readonly translate = inject(TranslateService);
  private readonly data = inject<MemoryManagerDialogData>(NZ_MODAL_DATA);

  readonly scopeOptions: readonly MemoryScopeOption[] = [
    { scope: 'global', labelKey: 'AILY_CHAT.MEMORY_GLOBAL' },
    { scope: 'project', labelKey: 'AILY_CHAT.MEMORY_PROJECT' },
    { scope: 'session', labelKey: 'AILY_CHAT.MEMORY_SESSION' },
  ];

  readonly state = new ChatMemoryManagerState(
    new ChatMemoryStorage(
      this.data.host,
      this.data.projectPath,
      this.data.sessionId,
    ),
    this.buildProjectNavigationItems(),
    this.buildSessionNavigationItems(),
  );
  readonly relatedFileStorage = new ProjectRelatedFileStorage(this.data.host);
  relatedFiles: readonly ProjectRelatedFileEntry[] = [];

  constructor() {
    this.state.initialize();
    this.refreshRelatedFiles();
  }

  closeDialog(): void {
    this.runWithHandling(() => {
      this.state.flushAll();
      this.modalRef.close(true);
    }, 'AILY_CHAT.MEMORY_SAVE_ERROR');
  }

  switchScope(scope: ChatMemoryScope): void {
    this.runWithHandling(
      () => {
        this.state.switchScope(scope);
        this.refreshRelatedFiles();
      },
      'AILY_CHAT.MEMORY_SAVE_ERROR',
    );
  }

  updateSearch(value: string): void {
    this.state.setSearchTerm(value);
  }

  createEntry(): void {
    this.runWithHandling(
      () => this.state.createEntry(),
      'AILY_CHAT.MEMORY_CREATE_ERROR',
    );
  }

  selectNavigationItem(item: ChatMemoryNavigationItem): void {
    this.runWithHandling(
      () => {
        this.state.selectNavigationItem(item);
        this.refreshRelatedFiles();
      },
      'AILY_CHAT.MEMORY_SAVE_ERROR',
    );
  }

  updateDraft(entry: ChatMemoryEntry, value: string): void {
    this.state.updateDraft(entry, value);
  }

  flushEntry(entry: ChatMemoryEntry): void {
    this.runWithHandling(
      () => this.state.flushEntry(entry),
      'AILY_CHAT.MEMORY_SAVE_ERROR',
    );
  }

  deleteEntry(entry: ChatMemoryEntry): void {
    this.runWithHandling(
      () => this.state.deleteEntry(entry),
      'AILY_CHAT.MEMORY_DELETE_ERROR',
    );
  }

  async addRelatedFiles(): Promise<void> {
    try {
      const projectPath = this.getSelectedProjectPath();
      if (!projectPath) {
        return;
      }

      const result = await this.relatedFileStorage.pickAndCopy(projectPath);
      this.refreshRelatedFiles();
      if (result.skippedOriginalPaths.length > 0) {
        this.message.info(
          this.translate.instant('AILY_CHAT.MEMORY_RELATED_SKIP_DUPLICATE', {
            count: result.skippedOriginalPaths.length,
          }),
        );
      }
    } catch (error) {
      console.error('[MemoryManagerDialog] related files add failed:', error);
      this.message.error(this.translate.instant('AILY_CHAT.MEMORY_RELATED_ADD_ERROR'));
    }
  }

  removeRelatedFile(entry: ProjectRelatedFileEntry): void {
    try {
      const projectPath = this.getSelectedProjectPath();
      if (!projectPath) {
        return;
      }

      this.relatedFileStorage.remove(projectPath, entry);
      this.refreshRelatedFiles();
    } catch (error) {
      console.error('[MemoryManagerDialog] related files remove failed:', error);
      this.message.error(this.translate.instant('AILY_CHAT.MEMORY_RELATED_DELETE_ERROR'));
    }
  }

  openRelatedFileInExplorer(entry: ProjectRelatedFileEntry): void {
    const targetPath = this.resolveExplorerPath(entry);
    this.data.host.shell?.openByExplorer?.(targetPath);
  }

  trackByScope(_: number, item: MemoryScopeOption): ChatMemoryScope {
    return item.scope;
  }

  trackByNavigationId(_: number, item: ChatMemoryNavigationItem): string {
    return item.id;
  }

  trackByPath(_: number, item: ChatMemoryEntry): string {
    return item.absolutePath;
  }

  trackByRelatedFilePath(_: number, item: ProjectRelatedFileEntry): string {
    return item.absolutePath;
  }

  describeEntry(entry: ChatMemoryEntry): string {
    return this.readContentSummary(entry.content) || entry.fileName;
  }

  formatRelativeTime(updatedAt: number): string {
    const elapsedMs = Math.max(0, Date.now() - updatedAt);
    const minutes = Math.max(1, Math.floor(elapsedMs / (60 * 1000)));

    if (minutes < 60) {
      return this.translate.instant(
        'AILY_CHAT.MEMORY_RELATIVE_MINUTES',
        { count: minutes },
      );
    }

    const hours = Math.max(1, Math.floor(minutes / 60));
    if (hours < 24) {
      return this.translate.instant(
        'AILY_CHAT.MEMORY_RELATIVE_HOURS',
        { count: hours },
      );
    }

    const days = Math.max(1, Math.floor(hours / 24));
    return this.translate.instant(
      'AILY_CHAT.MEMORY_RELATIVE_DAYS',
      { count: days },
    );
  }

  private runWithHandling(action: () => void, errorKey: string): void {
    try {
      action();
    } catch (error) {
      console.error('[MemoryManagerDialog] operation failed:', error);
      this.message.error(this.translate.instant(errorKey));
    }
  }

  private buildProjectNavigationItems(): readonly ChatMemoryNavigationItem[] {
    const items = this.data.recentProjects.map((project) => ({
      id: project.path,
      title: project.nickname?.trim() || project.name?.trim() || project.path,
      updatedAt: this.readPathUpdatedAt(project.path),
      projectPath: project.path,
    }));

    if (
      this.data.projectPath
      && !items.some((item) => item.id === this.data.projectPath)
    ) {
      items.unshift({
        id: this.data.projectPath,
        title: this.data.host.path.basename(this.data.projectPath),
        updatedAt: this.readPathUpdatedAt(this.data.projectPath),
        projectPath: this.data.projectPath,
      });
    }

    return items;
  }

  private buildSessionNavigationItems(): readonly ChatMemoryNavigationItem[] {
    return this.data.sessionItems
      .filter((item) => item.sessionId)
      .map((item) => ({
        id: item.sessionId,
        title: item.title,
        updatedAt: item.timing?.updated ?? item.timing?.created ?? Date.now(),
        projectPath: item.projectPath ?? this.data.projectPath,
        sessionId: item.sessionId,
      }));
  }

  private readPathUpdatedAt(projectPath: string): number {
    try {
      if (!projectPath || !this.data.host.fs.existsSync(projectPath)) {
        return 0;
      }

      return this.data.host.fs.statSync(projectPath).mtime.getTime();
    } catch {
      return 0;
    }
  }

  private refreshRelatedFiles(): void {
    if (this.state.activeScope !== 'project') {
      this.relatedFiles = [];
      this.cdr.markForCheck();
      return;
    }

    const projectPath = this.getSelectedProjectPath();
    this.relatedFiles = projectPath
      ? this.relatedFileStorage.list(projectPath)
      : [];
    this.cdr.markForCheck();
  }

  private getSelectedProjectPath(): string | undefined {
    return this.state.activeScope === 'project'
      ? this.state.selectedNavigationItem?.projectPath
      : undefined;
  }

  private resolveExplorerPath(entry: ProjectRelatedFileEntry): string {
    try {
      if (
        this.data.host.fs.existsSync(entry.absolutePath)
        && this.data.host.fs.statSync(entry.absolutePath).isFile()
      ) {
        return this.data.host.path.dirname(entry.absolutePath);
      }
    } catch {
      return this.data.host.path.dirname(entry.absolutePath);
    }

    return entry.absolutePath;
  }

  private readContentSummary(content: string): string {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return this.translate.instant('AILY_CHAT.MEMORY_EMPTY');
    }

    const firstLine = lines[0];
    return firstLine.length > 28 ? `${firstLine.slice(0, 28)}...` : firstLine;
  }
}
