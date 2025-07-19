import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { GlobalLibraryService, GlobalLibrary } from '../../services/global-library.service';
import { ElectronService } from '../../services/electron.service';

@Component({
  selector: 'app-global-library-manager',
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzTableModule,
    NzToolTipModule,
    NzTagModule,
    TranslateModule
  ],
  templateUrl: './global-library-manager.component.html',
  styleUrl: './global-library-manager.component.scss'
})
export class GlobalLibraryManagerComponent {
  @Output() close = new EventEmitter();

  globalLibraries: GlobalLibrary[] = [];
  loading = false;

  constructor(
    private globalLibraryService: GlobalLibraryService,
    private message: NzMessageService,
    private modal: NzModalService,
    private translate: TranslateService,
    private electronService: ElectronService
  ) {}

  ngOnInit() {
    this.loadGlobalLibraries();
  }

  /**
   * 加载全局库列表
   */
  loadGlobalLibraries(): void {
    this.loading = true;
    try {
      this.globalLibraries = this.globalLibraryService.getGlobalLibraries();
    } catch (error) {
      console.error('加载全局库列表失败:', error);
      this.message.error('加载全局库列表失败: ' + error.message);
    } finally {
      this.loading = false;
    }
  }

  /**
   * 移除全局库
   */
  removeGlobalLibrary(library: GlobalLibrary): void {
    this.modal.confirm({
      nzTitle: '确认移除',
      nzContent: `确定要将 "${library.nickname}" 从全局库中移除吗？这不会卸载已安装的库。`,
      nzOkText: '确定',
      nzCancelText: '取消',
      nzOkType: 'primary',
      nzOkDanger: true,
      nzOnOk: () => {
        try {
          this.globalLibraryService.removeGlobalLibrary(library.name);
          this.loadGlobalLibraries();
          this.message.success(`${library.nickname} 已从全局库中移除`);
        } catch (error) {
          console.error('移除全局库失败:', error);
          this.message.error('移除失败: ' + error.message);
        }
      }
    });
  }

  /**
   * 清空所有全局库
   */
  clearAllGlobalLibraries(): void {
    if (this.globalLibraries.length === 0) {
      this.message.info('没有全局库需要清空');
      return;
    }

    this.modal.confirm({
      nzTitle: '确认清空',
      nzContent: `确定要清空所有全局库吗？这将移除 ${this.globalLibraries.length} 个全局库配置。`,
      nzOkText: '确定',
      nzCancelText: '取消',
      nzOkType: 'primary',
      nzOkDanger: true,
      nzOnOk: () => {
        try {
          this.globalLibraryService.clearGlobalLibraries();
          this.loadGlobalLibraries();
          this.message.success('所有全局库已清空');
        } catch (error) {
          console.error('清空全局库失败:', error);
          this.message.error('清空失败: ' + error.message);
        }
      }
    });
  }

  /**
   * 导出全局库配置
   */
  exportGlobalLibraries(): void {
    try {
      const config = this.globalLibraryService.exportConfig();
      const dataStr = JSON.stringify(config, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(dataBlob);
      link.download = 'global-libraries-config.json';
      link.click();
      
      this.message.success('全局库配置已导出');
    } catch (error) {
      console.error('导出全局库配置失败:', error);
      this.message.error('导出失败: ' + error.message);
    }
  }

  /**
   * 导入全局库配置
   */
  importGlobalLibraries(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const config = JSON.parse(e.target.result);
          
          // 验证配置格式
          if (!config.libraries || !Array.isArray(config.libraries)) {
            throw new Error('无效的配置文件格式');
          }

          this.modal.confirm({
            nzTitle: '确认导入',
            nzContent: `确定要导入 ${config.libraries.length} 个全局库配置吗？这将覆盖当前的全局库配置。`,
            nzOkText: '确定',
            nzCancelText: '取消',
            nzOnOk: () => {
              try {
                this.globalLibraryService.importConfig(config);
                this.loadGlobalLibraries();
                this.message.success('全局库配置导入成功');
              } catch (error) {
                console.error('导入全局库配置失败:', error);
                this.message.error('导入失败: ' + error.message);
              }
            }
          });
        } catch (error) {
          console.error('解析配置文件失败:', error);
          this.message.error('配置文件格式错误');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /**
   * 打开配置文件位置
   */
  openConfigLocation(): void {
    try {
      const configPath = this.globalLibraryService.getConfigFilePath();
      const dirPath = window['path'].dirname(configPath);
      window['other'].openByExplorer(dirPath);
    } catch (error) {
      console.error('打开配置文件位置失败:', error);
      this.message.error('打开失败: ' + error.message);
    }
  }

  /**
   * 返回
   */
  back(): void {
    this.close.emit();
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

  /**
   * 获取全局库数量
   */
  getLibraryCount(): number {
    return this.globalLibraries.length;
  }
}
