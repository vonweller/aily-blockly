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
  @Input() position = { x: 0, y: 0 };

  @Output() confirm = new EventEmitter();
  @Output() close = new EventEmitter();

  value = '';

  constructor(
  ) {
  }

  ngOnInit(): void {
    // 获取窗口的宽度和高度,放置到中间位置
    let width = window.innerWidth;
    let height = window.innerHeight;
    this.position = {
      x: (width - 300) / 2,
      y: (height - 300) / 2
    };
  }

  onConfirm() {
    this.confirm.emit(this.value);
  }


  onClose() {
    this.close.emit();
  }
}
