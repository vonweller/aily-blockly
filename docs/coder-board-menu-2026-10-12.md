# Coder 主板扩展菜单与源码同步

基线：`downeyin-subapp-aily`，修复前先拉取至 `4fdf3e938`。核对日期：2026-10-12。

## 原因与修复

Coder 的独立工程上下文只加载 `board.json`，未加载主板包根目录的 `menu.json` 和翻译；因此同一主板在 Blockly 可见的额外配置在 Coder 中缺失。上下文克隆还可能继承前一个工程的菜单缓存。现在每个 Coder 工程独立加载、保存并向活动窗口投影菜单；依赖安装完成后重新同步，切换工程和主板缺失时不会继续显示旧菜单。

打开 Coder 菜单本身不写默认值或修改引脚，默认首项仍按 SDK 规则显示。菜单配置保存后，Coder 先同步持久源码，再通过自己的预处理执行器更新编译环境。原来的 `preprocess-trigger` 只存在 Blockly 监听器，不能用于 Coder。自定义分区仍打开分区管理器，SoftDevice 仍沿用显式选项的烧录动作。

## 所有已确认会改变生成源码的菜单

| 菜单 | Blockly 行为 | Coder 源码同步 |
| --- | --- | --- |
| ESP32 `CDCOnBoot` | 开启后增加 USB CDC 串口选项；关闭时把 `Serial0` 字段还原为主板声明的 CDC 串口值，通常是 `Serial`。其他仍有效的字段值保持不变。 | 关闭 CDC 时把项目源码里的同名串口引用还原，如 `Serial0.begin(...)` → `Serial.begin(...)`；使用主板 `cdcSerialPort` 的实际值。开启 CDC 保持仍有效的引用，与 Blockly 一致。 |
| STM32 `pnum` | 根据 SDK variant 更新数字、模拟、PWM、舵机、中断引脚选项，重新加载后失效选项回退到相应列表首项；有效选项不变。 | 更新失效的主板引脚标识符；`pinMode`、`digitalRead`、`digitalWrite`、`analogRead`、`analogWrite`、`digitalPinToInterrupt` 的直接引脚参数按对应类别回退。一般数值常量不全局替换。 |

源码扫描覆盖普通 Coder 的 `sketch/` 和工程声明的 `sourceRoots`，以及原生 Arduino 工程根目录的 `.ino`、C/C++ 源文件与头文件。排除第三方库、依赖、构建目录和符号链接。注释、字符串、原始字符串、include 路径、对象成员和命名空间成员不参与替换。遇到与待迁移主板符号同名的自定义声明/宏会报错并恢复配置；任意自定义函数中的裸数字、宏计算、复杂 C++ 符号语义不作推断。

先通过既有编辑器保存通道保存文件；写入前再次检查编辑器未保存状态和文件基线。保存失败、期间切换工程、配置失效或文件写入失败会中止或回滚本轮配置/源码。源码同步使用工程生命周期锁阻止同工程切换主板、关闭和启动编译；操作完成后执行预处理。预处理失败保留已保存的配置/源码并显示错误，不伪装为编译成功。

## 扫描到的完整菜单键清单

来源：本机已安装的 17 个主板包的 `menu.json`，共 25 个不同键；这是可复核的本地包快照，不表示线上所有历史/未来主板包的全集。具体选项仍由所安装 SDK 的 `boards.txt` 提供，宿主没有另建 Coder 专用菜单表。

以下除 `CDCOnBoot` 和 `pnum` 外，均通过 `projectConfig` 传入编译/上传工具链，不由宿主直接改写 C++ 文件。`PartitionScheme=custom` 额外打开分区管理器编辑 CSV；`PinNumbers` 会影响 SDK 对引脚编号的解释，但现有 Blockly 菜单没有源码替换钩子。

| 配置键 | 本机声明该菜单的主板 |
| --- | --- |
| `Algorithm` | `ci1302`, `ci1303`, `ci1306` |
| `CDCOnBoot` | `beginner_a1`, `esp32s3`, `esp32s3dev`, `esp_mosaico`, `linkbit`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `Clock` | `ci1302`, `ci1303`, `ci1306` |
| `DFUOnBoot` | `esp_mosaico` |
| `DebugLevel` | `esp_mosaico` |
| `EraseFlash` | `esp_mosaico` |
| `FlashMode` | `beginner_a1`, `esp32`, `esp32s3`, `esp32s3dev`, `linkbit`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `FlashSize` | `beginner_a1`, `esp32`, `esp32s3`, `esp32s3dev`, `esp_mosaico`, `linkbit`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `JTAGAdapter` | `esp_mosaico` |
| `MSCOnBoot` | `esp_mosaico` |
| `Microphone` | `ci1306` |
| `PSRAM` | `esp32`, `esp32s3`, `esp32s3dev`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `PartitionScheme` | `arduino_nano_esp32`, `beginner_a1`, `esp32`, `esp32s3`, `esp32s3dev`, `esp_mosaico`, `linkbit`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `PinNumbers` | `arduino_nano_esp32` |
| `USBMode` | `arduino_nano_esp32`, `esp32s3`, `esp32s3dev`, `esp_mosaico`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `UploadMode` | `esp32s3`, `esp32s3dev`, `esp_mosaico`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `UploadSpeed` | `beginner_a1`, `esp32`, `esp32s3`, `esp32s3dev`, `esp_mosaico`, `linkbit`, `xiao_esp32s3`, `xiao_esp32s3_sense` |
| `ZigbeeMode` | `esp_mosaico` |
| `clock` | `ai8051u_34k16`, `ai8051u_34k32`, `ai8051u_34k64` |
| `cppcore` | `ai8051u_34k16`, `ai8051u_34k32`, `ai8051u_34k64` |
| `cpu` | `arduino_nano` |
| `execution` | `ai8051u_34k16`, `ai8051u_34k32`, `ai8051u_34k64` |
| `memory` | `ai8051u_34k16`, `ai8051u_34k32`, `ai8051u_34k64` |
| `pnum` | `stm32f103c8` |
| `usb` | `stm32f103c8` |

此外宿主支持主板包以 `extra.selectAction=flash-softdevice` 声明 SoftDevice 烧录；它属于设备操作，不改源码。该动作不在这次 17 个本地菜单包中。

## 验证

- TypeScript 应用检查：`node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit`。
- `npm run test:coder-board-menu`：66/66 ChromeHeadless Angular 定向测试通过，覆盖源码词法保护、CDC/引脚迁移、多源文件、写入回滚、保存失败、并发保护、工程菜单隔离、SDK 未就绪与恢复、Header 模式分发、自定义分区、已有 Coder 多工程行为。
- 架构检查发现现有 `update-dialog.component.spec.ts` 直接导入 `ConfigService` 的基线外违规；该导入已存在于修复前提交，本轮没有修改它。
- 本轮属于源码和浏览器测试层验证；未安装发布包，未执行物理主板编译上传或 SoftDevice 烧录。

## 转换工程实测反馈与后续修复

用户反馈的实际执行路径是 `release-20260930-01/artifacts/hosts/coder/mac-arm64/aily coder.app`。核对该包的 `app.asar` 后确认，它没有上述 10 月 12 日菜单上下文修复。开发版 Blockly 原先通过 macOS 索引寻找已安装的 Coder，因此转换成功后仍打开了 9 月 30 日旧包。开发模式现在使用当前仓库的 Electron 入口，以目标产品模式启动配套窗口；发布包仍使用已安装应用。主进程变更需要重启开发宿主才生效，渲染层热更新不能替代这一步。

实测工程 `AI-VOX3yuyinkongzhiLED_314036_coder_1` 使用 `@aily-project/board-ai-vox@3.2.1`，其配置为 `PartitionScheme=custom`，但原 Blockly 工程和转换后的源码目录均没有项目分区文件。所选主板包根目录自带所需的 `partitions.csv`。转换现在把该文件放到 Coder 的 `sketch/src/partitions.csv`；预处理也对已转换但缺文件的工程提供同一补全路径。项目源码、旧项目根目录及显式配置的 CSV 优先于主板默认文件，用户已有 CSV 不被覆盖。构建哈希把待补全文件作为源输入计算，避免第一次预处理后立即变成过期构建。

同时修复主板入口重复开关的点击冒泡，以及配置预处理成功后仍显示“编译准备中”的提示状态。已为用户现有 Coder 工程补齐缺失 CSV，未改写其 `main.cpp` 或 `package.json`。原 Blockly 工程保持不变。

后续验证：

- 23 项 Node 测试通过：转换目录、分区来源优先级、依赖预处理以及开发版/发布版配套应用启动隔离。
- 67 项主板菜单定向 Angular 测试、26 项 Coder 构建信息定向测试通过；应用 TypeScript 检查通过。
- 使用该 AI-VOX 工程的隔离副本，开发版 Electron 已完成菜单显示、保存烧录速度、分区补全和完整编译，生成 `.build/main.bin`。副本移除原分区文件和构建记录后开始测试。
- 本地 Coder 应用使用 `CSC_IDENTITY_AUTO_DISCOVERY=false node scripts/build-electron.js --product coder --flavor cn --dir` 构建，路径为 `dist/aily-coder/mac-arm64/aily coder.app`。`app.asar` SHA-256：`a85fd95f35de1eb0276e73da1913b0f43088017f01f6c81b1b4e4c061fc9e66b`。
- 对该 `.app` 的 AI-VOX 用例通过（45.7 秒，完整编译 21.19 秒）：核对全部 8 个配置菜单和“切换开发板”、保存 `UploadSpeed=115200` 并重新展开核对勾选、缺失 CSV 从主板包恢复、生成 `main.bin`，构建记录成功且哈希一致。截图位于 `e2e/.artifacts/aivox-conversion/blockly-coder-conversion-c-32fc1-its-board-custom-partitions/` 的 `aivox-board-menu.png` 和 `aivox-compiled.png`。
- `e2e/tests/blockly-coder-conversion.spec.ts` 另外 3 个转换入口用例通过：直接打开生成的 `.ino`、内嵌 Code Viewer、独立 Code Viewer。覆盖取消/确认、弹窗非透明背景、原项目保留、最新代码保存、`sketch/src/main.cpp` 结构和外层依赖安装；直接打开用例额外完成 Arduino UNO 编译。Viewer 用例仅拦截最后的操作系统启动调用。

复现 AI-VOX 包验证（已有本机工具链和该用户工程时）：

```sh
AILY_CONVERSION_SEED=/Users/downey/Library/aily-project \
AILY_CONVERSION_AIVOX_PROJECT=/Users/downey/Documents/aily-code-project/AI-VOX3yuyinkongzhiLED_314036_coder_1 \
AILY_CONVERSION_CODER_EXECUTABLE='/Users/downey/Projects/OutSource/aily--blockly/dist/aily-coder/mac-arm64/aily coder.app/Contents/MacOS/aily coder' \
npx playwright test --config=e2e/coder-conversion.config.ts --grep='converted AI-VOX' --output=e2e/.artifacts/aivox-conversion
```

这是本地 macOS arm64 宿主验证，未替换用户 9 月 30 日发布包，未执行物理主板烧录。Coder 子应用使用本机已有 `0.1.15-dev`，不作为全部子应用重新发布验收。`--dir` 包没有 `app-update.yml` 的更新检查日志与本次菜单、编译链无关。

## 菜单外部点击关闭

Coder 的编辑区位于跨源 iframe 中，点击不会冒泡到宿主 `document`。修复前实际 Electron 回归复现：点击编辑区后，左上角主菜单仍保留。共享菜单现在监听宿主窗口失焦，并在下一轮事件中确认焦点是否移入菜单外的 iframe，再关闭菜单；保持原点击进入编辑区，组件销毁时清理监听及定时器。宿主普通区域沿用既有外部点击处理。主菜单和主板菜单明确互斥，点击另一个入口会关闭原菜单，同一入口仍能重复开关。

- 菜单组件 16 项、主板菜单 68 项定向测试通过，覆盖 iframe 焦点延迟、菜单内部焦点、普通窗口失焦、销毁清理和菜单互斥。
- 实际 macOS Coder 修复包和 Blockly 开发窗口共 2 项 Electron 流程通过（38.1 秒）。两个菜单均验证：内部点击保留、宿主空白点击关闭、工作区点击关闭、连续重开后再次关闭，以及相互切换。Coder 额外确认焦点保留在编辑 iframe；既有转换和 UNO 编译流程也通过。
- 本地修复包：`dist/aily-coder-menu-fix/mac-arm64/aily coder.app`，使用与前述构建相同的步骤，额外传入 `-c.directories.output=dist/aily-coder-menu-fix`，避免覆盖正在运行的应用。`app.asar` SHA-256：`554043ea22d36445741bb9118f415da44d3a250b64f6ba15681eb51350b53e3a`。
- 截图：`e2e/.artifacts/menu-dismiss-packaged/blockly-coder-conversion-o-38307-pens-an-independent-project/coder-menus-dismissed.png`；`e2e/.artifacts/menu-dismiss-packaged/blockly-coder-conversion-C-26471-verts-and-hands-it-to-Coder/blockly-menus-dismissed.png`。
