import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { FlatTreeControl } from '@angular/cdk/tree';
import { SelectionModel } from '@angular/cdk/collections';
import { NzTreeFlatDataSource, NzTreeFlattener, NzTreeViewModule } from 'ng-zorro-antd/tree-view';
import { FileService } from '../../file.service';
import { SimplebarAngularModule } from 'simplebar-angular';
import { CommonModule } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { NzTreeNodeOptions } from 'ng-zorro-antd/tree';

// 原始文件节点接口
interface FileNode {
  title: string;
  key: string;
  isLeaf: boolean;
  path: string;
  children?: FileNode[];
}

// 扁平化的文件节点接口
interface FlatFileNode {
  expandable: boolean;
  title: string;
  level: number;
  key: string;
  isLeaf: boolean;
  path: string;
}

@Component({
  selector: 'app-file-tree',
  imports: [NzTreeViewModule, SimplebarAngularModule, CommonModule],
  templateUrl: './file-tree.component.html',
  styleUrl: './file-tree.component.scss'
})
export class FileTreeComponent implements OnInit {

  @Input() rootPath: string;
  @Input() selectedFile;
  @Output() selectedFileChange = new EventEmitter();

  isLoading = false;
  // 维护一个数据副本
  private dataChange = new BehaviorSubject<FileNode[]>([]);

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };

  // 转换器 - 将原始节点转换为扁平节点
  private transformer = (node: FileNode, level: number): FlatFileNode => ({
    expandable: !node.isLeaf,
    title: node.title,
    level,
    key: node.key,
    isLeaf: node.isLeaf,
    path: node.path
  });

  // 选择模型 - 用于跟踪选中的节点
  nodeSelection = new SelectionModel<FlatFileNode>();

  // 树控件 - 使用 FlatTreeControl
  // 注意：虽然 FlatTreeControl 在 Angular 19 中被标记为已弃用，
  // 但 ng-zorro-antd 仍然需要它。我们需要等待 ng-zorro-antd 更新到新的 API。
  // 这个弃用警告是暂时的，不会影响应用程序的运行。
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - 已知的弃用警告，等待 ng-zorro-antd 更新
  treeControl = new FlatTreeControl<FlatFileNode>(
    node => node.level,
    node => node.expandable
  );

  // 树扁平化器
  treeFlattener = new NzTreeFlattener(
    this.transformer,
    node => node.level,
    node => node.expandable,
    node => node.children
  );

  // 数据源
  dataSource = new NzTreeFlatDataSource(this.treeControl, this.treeFlattener);

  constructor(
    private fileService: FileService
  ) {
    this.dataChange.subscribe(data => this.dataSource.setData(data));
  }

  ngOnInit() {
    this.loadRootPath();
  }

  loadRootPath(path = this.rootPath): void {
    const files = this.fileService.readDir(path);
    console.log('Loaded root path files:', files);
    this.dataChange.next(files as FileNode[]);
  }

  // 判断节点是否有子节点
  hasChild = (_: number, node: FlatFileNode): boolean => node.expandable;

  // 当节点被点击时
  nodeClick(node: FlatFileNode): void {
    if (node.isLeaf) {
      this.openFile(node);
    } else {
      this.openFolder(node);
    }
  }

  // 获取当前数据
  getCurrentData(): FileNode[] {
    return this.dataChange.value;
  }

  openFolder(folder: FlatFileNode) {
    // 如果是文件夹，展开或收起
    if (this.treeControl.isExpanded(folder)) {
      this.treeControl.collapse(folder);
    } else {
      this.treeControl.expand(folder);
      // 加载子文件夹内容
      const files = this.fileService.readDir(folder.path);
      console.log('Loaded folder files:', files);

    }
  }

  openFile(file) {
    this.selectedFile = file.path;
    this.selectedFileChange.emit(file);
  }

  getFileIcon(filename: string): string {
    // 根据文件扩展名返回不同的图标类
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'c': return 'fa-light fa-c';
      case 'cpp': return 'fa-light fa-c';
      case 'h': return 'fa-light fa-h';
      default: return 'fa-light fa-file';
    }
  }

  // 检查文件列表是否为空
  isEmpty(): boolean {
    return this.dataChange.value.length === 0;
  }

  refresh() {
    this.isLoading = true;
    setTimeout(() => {
      this.loadRootPath();
      this.isLoading = false;
    }, 1000);
  }
}
