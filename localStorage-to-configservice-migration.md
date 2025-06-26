# localStorage 到 ConfigService 迁移总结

## 概述
将项目中所有使用 `localStorage` 的代码迁移到使用 `ConfigService.data` 进行数据读写。

## 修改的文件

### 1. config.service.ts
**修改内容：**
- 扩展了 `AppConfig` 接口，添加了以下新字段：
  - `quickSendList?: Array<{ name: string, type: "signal" | "text" | "hex", data: string }>` - 串口监视器快速发送列表
  - `recentlyProjects?: Array<{ name: string, path: string }>` - 最近打开的项目列表
  - `selectedLanguage?: string` - 当前选择的语言
  - `skippedVersions?: string[]` - 跳过更新的版本列表

### 2. serial-monitor.service.ts
**修改内容：**
- 添加了 `ConfigService` 导入
- 在构造函数中注入 `ConfigService`
- 修改 `saveQuickSendList()` 方法：
  - 从 `localStorage.setItem('quickSendList', data)` 改为 `this.configService.data.quickSendList = this.quickSendList; this.configService.save()`
- 修改 `loadQuickSendList()` 方法：
  - 从 `localStorage.getItem('quickSendList')` 改为 `this.configService.data?.quickSendList`

### 3. project.service.ts
**修改内容：**
- 添加了 `ConfigService` 导入
- 在构造函数中注入 `ConfigService`
- 修改 `recentlyProjects` getter 和 setter：
  - getter: 从 `localStorage.getItem('recentlyProjects')` 改为 `this.configService.data?.recentlyProjects || []`
  - setter: 从 `localStorage.setItem('recentlyProjects', JSON.stringify(data))` 改为 `this.configService.data.recentlyProjects = data; this.configService.save()`

### 4. translation.service.ts
**修改内容：**
- 添加了 `ConfigService` 导入
- 在构造函数中注入 `ConfigService`
- 修改语言设置方法：
  - 从 `localStorage.setItem('language', lang)` 改为 `this.configService.data.selectedLanguage = lang; this.configService.save()`
- 修改 `getSelectedLanguage()` 方法：
  - 从 `localStorage.getItem('language')` 改为 `this.configService.data?.selectedLanguage`

### 5. update.service.ts
**修改内容：**
- 添加了 `ConfigService` 导入
- 在构造函数中注入 `ConfigService`
- 修改 `skipVersion()` 方法：
  - 从 `localStorage.setItem('skippedVersions', JSON.stringify(skippedVersions))` 改为 `this.configService.data.skippedVersions = skippedVersions; this.configService.save()`
- 修改 `getSkippedVersions()` 方法：
  - 从 `localStorage.getItem('skippedVersions')` 改为 `this.configService.data?.skippedVersions || []`
- 修改 `clearSkipVersions()` 方法：
  - 从 `localStorage.removeItem('skippedVersions')` 改为 `this.configService.data.skippedVersions = []; this.configService.save()`

## 优势
1. **集中管理**：所有配置数据现在通过 ConfigService 统一管理
2. **持久化**：数据通过 ConfigService.save() 方法持久化到文件系统
3. **类型安全**：通过 TypeScript 接口提供类型检查
4. **数据同步**：配置数据在主进程和渲染进程之间可以更好地同步
5. **备份和恢复**：配置文件可以更容易地进行备份和恢复

## 注意事项
- 所有服务现在都依赖于 ConfigService，需要确保 ConfigService 在这些服务之前初始化
- 原有的 localStorage 数据需要手动迁移（如果需要保留）
- 确保在 Angular 的依赖注入中正确配置 ConfigService
