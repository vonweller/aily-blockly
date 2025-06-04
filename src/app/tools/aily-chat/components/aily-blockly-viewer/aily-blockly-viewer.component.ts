import { Component, Input, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AilyBlocklyComponent } from '../../../../components/aily-blockly/aily-blockly.component';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';

export interface AilyBlocklyData {
  type: 'aily-blockly';
  blocks?: any;
  workspace?: any;
  metadata?: any;
  raw?: string;
  content?: string;
}

@Component({
  selector: 'app-aily-blockly-viewer',
  standalone: true,
  imports: [
    CommonModule,
    AilyBlocklyComponent,
    NzButtonModule,
    NzIconModule,
    NzToolTipModule
  ],
  templateUrl: './aily-blockly-viewer.component.html',
  styleUrls: ['./aily-blockly-viewer.component.scss']
})
export class AilyBlocklyViewerComponent implements OnInit, OnDestroy {
  @Input() data: AilyBlocklyData | null = null;
  @ViewChild('blocklyComponent') blocklyComponent?: AilyBlocklyComponent;

  showRaw = false;
  errorMessage = '';
  blocklyData: any = null;
  canImport = false; // 可以根据实际情况判断是否支持导入

  ngOnInit() {
    this.processData();
    // 检查是否在主编辑器环境中，如果是则显示导入按钮
    this.canImport = this.checkCanImport();
  }

  ngOnDestroy() {
    // 清理资源
  }

  /**
   * 设置组件数据（由指令调用）
   */
  setData(data: AilyBlocklyData): void {
    this.data = data;
    this.processData();
  }

  /**
   * 处理数据
   */
  private processData(): void {
    if (!this.data) {
      this.errorMessage = '没有可显示的数据';
      return;
    }

    try {
      if (this.data.metadata?.isRawText) {
        // 如果是原始文本，尝试解析
        this.parseRawContent();
      } else {
        // 处理 JSON 数据
        this.blocklyData = this.data.blocks || this.data.workspace || {};
      }
      this.errorMessage = '';
    } catch (error) {
      console.error('Error processing blockly data:', error);
      this.errorMessage = `数据处理失败: ${error.message}`;
    }
  }

  /**
   * 解析原始内容
   */
  private parseRawContent(): void {
    try {
      const content = this.data?.content || this.data?.raw || '';
      if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        this.blocklyData = JSON.parse(content);
      } else {
        throw new Error('无法解析的内容格式');
      }
    } catch (error) {
      // 如果解析失败，显示原始内容
      this.showRaw = true;
      this.errorMessage = '无法解析 Blockly 数据，显示原始内容';
    }
  }

  /**
   * 切换显示模式
   */
  toggleView(): void {
    this.showRaw = !this.showRaw;
  }

  /**
   * 格式化显示数据
   */
  formatData(): string {
    if (this.data?.content || this.data?.raw) {
      return this.data.content || this.data.raw || '';
    }
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * 复制到剪贴板
   */
  async copyToClipboard(): Promise<void> {
    try {
      const content = this.showRaw ? this.formatData() : JSON.stringify(this.blocklyData, null, 2);
      await navigator.clipboard.writeText(content);
      // 这里可以添加成功提示
      console.log('内容已复制到剪贴板');
    } catch (error) {
      console.error('复制失败:', error);
      // 这里可以添加错误提示
    }
  }

  /**
   * 导入到工作区
   */
  importToWorkspace(): void {
    try {
      if (!this.blocklyData) {
        throw new Error('没有可导入的数据');
      }

      // 这里需要根据实际的应用架构来实现
      // 可能需要通过服务或事件来通知主工作区
      
      // 示例实现：
      // this.blocklyService.importWorkspace(this.blocklyData);
      
      console.log('导入到工作区:', this.blocklyData);
      // 可以添加成功提示
    } catch (error) {
      console.error('导入失败:', error);
      this.errorMessage = `导入失败: ${error.message}`;
    }
  }

  /**
   * 检查是否可以导入
   */
  private checkCanImport(): boolean {
    // 这里可以根据实际情况判断
    // 例如检查是否在编辑器环境中，是否有权限等
    return typeof window !== 'undefined' && window.location?.pathname.includes('blockly');
  }
}
