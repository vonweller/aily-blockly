import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { presetColors } from 'ng-zorro-antd/core/color';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzPaginationModule } from 'ng-zorro-antd/pagination';
@Component({
  selector: 'app-project-manager',
  imports: [
    NzInputModule,
    FormsModule,
    CommonModule,
    NzTagModule,
    NzSelectModule,
    NzButtonModule,
    NzPaginationModule
  ],
  templateUrl: './project-manager.component.html',
  styleUrl: './project-manager.component.scss'
})
export class ProjectManagerComponent {

  value;

  version="1.0.1";
  readonly presetColors = presetColors;

}
