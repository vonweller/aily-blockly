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
  template: `
    <div class="aily-blockly-viewer">
      <div class="viewer-header">
        <div class="header-left">
          <span class="type-badge">Blockly</span>
          <span class="title" *ngIf="data?.metadata?.title">{{ data.metadata.title }}</span>
        </div>
        <div class="header-actions">
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="复制到剪贴板"
            (click)="copyToClipboard()">
            <span nz-icon nzType="copy"></span>
          </button>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="导入到工作区"
            (click)="importToWorkspace()"
            *ngIf="canImport">
            <span nz-icon nzType="import"></span>
          </button>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="切换视图"
            (click)="toggleView()">
            <span nz-icon [nzType]="showRaw ? 'eye' : 'code'"></span>
          </button>
        </div>
      </div>
      
      <div class="viewer-content">
        <div *ngIf="!showRaw && blocklyData" class="blockly-view">
          <app-aily-blockly [data]="blocklyData" #blocklyComponent></app-aily-blockly>
        </div>
        
        <div *ngIf="showRaw" class="raw-view">
          <pre><code>{{ formatData() }}</code></pre>
        </div>
        
        <div *ngIf="errorMessage" class="error-view">
          <div class="error-content">
            <span nz-icon nzType="exclamation-circle" class="error-icon"></span>
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>
      
      <div class="viewer-footer" *ngIf="data?.metadata">
        <small class="metadata-info">
          <span *ngIf="data.metadata.description">{{ data.metadata.description }}</span>
          <span *ngIf="data.metadata.version" class="version">v{{ data.metadata.version }}</span>
        </small>
      </div>
    </div>
  `,
  styles: [`
    .aily-blockly-viewer {
      border: 1px solid #d9d9d9;
      border-radius: 6px;
      margin: 12px 0;
      background-color: #fafafa;
      overflow: hidden;
    }

    .viewer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background-color: #f5f5f5;
      border-bottom: 1px solid #d9d9d9;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .type-badge {
      background-color: #1890ff;
      color: white;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 500;
    }

    .title {
      font-weight: 500;
      color: #262626;
    }

    .header-actions {
      display: flex;
      gap: 4px;
    }

    .viewer-content {
      min-height: 120px;
    }

    .blockly-view {
      padding: 12px;
      background-color: white;
    }

    .raw-view {
      padding: 12px;
      background-color: #f8f8f8;
    }

    .raw-view pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .raw-view code {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      line-height: 1.4;
      color: #333;
    }

    .error-view {
      padding: 12px;
      background-color: #fff2f0;
      border-left: 4px solid #ff4d4f;
    }

    .error-content {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #a8071a;
    }

    .error-icon {
      color: #ff4d4f;
    }

    .viewer-footer {
      padding: 8px 12px;
      background-color: #f5f5f5;
      border-top: 1px solid #d9d9d9;
    }

    .metadata-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #8c8c8c;
    }

    .version {
      font-family: monospace;
    }
  `]
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
