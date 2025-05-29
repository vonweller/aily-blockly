import { ChangeDetectorRef, Component, Input, SimpleChanges } from '@angular/core';
import { BlockItemComponent } from '../block-item/block-item.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../../services/electron.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { MonacoEditorComponent } from '../../../components/monaco-editor/monaco-editor.component';
import { SimplebarAngularModule } from 'simplebar-angular';
import { BlockTestComponent } from '../block-test/block-test.component';
// import { BlockVisualEditorComponent } from '../block-visual-editor/block-visual-editor.component';
import { NzButtonModule } from 'ng-zorro-antd/button';

@Component({
  selector: 'app-lib-content',
  imports: [
    CommonModule,
    FormsModule,
    BlockItemComponent,
    NzToolTipModule,
    NzTabsModule,
    MonacoEditorComponent,
    SimplebarAngularModule,
    BlockTestComponent,
    // BlockVisualEditorComponent,
    NzButtonModule
  ],
  templateUrl: './lib-content.component.html',
  styleUrl: './lib-content.component.scss'
})
export class LibContentComponent {

  selectedIndex = 0;

  @Input() path: string;

  blocks = []

  openedFiles: OpenedFile[] = [];

  selectedBlock: string;

  code = 'test'

  // 当前编辑模式：'code' 表示代码编辑，'visual' 表示可视化编辑
  editMode: 'code' | 'visual' = 'code';

  options = {
    autoHide: true,
    clickOnTrack: true,
    scrollbarMinSize: 50,
  };


  constructor(
    private electronService: ElectronService,
    private cd: ChangeDetectorRef
  ) {

  }

  onInit() {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['path'] && this.path) {
      // let files = [
      //   {
      //     path: this.path + '/block.json',
      //     title: 'block.json'
      //   },
      //   {
      //     path: this.path + '/generator.js',
      //     title: 'generator.js'
      //   },
      //   {
      //     path: this.path + '/toolbox.json',
      //     title: 'toolbox.json'
      //   },
      //   {
      //     path: this.path + '/package.json',
      //     title: 'package.json'
      //   }
      // ];
      // this.openedFiles = this.loadFiles(files);
      // this.code = this.openedFiles[0].content
      this.loadBlocks();
      this.onBlockClick(this.blocks[0]);
    }
  }

  loadFiles(files): OpenedFile[] {

    return files.map(file => {
      let content = this.electronService.readFile(file.path);
      return {
        path: file.path,
        title: file.title,
        content: content || '',
        isDirty: false
      }
    })
  }

  loadBlocks() {
    const blockPath = `${this.path}/block.json`;
    this.blocks = JSON.parse(this.electronService.readFile(blockPath))
  }

  onTabChange(index: number) {
    this.code = this.openedFiles[index].content
  }

  onCodeChange(code: string) {

  }

  // 切换编辑模式
  switchEditMode(mode: 'code' | 'visual') {
    this.editMode = mode;
  }

  // 处理可视化编辑器的 block 变更
  onVisualBlockChanged(updatedBlock: any) {
    if (this.selectedBlock) {
      // 更新当前选中的 block
      Object.assign(this.selectedBlock, updatedBlock);
      
      // 更新对应的文件内容
      const blockFileIndex = this.openedFiles.findIndex(file => file.title === 'block');
      if (blockFileIndex >= 0) {
        this.openedFiles[blockFileIndex].content = JSON.stringify(updatedBlock, null, 2);
        this.openedFiles[blockFileIndex].isDirty = true;
      }
      
      // 如果当前显示的是 block 文件，更新代码显示
      if (this.selectedIndex === blockFileIndex) {
        this.code = this.openedFiles[blockFileIndex].content;
      }
    }
  }

  // 处理可视化编辑器的预览
  onVisualBlockPreview(previewBlock: any) {
    // 这里可以实现实时预览功能，比如更新右侧的预览区域
    console.log('Preview block:', previewBlock);
  }

  onBlockClick(block: any) {
    this.selectedBlock = block;
    console.log('onBlockClick', block);

    this.openedFiles = [
      {
        path: this.path + '/block.json#' + block.type,
        title: 'block',
        content: JSON.stringify(block, null, 2),
      },
      {
        path: this.path + '/generator.js#' + block.type,
        title: 'generator',
        content: window['Arduino'].forBlock[block.type].toString(),
      },
    ];
    this.code = this.openedFiles[this.selectedIndex].content;
    this.cd.detectChanges();
    // this.openedFiles = this.loadFiles(files);
  }
}


export interface OpenedFile {
  path?: string;      // 文件路径
  title: string;     // 显示的文件名
  content?: string;   // 文件内容
  isDirty?: boolean;  // 是否有未保存的更改
}