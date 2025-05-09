import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Location } from '@angular/common';
import { SUBJECT_LIST } from './data';
import { Router, RouterModule } from '@angular/router';

@Component({
  selector: 'app-playground',
  imports: [
    FormsModule,
    NzButtonModule,
    NzTagModule,
    NzInputModule,
    NzToolTipModule,
    TranslateModule,
    RouterModule
  ],
  templateUrl: './playground.component.html',
  styleUrl: './playground.component.scss'
})
export class PlaygroundComponent {
  @Output() close = new EventEmitter();
  tagList: string[] = [];
  // exampleList = []

  constructor(
    private router: Router,
    private location: Location,
    private translate: TranslateService
  ) {

  }

  ngOnInit() {
    // 使用翻译初始化标签列表
    this.tagList = [
      this.translate.instant('显示全部'),
      this.translate.instant('入门课程'),
      this.translate.instant('库示例'),
      this.translate.instant('精选项目'),
      this.translate.instant('物联网'),
      this.translate.instant('机器人'),
    ];

    // this.exampleList = SUBJECT_LIST
  }

  keyword: string = '';
  search(keyword = this.keyword) {
    if (keyword) {
      keyword = keyword.replace(/\s/g, '').toLowerCase();
      this.router.navigate(['/main/playground/list'], {
        queryParams: { keyword }
      });
    } else {

    }
  }

  back() {
    this.location.back();
  }
}
