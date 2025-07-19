import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { GlobalLibraryService } from './services/global-library.service';
import { GlobalLibraryTester } from './test-global-library';

/**
 * 全局库功能演示组件
 * 这个组件用于演示和测试全局库的各种功能
 */
@Component({
  selector: 'app-demo-global-library',
  imports: [
    CommonModule,
    NzButtonModule
  ],
  template: `
    <div style="padding: 20px;">
      <h2>全局库功能演示</h2>
      
      <div style="margin-bottom: 20px;">
        <h3>基本操作</h3>
        <button nz-button nzType="primary" (click)="addTestLibrary()" style="margin-right: 10px;">
          添加测试库
        </button>
        <button nz-button nzType="default" (click)="showGlobalLibraries()" style="margin-right: 10px;">
          显示全局库列表
        </button>
        <button nz-button nzType="default" (click)="removeTestLibrary()" style="margin-right: 10px;">
          移除测试库
        </button>
        <button nz-button nzType="default" (click)="clearAllLibraries()">
          清空所有库
        </button>
      </div>

      <div style="margin-bottom: 20px;">
        <h3>配置管理</h3>
        <button nz-button nzType="default" (click)="exportConfig()" style="margin-right: 10px;">
          导出配置
        </button>
        <button nz-button nzType="default" (click)="showConfigPath()">
          显示配置路径
        </button>
      </div>

      <div style="margin-bottom: 20px;">
        <h3>完整测试</h3>
        <button nz-button nzType="primary" (click)="runAllTests()">
          运行所有测试
        </button>
      </div>

      <div style="margin-top: 20px;">
        <h3>当前全局库 ({{ globalLibraryCount }})</h3>
        <div *ngFor="let lib of globalLibraries" style="padding: 8px; border: 1px solid #ddd; margin: 4px 0; border-radius: 4px;">
          <strong>{{ lib.nickname }}</strong> ({{ lib.name }}@{{ lib.version }})
          <br>
          <small>{{ lib.description }}</small>
          <br>
          <small style="color: #666;">添加时间: {{ formatDate(lib.addedAt) }}</small>
        </div>
      </div>
    </div>
  `,
  standalone: true
})
export class DemoGlobalLibraryComponent {
  globalLibraries: any[] = [];
  globalLibraryCount = 0;
  private tester: GlobalLibraryTester;

  constructor(
    private globalLibraryService: GlobalLibraryService,
    private message: NzMessageService
  ) {
    this.tester = new GlobalLibraryTester(this.globalLibraryService);
    this.updateLibraryList();
  }

  /**
   * 更新库列表显示
   */
  updateLibraryList(): void {
    this.globalLibraries = this.globalLibraryService.getGlobalLibraries();
    this.globalLibraryCount = this.globalLibraries.length;
  }

  /**
   * 添加测试库
   */
  addTestLibrary(): void {
    try {
      const testLibrary = {
        name: '@aily-project/lib-demo-' + Date.now(),
        version: '1.0.0',
        nickname: '演示库 ' + new Date().toLocaleTimeString(),
        description: '这是一个用于演示的测试库'
      };

      this.globalLibraryService.addGlobalLibrary(testLibrary);
      this.message.success(`添加全局库成功: ${testLibrary.nickname}`);
      this.updateLibraryList();
    } catch (error) {
      this.message.error('添加全局库失败: ' + error.message);
    }
  }

  /**
   * 显示全局库列表
   */
  showGlobalLibraries(): void {
    this.updateLibraryList();
    if (this.globalLibraries.length === 0) {
      this.message.info('当前没有全局库');
    } else {
      this.message.success(`当前有 ${this.globalLibraries.length} 个全局库`);
      console.log('全局库列表:', this.globalLibraries);
    }
  }

  /**
   * 移除测试库
   */
  removeTestLibrary(): void {
    const testLibraries = this.globalLibraries.filter(lib => 
      lib.name.startsWith('@aily-project/lib-demo-')
    );

    if (testLibraries.length === 0) {
      this.message.info('没有找到测试库');
      return;
    }

    try {
      testLibraries.forEach(lib => {
        this.globalLibraryService.removeGlobalLibrary(lib.name);
      });
      
      this.message.success(`移除了 ${testLibraries.length} 个测试库`);
      this.updateLibraryList();
    } catch (error) {
      this.message.error('移除测试库失败: ' + error.message);
    }
  }

  /**
   * 清空所有库
   */
  clearAllLibraries(): void {
    try {
      this.globalLibraryService.clearGlobalLibraries();
      this.message.success('已清空所有全局库');
      this.updateLibraryList();
    } catch (error) {
      this.message.error('清空失败: ' + error.message);
    }
  }

  /**
   * 导出配置
   */
  exportConfig(): void {
    try {
      const config = this.globalLibraryService.exportConfig();
      console.log('导出的配置:', config);
      
      // 创建下载链接
      const dataStr = JSON.stringify(config, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = 'global-libraries-demo.json';
      link.click();
      
      URL.revokeObjectURL(url);
      this.message.success('配置已导出到下载文件');
    } catch (error) {
      this.message.error('导出配置失败: ' + error.message);
    }
  }

  /**
   * 显示配置路径
   */
  showConfigPath(): void {
    try {
      const configPath = this.globalLibraryService.getConfigFilePath();
      console.log('配置文件路径:', configPath);
      this.message.success('配置文件路径已输出到控制台');
    } catch (error) {
      this.message.error('获取配置路径失败: ' + error.message);
    }
  }

  /**
   * 运行所有测试
   */
  runAllTests(): void {
    try {
      console.log('开始运行全局库功能测试...');
      this.tester.runAllTests();
      this.updateLibraryList();
      this.message.success('测试完成，请查看控制台输出');
    } catch (error) {
      this.message.error('测试失败: ' + error.message);
    }
  }

  /**
   * 格式化日期
   */
  formatDate(dateString: string): string {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  }
}
