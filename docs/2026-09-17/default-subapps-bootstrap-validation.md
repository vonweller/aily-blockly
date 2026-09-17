# 默认子应用后台安装与串口提示精简验证

日期：2026-09-17。

## 需求及入口

用户截图要求移除串口调试器顶部正常状态的“日志持久记录中”，并在首次启动时后台下载安装 Aily Chat、串口调试器。本次不改变日志持久化能力。

- 宿主入口：`MainWindowComponent.ngOnInit()` 在 renderer-ready 通知后以 `void this.ensureDefaultSubapps()` 发起后台工作，不等待下载安装才显示主界面。
- 安装链：`bootstrapDefaultSubapps` → `SubappManagerService.install(catalogId)` → 已有 Electron 子应用安装 IPC / 版本存储。
- 串口完整及紧凑入口：`packages/serial-debugger/ui/src/app/app.html` 与 `compact-surface.component.html`；以当前正式 Angular 构建产物接入真实 `startSerialDebuggerServer` 验证。

## 行为

- 初始化策略来自 `subapp-index.json[目录ID].app`，没有硬编码默认安装名单。`autoInstall`、`defaultToolbar` 均为可选布尔值，缺省 `false`，类型错误由目录校验器拒绝。
- 源码声明为 `package.json#ailySubapp.app`。Aily Chat 设置 `autoInstall: true, defaultToolbar: true`，串口设置 `autoInstall: true, defaultToolbar: false`。两边生成器均保留完整 app 扩展字段，已生成对应 `dist/subapp-index.json` 并由宿主解析器复核。
- 启动在后台等待已存在的目录刷新请求，避免重复请求与缓存缺项；网络失败继续使用可用缓存。
- 顺序执行配置中的安装，单个失败继续处理其余条目。只对已安装且可运行的应用记录成功；已安装正式/开发版本直接复用，禁用、卸载中、`only` 不匹配的应用跳过。
- 安装和置顶分别保存为 `subappInitialization[目录ID].autoInstall/defaultToolbar` 的时间戳；用户后续卸载或取消置顶不被自动恢复。兼容旧 Chat/串口标记，仅用于迁移完成状态，不作为执行名单。
- 工具栏已满时保留置顶待处理状态，安装仍记录成功；下次启动不会重复下载。默认置顶本身不会触发下载安装。
- 正常日志记录标记在两个串口视图都不显示，异常警告仍显示。日志、搜索、导出及 Runtime 未修改。
- 详细字段和使用示例见 `/Users/downey/Projects/ZCK/aily-subapp/docs/subapp-initialization-policy.md`。

## 验证

- 配置化宿主 Angular 目标测试（Node 22.21.1 / ChromeHeadless 152）：26/26 通过，覆盖任意目录配置、缺省/false、旧标记兼容、独立安装/置顶、用户卸载/取消置顶、目录刷新复用、离线缓存、产品范围、别名和工具栏容量。
- Electron 安装/版本管理测试：23/23 通过，含配置从目录校验、真实临时包解压安装到 Runtime config 的投影测试；验证 Chat 无隐式置顶且 `false` 生效。
- Chat 目录生成器测试：2/2 通过，验证 true/false 与未来 app 扩展字段保留。
- 本轮配置化相关测试合计 51 项通过。
- 宿主 `tsc -p tsconfig.app.json --noEmit` 通过。
- `guard-aily-chat-mainline.js` 通过，唯一 Chat UI 入口仍为 React 子应用。
- 串口 `node scripts/build-ui.mjs` 生产构建通过；紧凑 SCSS 4.92 kB 超过现有 4 kB 警告阈值，未达到构建错误阈值。
- 串口现有 Angular UI 测试 13/13 通过。测试环境既有 bootstrap 尝试连接 localhost:3000，产生两组 ECONNREFUSED 控制台输出，测试仍全部通过；实际浏览器页面没有这些错误。
- 浏览器运行生产 UI，使用独立临时日志目录；真实 Runtime 回读 `journalEnabled: true`，无串口设备连接或发送。完整/紧凑页面均无正常日志记录提示，更多设置开关、波特率选择 115200 → 9600、紧凑串口刷新操作通过。两个页面浏览器 error/warn 列表均为空。
- 截图均为 1280×720：
  - [完整界面](/Users/downey/.codex/visualizations/2026/09/17/01a0ae4d-e134-7241-97fc-0440ffe762c3/serial-full.png)
  - [紧凑界面](/Users/downey/.codex/visualizations/2026/09/17/01a0ae4d-e134-7241-97fc-0440ffe762c3/serial-compact.png)
- 两个仓库 `git diff --check` 通过。

## 现有问题及验证范围

架构检查因未修改文件中的 6 项现有违规返回失败：`extension-ui-boundary.spec.ts` 中 2 项跨域深导入及 1 项 UI 导入；`blockly-performance.spec.ts` 中 3 项深导入。本次未修改这些文件或重写基线。

首次安装验证覆盖编排、缓存、失败恢复及 Electron 临时包安装测试，未使用全新 Electron 用户目录执行远端完整下载安装。本轮未发布远端 subapp-index.json；运行中的 Electron 主进程也未重启加载新的解析逻辑。浏览器视觉验证为正式子应用 Runtime 的独立入口，不等同于宿主 Electron 内嵌窗口验收；未发布 npm 包或替换用户安装目录中的版本。
