import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { PythonRuntimeClient } from '../../../../../services/python-runtime/python-runtime-client';
import { joinRemotePath, normalizeRemoteDirectory, RemoteDirectoryNode } from '../../../../../services/python-runtime/remote-file-tree';

@Component({
  selector: 'app-remote-file-tree',
  standalone: true,
  imports: [CommonModule, FormsModule, NzIconModule],
  templateUrl: './remote-file-tree.component.html',
  styleUrl: './remote-file-tree.component.scss',
})
export class RemoteFileTreeComponent implements OnInit, OnChanges {
  @Input() enabled = false;
  @Input() disabledReason = '';
  @Input({ required: true }) runtime!: PythonRuntimeClient;
  @Output() fileOpen = new EventEmitter<RemoteDirectoryNode>();

  rootPath = '/';
  nodes: RemoteDirectoryNode[] = [];
  expanded = new Set<string>();
  children = new Map<string, RemoteDirectoryNode[]>();
  loading = new Set<string>();
  selectedPath = '';
  error = '';
  newFolderName = '';
  renameName = '';
  renaming = false;
  private requestGeneration = 0;

  constructor(
    private readonly modal: NzModalService,
    private readonly message: NzMessageService,
  ) {}

  ngOnInit(): void {
    if (this.enabled) void this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['enabled']?.currentValue === true && changes['enabled'].previousValue !== true) {
      void this.refresh();
    } else if (changes['enabled']?.currentValue === false) {
      this.clearDeviceState();
    }
  }

  async refresh(): Promise<void> {
    if (!this.enabled) return;
    const generation = this.requestGeneration;
    this.error = '';
    this.selectedPath = '';
    this.children.clear();
    this.loading.add(this.rootPath);
    try {
      const response = await this.runtime.listRemoteDirectory(this.rootPath);
      if (!this.isCurrentRequest(generation)) return;
      const entries = normalizeRemoteDirectory(this.rootPath, response);
      this.children.set(this.rootPath, entries);
      this.nodes = entries;
      this.expanded.clear();
    } catch (error) {
      if (this.isCurrentRequest(generation)) {
        this.error = this.errorText(error);
      }
    } finally {
      if (this.isCurrentRequest(generation)) {
        this.loading.delete(this.rootPath);
      }
    }
  }

  async toggle(node: RemoteDirectoryNode): Promise<void> {
    if (!this.enabled || node.type !== 'directory') return;
    if (this.expanded.has(node.path)) {
      this.expanded.delete(node.path);
      return;
    }
    this.expanded.add(node.path);
    if (this.children.has(node.path)) return;
    const generation = this.requestGeneration;
    this.loading.add(node.path);
    try {
      const response = await this.runtime.listRemoteDirectory(node.path);
      if (this.isCurrentRequest(generation)) {
        this.children.set(node.path, normalizeRemoteDirectory(node.path, response));
      }
    } catch (error) {
      if (this.isCurrentRequest(generation)) {
        this.expanded.delete(node.path);
        this.error = this.errorText(error);
      }
    } finally {
      if (this.isCurrentRequest(generation)) {
        this.loading.delete(node.path);
      }
    }
  }

  childrenOf(node: RemoteDirectoryNode): RemoteDirectoryNode[] {
    return this.children.get(node.path) || [];
  }

  select(node: RemoteDirectoryNode): void {
    if (!this.enabled) return;
    this.selectedPath = node.path;
    if (node.type === 'file') this.fileOpen.emit(node);
  }

  async createDirectory(): Promise<void> {
    if (!this.enabled) return;
    const name = this.newFolderName.trim();
    if (!name) return;
    if (!/^[^\\/]+$/.test(name) || name === '.' || name === '..') {
      this.error = 'Folder name contains invalid characters';
      return;
    }
    const parent = this.selectedDirectoryPath();
    try {
      await this.runtime.createRemoteDirectory(joinRemotePath(parent, name));
      this.newFolderName = '';
      await this.reloadDirectory(parent);
      this.message.success(`Created ${name}`);
    } catch (error) {
      this.error = this.errorText(error);
    }
  }

  deleteSelected(): void {
    if (!this.enabled) return;
    const node = this.findNode(this.selectedPath);
    if (!node) return;
    this.modal.confirm({
      nzTitle: `Delete ${node.name}?`,
      nzContent: node.type === 'directory' ? 'The directory must be empty.' : 'This cannot be undone on the device.',
      nzOkText: 'Delete',
      nzCancelText: 'Cancel',
      nzOnOk: async () => {
        if (!this.enabled) return;
        try {
          if (node.type === 'directory') await this.runtime.removeRemoteDirectory(node.path);
          else await this.runtime.deleteRemoteFile(node.path);
          this.selectedPath = '';
          await this.reloadDirectory(this.parentPath(node.path));
        } catch (error) {
          this.error = this.errorText(error);
        }
      },
    });
  }

  beginRename(): void {
    if (!this.enabled) return;
    const node = this.findNode(this.selectedPath);
    if (!node) return;
    this.renameName = node.name;
    this.renaming = true;
  }

  async renameSelected(): Promise<void> {
    if (!this.enabled) return;
    const node = this.findNode(this.selectedPath);
    const name = this.renameName.trim();
    if (!node || !name) return;
    if (!/^[^\\/]+$/.test(name) || name === '.' || name === '..') {
      this.error = 'Name contains invalid characters';
      return;
    }
    try {
      await this.runtime.renameRemotePath(node.path, joinRemotePath(this.parentPath(node.path), name));
      this.renaming = false;
      this.selectedPath = '';
      await this.reloadDirectory(this.parentPath(node.path));
    } catch (error) {
      this.error = this.errorText(error);
    }
  }

  async executeSelected(): Promise<void> {
    if (!this.enabled) return;
    const node = this.findNode(this.selectedPath);
    if (!node || node.type !== 'file') return;
    try {
      await this.runtime.executeRemoteFile(node.path);
      this.message.success(`Started ${node.name}`);
    } catch (error) {
      this.error = this.errorText(error);
    }
  }

  trackByPath(_index: number, node: RemoteDirectoryNode): string {
    return node.path;
  }

  isLoading(path: string): boolean {
    return this.loading.has(path);
  }

  private async reloadDirectory(path: string): Promise<void> {
    if (!this.enabled) return;
    const generation = this.requestGeneration;
    const response = await this.runtime.listRemoteDirectory(path);
    if (!this.isCurrentRequest(generation)) return;
    this.children.set(path, normalizeRemoteDirectory(path, response));
    if (path === this.rootPath) this.nodes = this.children.get(path) || [];
  }

  private selectedDirectoryPath(): string {
    const node = this.findNode(this.selectedPath);
    return node?.type === 'directory' ? node.path : this.parentPath(this.selectedPath || this.rootPath);
  }

  private findNode(path: string): RemoteDirectoryNode | undefined {
    if (!path) return undefined;
    for (const list of this.children.values()) {
      const match = list.find(node => node.path === path);
      if (match) return match;
    }
    return undefined;
  }

  private parentPath(path: string): string {
    const index = path.lastIndexOf('/');
    return index <= 0 ? '/' : path.slice(0, index);
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private clearDeviceState(): void {
    this.requestGeneration += 1;
    this.nodes = [];
    this.children.clear();
    this.expanded.clear();
    this.loading.clear();
    this.selectedPath = '';
    this.error = '';
    this.newFolderName = '';
    this.renameName = '';
    this.renaming = false;
  }

  private isCurrentRequest(generation: number): boolean {
    return this.enabled && generation === this.requestGeneration;
  }
}
