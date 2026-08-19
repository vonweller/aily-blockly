# Linux Python Runtime 换机交接

日期口径：2026-08-18（后续实机与回归记录到 2026-08-20）

分支：`codex/cybercam-main-integration`

状态：`linux-ssh` 与 `linux-serial-shell` 主体实现、P0/P1/P2 自动化和独立核桃派 SSH 主链路已完成。代码在本机工作区；提交 SHA 见下文“Git 状态”。Raspberry Pi SSH 与独立核桃派 SERIAL-A 仍 BLOCKED。不要把 fake-peer 证据写成实机 PASS。

## 一句话结论

Electron runtime broker 现在同时注册 `canmv-k230`、`linux-ssh`、`linux-serial-shell`。Linux 驱动共享绝对 POSIX Python 路径、token+`/proc/<pid>/stat` starttime 停止、SFTP/helper 文件和 JPEG 预览。独立 WalnutPi-2b `192.168.10.103` 的 SSH 主链路已 PARTIAL PASS；Preview JPEG 因 `/dev/video0` V4L2 读帧超时 UNAVAILABLE。密码未写入仓库或文档。

## 不要做的事

- 不要执行 `git reset --hard`、`git clean -fd`、`git checkout -- .`。
- 不要扫描局域网、猜测树莓派 IP、批量打开 COM 口。
- 不要把 SSH 密码、私钥或 passphrase 写入项目、日志或文档。
- 不要删除非 `aily-<project>.*` 的 systemd unit 或 `/boot/start` 文件。
- 不要用 fake SSH/serial peer、fake IPC 或 CyberCAM K230 代替 Raspberry Pi / SERIAL-A 实机验收。

## 已有设计，不要重写

- `docs/superpowers/specs/2026-08-18-linux-python-runtimes-design.md`
- `docs/superpowers/plans/2026-08-18-linux-python-runtimes.md`
- `docs/python-board-runtime-compatibility.md`
- `docs/linux-python-runtime-hardware-acceptance.md`
- `docs/cybercam-development-handoff-2026-08-14.md`
- `docs/linux-ssh-runtime-review-handoff-2026-08-19.md`
- `docs/aily-blockly-linux-runtime-progress-handoff-2026-08-18.md`

## 实现范围

### Electron

- `electron/python-runtime/runtime-broker.js`：按 adapter、session、renderer owner 隔离。
- `electron/python-runtime/runtime-errors.js`：稳定错误码和对外脱敏。
- `electron/python-runtime/canmv-driver.js`：包装既有 CanMV，不改二进制协议。
- `electron/python-runtime/linux-shared/`：endpoint、POSIX 路径、capability、launcher、JPEG。
- `electron/python-runtime/linux-ssh/driver.js`：TOFU host key、PTY、`python3 -u`、SFTP 原子写、systemd/`/boot/start`、独立 preview。
- `electron/python-runtime/linux-serial-shell/`：shell 校验、framed helper、文件 CRC/SHA/retry、`/boot/start`、preview 限速。
- `electron/python-runtime/bootstrap.js`、`ipc.js`、`electron/preload.js`：启动时注册三个 runtime，不自动连接。
- 依赖：`electron/package.json` 增加 `ssh2@^1.17.0`。

### Angular

- `src/app/services/python-runtime/linux-ssh-runtime.adapter.ts`
- `src/app/services/python-runtime/linux-serial-shell-runtime.adapter.ts`
- `src/app/services/python-runtime/python-runtime-providers.ts`
- `src/app/services/python-runtime/bound-python-runtime-bridge.ts`
- 运行面板增加 SSH/serial 表单、capability gating、远程文件、自启动、预览、PTY 输入和 resize。
- SSH 密码只留在组件内存，连接成功后清空。

### 本轮实机修掉的生产问题

1. SSH PTY 已是 session leader 时，`os.setsid()` 会 `PermissionError`；launcher 忽略该错误。
2. OpenSSH SFTP `rename` 不能覆盖已有文件；原子写在 `Failure(4)` / exists 时先 unlink 再 rename。
3. `/root/.aily` 不存在时 SFTP `mkdir` 不是递归的；现在先 `mkdir -p`。
4. serial 非主动 `close`/`error` 走幂等 remote-disconnect，pending waiter 以 `SESSION_CLOSED` 拒绝。
5. helper `terminate_process()` 把 grace 夹到 `0..10`，deadline 使用 grace。
6. systemd 安装失败只回滚当前 `aily-<project>.service`。
7. `JsonKnownHostStore` 串行化 RMW；Windows 覆盖写处理 `EPERM`/`EEXIST`。

## 自动化证据

最新新鲜回归：2026-08-20

```text
npm run test:python-runtime                         129/129
npm run test:python-runtime:angular                 58/58（本机 Playwright Chromium + --headless=new）
npm run test:create-cybercam-project                20/20
npm run test:cybercam-hardware-smoke                7/7
npx tsc -p e2e/tsconfig.json --noEmit               exit 0
npx tsc --noEmit -p tsconfig.spec.json              exit 0
npx ng build --configuration development            成功；既有 bundle warning
npx playwright test e2e/tests/linux-python-runtime.spec.ts  1/1
npm run test:e2e:fast -- --grep "CyberCAM|Linux Python"     2/2
git diff --check                                    无 whitespace 错误
```

启动注册证据：`electron/test/python-runtime-bootstrap.test.js` 断言 broker 注册 `canmv-k230`、`linux-serial-shell`、`linux-ssh`，且创建 registration 时不创建 SSH/serial session。

Angular 测试脚本引用的 `src/app/services/python-runtime/linux-runtime-adapters.spec.ts` 被仓库 `.gitignore` 的 `**/*.spec.ts` 忽略；若该文件未强制加入版本库，接手人需要保留本地副本或按同样规则补测。

## 实机验收

```text
Raspberry Pi linux-ssh: BLOCKED — 未提供 host/credential
Independent WalnutPi linux-ssh: PARTIAL PASS — 2026-08-20
Independent WalnutPi SERIAL-A: BLOCKED — 未选择 COM 口
```

WalnutPi SSH 身份（不含密码）：

```text
Host/port: 192.168.10.103:22
Username: root
Host-key: SHA256:Xj7GGYcDttPZaxxwN6y0UjsvD9unC5dsdBTAryfv2+c
Model: walnutpi-2b
Hostname: WalnutPi
OS: Debian GNU/Linux 12
Kernel: Linux 5.15.147 aarch64
Python: 3.11.2 /usr/bin/python3
files=sftp
autostart=boot-start-sh
preview=opencv advertised; /dev/video0 exists; cap.read() V4L2 select() timeout
```

通过：连接、capability、PTY 运行/输入/resize/停止、SFTP CRUD、`/boot/start` 安装查询移除、清理。
未通过：Preview JPEG 帧。OpenCV 能打开 `/dev/video0`，但读帧超时。

详细字段见 `docs/linux-python-runtime-hardware-acceptance.md`。

## 启动

```powershell
cd D:\Do\Githubs\Aily\aily-blockly
npm run electron
```

期望：Angular 4200 起来，Electron 窗口打开，三个 runtime 注册，启动时不自动连 SSH、不自动打开串口。

本机 Angular headless 需要：

```powershell
$env:CHROME_BIN='C:\Users\52953\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe'
```

Karma 需 `--headless=new`。系统 Chrome 不存在时不要改成假绿。

## 接手后的第一组命令

```powershell
cd D:\Do\Githubs\Aily\aily-blockly
git status --short --branch
git rev-parse HEAD
npm run test:python-runtime
```

## 剩余硬件限定动作

1. 用户明确提供树莓派 SSH host/port/username/credential 后，按硬件验收文档做完整 `linux-ssh` 路径。
2. 用户明确选择独立核桃派 SERIAL-A COM 口后，做 `linux-serial-shell` 路径。
3. 若要重测 WalnutPi 摄像头，先确认 `/dev/video0` 能实际读帧，再记 JPEG 证据；不要把进程启动成功写成帧 PASS。

## Git 状态

```text
Repository: D:\Do\Githubs\Aily\aily-blockly
Remote: https://github.com/vonweller/aily-blockly.git
Branch: codex/cybercam-main-integration
Implementation commit: a150d7e41b6e693de401f1df27dc9a96448ef67d
Docs commit: recorded by the follow-up docs commit on this file
Push: not requested; branch is ahead of origin after local commits
```

推送前必须再次确认工作区没有密码、临时验收脚本或本机密钥。
