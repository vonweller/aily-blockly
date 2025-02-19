import { Component } from '@angular/core';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { UiService } from '../../services/ui.service';

@Component({
  selector: 'app-settings',
  imports: [
    CommonModule,
    FormsModule,
    SubWindowComponent,
    NzButtonModule,
    NzInputModule,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {

  items = [
    {
      name: '基础设置',
      icon: 'fa-light fa-gear',
      content: [
        { name: '默认项目文件夹', key: 'fa-light fa-gear' },
        { name: '语言', key: 'base.lang' },
      ]
    }, {
      name: '主题设置',
      icon: 'fa-light fa-gift',
      content: [
        { name: '主题', key: 'theme.theme' },
        { name: '字体', key: 'theme.font' },
      ]
    }, {
      name: '仓库设置',
      icon: 'fa-light fa-book-bookmark',
      content: [
        { name: '仓库地址', type: 'registry-manager' },
      ]
    }, {
      name: '开发板管理',
      icon: 'fa-light fa-layer-group',
      content: [
        { name: '开发板', type: 'board-manager' },
      ]
    }
  ]

  constructor(
    private uiService: UiService
  ) {

  }

  currentType = this.items[0];
  selectType(item) {
    this.currentType = item;
  }

  cancel() {
    this.uiService.closeWindow();
  }

  apply() {

    // 保存完毕后关闭窗口
    this.uiService.closeWindow();
  }

}
