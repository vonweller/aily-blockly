import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ElectronService } from './electron.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';

@Injectable({
  providedIn: 'root'
})
export class UpdateService {
  private updateAvailable = new BehaviorSubject<boolean>(false);
  updateAvailable$ = this.updateAvailable.asObservable();
  
  private updateProgress = new BehaviorSubject<number>(0);
  updateProgress$ = this.updateProgress.asObservable();
  
  private updateStatus = new BehaviorSubject<string>('');
  updateStatus$ = this.updateStatus.asObservable();
  
  private updateInfo: any = null;

  constructor(
    private electronService: ElectronService,
    private message: NzMessageService,
    private modal: NzModalService
  ) { }

  init() {
    if (!this.electronService.isElectron) {
      return;
    }

    // 监听更新状态
    window['updater'].onUpdateStatus((status) => {
      console.log('更新状态:', status);
      
      switch (status.status) {
        case 'checking':
          this.updateStatus.next('checking');
          break;
          
        case 'available':
          this.updateAvailable.next(true);
          this.updateStatus.next('available');
          this.updateInfo = status.info;
          this.message.info(`发现新版本: ${status.info.version}`);
          break;
          
        case 'not-available':
          this.updateAvailable.next(false);
          this.updateStatus.next('not-available');
          break;
          
        case 'error':
          this.updateStatus.next('error');
          console.error('更新错误:', status.error);
          break;
          
        case 'progress':
          this.updateProgress.next(status.progress.percent || 0);
          this.updateStatus.next('downloading');
          break;
          
        case 'downloaded':
          this.updateStatus.next('downloaded');
          this.showUpdateDialog(status.info);
          break;
      }
    });

    // 应用启动时检查更新
    this.checkForUpdates();
  }

  checkForUpdates() {
    if (this.electronService.isElectron) {
      window['updater'].checkForUpdates();
    }
  }

  quitAndInstall() {
    if (this.electronService.isElectron) {
      window['updater'].quitAndInstall();
    }
  }

  private showUpdateDialog(info: any) {
    this.modal.confirm({
      nzTitle: '应用更新',
      nzContent: `已下载新版本 ${info.version}，是否现在重启应用安装更新？`,
      nzOkText: '立即重启',
      nzCancelText: '稍后重启',
      nzOnOk: () => this.quitAndInstall()
    });
  }
}