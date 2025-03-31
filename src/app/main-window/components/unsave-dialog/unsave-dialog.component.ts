import { Component, OnInit, inject } from '@angular/core';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';

@Component({
  selector: 'app-unsave-dialog',
  imports: [NzButtonModule, CommonModule],
  templateUrl: './unsave-dialog.component.html',
  styleUrl: './unsave-dialog.component.scss'
})
export class UnsaveDialogComponent {

  readonly modal = inject(NzModalRef);
  readonly data: { title: string; text: string } = inject(NZ_MODAL_DATA);

  get title(): string {
    return this.data.title;
  }

  get text(): string {
    return this.data.text;
  }

  constructor(
  ) {
  }

  ngOnInit(): void {
  }

  cancel(): void {
    this.modal.close({ result: 'cancel' });
  }

  continueWithoutSave(): void {
    this.modal.close({ result: 'continue' });
  }

  saveAndContinue(): void {
    this.modal.close({ result: 'save' });
  }
}
