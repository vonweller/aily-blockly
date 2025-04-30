import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { FlatTreeControl } from '@angular/cdk/tree';
import { SelectionModel } from '@angular/cdk/collections';
import { NzTreeFlatDataSource, NzTreeFlattener, NzTreeViewModule } from 'ng-zorro-antd/tree-view';
import { FileService } from '../../file.service';
import { SimplebarAngularModule } from 'simplebar-angular';
import { CommonModule } from '@angular/common';
import { BehaviorSubject } from 'rxjs';

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

  @Input() rootPath:string;
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

  // 树控件
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
    this.loadFiles();
  }

  loadFiles() {
    // 从文件服务中读取文件
    const files = this.fileService.readDir(this.rootPath);
    this.dataChange.next(files as FileNode[]);
  }

  // 判断节点是否有子节点
  hasChild = (_: number, node: FlatFileNode): boolean => node.expandable;

  // 当节点被点击时
  nodeClick(node: FlatFileNode): void {    
    if (node.isLeaf) {
      this.openFile(node);
    } else {
      // 切换展开状态
      this.treeControl.toggle(node);
      // 如果节点展开且没有子节点，则加载子节点
      if (this.treeControl.isExpanded(node)) {
        this.loadChildren(node);
      }
    }
  }

  // 获取当前数据
  getCurrentData(): FileNode[] {
    return this.dataChange.value;
  }

  // 加载子节点
  loadChildren(node: FlatFileNode): void {
    // 获取当前原始数据
    const currentData = [...this.getCurrentData()];
    
    // 查找原始数据中的节点
    const findNode = (nodes: FileNode[], path: string): FileNode | null => {
      for (const n of nodes) {
        if (n.path === path) return n;
        if (n.children) {
          const found = findNode(n.children, path);
          if (found) return found;
        }
      }
      return null;
    };

    const originalNode = findNode(currentData, node.path);
    
    if (originalNode && (!originalNode.children || originalNode.children.length === 0)) {
      // 加载子节点
      originalNode.children = this.fileService.readDir(node.path) as FileNode[];
      // 更新数据源
      this.dataChange.next(currentData);
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
      this.loadFiles();
      this.isLoading = false;
    }, 1000);
  }
}
