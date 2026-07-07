import { Component, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
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
import { SimplebarAngularComponent, SimplebarAngularModule } from 'simplebar-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { AuthService } from '../../services/auth.service';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzMessageService } from 'ng-zorro-antd/message';
import { ThemeService, ThemeMode } from '../../services/theme.service';
import { CmdService } from '../../services/cmd.service';
import { ElectronService } from '../../services/electron.service';
import { NzToolTipModule } from "ng-zorro-antd/tooltip";

type CacheClearOption = 'all' | '30' | '90';

interface CacheStats {
  totalFiles: number;
  totalSizeFormatted: string;
}

interface DirectoryStats {
  size: number;
  count: number;
}

interface CacheClearPaths {
  buildPath: string;
  configFilePath: string;
  scriptPath: string;
}

@Component({
  selector: 'app-settings',
  imports: [
    CommonModule,
    FormsModule,
    SubWindowComponent,
    NzButtonModule,
    NzInputModule,
    NzRadioModule,
    SimplebarAngularModule,
    TranslateModule,
    NzSwitchModule,
    NzSelectModule,
    NzToolTipModule
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnDestroy {
  @ViewChild('scrollContainer', { static: false }) scrollContainer: SimplebarAngularComponent;

  activeSection = 'SETTINGS.SECTIONS.BASIC'; // 当前活动的部分
  private scrollElement: HTMLElement | null = null;
  private readonly scrollHandler = () => this.onScroll();
  private scrollTargetSection: string | null = null;
  private scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

  // simplebar 配置选项
  options = {
    autoHide: true,
    scrollbarMinSize: 50
  };

  items = [
    {
      name: 'SETTINGS.SECTIONS.BASIC',
      icon: 'fa-light fa-gear'
    },
    {
      name: 'SETTINGS.SECTIONS.THEME',
      icon: 'fa-light fa-gift'
    },
    // {
    //   name: 'SETTINGS.SECTIONS.COMPILATION',
    //   icon: 'fa-light fa-screwdriver-wrench'
    // },
    {
      name: 'SETTINGS.SECTIONS.BLOCKLY',
      icon: 'fa-light fa-puzzle-piece'
    },
    {
      name: 'SETTINGS.SECTIONS.REPOSITORY',
      icon: 'fa-light fa-globe'
    },
    {
      name: 'SETTINGS.SECTIONS.DEPENDENCIES',
      icon: 'fa-light fa-layer-group'
    },
    {
      name: 'SETTINGS.SECTIONS.AILY_BUILDER',
      icon: 'fa-light fa-hammer'
    },
    // {
    //   name: 'SETTINGS.SECTIONS.MCP',
    //   icon: 'fa-light fa-webhook'
    // },
    {
      name: 'SETTINGS.SECTIONS.CACHE',
      icon: 'fa-light fa-broom'
    },
    {
      name: 'SETTINGS.SECTIONS.LABS',
      icon: 'fa-light fa-flask'
    },
    // {
    //   name: 'SETTINGS.SECTIONS.DEVMODE',
    //   icon: 'fa-light fa-gear-code'
    // },
  ];

  // 缓存管理
  cacheStats: CacheStats = { totalFiles: 0, totalSizeFormatted: '0 B' };
  cacheSizeLoading = false;
  cacheClearing: CacheClearOption | null = null;
  private _clearCacheSubscription: Subscription | null = null;
  private _clearCacheLoadingRef: string | null = null;

  // 用于跟踪安装/卸载状态
  boardOperations = {};
  ailyBuilderStatus: any = null;
  ailyBuilderUpdating = false;
  ailyBuilderChannelSwitching = false;
  private ailyBuilderStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private initialAilyBuilderNext = false;

  // 搜索关键字
  boardSearchKeyword: string = '';

  get boardList() {
    return this.settingsService.boardList.concat(
      this.settingsService.toolList,
      this.settingsService.sdkList,
      this.settingsService.compilerList
    );;
  }

  // 过滤后的开发板列表
  get filteredBoardList() {
    if (!this.boardSearchKeyword || this.boardSearchKeyword.trim() === '') {
      return this.boardList;
    }
    const keyword = this.boardSearchKeyword.toLowerCase().trim();
    return this.boardList.filter(board =>
      board.name.toLowerCase().includes(keyword) ||
      (board.version && board.version.toLowerCase().includes(keyword))
    );
  }

  get npmRegistryList() {
    return this.configService.getRegionList();
  }

  get apiServerList() {
    return this.configService.getRegionList();
  }

  get resourceSourceList() {
    return this.configService.getResourceSourceList();
  }

  // 区域对应的国旗映射
  regionFlags: { [key: string]: string } = {
    'cn': '🇨🇳',
    'eu': '🇪🇺',
    'us': '🇺🇸',
    'jp': '🇯🇵',
    'kr': '🇰🇷',
    'localhost': ''
  };

  // 获取区域列表（仅启用的区域）
  get regionList() {
    return this.configService.getEnabledRegionList();
  }

  // 获取区域对应的国旗
  getRegionFlag(key: string): string {
    return this.regionFlags[key] || '🌐';
  }

  // 当前选择的区域
  get selectedRegion() {
    return this.configData.region || 'cn';
  }

  set selectedRegion(value: string) {
    this.configData.region = value;
  }

  get selectedResourceSource() {
    return this.configData.resource_source || 'auto';
  }

  set selectedResourceSource(value: string) {
    this.configData.resource_source = value;
  }

  getResourceSourceLabel(source: { key: string; name?: string; url: string }): string {
    if (source.name) {
      return source.name;
    }

    const translationKey = `SETTINGS.FIELDS.RESOURCE_SOURCE_${String(source.key || '').toUpperCase()}`;
    const translated = this.translateService.instant(translationKey);
    return translated !== translationKey ? translated : source.url;
  }

  // 切换区域
  async onRegionChange(regionKey: string) {
    // 如果选择的区域和当前区域一样，直接返回
    if (regionKey === this.selectedRegion) {
      return;
    }

    // 检查是否已登录
    if (this.authService.isAuthenticated) {
      // 显示确认弹窗
      this.modal.confirm({
        nzTitle: this.translateService.instant('SETTINGS.FIELDS.REGION_TITLE'),
        nzContent: this.translateService.instant('SETTINGS.FIELDS.REGION_DESC'),
        nzOkText: this.translateService.instant('SETTINGS.FIELDS.REGION_CONFIRM'),
        nzCancelText: this.translateService.instant('SETTINGS.FIELDS.REGION_CANCEL'),
        nzBodyStyle: { background: 'var(--aily-bg-primary)' },
        nzOnOk: async () => {
          // 用户确认后，更新区域值
          this.selectedRegion = regionKey;

          // 发送消息到主窗口执行登出
          try {
            setTimeout(async () => {
              if (window['iWindow'] && window['iWindow'].send) {
                // 子窗口：发送消息到主窗口
                window['iWindow'].send({
                  to: 'main',
                  data: { action: 'logout' }
                });
                this.authService.logout();
              } else {
                this.authService.logout();
              }
            }, 0);
          } catch (error) {
            console.error('登出失败:', error);
          }
          // 继续执行切换区域
          await this.configService.setRegion(regionKey);
          await this.updateBoardList();
        }
      });
    } else {
      // 未登录，直接切换区域
      this.selectedRegion = regionKey;
      await this.configService.setRegion(regionKey);
      await this.updateBoardList();
    }
  }

  get langList() {
    return this.translationService.languageList;
  }

  get currentLang() {
    return this.translationService.getSelectedLanguage();
  }

  get configData() {
    return this.configService.data;
  }

  get labsConfig() {
    if (!this.configData.labs) {
      this.configData.labs = {};
    }
    return this.configData.labs;
  }

  appdata_path: string

  mcpServiceList = []

  constructor(
    private uiService: UiService,
    private settingsService: SettingsService,
    private translationService: TranslationService,
    private configService: ConfigService,
    private authService: AuthService,
    private modal: NzModalService,
    private translateService: TranslateService,
    private themeService: ThemeService,
    private message: NzMessageService,
    private cmdService: CmdService,
    private electronService: ElectronService
  ) {
  }

  ngOnDestroy() {
    this.scrollElement?.removeEventListener('scroll', this.scrollHandler);
    this.clearScrollEndTimer();
    this.clearAilyBuilderStatusTimer();
    this._clearCacheSubscription?.unsubscribe();
    if (this._clearCacheLoadingRef) {
      this.message.remove(this._clearCacheLoadingRef);
      this._clearCacheLoadingRef = null;
    }
  }

  async ngOnInit() {
    // await this.configService.init();
  }

  async ngAfterViewInit() {
    this.scrollElement = this.scrollContainer?.SimpleBar?.getScrollElement() || null;
    this.scrollElement?.addEventListener('scroll', this.scrollHandler);
    await this.updateBoardList();
    this.initialAilyBuilderNext = !!this.labsConfig.ailyBuilderNext;
    await this.loadAilyBuilderStatus();
    this.loadCacheStats();
  }

  async updateBoardList() {
    const platform = this.configService.data.platform;
    // this.appdata_path = this.configService.data.appdata_path[platform].replace('%HOMEPATH%', window['path'].getUserHome());
    this.appdata_path = window['path'].getAppDataPath();
    // 使用当前区域的仓库地址
    const npmRegistry = this.configService.getCurrentNpmRegistry();
    // this.settingsService.getBoardList(this.appdata_path, npmRegistry);
    this.settingsService.getToolList(this.appdata_path, npmRegistry);
    this.settingsService.getSdkList(this.appdata_path, npmRegistry);
    this.settingsService.getCompilerList(this.appdata_path, npmRegistry);
  }

  async loadAilyBuilderStatus() {
    if (!window['builder']?.status) {
      return;
    }
    try {
      const updateCheck = await window['packageUpdates']?.check?.();
      this.ailyBuilderStatus = updateCheck?.ailyBuilder || await window['builder'].status();
      if (this.ailyBuilderStatus?.installing) {
        this.scheduleAilyBuilderStatusReload();
      }
    } catch (error) {
      console.warn('加载 aily-builder 状态失败:', error);
      this.ailyBuilderStatus = null;
    }
  }

  getAilyBuilderStatusText() {
    if (!this.ailyBuilderStatus) {
      return this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_UNKNOWN');
    }
    if (this.ailyBuilderUpdating || this.ailyBuilderStatus.installing) {
      return '';
    }
    if (this.ailyBuilderStatus.error) {
      return this.ailyBuilderStatus.error;
    }
    if (!this.ailyBuilderStatus.installed) {
      return this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_NOT_INSTALLED');
    }
    if (this.ailyBuilderStatus.updateAvailable) {
      return '';
    }
    return this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_UP_TO_DATE');
  }

  getAilyBuilderDisplayName() {
    const status = this.ailyBuilderStatus;
    if (!status) {
      return this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_UNKNOWN');
    }

    const name = status.channel === 'next' ? 'next' : 'stable';
    const version = status.installedVersion || status.targetVersion;
    return version ? `${name} @ ${version}` : name;
  }

  async updateAilyBuilder() {
    if (!window['builder']?.update || this.ailyBuilderUpdating) {
      return;
    }

    const targetVersion = this.ailyBuilderStatus?.targetVersion;
    this.ailyBuilderUpdating = true;
    try {
      await window['builder'].update(targetVersion);
      await this.loadAilyBuilderStatus();
      this.message.success(this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_UPDATE_DONE'));
    } catch (error: any) {
      console.error('aily-builder 更新失败:', error);
      this.message.error(error?.message || this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_UPDATE_FAILED'));
    } finally {
      this.ailyBuilderUpdating = false;
    }
  }

  onAilyBuilderNextChange(enabled: boolean) {
    this.labsConfig.ailyBuilderNext = enabled;
  }

  private async syncAilyBuilderChannel(options: { install?: boolean } = {}) {
    if (!window['builder']?.setChannel || this.ailyBuilderChannelSwitching) {
      return;
    }

    this.ailyBuilderChannelSwitching = true;
    try {
      const channel = this.labsConfig.ailyBuilderNext ? 'next' : 'stable';
      this.ailyBuilderStatus = await window['builder'].setChannel(channel, options);
      await this.loadAilyBuilderStatus();
    } catch (error: any) {
      console.error('aily-builder channel 切换失败:', error);
      this.message.error(error?.message || this.translateService.instant('SETTINGS.FIELDS.AILY_BUILDER_UPDATE_FAILED'));
    } finally {
      this.ailyBuilderChannelSwitching = false;
    }
  }

  private scheduleAilyBuilderStatusReload() {
    this.clearAilyBuilderStatusTimer();
    this.ailyBuilderStatusTimer = setTimeout(() => {
      this.ailyBuilderStatusTimer = null;
      this.loadAilyBuilderStatus();
    }, 2000);
  }

  private clearAilyBuilderStatusTimer() {
    if (this.ailyBuilderStatusTimer) {
      clearTimeout(this.ailyBuilderStatusTimer);
      this.ailyBuilderStatusTimer = null;
    }
  }

  selectLang(lang) {
    this.translationService.setLanguage(lang.code);
    window['ipcRenderer'].send('setting-changed', { action: 'language-changed', data: lang.code });
  }

  // 使用锚点滚动到指定部分
  scrollToSection(item) {
    this.activeSection = item.name;
    this.scrollTargetSection = item.name;
    this.clearScrollEndTimer();

    const element = document.getElementById(item.name);
    if (element && this.scrollElement) {
      this.scrollElement.scrollTo({
        top: Math.max(element.offsetTop - 12, 0),
        behavior: 'smooth'
      });
      this.scheduleScrollEnd();
    } else {
      this.scrollTargetSection = null;
    }
  }

  // 监听滚动事件以更新活动菜单项
  onScroll() {
    if (!this.scrollElement) {
      return;
    }

    if (this.scrollTargetSection) {
      this.activeSection = this.scrollTargetSection;
      this.scheduleScrollEnd();
      return;
    }

    this.updateActiveSectionByScrollPosition();
  }

  private updateActiveSectionByScrollPosition() {
    const sections = document.querySelectorAll('.section');
    const scrollPosition = this.scrollElement.scrollTop;

    sections.forEach((section: HTMLElement) => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;

      if (scrollPosition >= sectionTop - 50 &&
        scrollPosition < sectionTop + sectionHeight - 50) {
        this.activeSection = section.id.replace('section-', '');
      }
    });
  }

  private scheduleScrollEnd() {
    this.clearScrollEndTimer();
    this.scrollEndTimer = setTimeout(() => {
      this.scrollTargetSection = null;
      this.scrollEndTimer = null;
    }, 120);
  }

  private clearScrollEndTimer() {
    if (this.scrollEndTimer) {
      clearTimeout(this.scrollEndTimer);
      this.scrollEndTimer = null;
    }
  }

  cancel() {
    if (this.labsConfig.ailyBuilderNext !== this.initialAilyBuilderNext) {
      this.labsConfig.ailyBuilderNext = this.initialAilyBuilderNext;
    }
    this.uiService.closeWindow();
  }

  async apply() {
    await this.configService.applyResourceSourceRuntimeSelection();
    // 保存到config.json，如有需要立即加载的，再加载
    await this.configService.save();
    if (this.labsConfig.ailyBuilderNext !== this.initialAilyBuilderNext) {
      await this.syncAilyBuilderChannel({ install: true });
    }
    this.initialAilyBuilderNext = !!this.labsConfig.ailyBuilderNext;
    window['ipcRenderer'].send('setting-changed', { action: 'devmode-changed', data: this.configData.devmode });
    // 保存完毕后关闭窗口
    this.uiService.closeWindow();
  }

  onThemeChange(value: string) {
    const mode: ThemeMode = value === 'light' ? 'light' : 'dark';
    this.themeService.setTheme(mode);
    window['ipcRenderer'].send('setting-changed', { action: 'theme-changed', data: mode });
  }

  async uninstall(board) {
    this.boardOperations[board.name] = { status: 'loading' };
    const result = await this.settingsService.uninstall(board)
    if (result === 'success') {
      board.installed = false;
    }
    else if (result === 'failed') {
      this.boardOperations[board.name] = { status: 'failed' };
    }
  }

  async install(board) {
    this.boardOperations[board.name] = { status: 'loading' };
    const result = await this.settingsService.install(board)
    if (result === 'success') {
      board.installed = true;
    }
    else if (result === 'failed') {
      this.boardOperations[board.name] = { status: 'failed' };
    }
  }

  onDevModeChange() {
    // this.configData.devmode = this.configData.devmode;
  }

  async loadCacheStats() {
    const buildPath = this.getCacheBuildPath();
    if (!buildPath) {
      this.cacheStats = this.getEmptyCacheStats();
      this.cacheSizeLoading = false;
      return;
    }

    this.cacheSizeLoading = true;
    try {
      this.cacheStats = this.calculateCacheStats(buildPath);
    } catch (e) {
      console.error('Failed to load cache stats', e);
      this.cacheStats = this.getEmptyCacheStats();
    } finally {
      this.cacheSizeLoading = false;
    }
  }

  private getCacheBuildPath(): string | null {
    const buildPath = window['path'].getAilyBuilderBuildPath();
    if (!buildPath || !window['fs'].existsSync(buildPath)) {
      return null;
    }
    return buildPath;
  }

  private getEmptyCacheStats(): CacheStats {
    return { totalFiles: 0, totalSizeFormatted: '0 B' };
  }

  private calculateCacheStats(buildPath: string): CacheStats {
    let totalSize = 0;
    let totalFiles = 0;
    const entries = window['fs'].readDirSync(buildPath);

    for (const entry of entries) {
      if (!entry._isDirectory) {
        continue;
      }

      const dirPath = window['path'].join(buildPath, entry.name);
      const { size, count } = this.calcDirSize(dirPath);
      totalSize += size;
      totalFiles += count;
    }

    return {
      totalFiles,
      totalSizeFormatted: this.formatFileSize(totalSize)
    };
  }

  private calcDirSize(dirPath: string): DirectoryStats {
    let size = 0;
    let count = 0;
    try {
      const entries = window['fs'].readDirSync(dirPath);
      for (const entry of entries) {
        const fullPath = window['path'].join(dirPath, entry.name);
        if (entry._isDirectory) {
          const sub = this.calcDirSize(fullPath);
          size += sub.size;
          count += sub.count;
        } else {
          try {
            const stat = window['fs'].statSync(fullPath);
            size += stat.size;
            count++;
          } catch { }
        }
      }
    } catch { }
    return { size, count };
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  clearCache(option: CacheClearOption) {
    if (option === 'all') {
      this.modal.confirm({
        nzTitle: this.translateService.instant('SETTINGS.FIELDS.CACHE_CONFIRM_TITLE'),
        nzContent: this.translateService.instant('SETTINGS.FIELDS.CACHE_CONFIRM_DESC'),
        nzOkText: this.translateService.instant('SETTINGS.FIELDS.CACHE_CONFIRM_OK'),
        nzCancelText: this.translateService.instant('SETTINGS.BUTTONS.CANCEL'),
        nzBodyStyle: { background: 'var(--aily-bg-primary)' },
        nzOnOk: () => this.doClearCache(option)
      });
    } else {
      this.doClearCache(option);
    }
  }

  private async doClearCache(option: CacheClearOption) {
    const paths = this.getCacheClearPaths();
    const excludeDirs = await this.getCurrentProjectCacheExcludeDirs();

    if (!this.writeClearCacheConfig(paths, option, excludeDirs)) {
      return;
    }

    this.startClearCacheProcess(option, paths);
  }

  private getCacheClearPaths(): CacheClearPaths {
    const buildPath = window['path'].getAilyBuilderBuildPath();
    const appDataPath = window['path'].getAppDataPath();

    return {
      buildPath,
      configFilePath: window['path'].join(appDataPath, 'clear-cache-config.json'),
      scriptPath: window['path'].join(window['path'].getAilyChildPath(), 'scripts', 'clear-cache.js')
    };
  }

  private async getCurrentProjectCacheExcludeDirs(): Promise<string[]> {
    if (!window['iWindow']?.send) {
      return [];
    }

    try {
      const resp = await window['iWindow'].send({ to: 'main', data: { action: 'get-build-path' } });
      return resp?.buildPath ? [window['path'].basename(resp.buildPath)] : [];
    } catch {
      return [];
    }
  }

  private writeClearCacheConfig(paths: CacheClearPaths, option: CacheClearOption, excludeDirs: string[]): boolean {
    try {
      window['fs'].writeFileSync(paths.configFilePath, JSON.stringify({
        buildPath: paths.buildPath,
        option,
        excludeDirs
      }, null, 2));
      return true;
    } catch (e) {
      console.error('Failed to write clear-cache config', e);
      this.message.error(this.translateService.instant('SETTINGS.FIELDS.CACHE_CLEAR_FAILED'));
      return false;
    }
  }

  private startClearCacheProcess(option: CacheClearOption, paths: CacheClearPaths) {
    this.cacheClearing = option;
    const loadingRef = this.message.loading(this.translateService.instant('SETTINGS.FIELDS.CACHE_CLEARING'), { nzDuration: 0 });
    this._clearCacheLoadingRef = loadingRef.messageId;

    const command = `node "${paths.scriptPath}" "${paths.configFilePath}"`;
    this.sendLog({ detail: command, state: 'doing' });
    const startTime = Date.now();

    this._clearCacheSubscription?.unsubscribe();
    this._clearCacheSubscription = this.cmdService.spawn('node', [paths.scriptPath, paths.configFilePath], {}, true).subscribe({
      next: (output) => {
        if (output.type === 'stdout' || output.type === 'stderr') {
          this.logClearCacheOutput(output.data, output.type === 'stderr' ? 'error' : 'doing');
          return;
        }

        if (output.type === 'close') {
          this.finishClearCache(output.code === 0, startTime, output.stderr);
        }
      },
      error: (e) => {
        console.error('Failed to clear cache', e);
        this.finishClearCache(false, startTime, String(e));
      }
    });
  }

  private logClearCacheOutput(data: string | undefined, state: 'doing' | 'error') {
    if (!data) {
      return;
    }

    const lines = data.split(/\r?\n/).filter(l => l.trim());
    for (const line of lines) {
      this.sendLog({ detail: line, state });
    }
  }

  private finishClearCache(success: boolean, startTime: number, errorDetail?: string) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (this._clearCacheLoadingRef) {
      this.message.remove(this._clearCacheLoadingRef);
      this._clearCacheLoadingRef = null;
    }

    if (success) {
      this.sendLog({ detail: `Cache cleared (${duration}s)`, state: 'done' });
      this.message.success(this.translateService.instant('SETTINGS.FIELDS.CACHE_CLEARED'));
    } else {
      this.sendLog({
        title: this.translateService.instant('SETTINGS.FIELDS.CACHE_CLEAR_FAILED'),
        detail: `Cache clear failed (${duration}s) ${errorDetail || ''}`.trim(),
        state: 'error'
      });
      this.message.error(this.translateService.instant('SETTINGS.FIELDS.CACHE_CLEAR_FAILED'));
    }

    this.cacheClearing = null;
    this.loadCacheStats();
  }

  private sendLog(log: { title?: string; detail?: string; state?: string }) {
    if (window['iWindow'] && window['iWindow'].send) {
      window['iWindow'].send({ to: 'main', data: { action: 'log', log } });
    }
  }

  // 搜索框变化处理
  onBoardSearchChange() {
    // 搜索逻辑已通过 filteredBoardList getter 实现
    // 这里可以添加额外的处理逻辑，如防抖等
  }

  openResources() {
    this.electronService.openByExplorer(window['path'].getAppDataPath());
  }

  openCacheFolder() {
    this.electronService.openByExplorer(window['path'].getAilyBuilderCachePath());
  }
}
