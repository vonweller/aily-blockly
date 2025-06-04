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
import { BlocklyService } from '../../../blockly/blockly.service';

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
    private cd: ChangeDetectorRef,
    private blocklyService: BlocklyService
  ) {

  }

  onInit() {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['path'] && this.path) {
      this.loadBlocks();
      this.onBlockClick(this.blocks[0]);
    }
  }

  testcode;
  ngAfterViewInit(): void {
    this.blocklyService.codeSubject.subscribe((code) => {
      setTimeout(() => {
        this.testcode = code;
      }, 100);
    });
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

  currentBlockJson;
  onCodeChange(code: string) {
    // console.log(code);
    if (this.selectedIndex == 0) {
      try {
        this.currentBlockJson = JSON.parse(code);
      } catch (error) {
        this.currentBlockJson = {};
        console.error('解析代码失败:', error);
      }
    }
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
      }, {
        path: this.path + '/toolbox.json#' + block.type,
        title: 'toolbox',
        content: this.getBlockToolboxContent(block),
      },
    ];
    this.code = this.openedFiles[this.selectedIndex].content;
    this.cd.detectChanges();
    // this.openedFiles = this.loadFiles(files);
    this.currentBlockJson = JSON.parse(JSON.stringify(block));
  }

  // 获取指定block的toolbox内容
  getBlockToolboxContent(block: any): string {
    try {
      // 查找当前选中block对应的toolbox条目
      const blockToolboxItem = this.findBlockToolboxItem(block.type);

      if (blockToolboxItem) {
        return JSON.stringify(blockToolboxItem, null, 2);
      }

      // 方法2: 如果没有找到，尝试从本地文件读取
      const toolboxPath = `${this.path}/toolbox.json`;
      if (this.electronService.exists(toolboxPath)) {
        const toolboxContent = this.electronService.readFile(toolboxPath);
        return toolboxContent || '{}';
      }

      // 方法3: 返回默认的block toolbox条目
      return JSON.stringify({
        kind: 'block',
        type: block.type
      }, null, 2);
    } catch (error) {
      console.error('获取toolbox内容失败:', error);
      return JSON.stringify({
        kind: 'block',
        type: block.type
      }, null, 2);
    }
  }

  // 查找指定block类型对应的toolbox条目
  private findBlockToolboxItem(blockType: string): any | null {
    const toolboxData = this.blocklyService.toolbox;
    if (!toolboxData || !toolboxData.contents) return null;

    for (const content of toolboxData.contents) {
      if (content.kind === 'category' && content.contents) {
        for (const item of content.contents) {
          if (item.kind === 'block' && item.type === blockType) {
            return item; // 返回具体的block toolbox条目
          }
        }
      }
    }
    return null;
  }

  // 获取所有已加载的toolbox数据
  getAllLoadedToolboxData(): any {
    return this.blocklyService.toolbox;
  }

  // 获取所有分类列表
  getAllCategories(): any[] {
    const toolbox = this.blocklyService.toolbox;
    if (!toolbox || !toolbox.contents) return [];

    return toolbox.contents.filter(item => item.kind === 'category');
  }

  // 根据分类名称获取分类数据
  getCategoryByName(categoryName: string): any | null {
    const categories = this.getAllCategories();
    return categories.find(category => category.name === categoryName) || null;
  }

  // 获取指定分类中的所有block类型
  getBlockTypesInCategory(categoryName: string): string[] {
    const category = this.getCategoryByName(categoryName);
    if (!category || !category.contents) return [];

    return category.contents
      .filter(item => item.kind === 'block')
      .map(item => item.type);
  }
}


export interface OpenedFile {
  path?: string;      // 文件路径
  title: string;     // 显示的文件名
  content?: string;   // 文件内容
  isDirty?: boolean;  // 是否有未保存的更改
}