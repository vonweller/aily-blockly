import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
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
    private location: Location
  ) {

  }

  ngOnInit() {
    // 使用翻译初始化标签列表
    this.tagList = []
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
