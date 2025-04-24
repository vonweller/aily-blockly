import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { ElectronService } from './electron.service';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { UpdateDialogComponent } from '../main-window/components/update-dialog/update-dialog.component';

@Injectable({
  providedIn: 'root',
})
export class UpdateService {

  updateProgress = new BehaviorSubject<number>(0);

  updateStatus = new Subject<string>();

  dialogAction = new Subject();

  // private updateInfo: any = null;

  constructor(
    private electronService: ElectronService,
    // private message: NzMessageService,
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
          this.updateStatus.next('available');
          // this.updateInfo = status.info;
          // 检查是否已经跳过此版本
          const skippedVersions = this.getSkippedVersions();
          if (skippedVersions.includes(status.info.version)) {
            // console.log(`已跳过版本 ${status.info.version}，不再提示`);
            break;
          }
          // 判断是否已下载，如果已下载则直接显示安装对话框
          if (status.info.isDownloaded) {
            this.showUpdateDialog(status.info, true);
          } else {
            this.showUpdateDialog(status.info, false);
          }
          break;

        case 'not-available':
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
          break;
      }
    });
    // 应用启动时检查更新
    setTimeout(() => {
      this.checkForUpdates();
    }, 3000);

  }

  checkForUpdates() {
    if (this.electronService.isElectron) {
      window['updater'].checkForUpdates();
    }
  }

  downloadUpdate() {
    window['updater'].downloadUpdate();
  }

  cancelDownload() {
    if (window['updater'].cancelDownload) {
      window['updater'].cancelDownload();
    }
  }

  quitAndInstall() {
    window['updater'].quitAndInstall();
  }

  skipVersion(version: string) {
    if (!version) return;
    const skippedVersions = this.getSkippedVersions();
    if (!skippedVersions.includes(version)) {
      skippedVersions.push(version);
      localStorage.setItem('skippedVersions', JSON.stringify(skippedVersions));
      // console.log(`已将版本 ${version} 添加到跳过列表`);
    }
  }

  private getSkippedVersions(): string[] {
    const stored = localStorage.getItem('skippedVersions');
    return stored ? JSON.parse(stored) : [];
  }

  clearSkipVersions() {
    localStorage.removeItem('skippedVersions');
  }

  dialogActionSubscription;
  private showUpdateDialog(info: any, isDownloaded: boolean = false) {
    // console.log('showUpdateDialog', info, isDownloaded);
    const mode = isDownloaded ? 'downloaded' : 'available';
    const title = isDownloaded ?
      `更新已准备就绪` :
      `发现新版本 ${info.version}`;
    const text = isDownloaded ?
      `新版本 ${info.version} 已下载完成，是否立即安装？` :
      `是否要下载并安装此更新？`;

    const modalRef = this.modal.create({
      nzTitle: null,
      nzFooter: null,
      nzClosable: false,
      nzBodyStyle: {
        padding: '0',
      },
      nzWidth: '320px',
      nzContent: UpdateDialogComponent,
      nzData: {
        title: title,
        text: text,
        mode: mode,
        progress: 0,
        version: info.version,
      },
      nzMaskClosable: false,
    });

    modalRef.afterClose.subscribe(async result => {
      if (this.dialogActionSubscription) {
        this.dialogActionSubscription.unsubscribe();
      }
      switch (result) {
        case 'skip':
          // 跳过版本
          this.skipVersion(info.version);
          break;
        case 'install':
          // 安装更新
          this.quitAndInstall();
          break;
        case 'download_stop':
          // 取消下载
          this.cancelDownload();
          break;
        default:
          // 取消操作
          break;
      }
    });

    this.dialogActionSubscription = this.dialogAction.subscribe((action) => {
      if (action === 'download') {
        this.downloadUpdate();
      }
    })
  }
}