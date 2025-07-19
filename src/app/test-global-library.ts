/**
 * 全局库功能测试脚本
 * 这个文件用于测试全局库的各种功能
 */

import { GlobalLibraryService, GlobalLibrary } from './services/global-library.service';

export class GlobalLibraryTester {
  
  constructor(private globalLibraryService: GlobalLibraryService) {}

  /**
   * 测试添加全局库
   */
  testAddGlobalLibrary(): void {
    console.log('=== 测试添加全局库 ===');
    
    const testLibrary: Omit<GlobalLibrary, 'addedAt'> = {
      name: '@aily-project/lib-test',
      version: '1.0.0',
      nickname: '测试库',
      description: '这是一个用于测试的库'
    };

    try {
      this.globalLibraryService.addGlobalLibrary(testLibrary);
      console.log('✅ 添加全局库成功');
      
      // 验证是否添加成功
      const isGlobal = this.globalLibraryService.isGlobalLibrary(testLibrary.name);
      console.log(`✅ 验证库是否为全局库: ${isGlobal}`);
      
      const globalLib = this.globalLibraryService.getGlobalLibrary(testLibrary.name);
      console.log('✅ 获取全局库信息:', globalLib);
      
    } catch (error) {
      console.error('❌ 添加全局库失败:', error);
    }
  }

  /**
   * 测试获取全局库列表
   */
  testGetGlobalLibraries(): void {
    console.log('=== 测试获取全局库列表 ===');
    
    try {
      const libraries = this.globalLibraryService.getGlobalLibraries();
      console.log(`✅ 获取到 ${libraries.length} 个全局库:`);
      libraries.forEach((lib, index) => {
        console.log(`  ${index + 1}. ${lib.nickname} (${lib.name}@${lib.version})`);
      });
    } catch (error) {
      console.error('❌ 获取全局库列表失败:', error);
    }
  }

  /**
   * 测试移除全局库
   */
  testRemoveGlobalLibrary(): void {
    console.log('=== 测试移除全局库 ===');
    
    const testLibraryName = '@aily-project/lib-test';
    
    try {
      // 先检查库是否存在
      const existsBefore = this.globalLibraryService.isGlobalLibrary(testLibraryName);
      console.log(`移除前库是否存在: ${existsBefore}`);
      
      if (existsBefore) {
        this.globalLibraryService.removeGlobalLibrary(testLibraryName);
        console.log('✅ 移除全局库成功');
        
        // 验证是否移除成功
        const existsAfter = this.globalLibraryService.isGlobalLibrary(testLibraryName);
        console.log(`✅ 验证移除结果: ${!existsAfter ? '成功' : '失败'}`);
      } else {
        console.log('⚠️ 库不存在，无需移除');
      }
      
    } catch (error) {
      console.error('❌ 移除全局库失败:', error);
    }
  }

  /**
   * 测试导出和导入配置
   */
  testExportImportConfig(): void {
    console.log('=== 测试导出和导入配置 ===');
    
    try {
      // 先添加一些测试数据
      const testLibraries: Omit<GlobalLibrary, 'addedAt'>[] = [
        {
          name: '@aily-project/lib-sensor',
          version: '2.1.0',
          nickname: '传感器库',
          description: '各种传感器的驱动库'
        },
        {
          name: '@aily-project/lib-display',
          version: '1.5.0',
          nickname: '显示库',
          description: '显示屏驱动库'
        }
      ];

      testLibraries.forEach(lib => {
        this.globalLibraryService.addGlobalLibrary(lib);
      });

      // 导出配置
      const exportedConfig = this.globalLibraryService.exportConfig();
      console.log('✅ 导出配置成功:', exportedConfig);

      // 清空配置
      this.globalLibraryService.clearGlobalLibraries();
      console.log('✅ 清空配置成功');

      // 验证清空结果
      const emptyLibraries = this.globalLibraryService.getGlobalLibraries();
      console.log(`清空后库数量: ${emptyLibraries.length}`);

      // 导入配置
      this.globalLibraryService.importConfig(exportedConfig);
      console.log('✅ 导入配置成功');

      // 验证导入结果
      const importedLibraries = this.globalLibraryService.getGlobalLibraries();
      console.log(`导入后库数量: ${importedLibraries.length}`);
      
    } catch (error) {
      console.error('❌ 导出导入配置失败:', error);
    }
  }

  /**
   * 测试配置文件路径
   */
  testConfigFilePath(): void {
    console.log('=== 测试配置文件路径 ===');
    
    try {
      const configPath = this.globalLibraryService.getConfigFilePath();
      console.log('✅ 配置文件路径:', configPath);
      
      // 检查配置文件是否存在
      const exists = window['path']?.isExists(configPath);
      console.log(`配置文件是否存在: ${exists}`);
      
    } catch (error) {
      console.error('❌ 获取配置文件路径失败:', error);
    }
  }

  /**
   * 运行所有测试
   */
  runAllTests(): void {
    console.log('🚀 开始运行全局库功能测试...\n');
    
    this.testConfigFilePath();
    console.log('');
    
    this.testAddGlobalLibrary();
    console.log('');
    
    this.testGetGlobalLibraries();
    console.log('');
    
    this.testExportImportConfig();
    console.log('');
    
    this.testRemoveGlobalLibrary();
    console.log('');
    
    console.log('✅ 所有测试完成！');
  }
}

/**
 * 在浏览器控制台中运行测试的辅助函数
 */
export function runGlobalLibraryTests() {
  // 这个函数可以在浏览器控制台中调用来测试功能
  console.log('请在 Angular 应用中注入 GlobalLibraryService 后调用测试');
}
