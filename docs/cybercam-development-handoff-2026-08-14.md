# CyberCAM Python Blockly 开发交接

原始交付：2026-08-14（Asia/Shanghai）

Linux runtime 更新：2026-08-18（Asia/Shanghai）

```text
Branch: codex/cybercam-main-integration
Launch: npm run electron
Final commit: <CONTROLLER_TO_REPLACE_AFTER_FINAL_COMMIT>
```

## 交付范围

本次工作为 Aily Blockly 增加完整的 CyberCAM K230 Python 项目链路：

- 本地 CyberCAM 板卡项目，不依赖远程板卡列表创建或加载；
- Blockly 生成并保存 `main.py`；
- USB 自动发现、连接、运行、停止和终端输入；
- 设备 `scriptOutput` 终端输出、`scriptState` 运行状态回传，以及独立的本地 backend stderr 诊断通道；
- CanMV 远程文件和摄像头预览接口；
- 摄像头、屏幕、OpenCV、KPU、GPIO、PWM、UART、网络、文件、音频、IMU、系统等积木；
- CyberCAM 的 `canmv-k230` 运行/部署 profile；
- Linux 的 `linux-ssh` 和 `linux-serial-shell` 运行后端、contextual IPC/UI、文件、自启动和预览能力；
- fake-peer 集成和 Electron E2E 自动化；真实树莓派和独立核桃派仍属于硬件验收阶段。

## 三个仓库和交付分支

| 范围 | 仓库 | 分支 |
| --- | --- | --- |
| 桌面应用和运行时 | `https://github.com/vonweller/aily-blockly.git` | `codex/cybercam-main-integration` |
| CyberCAM 板卡包 | `https://github.com/vonweller/aily-blockly-boards.git` | `codex/cybercam-python-board` |
| CyberCAM 积木库 | `https://github.com/vonweller/aily-blockly-libraries.git` | `codex/cybercam-python-blocks` |

换机后以远端分支为准，用 `git rev-parse HEAD` 和 `git ls-remote --heads origin <branch>` 核对最新提交。不要叠加旧的 `codex/python-runtime-foundation` 分支。

## 新电脑拉取

```powershell
New-Item -ItemType Directory -Force Aily | Out-Null
Set-Location Aily

git clone https://github.com/vonweller/aily-blockly.git
git -C aily-blockly fetch origin codex/cybercam-main-integration
git -C aily-blockly switch --track origin/codex/cybercam-main-integration

git clone https://github.com/vonweller/aily-blockly-boards.git
git -C aily-blockly-boards fetch origin codex/cybercam-python-board
git -C aily-blockly-boards switch --track origin/codex/cybercam-python-board

git clone https://github.com/vonweller/aily-blockly-libraries.git
git -C aily-blockly-libraries fetch origin codex/cybercam-python-blocks
git -C aily-blockly-libraries switch --track origin/codex/cybercam-python-blocks

Set-Location aily-blockly
npm ci
```

## 创建离线 CyberCAM 项目

保持三个仓库为同级目录，然后在主仓库运行：

```powershell
npm run create:cybercam-project
```

默认创建：

```text
%USERPROFILE%\Documents\aily-project\CyberCAM_Starter
```

项目内置：

```text
package.json
project.abi
node_modules/@aily-project/board-cybercam
node_modules/@aily-project/lib-cybercam
```

因此打开现有项目时不依赖远程 `boards.json`，也不需要在线安装板卡包或积木库。创建器会拒绝覆盖已有同名目录。创建其他项目：

```powershell
node scripts/create-local-cybercam-project.mjs `
  --target "$env:USERPROFILE\Documents\aily-project\CyberCAM_Test_2" `
  --name "CyberCAM Test 2"
```

## 运行和测试

启动桌面开发版：

```powershell
npm run electron
```

打开 `%USERPROFILE%\Documents\aily-project\CyberCAM_Starter`。进入项目后 Python Device 面板会自动扫描设备；正常情况下无需先点击刷新。

安全的真实 CyberCAM 冒烟：

```powershell
npm run smoke:cybercam-hardware -- --port COM9
```

自动化验证：

```powershell
node --test electron/test/canmv-backend.test.js electron/test/canmv-ipc.test.js electron/test/python-runtime-bootstrap.test.js
node --test electron/test/canmv-packaged-resources.test.js
node --test electron/test/linux-runtime-integration.test.js
npm run test:create-cybercam-project
npm run test:cybercam-hardware-smoke
npm run test:e2e:fast -- --grep "CyberCAM"
npx playwright test e2e/tests/linux-python-runtime.spec.ts
npx tsc --noEmit -p tsconfig.spec.json
npx tsc -p e2e/tsconfig.json --noEmit
git diff --check
```

Karma 如果不能自动找到 Chrome，可使用 Playwright Chromium：

```powershell
$env:CHROME_BIN="$env:LOCALAPPDATA\ms-playwright\chromium-1200\chrome-win64\chrome.exe"
npx ng test --watch=false --browsers=ChromeHeadless --progress=false `
  --include src/app/services/python-runtime/python-mode.spec.ts `
  --include src/app/editors/blockly-editor/components/python-runtime-panel/python-runtime-panel.component.spec.ts
```

板卡仓库和积木库没有可用的顶层统一 `npm test`。CyberCAM 包的实际验证命令是：

```powershell
# aily-blockly-boards
npm test --prefix cybercam
node .scripts/validate-boards-compliance.js cybercam

# aily-blockly-libraries
npm test --prefix cybercam
node .scripts_git_action/validate-library-compliance.js cybercam
```

## 2026-08-14 最终验证结果

以下结果均为提交前重新执行所得：

| 范围 | 结果 |
| --- | --- |
| Electron runtime、IPC、协议、资源和 bootstrap | 27/27 通过 |
| 离线 CyberCAM 项目创建器 | 20/20 通过 |
| 安全硬件冒烟脚本单元测试 | 7/7 通过 |
| Python runtime Angular spec | 42/42 通过 |
| 主应用 TypeScript 编译 | 通过 |
| E2E TypeScript 编译 | 通过 |
| CyberCAM Electron E2E | 1/1 通过 |
| CyberCAM 板卡包契约和规范 | 通过 |
| CyberCAM 积木库 | 25/25 通过 |
| CyberCAM 积木通用规范检查 | 命令成功；只有建议级提示 |

Electron E2E 使用协议兼容的假 CanMV backend，明确断言自动扫描、连接、远程目录、运行输出、预览启停、远程文件读取、停止和断开。它不验证终端尺寸，也不证明应用退出后真实 backend PID 或物理 USB 句柄已经释放；顽固 backend 进程终止由独立 Electron Node 测试覆盖，真实设备基础能力由下一节的 COM9 安全冒烟单独记录。

## 2026-08-18 Linux Python runtime 更新

新增两个运行后端：

- `linux-ssh`：服务树莓派和启用 SSH 的核桃派。支持 TOFU host-key、PTY、`python3 -u`、实时输出、PTY 输入/resize、token 与 `/proc/<pid>/stat` starttime 校验后的安全 PGID stop、SFTP 或受控 helper 文件操作、原子写、systemd 或 `/boot/start`、JPEG 预览。
- `linux-serial-shell`：服务无法联网或要求通过 USB SERIAL-A 运行的独立核桃派。支持 shell nonce/prompt 验证、helper SHA bootstrap、noisy/fragmented framed protocol、`python3 -u`、输出/输入/resize、token/starttime stop、CRC/SHA/retry 文件传输、`/boot/start/aily-*.sh`、preview dropping 和 helper cleanup。

自动化证据由三层组成：

1. `electron/test/linux-runtime-integration.test.js` 直接使用真实 driver API。
2. SSH fixture 的边界是 `real LinuxSshDriver clientFactory/SFTP seam; no network listener`；它不是网络 SSH server。
3. serial fixture 通过真实 serial driver/protocol seam 注入带噪声和分片的数据；Playwright 场景使用 fake IPC 验证 UI 契约，不是物理 transport 证据。

Linux Playwright 场景覆盖 SSH form、serial form、capability gating、live output、Stop → Run、远程 `main.py`、autostart controls、JPEG preview，以及保持不变的 CyberCAM form。

最终 controller 在提交前应重新执行并记录精确结果：

```powershell
node --test electron/test/linux-runtime-integration.test.js
npx tsc -p e2e/tsconfig.json --noEmit
npx playwright test e2e/tests/linux-python-runtime.spec.ts
git diff --check
git diff --name-only
git status --short
```

本文件不预填最终 commit SHA。controller 完成整合、验证和最终提交后，用真实值替换：

```text
Final commit: <CONTROLLER_TO_REPLACE_AFTER_FINAL_COMMIT>
```

## 本轮并发和清理加固

- CanMV backend 的 stdout、stderr、error 和 exit 都绑定到创建它们的 child；旧 child 的晚到事件不能清理或破坏新 backend。
- 请求超时会使当前 backend 失效并终止，下一次请求创建全新 backend。
- Python Device 面板为每次 runtime activation 分配代际 ID；旧初始化或扫描不能覆盖新 runtime 的设备、错误或 busy 状态。
- 硬件冒烟在等待运行请求时发生 evidence 超时，也会执行 `stopScript`、`disconnectBoard` 和 backend 关闭，且不会产生未处理 Promise rejection。
- 硬件冒烟只有在脚本最终报告 `running: false` 时才会输出 `status: "passed"`。

## 真实 CyberCAM K230 证据

2026-08-14 已在真实设备完成安全基础硬件冒烟：

```text
端口: COM9
名称: CyberCAM K230
VID/PID: 1209:abd1
序列号: 53EB63EA_ECF5223E
固件: v1.1.0
```

验证链路：

```text
detectBoards
connectBoard
runScript
scriptOutput
scriptState
scriptRunning
io.listDir("/")
getFirmwareCommit
stopScript
disconnectBoard
```

运行脚本只打印唯一标记，设备回传：

```text
# python3 -u /vscode-current-file.py

AILY_CYBERCAM_SMOKE_9552CCF249C94E32B1BB303C8545C4A2
```

脚本状态依次包含 `started`、`finished`，最终 `scriptRunning.running` 为 `false`。根目录读取成功并包含 `/boot`、`/data`、`/home`、`/root`、`/usr`、`/etc` 等。该测试不写文件、不操作 GPIO、不启动摄像头或音频。

如果命令报告 `Serial port busy`，先检查是否已有 Aily Blockly 的 `canmv-backend` 连接了同一串口。释放旧连接后再运行；不要同时让桌面 UI、硬件冒烟和其他串口工具占用 COM9。

## 平台能力边界

- CyberCAM K230：`canmv-k230` adapter 已实现并完成真实设备基础冒烟。
- 树莓派 Linux：`linux-ssh` 自动化实现已完成；真实设备状态为 **BLOCKED — hardware/credential unavailable**。
- 核桃派 Linux SSH：复用 `linux-ssh` 并由 capability probe 选择文件、自启动和预览能力；2026-08-20 已在独立 WalnutPi-2b 上完成 SSH 主链路验收。Preview JPEG 因 `/dev/video0` V4L2 读帧超时仍为 UNAVAILABLE。
- 独立核桃派 Linux SERIAL-A：`linux-serial-shell` 自动化实现已完成；真实设备状态为 **BLOCKED — hardware/credential unavailable**。
- GPIO、摄像头、显示、音频、IMU、网络和 KPU 仍需按照 `docs/cybercam-hardware-smoke-test.md` 做非破坏性专项验收。

详细运行模型见 `docs/python-board-runtime-compatibility.md`，真实 Linux 设备步骤和证据模板见 `docs/linux-python-runtime-hardware-acceptance.md`。

## 剩余硬件限定动作

以下动作不能由 fake peer、UI fake IPC 或现有 CyberCAM K230 代替：

1. 使用一台真实 Raspberry Pi，通过用户明确提供的 SSH host/port/username/credential 完成一次运行、输出、PTY 输入、resize、安全停止、文件、自启动、预览和清理验收。
2. 使用一台独立核桃派，只打开验收人员明确选择的 SERIAL-A，完成 helper bootstrap、运行、输出、输入、resize、文件传输、`/boot/start`、预览、停止、helper cleanup 和串口释放验收。
3. 若该独立核桃派启用 SSH，再补做 `linux-ssh` 能力探测，记录其实际选择的是 SFTP/helper、systemd/`boot-start-sh` 以及摄像头 backend。
4. 把时间戳、设备型号、hostname、OS、Python、VID/PID/serial、SSH host-key fingerprint、日志/截图和 cleanup 证据填写到硬件验收文档。

安全限制：

- 只枚举串口，不轮流打开未知 COM 口。
- 不扫描 LAN，不探测子网，不批量扫描 SSH。
- SSH 只连接用户明确提供的目标和 credential。
- 自启动只清理 `/etc/systemd/system/aily-*.service` 和 `/boot/start/aily-*.sh` 中本次记录的 project ID。
- SSH 会话临时控制文件只位于 `/tmp/aily-runtime/<session>/`；受管项目文件只位于 capability probe 返回的 workspace 下对应 project 目录。
- serial helper 只位于 `/tmp/aily-serial-helper-<session>.py`，会话脚本只位于 `/tmp/aily-runtime/<session>/`；异常中断后也只清理已记录的 session。
- 正常清理顺序是 Stop Preview、Stop、Remove Autostart、Disconnect；不得用无边界递归删除替代。

## 注意事项

- 积木库工作区可能存在与 CyberCAM 无关的 `.baoyu-skills/baoyu-translate/EXTEND.md` 删除状态；不要提交、恢复或覆盖它。
- 本地项目中的 `.temp`、`node_modules` 和 `project.abi.pre-project-data.bak` 都有用途，不应作为“多余文件夹”删除。
- 只在三个分支均完成验证和推送后，才把本交接文档视为最终交付状态。
