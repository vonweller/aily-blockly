import { Component, ElementRef, EventEmitter, Input, OnInit, Output, SimpleChanges, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as Blockly from 'blockly';
import { ConfigService } from '../../../services/config.service';

@Component({
  selector: 'app-block-test',
  imports: [CommonModule],
  templateUrl: './block-test.component.html',
  styleUrl: './block-test.component.scss'
})
export class BlockTestComponent implements AfterViewInit, OnDestroy {

  @ViewChild('blockPreview', { static: true }) blockPreview!: ElementRef;

  @Input() blockDefinition: any; // 单个 block 的定义 JSON
  @Input() showError: boolean = false; // 是否显示错误信息
  @Input() showToolbox: boolean = true; // 是否显示工具箱

  @Output() clicked = new EventEmitter<any>(); // 点击 block 时触发
  @Output() blockError = new EventEmitter<string>(); // block 创建错误时触发

  private workspace: Blockly.WorkspaceSvg | null = null;
  private block: Blockly.Block | null = null;
  private errorMessage: string = '';
  private previousBlockType: string | null = null; // 记录上一次的 block 类型

  // 工具箱配置
  private toolboxConfig = {
    "kind": "flyoutToolbox",
    "contents": [
      {
        "kind": "block",
        "type": "text"
      },
      {
        "kind": "block",
        "type": "math_number"
      },
      {
        "kind": "block",
        "type": "logic_boolean"
      }
    ]
  };

  constructor(
    private configService: ConfigService,
    private elementRef: ElementRef
  ) {

  }

  ngAfterViewInit(): void {
    this.createWorkspace();
    if (this.blockDefinition) {
      this.createBlock();
    }
  }
  ngOnDestroy(): void {
    // 清理 block 定义
    if (this.previousBlockType && Blockly.Blocks[this.previousBlockType]) {
      delete Blockly.Blocks[this.previousBlockType];
      if (Blockly.JavaScript && Blockly.JavaScript[this.previousBlockType]) {
        delete Blockly.JavaScript[this.previousBlockType];
      }
    }
    
    if (this.workspace) {
      this.workspace.dispose();
    }
  }
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['blockDefinition']) {
      if (this.workspace) {
        this.redefineAndCreateBlock();
      }
    }

    if (changes['showToolbox'] && !changes['showToolbox'].firstChange) {
      // 重新创建工作区以应用工具箱变化
      this.recreateWorkspace();
    }
  }

  private createWorkspace(): void {
    if (!this.blockPreview?.nativeElement) {
      return;
    }

    const blockPreview = this.blockPreview.nativeElement;

    // 创建工作区配置
    const workspaceConfig: any = {
      readOnly: false,
      renderer: this.configService.data.blockly.renderer || 'thrasos',
      toolbox: this.showToolbox ? this.toolboxConfig : null,
      scrollbars: true,
      trashcan: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 1.0,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.2
      },
      theme: {
        'name': 'custom',
        'base': Blockly.Themes.Classic,
        'componentStyles': {
          'workspaceBackgroundColour': '#f9f9f9'
        }
      }
    };

    this.workspace = Blockly.inject(blockPreview, workspaceConfig);

    // 添加事件监听器
    this.addWorkspaceListeners();
  }

  private addWorkspaceListeners(): void {
    if (!this.workspace) return;

    // 监听 block 点击事件
    this.workspace.addChangeListener((event: any) => {
      if (event.type === Blockly.Events.CLICK && event.targetType === 'block') {
        const clickedBlock = this.workspace!.getBlockById(event.blockId);
        if (clickedBlock) {
          this.clicked.emit({
            block: clickedBlock,
            type: clickedBlock.type,
            id: clickedBlock.id
          });
        }
      }
    });
  }

  private recreateWorkspace(): void {
    if (this.workspace) {
      // 保存当前工作区状态
      const workspaceXml = Blockly.Xml.workspaceToDom(this.workspace);

      // 销毁旧工作区
      this.workspace.dispose();

      // 创建新工作区
      this.createWorkspace();

      // 恢复工作区状态
      if (this.workspace) {
        Blockly.Xml.domToWorkspace(workspaceXml, this.workspace);
      }
    } else {
      this.createWorkspace();
    }
  }
  private redefineAndCreateBlock(): void {
    if (!this.workspace || !this.blockDefinition) {
      this.setError('工作区或 block 定义无效');
      return;
    }

    try {
      this.clearError();
      
      // 清空工作区
      this.workspace.clear();
      
      // 如果有之前的 block 类型，清除它的定义
      if (this.previousBlockType && Blockly.Blocks[this.previousBlockType]) {
        delete Blockly.Blocks[this.previousBlockType];
        // 如果有对应的代码生成器，也删除
        if (Blockly.JavaScript && Blockly.JavaScript[this.previousBlockType]) {
          delete Blockly.JavaScript[this.previousBlockType];
        }
      }
      
      // 如果当前 blockDefinition 有 type，也清除它的定义（防止缓存）
      if (this.blockDefinition.type && Blockly.Blocks[this.blockDefinition.type]) {
        delete Blockly.Blocks[this.blockDefinition.type];
        // 如果有对应的代码生成器，也删除
        if (Blockly.JavaScript && Blockly.JavaScript[this.blockDefinition.type]) {
          delete Blockly.JavaScript[this.blockDefinition.type];
        }
      }
      
      // 重新创建 block
      this.createBlock();
      
      // 更新 previousBlockType
      this.previousBlockType = this.blockDefinition.type;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '重新定义 block 时出现未知错误';
      this.setError(errorMsg);
      console.error('重新定义 block 时出错:', error);
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

      // 总是重新定义 block，确保最新的定义被使用
      Blockly.defineBlocksWithJsonArray([this.blockDefinition]);

      // 创建 block 实例
      this.block = this.workspace.newBlock(this.blockDefinition.type);
      (this.block as any).initSvg();
      (this.block as any).render();

      // 将 block 移动到工作区中心
      this.centerBlock();

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '创建 block 时出现未知错误';
      this.setError(errorMsg);
      console.error('创建 block 时出错:', error);
    }
  }

  private centerBlock(): void {
    if (!this.block || !this.workspace) return;

    // 获取工作区的可见区域
    const metrics = this.workspace.getMetrics();

    // 计算中心位置
    const centerX = metrics.viewWidth / 2 - metrics.viewLeft;
    const centerY = metrics.viewHeight / 2 - metrics.viewTop;

    // 移动 block 到中心
    this.block.moveBy(centerX - 50, centerY - 50); // 减去一些偏移量使其更居中
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
      this.redefineAndCreateBlock();
    }
  }

  // 公共方法：获取当前 block
  public getBlock(): Blockly.Block | null {
    return this.block;
  }

  // 公共方法：获取工作区
  public getWorkspace(): Blockly.WorkspaceSvg | null {
    return this.workspace;
  }

  // 公共方法：获取工作区 XML
  public getWorkspaceXml(): string {
    if (!this.workspace) return '';
    const xml = Blockly.Xml.workspaceToDom(this.workspace);
    return Blockly.Xml.domToText(xml);
  }

  // // 公共方法：从 XML 加载工作区
  // public loadWorkspaceFromXml(xmlText: string): void {
  //   if (!this.workspace) return;

  //   try {
  //     this.workspace.clear();
  //     const xml = Blockly.Xml.textToDom(xmlText);
  //     Blockly.Xml.domToWorkspace(xml, this.workspace);
  //   } catch (error) {
  //     console.error('加载工作区 XML 时出错:', error);
  //     this.setError('加载工作区 XML 时出错');
  //   }
  // }

  // 公共方法：清空工作区
  public clearWorkspace(): void {
    if (this.workspace) {
      this.workspace.clear();
    }
    this.block = null;
  }

  // 公共方法：设置工具箱显示状态
  public setToolboxVisible(visible: boolean): void {
    this.showToolbox = visible;
    this.recreateWorkspace();
  }
}
