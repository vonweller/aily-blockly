import { Component, ElementRef, ViewChild } from '@angular/core';
import { SubWindowComponent } from '../../components/sub-window/sub-window.component';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { UiService } from '../../services/ui.service';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { SettingsService } from '../../services/settings.service';
import { TranslationService } from '../../services/translation.service';
import { ConfigService } from '../../services/config.service';
import { SimplebarAngularModule } from 'simplebar-angular';
@Component({
  selector: 'app-settings',
  imports: [
    CommonModule,
    FormsModule,
    SubWindowComponent,
    NzButtonModule,
    NzInputModule,
    NzRadioModule,
    SimplebarAngularModule
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  @ViewChild('scrollContainer', { static: false }) scrollContainer: ElementRef;
  
  activeSection = '基础设置'; // 当前活动的部分

  // simplebar 配置选项
  options = {
    autoHide: true,
    scrollbarMinSize: 50
  };

  items = [
    {
      name: '基础设置',
      icon: 'fa-light fa-gear',
      content: [
        { name: '默认项目文件夹', key: 'fa-light fa-gear' },
        { name: '语言', key: 'base.lang' },
      ],
    },
    {
      name: '主题设置',
      icon: 'fa-light fa-gift',
      content: [
        { name: '主题', key: 'theme.theme' },
        { name: '字体', key: 'theme.font' },
      ],
    },
    {
      name: '编译设置',
      icon: 'fa-light fa-screwdriver-wrench',
      content: [

      ],
    },
    {
      name: '仓库设置',
      icon: 'fa-light fa-book-bookmark',
      content: [{ name: '仓库地址', type: 'registry-manager' }],
    },
    {
      name: '开发板管理',
      icon: 'fa-light fa-layer-group',
      content: [{ name: '开发板', type: 'board-manager' }],
    },
  ];

  UiThemeValue = 'dark';
  blocklyThemeValue = 'default';

  npmRegistryListStr = `https://registry.npmjs.org/
https://registry.npm.taobao.org/`;

  get boardList() {
    return this.settingsService.boardList;
  }

  get langList() {
    return this.translationService.languageList;
  }

  get currentLang() {
    return this.translationService.getSelectedLanguage();
  }

  get data() {
    return this.configService.data;
  }

  constructor(
    private uiService: UiService,
    private settingsService: SettingsService,
    private translationService: TranslationService,
    private configService: ConfigService
  ) {
  }

  async ngOnInit() {
    await this.configService.init()
  }

  selectLang(lang) {
    this.translationService.setLanguage(lang.code);
    window['ipcRenderer'].send('setting-changed', { action: 'language-changed', data: lang.code });
  }

  // 使用锚点滚动到指定部分
  scrollToSection(item) {
    this.activeSection = item.name;
    const element = document.getElementById(`section-${item.name}`);
    if (element && this.scrollContainer) {
      // 针对simplebar调整滚动方法
      const simplebarInstance = this.scrollContainer['SimpleBar'];
      if (simplebarInstance) {
        simplebarInstance.getScrollElement().scrollTo({
          top: element.offsetTop,
          behavior: 'smooth'
        });
      }
    }
  }

  // 监听滚动事件以更新活动菜单项
  onScroll() {
    const sections = document.querySelectorAll('.section');
    let scrollElement;
    
    // 获取simplebar的滚动元素
    const simplebarInstance = this.scrollContainer['SimpleBar'];
    if (simplebarInstance) {
      scrollElement = simplebarInstance.getScrollElement();
    } else {
      return;
    }
    
    const scrollPosition = scrollElement.scrollTop;
    
    sections.forEach((section: HTMLElement) => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      
      if (scrollPosition >= sectionTop - 50 && 
          scrollPosition < sectionTop + sectionHeight - 50) {
        this.activeSection = section.id.replace('section-', '');
      }
    });
  }

  cancel() {
    this.uiService.closeWindow();
  }

  apply() {
    // 保存到config.json，如有需要立即加载的，再加载

    // 保存完毕后关闭窗口
    this.uiService.closeWindow();
  }
}
