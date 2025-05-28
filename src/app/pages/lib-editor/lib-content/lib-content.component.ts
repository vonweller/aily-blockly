import { Component, Input, SimpleChanges } from '@angular/core';
import { BlockItemComponent } from '../block-item/block-item.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ElectronService } from '../../../services/electron.service';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';

@Component({
  selector: 'app-lib-content',
  imports: [
    CommonModule,
    FormsModule,
    BlockItemComponent,
    NzToolTipModule
  ],
  templateUrl: './lib-content.component.html',
  styleUrl: './lib-content.component.scss'
})
export class LibContentComponent {
  @Input() path: string;

  blocks = []

  constructor(
    private electronService: ElectronService
  ) {

  }

  onInit() { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['path'] && this.path) {
      this.loadBlocks();
    }
  }

  loadBlocks() {
    const blockPath = `${this.path}/block.json`;
    this.blocks = JSON.parse(this.electronService.readFile(blockPath))
    // console.log('blocks', this.blocks);
  }
}
