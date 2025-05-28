import { Component, ElementRef, EventEmitter, Input, OnInit, Output, SimpleChanges, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as Blockly from 'blockly';

@Component({
  selector: 'app-block-item',
  imports: [CommonModule],
  templateUrl: './block-item.component.html',
  styleUrl: './block-item.component.scss'
})
export class BlockItemComponent implements AfterViewInit, OnDestroy {

  @ViewChild('blockPreview', { static: true }) blockPreview!: ElementRef;

  @Input() blockDefinition: any; // 单个 block 的定义 JSON
  @Input() readOnly: boolean = true; // 默认只读模式
  @Input() theme: string = 'zelos'; // 主题
  @Input() renderer: string = 'zelos'; // 渲染器
  @Input() showError: boolean = false; // 是否显示错误信息

  @Output() blockClicked = new EventEmitter<any>(); // 点击 block 时触发
  @Output() blockError = new EventEmitter<string>(); // block 创建错误时触发

  private workspace: Blockly.WorkspaceSvg | null = null;
  private block: Blockly.Block | null = null;
  private errorMessage: string = '';

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
      readOnly: this.readOnly,
      media: 'assets/blockly/media/', // 根据你的项目结构调整路径
      theme: this.theme,
      renderer: this.renderer,
      toolbox: null, // 不需要工具箱
      scrollbars: false,
      trashcan: false,
      zoom: {
        controls: false,
        wheel: false,
        startScale: 1.0,
        maxScale: 1.0,
        minScale: 1.0
      },
      move: {
        scrollbars: false,
        drag: false,
        wheel: false
      }
    };

    this.workspace = Blockly.inject(blockPreview, workspaceConfig);    // 添加点击事件监听
    if (!this.readOnly) {
      this.workspace.addChangeListener((event: any) => {
        if (event.type === 'click' && event.blockId) {
          this.blockClicked.emit(this.block);
        }
      });
    }
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

      // 居中显示 block
      this.centerBlock();

      // 如果是只读模式，禁用拖拽
      if (this.readOnly) {
        this.block.setMovable(false);
        this.block.setDeletable(false);
        this.block.setEditable(false);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '创建 block 时出现未知错误';
      this.setError(errorMsg);
      console.error('创建 block 时出错:', error);
    }
  }

  private setError(message: string): void {
    this.errorMessage = message;
    this.blockError.emit(message);
  }

  private clearError(): void {
    this.errorMessage = '';
  }

  private centerBlock(): void {
    if (!this.block || !this.workspace) {
      return;
    }

    // 获取 block 的边界框
    const blockBBox = (this.block as any).getBoundingRectangle();
    const workspaceMetrics = this.workspace.getMetrics();

    // 计算居中位置
    const centerX = (workspaceMetrics.viewWidth - blockBBox.width) / 2;
    const centerY = (workspaceMetrics.viewHeight - blockBBox.height) / 2;

    // 移动 block 到中心位置
    this.block.moveBy(centerX - blockBBox.left, centerY - blockBBox.top);
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
