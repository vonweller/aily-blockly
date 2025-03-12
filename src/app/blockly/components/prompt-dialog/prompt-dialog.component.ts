import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';

@Component({
  selector: 'app-prompt-dialog',
  imports: [FormsModule, CommonModule, NzButtonModule, NzInputModule],
  templateUrl: './prompt-dialog.component.html',
  styleUrl: './prompt-dialog.component.scss'
})
export class PromptDialogComponent {
  @Input() title = 'Prompt';

  @Output() confirm = new EventEmitter();
  @Output() close = new EventEmitter();

  value = '';

  constructor(
  ) {
  }

  ngOnInit(): void {
  }

  onConfirm() {
    this.confirm.emit(this.value);
  }


  onClose() {
    this.close.emit();
  }
}
