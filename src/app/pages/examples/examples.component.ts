import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Location } from '@angular/common';

@Component({
  selector: 'app-examples',
  imports: [
    FormsModule,
    NzButtonModule,
    NzTagModule,
    NzInputModule,
    NzToolTipModule,
    TranslateModule
  ],
  templateUrl: './examples.component.html',
  styleUrl: './examples.component.scss'
})
export class ExamplesComponent {
  @Output() close = new EventEmitter();
  tagList: string[] = [];

  exampleList = [, , , , , , , , , ,]

  constructor(
    // private router: Router,
    private location: Location,
    private translate: TranslateService
  ) {

  }

  ngOnInit() {
    // 使用翻译初始化标签列表
    // 使用翻译初始化标签列表
    this.tagList = [
      this.translate.instant('显示全部'),
      this.translate.instant('入门课程'),
      this.translate.instant('库示例'),
      this.translate.instant('精选项目'),
      this.translate.instant('物联网'),
      this.translate.instant('机器人'),
    ];
  }

  keyword: string = '';
  search(keyword = this.keyword) {
    if (keyword) {
      keyword = keyword.replace(/\s/g, '').toLowerCase();

    } else {

    }
  }

  back() {
    this.location.back();
  }
}
