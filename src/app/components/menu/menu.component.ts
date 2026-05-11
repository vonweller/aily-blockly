import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { IMenuItem } from '../../configs/menu.config';
import { Router } from '@angular/router';
import { PlatformService } from '../../services/platform.service';

@Component({
  selector: 'app-menu',
  imports: [CommonModule, FormsModule, TranslateModule],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
})
export class MenuComponent {
  @ViewChild('menuBox') menuBox: ElementRef;
  @ViewChild('submenuBox') submenuBox: ElementRef;
  @ViewChildren('menuItem') menuItems: QueryList<ElementRef>;

  private _menuList: readonly any[] = [];

  @Input()
  set menuList(value: readonly any[]) {
    this._menuList = Array.isArray(value) ? value : [];
    this.initializeSectionState();
  }

  get menuList(): readonly any[] {
    return this._menuList;
  }

  @Input() position = {
    x: 2,
    y: 40,
  };

  @Input() width;

  @Input() maxHeight: number | null = null;

  @Output() itemClickEvent = new EventEmitter();

  @Output() subItemClickEvent = new EventEmitter();

  @Output() actionClickEvent = new EventEmitter();

  @Output() closeEvent = new EventEmitter();

  @Input() keywords: readonly string[] = [];

  sectionCollapsedState: Record<string, boolean> = {};
  sectionFilterState: Record<string, string> = {};

  // 添加子菜单显示状态管理
  activeSubmenuItem: IMenuItem | null = null;
  submenuTimeout: any = null;
  submenuPosition = { left: '0px', top: '0px' };
  submenuMaxHeight = 'none';
  submenuOverflow = 'visible';

  constructor(
    private router: Router,
    private platformService: PlatformService
  ) { }

  /** 按平台格式化快捷键显示：macOS 显示 ⌘，Windows 显示 Ctrl */
  formatShortcutForDisplay(text: string): string {
    if (!text) return '';
    if (this.platformService.isMac()) {
      return text.replace(/Ctrl\/⌘|Ctrl/gi, '⌘');
    }
    return text.replace(/Ctrl\/⌘|⌘/g, 'Ctrl');
  }

  ngAfterViewInit(): void {
    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('contextmenu', this.handleDocumentClick);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.handleDocumentClick);
    document.removeEventListener('contextmenu', this.handleDocumentClick);
  }

  itemClick(item) {
    if (item.disabled) return;
    if (this.isSectionToggle(item)) {
      this.toggleSection(item);
      return;
    }
    if (this.isSectionFilter(item)) {
      return;
    }
    if (item.children && item.action !== 'select-model') return;
    this.itemClickEvent.emit(item);
  }

  actionClick(event: MouseEvent, action: { icon: string; action: string }, item: any) {
    event.stopPropagation();
    this.actionClickEvent.emit({ action: action.action, data: item });
  }

  handleDocumentClick = (event: MouseEvent) => {
    event.preventDefault();
    const target = event.target as Node;

    // 检查点击是否在主菜单或子菜单内
    const isClickInMainMenu = this.menuBox && this.menuBox.nativeElement.contains(target);
    const isClickInSubmenu = this.submenuBox && this.submenuBox.nativeElement && this.submenuBox.nativeElement.contains(target);

    if (!isClickInMainMenu && !isClickInSubmenu) {
      this.closeMenu();
    }
  };

  closeMenu() {
    this.activeSubmenuItem = null;
    this.closeEvent.emit('');
  }

  get visibleMenuItems(): IMenuItem[] {
    const visibleItems: IMenuItem[] = [];

    for (const item of this.menuList) {
      if (item.sep) {
        visibleItems.push(item);
        continue;
      }

      if (this.isSectionScoped(item) && !this.isSectionItemVisible(item)) {
        continue;
      }

      if (this.isSectionFilter(item) && !this.isSectionExpanded(this.getSectionId(item))) {
        continue;
      }

      if ((item.children && item.children.length > 0) || (!item.children && this.showInRouter(item))) {
        visibleItems.push(item);
      }
    }

    return this.trimSectionSeparators(visibleItems);
  }

  isHighlight(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return this.keywords.some((keyword) =>
      keyword && lowerText.includes(keyword.toLowerCase())
    );
  }

  showInRouter(menuItem: IMenuItem) {
    if (!menuItem.router) {
      return true;
    } else {
      for (const router of menuItem.router) {
        if (this.router.url.indexOf(router) > -1) {
          return true;
        }
      }
    }
  }

  isSectionToggle(item: IMenuItem | null | undefined): boolean {
    return typeof item?.action === 'string' && item.action.startsWith('section-toggle-');
  }

  isSectionFilter(item: IMenuItem | null | undefined): boolean {
    return typeof item?.action === 'string' && item.action.startsWith('section-filter-');
  }

  getSectionId(item: IMenuItem | null | undefined): string {
    const explicitSectionId = typeof item?.extra?.sectionId === 'string' ? item.extra.sectionId.trim() : '';
    if (explicitSectionId) {
      return explicitSectionId;
    }

    const action = typeof item?.action === 'string' ? item.action : '';
    if (action.startsWith('section-toggle-')) {
      return action.slice('section-toggle-'.length);
    }
    if (action.startsWith('section-filter-')) {
      return action.slice('section-filter-'.length);
    }

    return typeof item?.extra?.section === 'string' ? item.extra.section : '';
  }

  isSectionExpanded(sectionId: string): boolean {
    return !this.sectionCollapsedState[sectionId];
  }

  toggleSection(item: IMenuItem): void {
    const sectionId = this.getSectionId(item);
    if (!sectionId) {
      return;
    }

    this.sectionCollapsedState[sectionId] = !this.sectionCollapsedState[sectionId];
    this.activeSubmenuItem = null;
  }

  updateSectionFilter(sectionId: string, value: string): void {
    this.sectionFilterState[sectionId] = typeof value === 'string' ? value : '';
  }

  getSectionFilterValue(sectionId: string): string {
    return this.sectionFilterState[sectionId] ?? '';
  }

  getSectionToggleIcon(item: IMenuItem): string {
    return this.isSectionExpanded(this.getSectionId(item)) ? 'fa-light fa-chevron-down' : 'fa-light fa-chevron-right';
  }

  private initializeSectionState(): void {
    for (const item of this.menuList) {
      if (this.isSectionToggle(item)) {
        const sectionId = this.getSectionId(item);
        if (!sectionId || this.sectionCollapsedState[sectionId] !== undefined) {
          continue;
        }
        this.sectionCollapsedState[sectionId] = item.extra?.collapsed !== false;
      }
      if (this.isSectionFilter(item)) {
        const sectionId = this.getSectionId(item);
        if (sectionId && this.sectionFilterState[sectionId] === undefined) {
          this.sectionFilterState[sectionId] = '';
        }
      }
    }
  }

  private isSectionScoped(item: IMenuItem): boolean {
    return typeof item?.extra?.section === 'string' && item.extra.section.trim().length > 0;
  }

  private isSectionItemVisible(item: IMenuItem): boolean {
    const sectionId = this.getSectionId(item);
    if (!sectionId) {
      return true;
    }

    if (!this.isSectionExpanded(sectionId)) {
      return false;
    }

    const filterValue = this.getSectionFilterValue(sectionId).trim().toLowerCase();
    if (!filterValue) {
      return true;
    }

    const haystack = [item.name, item.text, item.tooltip]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase();
    return haystack.includes(filterValue);
  }

  private trimSectionSeparators(items: IMenuItem[]): IMenuItem[] {
    const normalized: IMenuItem[] = [];

    for (const item of items) {
      if (item.sep && (normalized.length === 0 || normalized[normalized.length - 1].sep)) {
        continue;
      }
      normalized.push(item);
    }

    while (normalized.length > 0 && normalized[normalized.length - 1].sep) {
      normalized.pop();
    }

    return normalized;
  }
  // 显示子菜单
  showSubMenu(event: MouseEvent, item: IMenuItem, index: number) {
    if (!item?.children?.length) {
      if (this.activeSubmenuItem === item) {
        this.activeSubmenuItem = null;
      }
      return;
    }

    // 清除之前的延时
    if (this.submenuTimeout) {
      clearTimeout(this.submenuTimeout);
    }

    if (this.activeSubmenuItem === item) {
      return;
    }

    this.activeSubmenuItem = item;
    this.calculateSubmenuPosition(index);
  }

  // 计算子菜单位置
  calculateSubmenuPosition(index: number) {
    const menuItems = this.menuItems.toArray();
    if (menuItems[index]) {
      const menuItemElement = menuItems[index].nativeElement;
      const menuBoxElement = this.menuBox.nativeElement;
      const menuBoxRect = menuBoxElement.getBoundingClientRect();
      const itemRect = menuItemElement.getBoundingClientRect();

      // 子菜单与主菜单轻微贴合，减少 hover 过渡距离。
      const left = menuBoxRect.right - 4;
      const top = itemRect.top;

      this.submenuPosition = {
        left: left + 'px',
        top: top - 2 + 'px'
      };

      // 计算子菜单高度
      this.calculateSubmenuHeight(top);
    }
  }

  // 计算子菜单最大高度
  calculateSubmenuHeight(submenuTop: number) {
    const windowHeight = window.innerHeight;
    const submenuTopFromWindow = submenuTop;

    // 预估子菜单项数量和高度
    const submenuItems = this.activeSubmenuItem?.children || [];
    const itemHeight = 28; // 每个菜单项高度
    const padding = 8; // 上下padding (4px * 2)
    const estimatedSubmenuHeight = submenuItems.length * itemHeight + padding;

    // 计算最大可用高度 (窗口高度 - 子菜单顶部距离 - 底部预留空间)
    const bottomPadding = 10; // 底部预留空间
    const maxAvailableHeight = windowHeight - submenuTopFromWindow - bottomPadding;

    // 如果预估高度超过最大可用高度,启用滚动
    if (estimatedSubmenuHeight > maxAvailableHeight) {
      this.submenuMaxHeight = maxAvailableHeight + 'px';
      this.submenuOverflow = 'auto';
    } else {
      this.submenuMaxHeight = 'none';
      this.submenuOverflow = 'visible';
    }
  }

  // 隐藏子菜单
  hideSubMenu(event: MouseEvent, index: number) {
    // 延时隐藏，给用户时间移动到子菜单
    this.submenuTimeout = setTimeout(() => {
      this.activeSubmenuItem = null;
    }, 60);
  }

  // 保持子菜单打开
  keepSubMenuOpen() {
    if (this.submenuTimeout) {
      clearTimeout(this.submenuTimeout);
    }
  }

  subItemClick(event, subItem) {
    this.activeSubmenuItem?.children?.forEach(item => {
      item['check'] = false
    });
    subItem['check'] = true
    this.subItemClickEvent.emit(subItem);
  }
}
