# Windows 大项目加载排查与优化（2026-10-12）

在当前 Windows 主机上实际启动主软件 Electron，使用 `D:\Documents\aily-project\project_aug30a\project_aug30a` 的独立副本复现了 40 秒以上的项目打开。优化后三次完整就绪时间为 **45.940 / 33.381 / 28.084 秒**，中位数比基线减少 **31.9%**；加载期间总阻塞时间中位数减少 **63.9%**。首次打开改善较小，仍有约 4–5 秒的长任务，尚未达到此前 macOS 的约 7 秒。

## 测量条件与结果

- 基线为主软件 `bb5843d68` 的加载实现；优化后为其上的本轮源代码修改。开始时已有的 `package.json` / lockfile 版本范围修改予以保留，未更新依赖，实际运行 `aily-project-blockly@1.0.5`。
- Intel Core i7-10870H @ 2.20 GHz，Windows x64 `10.0.26200`，Electron `35.7.5` / Chromium `134.0.6998.205`。窗口就绪后采集的 GPU compositing、rasterization 均为 enabled，支持 `scheduler.yield()`。
- 项目为 7,767 块、3 个根块；保存缩放为 0.5，使用原 Aily Thrasos 渲染器、项目库、视口渲染和小地图。
- 两组均使用 D 盘项目副本、独立 Electron 用户目录、同一开发服务，每组同一 Electron 进程内打开三次。性能对照关闭 CPU profiler，期间没有并行构建或其他测试。
- `BLOCKLY_INIT_EDITOR_ONLY=1` 仅在测试窗口中替换 `installBoardDeps`，排除编辑器就绪后因空白用户目录触发的 SDK/编译器下载对后续轮次的干扰；库注册、项目装载、模型、渲染、生成器初始化仍走真实主软件流程。该设置不修改正式软件行为，因此数据代表编辑器打开链路，不代表首次安装开发板工具链的总耗时。

| 指标 | 基线 | 优化后 | 减少 |
| --- | ---: | ---: | ---: |
| 完整就绪中位数 | 49.035 s | 33.381 s | 31.9% |
| 首轮完整就绪 | 49.035 s | 45.940 s | 6.3% |
| 各轮最长主线程任务，中位数 | 4.855 s | 4.456 s | 8.2% |
| 加载期间总阻塞时间，中位数 | 29.111 s | 10.504 s | 63.9% |

| 轮次 | 基线就绪 | 优化后就绪 | 基线最长任务 | 优化后最长任务 | 基线总阻塞 | 优化后总阻塞 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 首轮 | 49.035 s | 45.940 s | 4.855 s | 4.700 s | 29.111 s | 15.227 s |
| 重开 1 | 34.552 s | 33.381 s | 4.649 s | 4.456 s | 17.978 s | 10.504 s |
| 重开 2 | 53.228 s | 28.084 s | 6.911 s | 4.331 s | 34.429 s | 7.895 s |

完整就绪从打开项目路由开始，到生成器运行时 ready 后再等两帧；包含库加载、模型构建、校验和显示。总阻塞时间为 Long Tasks API 各任务超过 50 ms 的部分之和。`result.json` 中旧同步 `workspaces.load` 的计时只覆盖空工作区/变量初始化，不能代表分片加载的总耗时。

三次样本存在明显波动，不宜把中位数降幅当成每次打开的保证，也不能仅凭跨主机数据把与 macOS 的差距全部归因于操作系统。首轮是本次 Electron 进程的首次项目打开，未清理 OS 文件缓存。

## 定位与修改

探索性 CPU profile 中，工具箱 `indexBlocks` 累计包含约 7.42 秒，声明完整性检查 `intact` 自身约 6.82 秒，原生祖先渲染排队 `Xc` 自身约 3.72 秒；`initSvg` 累计包含约 7.76 秒。另有文字宽度预热约 2.09 秒、连接排序约 1.65 秒。这些是带 profiler 的一次采样，包含耗时相互重叠，不能相加或直接替代无 profiler 的性能对照。

1. **合并库加载期间的工具箱刷新。** 库仍按顺序注册，最终统一更新工具箱和搜索索引，避免每增加一个库就重建全部索引。批次绑定工作区，支持嵌套、失败释放和工作区替换。
2. **按同步加载片段校验完整声明。** 每个片段开始和结束检查完整声明状态，逐次读取仍检查当前类型，避免每次恢复一个字段都重复扫描所有已使用类型。片段内原生回调造成的声明变化必须在让出线程前被拒绝；边界不跨越异步等待。
3. **合并新块的祖先渲染排队。** 仅在一个同步片段内，对仍使用原生 `queueRender` 的新块先标记自身，结束时补齐根块及其已有祖先。完成或异常都恢复实例方法，保留库自定义实现及回调主动安装的方法，不修改全局原型。完整模型、原生连接和字段语义保留。
4. **按实际耗时调整片段大小。** 原固定 32 块在较慢主机上容易超过预算，现按片段耗时向约 16 ms 调整，范围 1–32 块；单个复杂块仍可能超过软预算。
5. **减少分片之间的定时等待开销。** 支持时使用 `scheduler.yield()`，否则使用 `setTimeout(0)`。每约 50 ms 至少回到普通定时器队列一次，让取消和库定时回调有机会执行；没有持续依赖高优先级 continuation。

最终统一文字测量、原生布局及后续校验等工作仍是优化空间。此次未改变底层连接数据库的排序语义，也未通过丢弃屏外模型来缩短时间。

## 验证

- **71 项相关 ChromeHeadless 测试通过**，覆盖项目打开、工具箱批次、祖先几何更新和异常恢复、声明变更拒绝、原生字段顺序/恢复、取消与调度公平性。修正了原生字段测试中缺少既有加载准备方法的旧 mock；未用修改运行时行为来绕过旧 mock。
- 最终 Angular 开发服务编译成功，真实 Electron 使用该编译结果。`git diff --check` 通过。
- 无 profiler 的三轮对照均保持 7,767 块、3 个根块，生成代码相同，SHA-256 为 `b79d447455b914e5e158a0f05126ed330f3ef2752e06d9b4329af3eeeeb35a21`。
- 独立功能验收两轮通过：部分模型创建时实际导航取消后重开；未挂载/已挂载阶段注入拖动和 Delete，均被拦截且根块未变；真实工具箱搜索找到数学数值块；深层数值字段通过实际输入框从 0 改为 1，撤销、重做、保存及重开恢复正确，修改后的代码一致。
- 五组滚动位置及 0.5 / 1 / 1.5 倍缩放下，可见块遗漏为 0，已挂载块 SVG 坐标偏差为 0，完整模型数量不变。逐帧检查首次显示的保存缩放/滚动位置；检查了首屏及深层编辑截图。
- 功能验收每轮就绪后继续观察 2 秒，均无超过 50 ms 的剩余长任务。功能验收耗时 39.395 / 32.799 秒，不混入上表性能对照。
- 所有验收均操作独立副本，原项目 `project.abi` SHA-256 前后为 `f6ea78b37bb076568e2fd340ebc4eb1c2d041c1ab9012249a79b1ab4cb0a9ab7`，页面错误列表为空。

验证范围是 Windows Electron 开发运行链，未生成新的安装包，也未验证硬件编译/烧录。独立测试用户目录缺少 builder/linter/connector 的启动提示，不作为编辑器加载失败或硬件验收证据。

## 证据与复现

本机证据目录：`e2e/.artifacts/blockly-windows-loading-2026-10-12/`（git 忽略）：

- `baseline-unprofiled/result.json`：同配置基线三轮。
- `verified-performance/result.json`：最终三轮性能结果。
- `comparison.json`：逐轮数据和中位数计算。
- `verified-interactions/result.json`、`loaded-*.png`、`deep-field-edit.png`：最终功能断言及截图。
- `baseline/load.cpuprofile`：探索性采样，使用 C 盘临时副本且未屏蔽 SDK 下载；该组耗时不参与正式对照。

最终日志为 `e2e/.artifacts/windows-{unit-verified,verified-performance,verified-interactions}.log`。探索目录 `batched` 曾因开发服务的中间编译错误页失败，`optimized-unprofiled` 是更早的调度实现，均不作为最终验收结果。

仓库根目录启动独立开发服务：

```powershell
node scripts/run-angular.cjs serve --host 127.0.0.1 --port 4211
```

另一个 PowerShell 运行性能测试（输出标签使用新名字）：

```powershell
$env:AILY_E2E_DEV_URL = 'http://127.0.0.1:4211'
$env:AILY_E2E_PROJECT = 'D:\Documents\aily-project\project_aug30a\project_aug30a'
$env:BLOCKLY_INIT_OUTPUT = 'e2e/.artifacts/blockly-windows-loading-2026-10-12'
$env:BLOCKLY_INIT_PROJECT_ROOT = 'D:\Downey\YYSC\aily-blockly\e2e\.artifacts'
$env:BLOCKLY_INIT_LABEL = 'recheck-performance'
$env:BLOCKLY_INIT_ROUNDS = '3'
$env:BLOCKLY_INIT_PROFILE = '0'
$env:BLOCKLY_INIT_EDITOR_ONLY = '1'
node node_modules/@playwright/test/cli.js test -c e2e/real-performance.config.ts real-initialization.spec.ts
```

使用单独输出标签，增加以下设置运行功能验收（不能将其耗时混入纯性能对照）：

```powershell
$env:BLOCKLY_INIT_LABEL = 'recheck-interactions'
$env:BLOCKLY_INIT_ROUNDS = '2'
$env:BLOCKLY_INIT_CANCEL = '1'
$env:BLOCKLY_INIT_RACE = '1'
$env:BLOCKLY_INIT_INTERACTIONS = '1'
$env:BLOCKLY_INIT_GEOMETRY = '1'
$env:BLOCKLY_INIT_VIEW = 'stable'
$env:BLOCKLY_INIT_SETTLE = '1'
node node_modules/@playwright/test/cli.js test -c e2e/real-performance.config.ts real-initialization.spec.ts
```

再次跑纯性能组前，清除这些功能验收环境变量。项目副本由测试创建并清理；原项目不写入。
