# 端到端测试（E2E）

使用 [Playwright](https://playwright.dev/) 的 `_electron` API 对 aily-blockly 桌面应用做端到端测试。
测试直接启动 `electron/main.js` 主进程，针对 **生产构建产物** 运行。

## 工作原理

1. `global-setup`（[global-setup.ts](global-setup.ts)）先执行 `ng build --base-href ./`，
   再把构建产物 `dist/aily-blockly/browser` 暂存为项目根目录下的 `renderer/`。
   这正是 `electron-builder` 打包时的映射关系（`browser` → `renderer`）。
2. 启动夹具（[fixtures/electron-app.ts](fixtures/electron-app.ts)）用 `_electron.launch`
   以项目根为 `cwd`、`args: ['.']` 启动 Electron。主进程走「非 `--serve`」分支，
   通过 `loadFile('renderer/index.html')` 加载生产渲染层 —— 无需完整 `electron-builder` 打包。
3. 每个测试使用独立的临时 `--user-data-dir`，与真实用户数据完全隔离。

应用采用 hash 路由（`withHashLocation()`），测试用 `navigate(win, '/路由')` 切换页面。

## 运行

```powershell
# 完整跑（每次重新构建渲染层，最接近真实）
npm run test:e2e

# 快速迭代（复用已暂存的 renderer/，跳过重新构建）
npm run test:e2e:fast

# 注意：fast 模式会复用现有 renderer/，改过前端代码后请先跑一次完整 test:e2e

# 可视化 / 调试
npm run test:e2e:ui
npm run test:e2e:headed

# 查看上次 HTML 报告
npm run test:e2e:report

# 只跑某个文件
npm run test:e2e -- smoke.spec.ts
```

## ESP32-S3 仿真与块调试闭环

Windows x64 可使用单命令执行 Blockly 编辑、真实 Arduino ESP32-S3 编译、Artifact、
项目块断点及 QEMU/GDB 命中：

```powershell
npm run test:e2e:simulator-debug
```

命令要求 `aily-builder` 和 `aily-simulator` 与本仓库相邻。准备阶段会：

1. 按 fixture `package-lock.json` 把 9 个板卡/核心包安装到
   `e2e/.artifacts/esp32s3-package-source`；
2. 构建相邻 Builder，并把 Blockly 实际使用的应用 npm prefix 切换到该源码；
3. 校验 Builder Artifact/source-map/debug-source snapshot capability；
4. 校验 patchset0012 QEMU/GDB runtime bundle 的文件与 hash。

已完成准备时可快速重跑：

```powershell
npm run test:e2e:simulator-debug -- --skip-prepare
```

完整用例会验证 iframe 调试面板折叠/展开、项目块断点应用、调用栈 blockId 与
GDB frame/stackTop 的一致性，并从真实 GDB 验证局部变量/watch、寄存器分页、Artifact
内存区域读取、Arduino `String` 复合局部变量两级递归展开、临时函数断点新增/删除、
watch 删除/重建、step-over 到下一 Blockly 块、step-into 进入 Arduino SDK/FreeRTOS
函数及切换回 `loop` 栈帧。用例还会终止当前 Electron 隔离会话所属的 QEMU，验证
iframe 显示 crashed、recover 创建新 PID、GDB 重连不会自动恢复配置，以及块断点与
作用域 watch 的两阶段显式恢复。

同一用例使用真实双端器件接线，而不是单引脚逻辑替身：

```text
GPIO3 ── 220Ω Resistor ── LED(A→C) ── GND
GPIO4(INPUT_PULLUP) ── Button(NO) ── GND
```

它会检查 iframe 中 Aily 自有 `aily.appearance.resistor@1.0.0` 外观、LED
`off → on → off` 闪烁、按下后持续点亮及松开后恢复闪烁。Button 没有隐藏上拉电阻；
松开时由 QEMU IOMUX 根据固件的 `INPUT_PULLUP` 解析电平。若改用外接上拉/下拉，
电阻必须作为连接图中的独立双端组件出现。

用例还会读取真实 GDB hardware thread/core 列表，并在存在多个线程时切换到另一线程
再切回原 stopped 线程，验证每线程调用栈和 Blockly 源码定位不会串线。线程名只接受
GDB 明确返回的值；缺失时报告 `GDB thread N`，不能把顶层函数或线程顺序推断为
FreeRTOS task 名称。

块级控制还会验证：Blockly 用户选中的目标不会被 GDB 当前执行块覆盖；“运行到选中块”
使用的临时断点完成后被清理且不污染持久配置；“下一 Blockly 块”会跳过嵌套值块，
停在下一条语句块。iframe 只发送空操作，目标 blockId 与 source-map revision 由本地
Blockly adapter 读取并交给 Gateway。

Builder 会把本次实际编译输入复制为 hash 绑定的 `debug-source` Artifact。完整源码只在
Electron 主进程校验后交给受信任的 Blockly renderer；云端 iframe 只接收当前选中栈帧
附近最多 21 行的只读上下文。E2E 会同时验证当前行与 blockId 联动，以及进入 Arduino
SDK/FreeRTOS 外部源码时只显示相对文件和行号、不转发源码正文。
可独立复核生成的结构化报告：

```powershell
npm run validate:e2e:simulator-debug
```

从当前 Simulator 源码重新打包使用 `--refresh-runtime`；没有补丁 QEMU 构建和现成
runtime bundle 时，安装 Docker 后使用 `--build-patched-qemu`。脚本不会回退到不含
Aily Engine Bridge 的官方 QEMU。

结构化结果保存在：

```text
e2e/.artifacts/simulator-debug-preparation.json
e2e/.artifacts/simulator-debug-report.json
```

专用 CI 定义在 `.github/workflows/simulator-debug-e2e.yml`，会缓存 Linux
交叉编译的 Windows 补丁 QEMU，并在 hosted Windows 上执行同一桌面用例。

## 测试套件

| 文件 | 覆盖 | 默认是否运行 |
|------|------|------|
| [tests/smoke.spec.ts](tests/smoke.spec.ts) | 启动、主窗口、标题、版本、无崩溃 | ✅ |
| [tests/guide.spec.ts](tests/guide.spec.ts) | 指南主页与入口菜单 | ✅ |
| [tests/project-new.spec.ts](tests/project-new.spec.ts) | 新建项目向导渲染（含已装开发板时的选择） | ✅ |
| [tests/tools.spec.ts](tests/tools.spec.ts) | 串口监视器 / 终端面板（无需真实设备） | ✅ |
| [tests/aily-chat.spec.ts](tests/aily-chat.spec.ts) | AI 聊天工具离线 UI | ✅ |
| [tests/blockly-editor.spec.ts](tests/blockly-editor.spec.ts) | 打开项目、Blockly 工作区/工具箱 | ⏭️ 需环境变量 |
| [tests/compile.spec.ts](tests/compile.spec.ts) | 点击编译并等待结果 | ⏭️ 需环境变量 |
| [tests/full-flow.spec.ts](tests/full-flow.spec.ts) | 单开发板 / 全开发板：选择开发板 → 新建项目 → 编译 | ⏭️ 需环境变量 |

## 环境受限的用例（默认自动跳过）

Blockly 编辑器与编译需要真实项目和工具链，默认跳过。具备条件时按需开启：

```powershell
# Blockly 编辑器：指定一个含 project.abi 的项目目录
$env:AILY_E2E_PROJECT = 'D:\path\to\blockly-project'
npm run test:e2e -- blockly-editor.spec.ts

# 编译：还需已安装编译器/SDK（AILY_COMPILERS_PATH 等）并显式开启
$env:AILY_E2E_PROJECT = 'D:\path\to\blockly-project'
$env:AILY_E2E_COMPILE = '1'
npm run test:e2e -- compile.spec.ts

# 全流程：会先清空 %LOCALAPPDATA%\aily-project，再安装开发板包、使用默认项目名创建真实项目并调用真实编译工具链
$env:AILY_E2E_FULLFLOW = '1'
$env:AILY_E2E_BOARD_KEYWORD = 'uno r4' # 可选，默认 uno r4
# 指定多个开发板时用逗号分隔；设置后优先于 AILY_E2E_BOARD_KEYWORD
$env:AILY_E2E_BOARD_KEYWORDS = 'uno r4,esp32'
# 可选：新电脑首次下载依赖较慢时可调大，单位毫秒
$env:AILY_E2E_SINGLE_BOARD_TIMEOUT_MS = '2700000' # 默认 45 分钟
$env:AILY_E2E_INSTALL_TIMEOUT_MS = '1800000'      # 默认 30 分钟
$env:AILY_E2E_COMPILE_TIMEOUT_MS = '600000'       # 默认 10 分钟
npm run test:e2e:fast -- full-flow.spec.ts

# 全开发板全流程：会先清空 %LOCALAPPDATA%\aily-project，再逐个验证所有可创建开发板
$env:AILY_E2E_ALL_BOARDS = '1'
npm run test:e2e:fast -- full-flow.spec.ts
```

macOS / Linux 下使用 `VAR=value` 前缀或 `export`：

```bash
AILY_E2E_FULLFLOW=1 AILY_E2E_BOARD_KEYWORD='uno r4' npm run test:e2e:fast -- full-flow.spec.ts
AILY_E2E_FULLFLOW=1 AILY_E2E_BOARD_KEYWORDS='uno r4,esp32' npm run test:e2e:fast -- full-flow.spec.ts
AILY_E2E_ALL_BOARDS=1 npm run test:e2e:fast -- full-flow.spec.ts
```

> 说明：当前未覆盖「上传(upload)」流程，因为它需要连接真实外设，不便在 CI/本地稳定运行。

> 全流程用例启动前会清空并重建应用数据目录（Windows 默认 `C:\Users\<user>\AppData\Local\aily-project`，macOS 默认 `~/Library/aily-project`），因此会删除已安装的开发板包、编译器与 SDK 缓存；每次创建并编译开发板前还会清理 `aily-builder` 的 `project` 与 `cache` 目录，避免不同架构开发板复用错误的预编译对象。随后使用页面生成的默认项目名，并在默认目录 `~/Documents/aily-project/<name>` 创建项目，测试结束后清理该项目目录。全开发板用例耗时很长，每个开发板会使用独立 Electron 实例隔离运行；单个开发板失败后会继续验证后续开发板，并在最后汇总失败清单。

## 备注

- 测试串行执行（`workers: 1`），避免多个 Electron 实例相互干扰。
- 选择器优先使用组件标签（如 `app-header`、`app-serial-monitor`）与稳定 CSS 类；
  应用目前几乎没有 `data-testid`，后续可逐步补充以提升稳定性。
- `renderer/`、`test-results/`、`playwright-report/` 已加入 `.gitignore`。
