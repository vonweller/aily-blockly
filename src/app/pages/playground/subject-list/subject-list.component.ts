import { Component } from '@angular/core';
import { SUBJECT_LIST } from '../data';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ConfigService } from '../../../services/config.service';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-subject-list',
  imports: [RouterModule, CommonModule, FormsModule, NzInputModule, NzButtonModule, TranslateModule],
  templateUrl: './subject-list.component.html',
  styleUrl: './subject-list.component.scss'
})
export class SubjectListComponent {
  subjectList;
  _subjectList; // 保存原始数据
  resourceUrl;
  keyword: string = '';

  constructor(
    private configService: ConfigService,
    private translate: TranslateService,
    private route: ActivatedRoute
  ) {
    // 从URL参数中获取搜索关键词（如果有）
    this.route.queryParams.subscribe(params => {
      if (params['keyword']) {
        this.keyword = params['keyword'];
      }
    });
  }

  ngAfterViewInit() {
    this.resourceUrl = this.configService.data.resource[0] + "/imgs/examples/";
    this.configService.loadExamplesList().then(async (data: any) => {
      this._subjectList = this.process(data);
      this.subjectList = JSON.parse(JSON.stringify(this._subjectList));
      console.log(this.subjectList);
      
      // 如果URL中有关键词，执行搜索
      if (this.keyword) {
        this.search(this.keyword);
      }
    });
  }

  // 处理示例列表数据，为搜索做准备
  process(array) {
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      // 为全文搜索做准备，将所有可能需要搜索的字段组合起来
      item['fulltext'] = `${item.title || ''}${item.description || ''}${item.tags?.join(' ') || ''}${item.difficulty || ''}${item.author || ''}`.replace(/\s/g, '').toLowerCase();
    }
    return array;
  }

  search(keyword = this.keyword) {
    if (keyword) {
      keyword = keyword.replace(/\s/g, '').toLowerCase();
      this.subjectList = this._subjectList.filter((item) => item.fulltext.includes(keyword));
    } else {
      this.subjectList = JSON.parse(JSON.stringify(this._subjectList));
    }
  }

  onImgError(event) {
    (event.target as HTMLImageElement).src = 'imgs/subject.webp';
  }

  clearSearch() {
    this.keyword = '';
    this.search();
  }
}
