import { Injectable } from '@angular/core';
import { ConfigService } from './config.service';

export interface GlobalLibrary {
  name: string;           // 库名称，如 "@aily-project/lib-example"
  version: string;        // 版本号
  nickname: string;       // 显示名称
  description?: string;   // 描述
  addedAt: string;       // 添加时间
}

export interface GlobalLibraryConfig {
  libraries: GlobalLibrary[];
  lastUpdated: string;
}

@Injectable({
  providedIn: 'root'
})
export class GlobalLibraryService {
  private configFilePath: string;
  private config: GlobalLibraryConfig = {
    libraries: [],
    lastUpdated: new Date().toISOString()
  };

  constructor(private configService: ConfigService) {
    this.initConfigPath();
    this.loadConfig();
  }

  /**
   * 初始化配置文件路径
   */
  private initConfigPath(): void {
    const appDataPath = this.configService.data.appdata_path[this.configService.data.platform]
      .replace('%HOMEPATH%', window['path'].getUserHome());
    this.configFilePath = window['path'].join(appDataPath, 'global-libraries.json');
  }

  /**
   * 加载全局库配置
   */
  private loadConfig(): void {
    try {
      if (window['path'].isExists(this.configFilePath)) {
        const configData = window['fs'].readFileSync(this.configFilePath);
        this.config = JSON.parse(configData);
      } else {
        // 如果配置文件不存在，创建默认配置
        this.saveConfig();
      }
    } catch (error) {
      console.error('加载全局库配置失败:', error);
      // 使用默认配置
      this.config = {
        libraries: [],
        lastUpdated: new Date().toISOString()
      };
    }
  }

  /**
   * 保存全局库配置
   */
  private saveConfig(): void {
    try {
      this.config.lastUpdated = new Date().toISOString();
      window['fs'].writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('保存全局库配置失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有全局库
   */
  getGlobalLibraries(): GlobalLibrary[] {
    return [...this.config.libraries];
  }

  /**
   * 添加全局库
   */
  addGlobalLibrary(library: Omit<GlobalLibrary, 'addedAt'>): void {
    // 检查是否已存在相同的库
    const existingIndex = this.config.libraries.findIndex(
      lib => lib.name === library.name
    );

    const globalLibrary: GlobalLibrary = {
      ...library,
      addedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      // 如果已存在，更新版本和信息
      this.config.libraries[existingIndex] = globalLibrary;
    } else {
      // 如果不存在，添加新库
      this.config.libraries.push(globalLibrary);
    }

    this.saveConfig();
  }

  /**
   * 移除全局库
   */
  removeGlobalLibrary(libraryName: string): void {
    this.config.libraries = this.config.libraries.filter(
      lib => lib.name !== libraryName
    );
    this.saveConfig();
  }

  /**
   * 检查库是否为全局库
   */
  isGlobalLibrary(libraryName: string): boolean {
    return this.config.libraries.some(lib => lib.name === libraryName);
  }

  /**
   * 获取全局库信息
   */
  getGlobalLibrary(libraryName: string): GlobalLibrary | undefined {
    return this.config.libraries.find(lib => lib.name === libraryName);
  }

  /**
   * 更新全局库信息
   */
  updateGlobalLibrary(libraryName: string, updates: Partial<GlobalLibrary>): void {
    const index = this.config.libraries.findIndex(lib => lib.name === libraryName);
    if (index >= 0) {
      this.config.libraries[index] = {
        ...this.config.libraries[index],
        ...updates
      };
      this.saveConfig();
    }
  }

  /**
   * 清空所有全局库
   */
  clearGlobalLibraries(): void {
    this.config.libraries = [];
    this.saveConfig();
  }

  /**
   * 获取全局库数量
   */
  getGlobalLibraryCount(): number {
    return this.config.libraries.length;
  }

  /**
   * 导出全局库配置
   */
  exportConfig(): GlobalLibraryConfig {
    return { ...this.config };
  }

  /**
   * 导入全局库配置
   */
  importConfig(config: GlobalLibraryConfig): void {
    this.config = {
      ...config,
      lastUpdated: new Date().toISOString()
    };
    this.saveConfig();
  }

  /**
   * 获取配置文件路径
   */
  getConfigFilePath(): string {
    return this.configFilePath;
  }
}
