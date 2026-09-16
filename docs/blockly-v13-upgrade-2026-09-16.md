# Blockly 13.3.0 升级与验收

日期：2026-09-16。基线：宿主 `265c3a774`，旧核心 `893da3608`。

## 版本与交付方式

原 `aily-project-blockly@1.0.2` 基于上游 11.2.2，不是 Blockly 1.x。
本次升级到官方最新稳定版 13.3.0（上游 `bf35c82fce034a7728d07c7827a513b2a3073a1b`），
保留 Aily fork；不直接替换为丢失定制行为的官方 npm 包。

核心源码现在位于 `aily-npm-blockly/packages/blockly/core`。核心本地升级提交
`fbee0c44d` 保留旧 Aily 分支为祖先；`AILY_FORK.md` 记录全部旧补丁的责任映射。

宿主使用 `vendor/aily-project-blockly-13.3.0.tgz`，package-lock 记录完整性哈希。
三个官方插件同步到 13.3.0，并强制 field-colour/grid-dropdown 使用 13.3.0。
`npm ls --all` 确认所有插件共享同一核心，无 11/12/13 多副本混用。未向 npm 发布。

Node.js 最低 22；本次构建 Node 24.16.0，宿主内置 Node 22.21.0。

## 新能力及边界

- 13.2 改善插入标记、连接数据库更新、变量名比较和积木坐标计算，并修复相关内存泄漏。
  [官方 13.2 发布说明](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.2.0)。
- 13.3 增加可选工具箱／flyout 跳转、工作区滚动快捷键，开放更多拖拽策略扩展接口，
  修复撤销栈被渲染影响、拖拽误连接／删除等问题；workspace-search 插件增加读屏支持。
  [官方 13.3 发布说明](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.3.0)。
- v12/v13 的焦点、可访问性、变量及 CSS/API 变更需要宿主适配，不能仅修改版本号。
  [v12](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v12.0.0)、
  [v13](https://github.com/RaspberryPiFoundation/blockly/releases/tag/blockly-v13.0.0)。
- 这些上游能力不代表 Aily 已打开所有可选快捷键／安装 workspace-search 插件。
  本次目标是保留既有交互，不额外改变用户快捷键。
- 13.3 没有工作区“只创建可见积木 SVG”的虚拟化开关。批量渲染、headless 生成与
  SVG 工作区虚拟化不是同一能力；现有 Minimap 仍会建立 XML 镜像，不能承诺数万积木无卡顿。

## 兼容实现

1. 保留块／工作区注释的未失焦文本保存、初始文本、pinned、零坐标、尺寸调整位置及固定气泡布局。
2. 为独立发布的旧积木库提供 v11 variable workspace API、getVars、setEnabled 兼容层；不改变变量 ID。
3. 适配 v13 FocusManager/IDraggable：多选整组焦点、拖动 disposition、粘贴后的异步焦点恢复、清理监听器。
4. 相邻块避让改为按工作区控制，避免项目库 runtime 重建后恢复原型导致布局跳动。
5. 迁移 Toolbox/field CSS 名称；维持隐藏原生工具箱、显示 Aily 外部分类面板的原布局。
6. 修复音符字段构造验证顺序，以及角度、滑杆、音符编辑器重复获取临时焦点的问题。
7. 保留现有 Arduino 长链迭代生成、大资源引用扫描、分页／项目 runtime 隔离逻辑。
8. 真实大项目截图暴露旧通知进度动画会显示负数：同一帧内长任务使 rAF 时间戳早于动画启动时间，
   原缓动比例未限制下界。现限制比例和显示值，并覆盖早到帧、倒退／中断及非法起止值；不改下载数据或动画样式。

## 已执行验证

| 层级 | 结果 |
| --- | --- |
| 升级前宿主基线 | 381/381 单测通过 |
| 升级后核心含历史和新增注释契约 | 4035 通过；5 项上游测试 pending，未将其算作通过 |
| 升级后宿主 ChromeHeadless | 394/394 通过，含 6000 连续语句链生成、12000 层资源扫描及通知进度边界／真模板多帧 |
| Electron 主进程 Node tests | 91/91 通过；使用原 checkout 随附的离线 Coder 资源包补齐测试环境 |
| Arduino / MicroPython / Python 旧新核心对照 | 固定嵌套、注释、禁用、值块、语句尾链的生成片段和 JSON 往返一致 |
| 17 类定制字段 | 实际渲染、值序列化／还原、编辑器打开／关闭通过 |
| Electron Blockly 交互 | JSON/XML 代码一致、撤销重做、未失焦注释、多选真键鼠拖动／复制／粘贴／删除通过 |
| 项目运行时 | 两项目切换隔离、未使用库移除后原地重建且保留 DOM／代码／位置、iframe 焦点边界通过 |
| 干净安装 | 临时空目录 npm ci --ignore-scripts 通过，未使用 legacy-peer-deps |
| TypeScript | tsc --noEmit 通过 |
| 架构审计 | 基线与升级版输出完全相同，仍有 6 项既有测试文件 import 违规；无新增差异 |
| 桌面常规回归 | 57 项通过；另行运行的大项目、真实编译及小地图结果见下文；外部条件项没有算作通过 |
| 真实编译 | ESP32-S3 项目预处理、编译、成功状态、当前 buildInfo 和日志断言通过；生成 ELF/BIN，未执行烧录 |
| 真实大项目 | 当前副本为 7765 个工作区积木；JSON 往返、数值撤销、保存、重开和代码逐字一致已重复通过，最终图像验收见下文 |

测试修正不改变产品行为：等待 Playwright 附加预热 Page；macOS 使用原生窗口关闭生命周期；通过真实关闭按钮处理登录弹窗；
库移除的临时目录移到 node_modules 外；编译等待项目依赖／预处理就绪；精确鼠标位移测试关闭网格吸附。

### 真实大项目的代码与性能边界

本轮实际磁盘项目已不同于早先 2583 块的调查快照：当前工作区为 **7765 块、320 个变量**，
生成 Arduino 代码 **181380 字符**。只操作排除原实例锁的临时副本，原项目不写入。
另起独立旧版 Electron，复用原 `ng serve` 的旧版基线，运行相同项目副本。
两版生成代码 SHA-256 均为：

```text
54f21dbea3d1dd2b87c913e78cb9fb7c47f3e4f1c665c26ecdaf0509be38232d
```

新版两轮功能复测的整套加载／重载／撤销／保存／重开耗时分别约 **82.2 / 81.5 秒**，
其中首次加载约 **17.5 / 18.2 秒**，一次同步代码生成约 **202 / 205 ms**。
保存调用墙钟约 15.9–16.8 秒包含前序渲染任务等待；诊断日志中保存处理函数从进入到代码发布约 0.5 秒。
这些是本机单次流程记录，后台还可能有工具链初始化，**不是性能基准或“无卡顿”承诺**。
旧版对照是开发构建，新版是生产构建，也不能以此作严格速度比值。

初期测试直接重载整个 SVG 工作区，未采用正式宿主已有的事件批处理事务，出现过 180 秒超时。
大项目回归现按正式页加载器的事件批处理和文本宽度缓存方式执行，数字编辑／撤销仍启用事件。
两轮功能复测末尾的 CDP 截图另出现 30 秒超时；没有把这两次测试总结果记为通过。
最终使用 Electron 原生 compositor 窗口截图，仍保留并人工核对真实画面；不能用关闭录制解释全部性能开销。

最终桌面专项 **5/5 通过**（同一轮 2.8 分钟）：大项目、JSON/XML／注释／撤销、17 类字段、小地图同步与点击平移、多选键鼠操作。
最终大项目核心流程 85.9 秒，首次加载 19.2 秒、代码生成 219 ms；保存并重开后代码哈希仍完全一致。
原生窗口截图 3024×1768 已人工检查，积木、分类栏及通知显示正常；通知显示 4%，未再出现原截图的 -442%。
初次加载通知观察器记录 1 次合法采样；这不是连续帧性能测试。早到／中间／结束帧另用 ChromeHeadless 真模板断言 0%／75%／100%。

按不同测试用例去重，目前 **60 项桌面 E2E 已通过**（57 项常规，另加大项目、真实编译及小地图）；
这些结果来自分批运行，不冒充一次全量全绿。5 项外部条件测试未开启，详见下一节。

本机证据保存在升级工作区的 `e2e/.artifacts/blockly-v13/`：
`large-workspace-contract.json`、`large-workspace.png`、`negative-progress-before.png`、`minimap-pan.png`、`compile-success.png`。
最终桌面专项日志为 `/tmp/aily-blockly-v13-final-acceptance.log`。

本次使用 webapp-testing 技能要求的真实 Electron 页面及交互验证；按 ui-function-repair 的实际入口／截图复核要求定位并修复通知动画越界，
不能把构建／单测通过当作 UI 或硬件验收。

## 仍需外部条件的验收

- 实机串口、烧录、BLE、不同开发板全量工具链及 Windows/Linux 发布包未完成验收；没有选择或烧录用户设备。
- 真实账号／模型调用的 AI 操作遮罩测试未开启；没有复制账号凭据到测试环境。
- 在线项目广场当前出现 `ERR_CERT_DATE_INVALID`；没有禁用 TLS 检查来伪造成功。
- 模拟器 QEMU/GDB 专项需要对应的 runtime 包；本机缺少现有测试要求的 win32-x64 包。
- 定制媒体字段的编辑器契约通过不等于所有视频／音频格式、导入导出及实机播放已穷举。
- 已通过测试的范围不能表述为“所有平台、所有账号、所有硬件、所有第三方库功能 100% 验证完成”。

## 复现

```sh
# 核心
npm ci
npm run test:aily

# 宿主：在源码 checkout 执行
npm run blockly:sync -- /absolute/path/to/aily-npm-blockly
npm run test:unit:ci
node --test electron/*.test.js electron/tests/*.test.js
node scripts/verify-blockly-generator-parity.mjs /absolute/path/to/old/node_modules/blockly

AILY_E2E_PROJECT=/absolute/path/to/installed-fixture \
AILY_E2E_PROJECT_SECOND=/absolute/path/to/second-fixture \
AILY_E2E_LARGE_PROJECT=/absolute/path/to/real-large-project \
npm run test:e2e

# 仅复制工具链白名单，所有测试均使用独立临时 appdata
AILY_E2E_PROJECT=/absolute/path/to/installed-fixture \
AILY_E2E_TOOLCHAIN_SEED=/absolute/path/to/toolchain-appdata \
AILY_E2E_COMPILE=1 npm run test:e2e -- compile.spec.ts
```

旧新核心对照脚本是 headless 合同验证，不是三种语言所有第三方库的穷举测试。
基线版本由参数指定；不要在基线 checkout 已升级后仍把它当作旧核心。

## 回退

源码历史保留升级前提交。回退时应将核心 tarball、宿主兼容层、官方插件和 lockfile 作为一个单元处理，
先保留当前未提交内容，再用新的回退提交或独立工作区恢复基线；不要只单独降级 blockly，
也不要对现有开发目录执行 hard reset。本次不会重启或关闭既有开发实例。
