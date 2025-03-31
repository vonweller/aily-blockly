import { Component, Inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { Observable, Subscription } from 'rxjs';
import { UpdateService } from '../../../services/update.service';

@Component({
  selector: 'app-update-dialog',
  imports: [NzButtonModule, CommonModule, NzProgressModule, NzIconModule],
  templateUrl: './update-dialog.component.html',
  styleUrls: ['./update-dialog.component.scss']
})
export class UpdateDialogComponent implements OnInit, OnDestroy {
  title: string;
  text: string;
  mode: string;
  progress: number = 0;
  version: string;

  constructor(
    @Inject(NZ_MODAL_DATA) public data: any,
    private modal: NzModalRef,
    private updateService: UpdateService,
    private cd: ChangeDetectorRef
  ) {
    this.title = data.title || '';
    this.text = data.text || '';

    console.log('UpdateDialogComponent data:', data);

  }

  updateStatusSubscription: Subscription;
  updateProgressSubscription: Subscription;

  ngOnInit() {
    // 订阅更新状态
    this.updateStatusSubscription = this.updateService.updateStatus.subscribe((status) => {
      // console.log('更新状态:', status);
      this.mode = status;
      if (this.mode === 'downloaded') {
        this.progress = 100; 
      }
      this.cd.detectChanges();
    })
    this.updateProgressSubscription = this.updateService.updateProgress.subscribe((progress) => {
      this.progress = Math.floor(progress);
      this.cd.detectChanges();
    })
  }

  ngOnDestroy() {
    // 取消订阅
    this.updateStatusSubscription?.unsubscribe();
    this.updateProgressSubscription?.unsubscribe();
  }

  close(result: string = '') {
    this.modal.close(result);
  }

  download() {
    this.updateService.dialogAction.next('download');
  }
}
