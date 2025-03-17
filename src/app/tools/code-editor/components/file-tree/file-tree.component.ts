import { Component, EventEmitter, Input, output, Output } from '@angular/core';
import { NzFormatEmitEvent, NzTreeModule, NzTreeNode, NzTreeNodeOptions } from 'ng-zorro-antd/tree';
import { FileService } from '../../file.service';

@Component({
  selector: 'app-file-tree',
  imports: [NzTreeModule],
  templateUrl: './file-tree.component.html',
  styleUrl: './file-tree.component.scss'
})
export class FileTreeComponent {

  @Input() rootPath = 'd:\\';
  @Output() selectedFile = '';
  @Output() selectedFileChange = new EventEmitter();

  nodes: NzTreeNodeOptions[] = [];

  isLoading = false;

  activatedNode?: NzTreeNode;

  constructor(
    private fileService: FileService
  ) {

  }

  ngOnInit() {
    this.nodes = this.fileService.readDir(this.rootPath);
  }


  activeNode(data: NzFormatEmitEvent): void {
    console.log(data);
    
    if (!data.node.origin.isLeaf) {
      if(data.node.isExpanded){
        data.node.setExpanded(false);
        data.node.clearChildren();
      }else{
        data.node.setExpanded(true);
        let nodes = this.fileService.readDir(data.node.origin['path']);
        data.node.addChildren(nodes);
      }
    } else {
      this.openFile(data.node.origin);
    }
    // this.activatedNode = data.node!;
  }

  openFile(file) {
    console.log('open file', file);
  }

  getFileIcon(filename: string): string {
    // 根据文件扩展名返回不同的图标类
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'js': return 'fa-file-code js-file';
      case 'ts': return 'fa-file-code ts-file';
      case 'html': return 'fa-file-code html-file';
      case 'css': case 'scss': return 'fa-file-code css-file';
      case 'json': return 'fa-file-code json-file';
      case 'md': return 'fa-file-alt md-file';
      case 'jpg': case 'jpeg': case 'png': case 'gif': return 'fa-file-image image-file';
      default: return 'fa-file default-file';
    }
  }

  refresh() {
    this.isLoading = true;
    setTimeout(() => {
      this.isLoading = false;
    }, 1000);
  }
}
