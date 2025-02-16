import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-tool-container',
  imports: [NzTabsModule],
  templateUrl: './tool-container.component.html',
  styleUrl: './tool-container.component.scss',
})
export class ToolContainerComponent {
  @Input() title: string = '工具';

  @Output() closeEvent = new EventEmitter();

  @Output() copyEvent = new EventEmitter();

  @Output() trashEvent = new EventEmitter();

  @Output() refreshEvent = new EventEmitter();

  constructor(private uiService: UiService) {}

  close() {
    this.closeEvent.emit();
  }

  trash() {
    this.trashEvent.emit();
  }

  refresh() {
    this.refreshEvent.emit();
  }

  copy() {
    this.copyEvent.emit();
  }
}
