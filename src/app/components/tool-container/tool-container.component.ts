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
  @Input() title: string;

  @Output() closeEvent = new EventEmitter();

  constructor(
    private uiService: UiService
  ) { }

  trash() {
    this.uiService.clearTerminal();
  }

  close() {
    this.closeEvent.emit();
  }
}
