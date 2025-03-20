import { Component } from '@angular/core';
import { FileTreeComponent } from './components/file-tree/file-tree.component';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzModalService } from 'ng-zorro-antd/modal';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../../services/project.service';
import { MonacoEditorComponent } from '../../components/monaco-editor/monaco-editor.component';

export interface OpenedFile {
  path: string;      // 文件路径
  title: string;     // 显示的文件名
  content: string;   // 文件内容
  isDirty: boolean;  // 是否有未保存的更改
}

@Component({
  selector: 'app-code-editor',
  imports: [FileTreeComponent, NzTabsModule, MonacoEditorComponent, CommonModule],
  templateUrl: './code-editor.component.html',
  styleUrl: './code-editor.component.scss'
})
export class CodeEditorComponent {
  // 当前编辑器内容
  code: string = '';
  // 当前选中的文件路径
  selectedFile: string = '';
  // 当前打开的文件
  openedFiles: OpenedFile[] = [];
  // 当前选中的标签页索引
  selectedIndex = 0;

  loaded = false;

  get projectPath() {
    return this.projectService.currentProjectPath
  }

  sdkPath;
  librariesPath;

  constructor(
    private modal: NzModalService,
    private projectService: ProjectService
  ) { }

  async ngOnInit() {
  }

  // 从文件树选择文件时触发
  selectedFileChange(file: any) {
    const filePath = file.path;
    // 检查文件是否已经打开
    const existingFileIndex = this.openedFiles.findIndex(f => f.path === filePath);

    if (existingFileIndex >= 0) {
      // 如果已经打开，切换到该标签页
      this.selectedIndex = existingFileIndex;
    } else {
      // 否则新建标签页
      const content = window['fs'].readFileSync(filePath);
      const newFile: OpenedFile = {
        path: filePath,
        title: file.title,
        content: content,
        isDirty: false
      };

      this.openedFiles.push(newFile);
      this.selectedIndex = this.openedFiles.length - 1;
    }

    this.updateCurrentCode();
  }

  // 更新当前编辑器内容
  updateCurrentCode() {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.openedFiles.length) {
      this.code = this.openedFiles[this.selectedIndex].content;
      this.selectedFile = this.openedFiles[this.selectedIndex].path;
    } else {
      this.code = '';
      this.selectedFile = '';
    }

    this.sdkPath="D:\\Git\\aily-project-lod\\packages\\sdk\\avr\\avr@1.8.6";
    this.librariesPath="C:\\Users\\coloz\\Documents\\Arduino\\sketch_mar16a\\libraries";
  }

  // 关闭标签页
  closeTab({ index }: { index: number }): void {
    const file = this.openedFiles[index];

    if (file.isDirty) {
      // 如果文件有未保存的更改，弹出确认框
      this.modal.confirm({
        nzTitle: '确认关闭',
        nzContent: `${file.title} 有未保存的更改，是否保存？`,
        nzOkText: '保存',
        nzCancelText: '不保存',
        nzOnOk: () => {
          this.saveFile(index);
          this.doCloseTab(index);
        },
        nzOnCancel: () => {
          this.doCloseTab(index);
        }
      });
    } else {
      this.doCloseTab(index);
    }
  }

  // 实际执行关闭标签页的操作
  private doCloseTab(index: number): void {
    this.openedFiles.splice(index, 1);

    // 如果关闭的是当前选中的标签页，需要调整选中索引
    if (index === this.selectedIndex) {
      // 如果关闭的是最后一个标签页，选中前一个
      if (index === this.openedFiles.length) {
        this.selectedIndex = Math.max(0, index - 1);
      }
      // 否则保持当前索引，因为后面的标签会前移
      this.updateCurrentCode();
    } else if (index < this.selectedIndex) {
      // 如果关闭的标签在当前选中标签之前，需要调整索引
      this.selectedIndex--;
    }
  }

  // 保存文件
  saveFile(index: number): void {
    const file = this.openedFiles[index];
    window['fs'].writeFileSync(file.path, file.content);
    file.isDirty = false;
  }

  // 保存当前文件
  saveCurrentFile(): void {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.openedFiles.length) {
      this.saveFile(this.selectedIndex);
    }
  }

  // 标签页切换事件
  onTabChange(index: number): void {
    this.selectedIndex = index;
    this.updateCurrentCode();
  }

  // 编辑器内容变更事件
  onCodeChange(newContent: string): void {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.openedFiles.length) {
      const currentFile = this.openedFiles[this.selectedIndex];
      if (currentFile.content !== newContent) {
        currentFile.content = newContent;
        currentFile.isDirty = true;
      }
    }
  }

  // 处理鼠标中键点击事件
  handleMiddleClick(event: MouseEvent, index: number): void {
    // 鼠标中键的button值为1
    if (event.button === 1) {
      // 阻止默认行为（如在某些浏览器中的自动滚动）
      event.preventDefault();
      // 关闭对应的标签页
      this.doCloseTab(index);
    }
  }
}
