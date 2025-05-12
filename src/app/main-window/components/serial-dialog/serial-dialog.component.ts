import { Component, inject } from '@angular/core';
import { NzModalRef } from 'ng-zorro-antd/modal';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';

@Component({
  selector: 'app-serial-dialog',
  imports: [NzButtonModule, CommonModule],
  templateUrl: './serial-dialog.component.html',
  styleUrl: './serial-dialog.component.scss'
})
export class SerialDialogComponent {

  readonly modal = inject(NzModalRef);

  constructor(
  ) {
  }

  ngOnInit(): void {
  }

  cancel(): void {
    this.modal.close({ result: 'cancel' });
  }
}
