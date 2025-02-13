import { Component, Output } from '@angular/core';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { ToolContainerService } from './tool-container.service';

@Component({
  selector: 'app-tool-container',
  imports: [NzTabsModule],
  templateUrl: './tool-container.component.html',
  styleUrl: './tool-container.component.scss',
})
export class ToolContainerComponent {
  @Output() showRbox = false;

  constructor(private toolContainerService: ToolContainerService) {}

  trash() {
    this.toolContainerService.actionSubject.next('trash');
  }

  close() {
    this.toolContainerService.actionSubject.next('close');
  }
}
