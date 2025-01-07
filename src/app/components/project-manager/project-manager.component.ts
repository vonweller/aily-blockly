import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { presetColors } from 'ng-zorro-antd/core/color';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzPaginationModule } from 'ng-zorro-antd/pagination';
import { ProjectService } from '../../services/project.service';

@Component({
  selector: 'app-project-manager',
  standalone: true,
  imports: [
    NzInputModule,
    FormsModule,
    CommonModule,
    NzTagModule,
    NzSelectModule,
    NzButtonModule,
    NzPaginationModule,
  ],
  templateUrl: './project-manager.component.html',
  styleUrl: './project-manager.component.scss',
})
export class ProjectManagerComponent implements OnInit {
  keywords = '';
  platform = '';
  libraries = '';

  version = '1.0.1';
  readonly presetColors = presetColors;

  page: number = 1;
  perPage = 10;
  total: number = 0;
  dataList: any[] = [];

  constructor(private projectService: ProjectService) {}

  ngOnInit(): void {
    this.getSearch();
  }

  getSearch() {
    this.projectService
      .search({
        text: this.keywords,
        size: this.perPage,
        from: this.platform,
        quality: 0.65,
        popularity: 0.98,
        maintenance: 0.5,
      })
      .subscribe((res) => {
        this.dataList = (res as any)?.objects;
        this.total = (res as any)?.total;
      });
  }

  getList() {
    this.projectService.list({}).subscribe((res) => {});
  }
}
