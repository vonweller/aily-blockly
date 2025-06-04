import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzListModule } from 'ng-zorro-antd/list';

export interface AilyLibraryData {
  type: 'aily-library';
  library?: any;
  dependencies?: string[];
  metadata?: any;
  raw?: string;
  content?: string;
}

@Component({
  selector: 'app-aily-library-viewer',
  standalone: true,
  imports: [
    CommonModule,
    NzButtonModule,
    NzIconModule,
    NzToolTipModule,
    NzTagModule,
    NzCardModule,
    NzListModule
  ],
  template: `
    <div class="aily-library-viewer">
      <div class="viewer-header">
        <div class="header-left">
          <span class="type-badge">扩展库</span>
          <span class="title" *ngIf="libraryInfo?.name">{{ libraryInfo.name }}</span>
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
            nz-tooltip="安装库"
            (click)="installLibrary()"
            *ngIf="canInstall">
            <span nz-icon nzType="download"></span>
          </button>
          <button 
            nz-button 
            nzType="text" 
            nzSize="small"
            nz-tooltip="查看文档"
            (click)="viewDocumentation()"
            *ngIf="libraryInfo?.documentation">
            <span nz-icon nzType="file-text"></span>
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
        <div *ngIf="!showRaw && libraryInfo" class="library-view">
          <nz-card [nzBordered]="false" class="library-card">
            <div class="library-summary">
              <div class="library-icon" *ngIf="libraryInfo.icon">
                <img [src]="libraryInfo.icon" [alt]="libraryInfo.name" />
              </div>
              <div class="library-info">
                <h4>{{ libraryInfo.name || '未知库' }}</h4>
                <p *ngIf="libraryInfo.description" class="description">
                  {{ libraryInfo.description }}
                </p>
                <div class="library-tags" *ngIf="libraryInfo.tags?.length">
                  <nz-tag *ngFor="let tag of libraryInfo.tags" nzColor="blue">
                    {{ tag }}
                  </nz-tag>
                </div>
                <div class="library-version" *ngIf="libraryInfo.version">
                  <span class="version-label">版本:</span>
                  <code class="version-value">{{ libraryInfo.version }}</code>
                </div>
              </div>
            </div>
            
            <div class="library-details" *ngIf="libraryInfo.blocks?.length">
              <h5>提供的积木块</h5>
              <div class="blocks-grid">
                <div class="block-item" *ngFor="let block of libraryInfo.blocks">
                  <div class="block-name">{{ block.name || block.type }}</div>
                  <div class="block-category" *ngIf="block.category">
                    <nz-tag nzSize="small">{{ block.category }}</nz-tag>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="library-functions" *ngIf="libraryInfo.functions?.length">
              <h5>提供的函数</h5>
              <nz-list nzSize="small" [nzDataSource]="libraryInfo.functions" nzBordered>
                <ng-template #renderItem let-func>
                  <nz-list-item>
                    <div class="function-item">
                      <code class="function-name">{{ func.name }}</code>
                      <span class="function-desc" *ngIf="func.description">
                        {{ func.description }}
                      </span>
                    </div>
                  </nz-list-item>
                </ng-template>
              </nz-list>
            </div>
            
            <div class="library-dependencies" *ngIf="dependencies?.length">
              <h5>依赖项</h5>
              <div class="dependencies-list">
                <nz-tag *ngFor="let dep of dependencies" nzColor="orange">
                  {{ dep }}
                </nz-tag>
              </div>
            </div>
            
            <div class="library-package" *ngIf="libraryInfo.package">
              <div class="package-info">
                <span class="package-label">包名:</span>
                <code class="package-name">{{ libraryInfo.package }}</code>
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
          <span *ngIf="data.metadata.author" class="author">by {{ data.metadata.author }}</span>
          <span *ngIf="data.metadata.license" class="license">{{ data.metadata.license }}</span>
        </small>
      </div>
    </div>
  `,
  styles: [`
    .aily-library-viewer {
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
      background-color: #fa8c16;
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

    .library-view {
      padding: 12px;
      background-color: white;
    }

    .library-card {
      border: none;
      box-shadow: none;
    }

    .library-summary {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .library-icon {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      border-radius: 6px;
      overflow: hidden;
      background-color: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .library-icon img {
      max-width: 100%;
      max-height: 100%;
      object-fit: cover;
    }

    .library-info {
      flex: 1;
    }

    .library-info h4 {
      margin: 0 0 8px 0;
      color: #262626;
      font-size: 16px;
    }

    .description {
      margin: 0 0 8px 0;
      color: #595959;
      line-height: 1.4;
    }

    .library-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }

    .library-version {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .version-label {
      color: #8c8c8c;
      font-size: 13px;
    }

    .version-value {
      background-color: #e6f7ff;
      color: #1890ff;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
    }

    .library-details, .library-functions, .library-dependencies {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #f0f0f0;
    }

    .library-details h5, .library-functions h5, .library-dependencies h5 {
      margin: 0 0 12px 0;
      color: #262626;
      font-size: 14px;
    }

    .blocks-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 8px;
    }

    .block-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      background-color: #f8f8f8;
      border-radius: 4px;
    }

    .block-name {
      font-family: monospace;
      font-size: 13px;
      color: #262626;
    }

    .function-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .function-name {
      font-family: monospace;
      font-size: 13px;
      color: #1890ff;
    }

    .function-desc {
      font-size: 12px;
      color: #8c8c8c;
    }

    .dependencies-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .library-package {
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

    .author, .license {
      font-size: 12px;
    }
  `]
})
export class AilyLibraryViewerComponent implements OnInit, OnDestroy {
  @Input() data: AilyLibraryData | null = null;

  showRaw = false;
  errorMessage = '';
  libraryInfo: any = null;
  dependencies: string[] = [];
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
  setData(data: AilyLibraryData): void {
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
        this.libraryInfo = this.data.library || {};
        this.dependencies = this.data.dependencies || [];
      }
      this.errorMessage = '';
    } catch (error) {
      console.error('Error processing library data:', error);
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
        const parsed = JSON.parse(content);
        this.libraryInfo = parsed.library || parsed;
        this.dependencies = parsed.dependencies || [];
      } else {
        throw new Error('无法解析的内容格式');
      }
    } catch (error) {
      this.showRaw = true;
      this.errorMessage = '无法解析库数据，显示原始内容';
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
      const content = this.showRaw ? this.formatData() : JSON.stringify(this.libraryInfo, null, 2);
      await navigator.clipboard.writeText(content);
      console.log('库配置已复制到剪贴板');
    } catch (error) {
      console.error('复制失败:', error);
    }
  }

  /**
   * 安装库
   */
  installLibrary(): void {
    try {
      if (!this.libraryInfo?.package) {
        throw new Error('没有可安装的包信息');
      }

      // 这里需要根据实际的应用架构来实现
      // 可能需要通过服务来调用安装功能
      
      console.log('安装库包:', this.libraryInfo.package);
      // 可以添加成功提示
    } catch (error) {
      console.error('安装失败:', error);
      this.errorMessage = `安装失败: ${error.message}`;
    }
  }

  /**
   * 查看文档
   */
  viewDocumentation(): void {
    if (this.libraryInfo?.documentation) {
      window.open(this.libraryInfo.documentation, '_blank');
    }
  }

  /**
   * 检查是否可以安装
   */
  private checkCanInstall(): boolean {
    return typeof window !== 'undefined' && 
           this.libraryInfo?.package && 
           window.location?.pathname.includes('blockly');
  }
}
