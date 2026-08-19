# Aily Blockly Linux Python Runtime 当前进度交接

项目记录日期：2026-08-18（沿用本轮既定日期口径）

交接目的：由其他开发者继续完成 `linux-ssh` 与 `linux-serial-shell` 两个运行后端的审查修复、全量验证、提交推送和真实设备验收。

## 一句话结论

两个 Linux 运行后端、Electron runtime broker、Angular UI、文件、自启动、PTY、停止和摄像头预览的主体代码已经写入本机工作区。P0 四个失败和 P1 两项 SSH 审查已在本轮修完并通过新鲜回归；代码仍未提交、未推送。独立核桃派 `linux-ssh` 主链路已于 2026-08-20 完成 PARTIAL PASS；Raspberry Pi SSH 和独立核桃派 SERIAL-A 仍为 BLOCKED。

## 最重要的交接提醒

当前主要实现只存在于本机未提交工作区。另一个开发者如果现在只从 GitHub 拉取分支，将拿不到这些代码。

- 不要执行 `git reset --hard`、`git clean -fd`、`git checkout -- .` 或其他会清除工作区的命令。
- 若接手人使用同一台电脑，可直接在现有目录继续。
- 若接手人使用另一台电脑，应先由当前机器完成一次受控提交并推送，或完整传递包含未跟踪文件的工作目录；普通 `git diff` 补丁不会自动包含未跟踪文件。
- `.learnings/` 是本地过程记录，已通过 `.git/info/exclude` 排除，不应提交。

## 仓库和 Git 状态

```text
Repository: D:\Do\Githubs\Aily\aily-blockly
Remote: https://github.com/vonweller/aily-blockly.git
Branch: codex/cybercam-main-integration
Local HEAD: 9964c9f00588593f4f6048b3395f39901a59bc41
Remote branch HEAD: 37d5e4e2f9af54972dc899d6908592ca8ceb808c
Branch status: ahead 2
Node: v24.6.0
npm: 11.5.1
```

本地领先远端的两个提交只有设计和实施计划：

```text
9964c9f0 docs(python): add Linux runtime implementation plan
abdd3bee docs(python): design Linux runtime backends
```

Linux 后端主体实现仍在 modified/untracked 工作区，未提交、未推送。

## 已有设计与计划，不要重复编写

完整需求、架构和任务拆分已经记录在以下文件中，接手人应直接阅读：

- `docs/superpowers/specs/2026-08-18-linux-python-runtimes-design.md`
- `docs/superpowers/plans/2026-08-18-linux-python-runtimes.md`
- `docs/python-board-runtime-compatibility.md`
- `docs/linux-python-runtime-hardware-acceptance.md`
- `docs/cybercam-development-handoff-2026-08-14.md`
- `docs/linux-ssh-runtime-review-handoff-2026-08-19.md`

## 已完成的主体能力

### Runtime 和兼容层

- 新增 runtime broker，按 adapter、session、renderer owner 隔离连接与事件。
- 保留原有 `canmv-k230` / CyberCAM K230 流程。
- Electron IPC、preload 和 Angular bridge 已扩展为上下文绑定调用。
- Angular 已有 SSH/serial 连接表单、能力 gating、远程文件树、自启动、预览、终端输入和 resize。
- SSH 密码/passphrase 仅在连接期间保存在组件内存，连接后会清空。

### `linux-ssh`

- TOFU host-key 校验。
- PTY 执行、`python3 -u`、实时输出、输入和 resize。
- token 加 `/proc/<pid>/stat` starttime 校验后的进程组停止。
- SFTP 文件操作与 Python helper fallback，包含原子写。
- systemd 或 `/boot/start` 自启动路径。
- 独立 JPEG preview 进程组。
- SSH fallback 文件传输 ACK/NACK 已加入 transfer/chunk/attempt 身份隔离，迟到响应不会污染后续重试。
- capability probe 已保存严格验证的 Python 绝对路径，并用于运行、停止 helper、文件 helper、预览和自启动。
- run/preview 并发启动已加入互斥 sentinel，失败后允许重试。

SSH 定向测试的最新结果：

```powershell
node --test electron/test/linux-ssh-driver.test.js electron/test/linux-shared.test.js
```

```text
25/25 passed
```

### `linux-serial-shell`

- shell nonce/prompt 验证和 helper SHA bootstrap。
- 支持有噪声、分片输入的 framed protocol。
- PTY 执行、`python3 -u`、实时输出、输入和 resize。
- token/starttime 校验后的 PGID stop。
- CRC/SHA/retry 文件传输。
- `/boot/start/aily-*.sh` 自启动。
- preview 限速、只保留最新帧、控制帧优先。
- 正常断开时的 helper 清理流程。

## 当前最新测试状态

最新运行：2026-08-20

```powershell
npm run test:python-runtime
```

结果：

```text
Tests: 129
Passed: 129
Failed: 0
Cancelled: 0
Skipped: 0
Exit code: 0
```

原先 4 个失败已修复，并新增 4 个 P1 测试：

1. fake SSH fixture 现在返回 `pythonExecutable: '/usr/bin/python3'`，生产端仍使用严格绝对 POSIX 路径校验。
2. serial `close` 与非主动 `error` 走同一套幂等 remote-disconnect cleanup，pending / waiter 立即以 `SESSION_CLOSED` 拒绝。
3. helper `terminate_process()` 将 `grace` 夹到 `0..10`，deadline 使用 grace；`grace=0` 不会空转。
4. systemd 安装失败会对当前 `aily-<project>.service` 做 best-effort 回滚。
5. `JsonKnownHostStore` 将实例内 read-modify-write 串行化，一次失败不会毒化后续写；Windows 覆盖写使用 `EPERM`/`EEXIST` 回退。

后续新鲜回归：

```text
npm run test:python-runtime:angular     58/58（本机需 Playwright Chromium + --headless=new）
npm run test:create-cybercam-project    20/20
npm run test:cybercam-hardware-smoke    7/7
npx tsc -p e2e/tsconfig.json --noEmit   exit 0
npx tsc --noEmit -p tsconfig.spec.json  exit 0
npx ng build --configuration development 成功；既有 bundle warning
npx playwright test e2e/tests/linux-python-runtime.spec.ts  1/1
npm run test:e2e:fast -- --grep "CyberCAM|Linux Python"     2/2
```

## 必须继续完成的代码工作

P0 和 P1 已在 2026-08-20 完成。按优先级执行剩余交付：

### P2：完整回归和文档收尾

修复完成后必须重新运行以下命令，旧结果不能作为最终完成证据：

```powershell
npm run test:python-runtime

$env:CHROME_BIN='C:\Users\52953\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe'
npm run test:python-runtime:angular

npm run test:create-cybercam-project
npm run test:cybercam-hardware-smoke
npx tsc -p e2e/tsconfig.json --noEmit
npx tsc --noEmit -p tsconfig.spec.json
npx ng build --configuration development
npx playwright test e2e/tests/linux-python-runtime.spec.ts
npm run test:e2e:fast -- --grep "CyberCAM|Linux Python"
git diff --check
```

Angular/build/E2E 等曾在较早实现基线上通过，但在最新 SSH/serial 审查修改之后尚未重新完成最终全量验证，因此不能写成当前绿色结果。开发构建此前只有既有 bundle warning：initial bundle 约 7.09 MB，高于 7.00 MB warning budget，不是构建失败。

### P3：提交、推送和换机交接

所有自动化通过后建议分两次提交：

```powershell
git add package.json electron src docs e2e
git commit -m "feat(python): add Linux SSH and serial runtime backends"
```

记录实现提交 SHA，然后更新最终换机交接文档 `docs/python-linux-runtime-handoff-2026-08-18.md`，再提交：

```powershell
git add docs
git commit -m "docs(python): add Linux runtime development handoff"
git push origin codex/cybercam-main-integration
```

推送后核对：

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/codex/cybercam-main-integration
git ls-remote --heads origin codex/cybercam-main-integration
```

本地 HEAD、tracking SHA、远端 SHA 必须一致，分支不得继续显示 ahead。

### P4：Windows 启动确认

推送核对成功后运行并保持应用打开：

```powershell
npm run electron
```

确认 Angular 4200 启动、Electron 窗口打开、三个 runtime 注册无启动错误，并且启动时没有自动连接 SSH 或打开串口。

## 真实设备验收

```text
Raspberry Pi real-device acceptance: BLOCKED — no SSH host/credential
Independent WalnutPi linux-ssh: PARTIAL PASS — 2026-08-20 on 192.168.10.103
Independent WalnutPi SERIAL-A: BLOCKED — serial port not selected
```

原因和边界：

- 树莓派仍没有用户明确提供的 SSH host、username 和 credential。
- 独立核桃派 SSH 已用用户提供的 `192.168.10.103` / `root` 完成连接、运行、输入、resize、停止、SFTP、`/boot/start` 和清理；密码未写入仓库或文档。
- Preview JPEG 因 `/dev/video0` V4L2 `select()` 超时未拿到，记为 UNAVAILABLE，不是驱动崩溃。
- 独立核桃派 SERIAL-A 仍没有明确选定的 COM 口。
- 禁止扫描局域网、猜测 IP、批量尝试 COM 口。
- fake SSH/serial peer、fake UI IPC、CyberCAM K230 都不能替代真实 Raspberry Pi 或 SERIAL-A 验收。

实机验收步骤、记录字段和安全清理命令见 `docs/linux-python-runtime-hardware-acceptance.md`。

## 工作区主要文件区域

- Electron broker/IPC：`electron/python-runtime/runtime-broker.js`、`electron/python-runtime/ipc.js`、`electron/preload.js`
- SSH：`electron/python-runtime/linux-ssh/`
- Serial shell：`electron/python-runtime/linux-serial-shell/`
- Linux 共享层：`electron/python-runtime/linux-shared/`
- Electron 测试：`electron/test/linux-*.test.js`、`electron/test/python-runtime-*.test.js`
- Angular adapters/services：`src/app/services/python-runtime/`
- Angular UI：`src/app/editors/blockly-editor/components/python-runtime-panel/`
- Electron E2E：`e2e/tests/linux-python-runtime.spec.ts`

## 接手后的第一组命令

```powershell
cd D:\Do\Githubs\Aily\aily-blockly
git status --short --branch
git diff --check
node --test electron/test/linux-ssh-driver.test.js electron/test/linux-shared.test.js
node --test electron/test/linux-serial-backend.test.js electron/test/linux-serial-helper.test.js
npm run test:python-runtime
```

先确认工作区和上述失败可复现，再按 P0、P1 顺序继续。不要先做格式化或批量重写，以免覆盖现有大量未提交改动。

## Suggested skills

建议接手代理按顺序使用：

1. `using-superpowers`：确认可用技能与执行约束。
2. `executing-plans`：继续执行已有 implementation plan。
3. `systematic-debugging`：处理当前 4 个确定性失败。
4. `test-driven-development`：完成 serial cleanup、systemd rollback 和 known-host 并发写。
5. `receiving-code-review`：核对剩余 SSH 审查项的技术要求。
6. `verification-before-completion`：最终全量验证，禁止用旧测试结果声明完成。
7. `finishing-a-development-branch`：提交、推送和分支收尾。

## 当前没有完成的交付动作

- 未创建最终 `docs/python-linux-runtime-handoff-2026-08-18.md`。
- 未提交 Linux runtime 主体实现。
- 未推送当前分支更新。
- 未启动最终 Windows Electron 交付窗口。
- 未完成真实 Raspberry Pi SSH 实机验收。
- 独立核桃派 SSH 主链路已在 2026-08-20 完成；SERIAL-A 仍缺明确 COM 口；Preview JPEG 因 `/dev/video0` 读帧超时未拿到。

