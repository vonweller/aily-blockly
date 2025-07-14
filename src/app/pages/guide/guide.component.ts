import { Component, OnInit, OnDestroy } from '@angular/core';
import { GUIDE_MENU } from '../../configs/menu.config';
import { UiService } from '../../services/ui.service';
import { ProjectService } from '../../services/project.service';
import { version } from '../../../../package.json';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { ElectronService } from '../../services/electron.service';

@Component({
  selector: 'app-guide',
  imports: [TranslateModule],
  templateUrl: './guide.component.html',
  styleUrl: './guide.component.scss'
})
export class GuideComponent implements OnInit, OnDestroy {
  version = version;
  guideMenu = GUIDE_MENU;
  showMenu = true;
  showMore = false;

  // LOGO滚动播放相关属性
  logos = [
    { src: 'brand/seekfree/logo.png', alt: 'seekfree' },
    { src: 'brand/seeedstudio/logo.png', alt: 'seeedstudio' },
    { src: 'brand/openjumper/logo.png', alt: 'openjumper' },
    { src: 'brand/diandeng/logo.png', alt: 'diandeng' },
    { src: 'brand/titlab/logo.png', alt: 'titlab' },
    { src: 'brand/emakefun/logo.png', alt: 'emakefun' },
    { src: 'brand/keyes/logo.png', alt: 'keyes' },
    // 如果要添加新的LOGO，在这里添加，例如：
    // { src: 'brand/newbrand/logo.png', alt: 'newbrand' },
    
    // 为了无缝循环，再添加一遍相同的LOGO
    { src: 'brand/seekfree/logo.png', alt: 'seekfree' },
    { src: 'brand/seeedstudio/logo.png', alt: 'seeedstudio' },
    { src: 'brand/openjumper/logo.png', alt: 'openjumper' },
    { src: 'brand/diandeng/logo.png', alt: 'diandeng' },
    { src: 'brand/titlab/logo.png', alt: 'titlab' },
    { src: 'brand/emakefun/logo.png', alt: 'emakefun' },
    { src: 'brand/keyes/logo.png', alt: 'keyes' },
    // 如果上面添加了新LOGO，这里也要添加一遍，例如：
    // { src: 'brand/newbrand/logo.png', alt: 'newbrand' },
  ];
  logoOffset = 0; // 初始偏移量，会在startLogoCarousel中设置为负值
  private logoInterval: any;

  get recentlyProjects() {
    return this.projectService.recentlyProjects
  }

  constructor(
    private uiService: UiService,
    private projectService: ProjectService,
    private router: Router,
    private electronService: ElectronService
  ) { }

  ngOnInit() {
    this.startLogoCarousel();
  }

  ngOnDestroy() {
    if (this.logoInterval) {
      clearInterval(this.logoInterval);
    }
  }

  private startLogoCarousel() {
    const logoWidth = 140; // 每个logo的宽度
    const spacing = 40; // logo之间的间距
    const logoCount = this.logos.length / 2; // 实际LOGO数量（因为有重复）
    const itemWidth = logoWidth + spacing; // 单个LOGO项的总宽度
    const singleSetWidth = logoCount * itemWidth; // 单组LOGO的总宽度
    
    this.logoInterval = setInterval(() => {
      this.logoOffset -= 1; // 向左滚动
      
      // 当第一组LOGO完全滚动出视野时，重置到起始位置
      // 此时第二组LOGO已经在显示，实现无缝循环
      if (this.logoOffset <= -singleSetWidth) {
        this.logoOffset = 0;
      }
    }, 30); // 调整到30毫秒，让滚动更平滑
  }

  pauseLogoCarousel() {
    if (this.logoInterval) {
      clearInterval(this.logoInterval);
      this.logoInterval = null;
    }
  }

  resumeLogoCarousel() {
    if (!this.logoInterval) {
      this.startLogoCarousel();
    }
  }

  onMenuClick(e: any) {
    this.process(e);
  }

  async selectFolder() {
    const folderPath = await window['ipcRenderer'].invoke('select-folder', {
      path: '',
    });
    console.log('选中的文件夹路径：', folderPath);
    return folderPath;
  }

  async openProject(data) {
    const path = await this.selectFolder();
    if (path) {
      await this.projectService.projectOpen(path);
    }
  }

  async openProjectByPath(data) {
    await this.projectService.projectOpen(data.path);
  }

  process(item) {
    switch (item.action) {
      case 'project-new':
        this.uiService.openWindow(item.data);
        break;
      case 'project-open':
        this.openProject(item.data);
        break;
      case 'browser-open':
        this.electronService.openUrl(item.data.url);
        break;
      case 'playground-open':
        this.router.navigate(['/main/playground']);
        break;
      default:
        break;
    }
  }

  openUrl(url: string) {
    this.electronService.openUrl(url);
  }

  gotoPlayground() {
    this.router.navigate(['/main/playground']);
  }
}
