import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzCardModule } from 'ng-zorro-antd/card';
import { ConfigService } from '../../../../services/config.service';

export interface AilyBoardData {
  type: 'aily-board';
  board?: any;
  config?: any;
  metadata?: any;
  raw?: string;
  content?: string;
}

@Component({
  selector: 'app-aily-board-viewer',
  standalone: true,
  imports: [
    CommonModule,
    NzButtonModule,
    NzIconModule,
    NzToolTipModule,
    NzTagModule,
    NzCardModule
  ],
  templateUrl: './aily-board-viewer.component.html',
  styleUrls: ['./aily-board-viewer.component.scss']
})
export class AilyBoardViewerComponent implements OnInit, OnDestroy {
  @Input() data: any | null = null;

  get resourceUrl() {
    return this.configService.data.resource[0];
  }

  constructor(
    private configService: ConfigService
  ) { }

  ngOnInit() {
    // this.processData();
  }

  ngOnDestroy() {
    // 清理资源
  }
}
