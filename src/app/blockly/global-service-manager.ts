import { BitmapUploadService } from './bitmap-upload.service';

/**
 * 全局服务管理器
 * 用于在非 Angular 环境（如 Blockly 字段）中访问 Angular 服务
 */
export class GlobalServiceManager {
  private static instance: GlobalServiceManager;
  private bitmapUploadService: BitmapUploadService | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): GlobalServiceManager {
    if (!GlobalServiceManager.instance) {
      GlobalServiceManager.instance = new GlobalServiceManager();
    }
    return GlobalServiceManager.instance;
  }

  /**
   * 设置位图上传服务实例
   * 这个方法应该在 Angular 组件或服务中调用
   */
  setBitmapUploadService(service: BitmapUploadService): void {
    this.bitmapUploadService = service;
  }

  /**
   * 获取位图上传服务实例
   */
  getBitmapUploadService(): BitmapUploadService | null {
    return this.bitmapUploadService;
  }
}
