import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalRef, NzModalService } from 'ng-zorro-antd/modal';

@Component({
  selector: 'app-prompt-dialog',
  imports: [FormsModule, CommonModule, NzButtonModule, NzInputModule],
  templateUrl: './prompt-dialog.component.html',
  styleUrl: './prompt-dialog.component.scss'
})
export class PromptDialogComponent {
  @Input() title = 'Prompt';

  value = '';

  constructor(
    private modal: NzModalRef
  ) {
  }

  ngOnInit(): void {
  }

  onConfirm() {
    this.modal.triggerOk()
  }

  onClose() {
    this.modal.triggerCancel()
  }
}
