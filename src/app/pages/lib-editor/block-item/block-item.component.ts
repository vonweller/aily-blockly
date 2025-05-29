import { Component, ElementRef, EventEmitter, Input, OnInit, Output, SimpleChanges, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as Blockly from 'blockly';
import { ConfigService } from '../../../services/config.service';

@Component({
  selector: 'app-block-item',
  imports: [CommonModule],
  templateUrl: './block-item.component.html',
  styleUrl: './block-item.component.scss'
})
export class BlockItemComponent implements AfterViewInit, OnDestroy {

  @ViewChild('blockPreview', { static: true }) blockPreview!: ElementRef;

  @Input() blockDefinition: any; // 单个 block 的定义 JSON
  @Input() showError: boolean = false; // 是否显示错误信息

  @Output() clicked = new EventEmitter<any>(); // 点击 block 时触发
  @Output() blockError = new EventEmitter<string>(); // block 创建错误时触发

  private workspace: Blockly.WorkspaceSvg | null = null;
  private block: Blockly.Block | null = null;
  private errorMessage: string = '';

  constructor(
    private configService: ConfigService,
    private elementRef: ElementRef
  ) {

  }

  ngAfterViewInit(): void {
    if (this.blockDefinition) {
      this.createWorkspace();
      this.createBlock();
    }
  }

  ngOnDestroy(): void {
    if (this.workspace) {
      this.workspace.dispose();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['blockDefinition'] && !changes['blockDefinition'].firstChange) {
      if (this.workspace) {
        this.workspace.clear();
        this.createBlock();
      }
    }
  }

  private createWorkspace(): void {
    if (!this.blockPreview?.nativeElement) {
      return;
    }

    const blockPreview = this.blockPreview.nativeElement;

    // 创建工作区配置
    const workspaceConfig = {
      readOnly: true,
      renderer: this.configService.data.blockly.renderer || 'thrasos',
      toolbox: null, // 不需要工具箱
      scrollbars: false,
      trashcan: false,
      theme: {
        'name': 'transparent',
        'base': Blockly.Themes.Classic,
        'componentStyles': {
          'workspaceBackgroundColour': 'transparent'
        }
      }
    };
    this.workspace = Blockly.inject(blockPreview, workspaceConfig);
  }

  // 添加错误消息的 getter
  get hasError(): boolean {
    return !!this.errorMessage;
  }

  get error(): string {
    return this.errorMessage;
  }

  private createBlock(): void {
    if (!this.workspace || !this.blockDefinition) {
      this.setError('工作区或 block 定义无效');
      return;
    }

    try {
      this.clearError();
      // 验证 block 定义
      if (!this.blockDefinition.type) {
        throw new Error('Block 定义缺少 type 属性');
      }
      // 定义 block
      if (!Blockly.Blocks[this.blockDefinition.type]) {
        Blockly.defineBlocksWithJsonArray([this.blockDefinition]);
      }
      // 创建 block 实例
      this.block = this.workspace.newBlock(this.blockDefinition.type);
      (this.block as any).initSvg();
      (this.block as any).render();
      // 调整工作区和组件高度
      this.adjustHeights();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '创建 block 时出现未知错误';
      this.setError(errorMsg);
      console.error('创建 block 时出错:', error);
    }
  }

  private adjustHeights(): void {
    if (!this.block || !this.workspace || !this.blockPreview?.nativeElement) {
      return;
    }

    // 获取 block 的边界框
    const blockBBox = (this.block as any).getBoundingRectangle();

    // 计算新高度（添加一些边距）
    const padding = 2;
    const newHeight = blockBBox.bottom + padding;
    // console.log(this.blockDefinition.type, newHeight);


    // 调整工作区容器高度
    const workspaceContainer = this.blockPreview.nativeElement;
    workspaceContainer.style.height = `${newHeight}px`;

    // 调整组件根元素高度
    this.elementRef.nativeElement.style.height = `${newHeight}px`;

    // 触发工作区重新调整大小
    setTimeout(() => {
      if (this.workspace) {
        this.workspace.resizeContents();
      }
    }, 0);
  }

  private setError(message: string): void {
    this.errorMessage = message;
    this.blockError.emit(message);
  }

  private clearError(): void {
    this.errorMessage = '';
  }

  // 公共方法：刷新显示
  public refresh(): void {
    if (this.workspace && this.blockDefinition) {
      this.workspace.clear();
      this.createBlock();
    }
  }

  // 公共方法：获取当前 block
  public getBlock(): Blockly.Block | null {
    return this.block;
  }
}
