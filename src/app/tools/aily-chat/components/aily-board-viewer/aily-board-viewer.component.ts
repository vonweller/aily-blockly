import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzCardModule } from 'ng-zorro-antd/card';

export interface AilyBoardData {
  type: 'aily-board';
  board?: any;
  config?: any;
  metadata?: any;
  raw?: string;
  content?: string;
}

@Component({
  selector: 'app-aily-board-viewer',
  standalone: true,
  imports: [
    CommonModule,
    NzButtonModule,
    NzIconModule,
    NzToolTipModule,
    NzTagModule,
    NzCardModule
  ],
  template: `
    <div class="aily-board-viewer">
      <div class="viewer-header">
        <div class="header-left">
          <span class="type-badge">开发板1111</span>
          <span class="title" *ngIf="boardInfo?.name">{{ boardInfo.name }}</span>
        </div>
        <div class="header-actions">
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="复制配置"
            (click)="copyToClipboard()">
            <span nz-icon nzType="copy"></span>
          </button>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="安装开发板"
            (click)="installBoard()"
            *ngIf="canInstall">
            <span nz-icon nzType="download"></span>
          </button>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="查看详情"
            (click)="toggleDetails()">
            <span nz-icon [nzType]="showDetails ? 'up' : 'down'"></span>
          </button>
        </div>
      </div>
      
      <div class="viewer-content">
        <div *ngIf="!showRaw && boardInfo" class="board-view">
          <nz-card [nzBordered]="false" class="board-card">
            <div class="board-summary">
              <div class="board-icon" *ngIf="boardInfo.icon">
                <img [src]="boardInfo.icon" [alt]="boardInfo.name" />
              </div>
              <div class="board-info">
                <h4>{{ boardInfo.name || '未知开发板' }}</h4>
                <p *ngIf="boardInfo.description" class="description">
                  {{ boardInfo.description }}
                </p>
                <div class="board-tags" *ngIf="boardInfo.tags?.length">
                  <nz-tag *ngFor="let tag of boardInfo.tags" nzColor="blue">
                    {{ tag }}
                  </nz-tag>
                </div>
              </div>
            </div>
            
            <div class="board-specs" *ngIf="showDetails && boardInfo.specs">
              <h5>技术规格</h5>
              <div class="specs-grid">
                <div class="spec-item" *ngFor="let spec of getSpecs()">
                  <span class="spec-label">{{ spec.label }}:</span>
                  <span class="spec-value">{{ spec.value }}</span>
                </div>
              </div>
            </div>
            
            <div class="board-package" *ngIf="boardInfo.package">
              <div class="package-info">
                <span class="package-label">包名:</span>
                <code class="package-name">{{ boardInfo.package }}</code>
              </div>
            </div>
          </nz-card>
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
          <span *ngIf="data.metadata.version" class="version">v{{ data.metadata.version }}</span>
          <span *ngIf="data.metadata.author" class="author">by {{ data.metadata.author }}</span>
        </small>
      </div>
    </div>
  `,
  styles: [`
    .aily-board-viewer {
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
      background-color: #52c41a;
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

    .board-view {
      padding: 12px;
      background-color: white;
    }

    .board-card {
      border: none;
      box-shadow: none;
    }

    .board-summary {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .board-icon {
      flex-shrink: 0;
      width: 64px;
      height: 64px;
      border-radius: 8px;
      overflow: hidden;
      background-color: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .board-icon img {
      max-width: 100%;
      max-height: 100%;
      object-fit: cover;
    }

    .board-info {
      flex: 1;
    }

    .board-info h4 {
      margin: 0 0 8px 0;
      color: #262626;
      font-size: 16px;
    }

    .description {
      margin: 0 0 8px 0;
      color: #595959;
      line-height: 1.4;
    }

    .board-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .board-specs {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #f0f0f0;
    }

    .board-specs h5 {
      margin: 0 0 12px 0;
      color: #262626;
      font-size: 14px;
    }

    .specs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 8px;
    }

    .spec-item {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }

    .spec-label {
      color: #8c8c8c;
      font-size: 13px;
    }

    .spec-value {
      color: #262626;
      font-size: 13px;
      font-weight: 500;
    }

    .board-package {
      margin-top: 12px;
      padding: 8px;
      background-color: #f8f8f8;
      border-radius: 4px;
    }

    .package-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .package-label {
      color: #8c8c8c;
      font-size: 13px;
    }

    .package-name {
      background-color: #e6f7ff;
      color: #1890ff;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
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

    .version, .author {
      font-family: monospace;
      font-size: 12px;
    }
  `]
})
export class AilyBoardViewerComponent implements OnInit, OnDestroy {
  @Input() data: AilyBoardData | null = null;

  showRaw = false;
  showDetails = false;
  errorMessage = '';
  boardInfo: any = null;
  canInstall = false;

  ngOnInit() {
    this.processData();
    this.canInstall = this.checkCanInstall();
  }

  ngOnDestroy() {
    // 清理资源
  }

  /**
   * 设置组件数据（由指令调用）
   */
  setData(data: AilyBoardData): void {
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
        this.parseRawContent();
      } else {
        this.boardInfo = this.data.board || this.data.config || {};
      }
      this.errorMessage = '';
    } catch (error) {
      console.error('Error processing board data:', error);
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
        this.boardInfo = JSON.parse(content);
      } else {
        throw new Error('无法解析的内容格式');
      }
    } catch (error) {
      this.showRaw = true;
      this.errorMessage = '无法解析开发板数据，显示原始内容';
    }
  }

  /**
   * 获取规格信息
   */
  getSpecs(): Array<{label: string, value: string}> {
    if (!this.boardInfo?.specs) return [];
    
    const specs = [];
    const specsObj = this.boardInfo.specs;
    
    for (const [key, value] of Object.entries(specsObj)) {
      specs.push({
        label: this.formatSpecLabel(key),
        value: String(value)
      });
    }
    
    return specs;
  }

  /**
   * 格式化规格标签
   */
  private formatSpecLabel(key: string): string {
    const labelMap: Record<string, string> = {
      'cpu': 'CPU',
      'memory': '内存',
      'flash': '闪存',
      'pins': '引脚数',
      'voltage': '工作电压',
      'frequency': '工作频率',
      'interfaces': '接口',
      'wireless': '无线功能'
    };
    
    return labelMap[key] || key;
  }

  /**
   * 切换详情显示
   */
  toggleDetails(): void {
    this.showDetails = !this.showDetails;
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
      const content = this.showRaw ? this.formatData() : JSON.stringify(this.boardInfo, null, 2);
      await navigator.clipboard.writeText(content);
      console.log('开发板配置已复制到剪贴板');
    } catch (error) {
      console.error('复制失败:', error);
    }
  }

  /**
   * 安装开发板
   */
  installBoard(): void {
    try {
      if (!this.boardInfo?.package) {
        throw new Error('没有可安装的包信息');
      }

      // 这里需要根据实际的应用架构来实现
      // 可能需要通过服务来调用安装功能
      
      console.log('安装开发板包:', this.boardInfo.package);
      // 可以添加成功提示
    } catch (error) {
      console.error('安装失败:', error);
      this.errorMessage = `安装失败: ${error.message}`;
    }
  }

  /**
   * 检查是否可以安装
   */
  private checkCanInstall(): boolean {
    return typeof window !== 'undefined' && 
           this.boardInfo?.package && 
           window.location?.pathname.includes('blockly');
  }
}
