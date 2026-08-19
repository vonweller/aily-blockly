# Linux Python Runtime 实机验收

文档基线：2026-08-18（Asia/Shanghai）

本文件区分自动化 fake-peer 证据和真实设备证据。自动化测试可以证明驱动状态机、协议与 UI 契约，但不能证明某个树莓派镜像、核桃派镜像、USB 转串口芯片、SSH 配置、sudo 策略或摄像头在物理环境中可用。

## 当前验收状态

| 验收对象 | 必须使用的独立物理设备 | 当前真实设备状态 |
| --- | --- | --- |
| Raspberry Pi | 一台真实树莓派，通过用户明确提供的 SSH host 和 credential 验收 | BLOCKED — hardware/credential unavailable |
| Independent WalnutPi SSH | 用户明确提供的独立核桃派 `linux-ssh` 路径 | 2026-08-20 已完成连接、运行、输入、resize、停止、SFTP、`/boot/start` 和清理；Preview 因 `/dev/video0` V4L2 读帧超时未拿到 JPEG |
| Independent WalnutPi SERIAL-A | 同一台独立核桃派的 `linux-serial-shell` 路径，必须由验收人员明确选择 COM 口 | BLOCKED — serial port not selected |

上述状态不能用 fake SSH client、fake serial peer、UI fake IPC、CyberCAM K230 或同一台设备的重复测试替代。

## 已有自动化证据

执行时间字段由最终集成 controller 在同一次新鲜验证后填写：

```text
Automated verification timestamp: <CONTROLLER_TO_RECORD_YYYY-MM-DDTHH:mm:ss+08:00>
Branch: codex/cybercam-main-integration
Commit: <CONTROLLER_TO_REPLACE_AFTER_FINAL_COMMIT>
Host OS: <CONTROLLER_TO_RECORD>
Node.js: <CONTROLLER_TO_RECORD>
```

精确命令：

```powershell
node --test electron/test/linux-runtime-integration.test.js
npx tsc -p e2e/tsconfig.json --noEmit
npx playwright test e2e/tests/linux-python-runtime.spec.ts
git diff --check
```

证据边界：

| 自动化场景 | 已断言内容 | 不代表 |
| --- | --- | --- |
| fake SSH integration | TOFU host-key capture、PTY、`python3 -u`、输出、输入、resize、token/starttime 校验的安全 PGID stop、SFTP CRUD、临时文件和 atomic rename、systemd install/status/remove、两个 JPEG frame、disconnect | 使用真实 `LinuxSshDriver` 的 `clientFactory`/SFTP seam；没有网络监听器，不证明真实 SSH daemon、认证、SFTP、sudo/systemd 或摄像头 |
| fake serial integration | shell nonce/prompt 验证、helper bootstrap/SHA marker、`exec python3 -u`、noisy/fragmented frame、输出、输入、resize、token/starttime stop、chunk retry、CRC/SHA、文件 CRUD、`/boot/start/aily-*.sh`、preview dropping、helper shutdown/removal | 使用真实 serial driver/protocol seam，但没有物理 UART、USB 转串口芯片或真实核桃派镜像 |
| Playwright Electron E2E | SSH form、serial form、capability gating、live output、Stop 状态、remote `main.py`、autostart controls、JPEG preview 和未改变的 CyberCAM form | 使用 fake IPC，不证明 transport driver 或物理设备 |

## 安全约束

- Windows 侧只枚举串口；不自动打开任何枚举到但未被验收人员明确选择的端口。
- 不执行 LAN scanning、子网探测、mDNS 扫描或批量 `ssh-keyscan`。
- SSH 只连接用户明确提供并记录的 host、port、username 和 credential；首次主机密钥必须由验收人员核对后接受。
- 不保存明文 SSH 密码到项目、日志、截图或本文档。
- 不操作与本验收无关的 GPIO、马达、继电器、音频输出或其他外设。
- 自启动只使用 `aily-<project>.service` 或 `/boot/start/aily-<project>.sh`；清理时不得删除其他 systemd unit 或 `/boot/start` 文件。
- 文件清理不使用无边界递归删除。每个变量必须先记录并通过本文给出的格式校验。

## 每台设备必须记录的身份字段

每次验收都复制一份以下模板，不得用另一台设备的数据代填：

```text
Acceptance timestamp: <YYYY-MM-DDTHH:mm:ss+08:00>
Tester: <TO_BE_RECORDED>
Git branch: codex/cybercam-main-integration
Git commit: <CONTROLLER_TO_REPLACE_AFTER_FINAL_COMMIT>
Adapter: <linux-ssh|linux-serial-shell>
Device role: <Raspberry Pi|Independent WalnutPi>
Manufacturer/model: <TO_BE_RECORDED>
Hostname: <TO_BE_RECORDED>
OS image/version: <TO_BE_RECORDED>
Kernel/architecture: <TO_BE_RECORDED>
Python: <TO_BE_RECORDED>
Project ID: <TO_BE_RECORDED>
Session ID: <TO_BE_RECORDED>
SSH host/port: <TO_BE_RECORDED_OR_N/A>
SSH host-key fingerprint: <TO_BE_RECORDED_OR_N/A>
Serial port: <TO_BE_RECORDED_OR_N/A>
USB VID/PID/serial: <TO_BE_RECORDED_OR_N/A>
Camera/backend: <TO_BE_RECORDED_OR_UNAVAILABLE>
```

## Independent WalnutPi：`linux-ssh` 实机验收

当前状态：**PARTIAL PASS — SERIAL-A still BLOCKED; camera frames UNAVAILABLE**

```text
Acceptance timestamp: 2026-08-20T01:41:39+08:00
Tester: local session using user-provided SSH target
Git branch: codex/cybercam-main-integration
Git commit: a150d7e41b6e693de401f1df27dc9a96448ef67d
Adapter: linux-ssh
Device role: Independent WalnutPi
Manufacturer/model: walnutpi-2b
Hostname: WalnutPi
OS image/version: Debian GNU/Linux 12
Kernel/architecture: Linux 5.15.147 aarch64 GNU/Linux
Python: 3.11.2 /usr/bin/python3
Project ID: wpisshaccept
Session ID: accept-walnutpi-ssh
SSH host/port: 192.168.10.103:22
SSH username: root
SSH host-key fingerprint: SHA256:Xj7GGYcDttPZaxxwN6y0UjsvD9unC5dsdBTAryfv2+c
Serial port: N/A
USB VID/PID/serial: N/A
Camera/backend: opencv advertised; /dev/video0 exists but V4L2 select() timed out
```

通过证据：

```text
Connect/capabilities: PASS — files=sftp, autostart=boot-start-sh, preview.backend=opencv, pythonExecutable=/usr/bin/python3
Run/output/input/resize: PASS — AILY_LINUX_RUNTIME_ACCEPTANCE_START, AILY_ECHO=walnutpi-ssh-pty, heartbeat continued after resize
Token/starttime stop: PASS — leftover process list empty after stop
SFTP file CRUD/atomic overwrite: PASS — /root/.aily/wpisshaccept-files write/read/stat/list/rename/delete/rmdir
/boot/start install/status/remove: PASS — /boot/start/aily-wpisshaccept.sh installed then removed
Preview process start: PASS — independent pgid started
Preview JPEG frames: UNAVAILABLE — OpenCV opened /dev/video0 but cap.read() timed out
Cleanup: PASS — no leftover processes; managed /boot/start script removed; /root/.aily/wpisshaccept and /tmp/aily-runtime/accept-* removed
Result: PARTIAL PASS
```

本轮实机还暴露并修复了三个生产问题：

1. SSH PTY 进程已经是 session leader 时，`os.setsid()` 会 `PermissionError`；launcher 现在忽略该错误。
2. OpenSSH SFTP `rename` 不能覆盖已有文件，第二次 `runScript` 会失败；原子写现在先删除再 rename。
3. 工作区目录不存在时，SFTP `mkdir` 不是递归的；现在先 `mkdir -p` 创建父目录。

## Raspberry Pi：`linux-ssh` 实机验收

当前状态：**BLOCKED — hardware/credential unavailable**

### 1. 只对明确提供的 SSH 目标做身份预检

在 PowerShell 中填写验收人员提供的值；不要猜测 IP，也不要扫描局域网：

```powershell
$SshHost = '<USER_PROVIDED_HOST_OR_IP>'
$SshPort = 22
$SshUser = '<USER_PROVIDED_USERNAME>'
if ([string]::IsNullOrWhiteSpace($SshHost)) { throw 'SSH host is required' }
if ([string]::IsNullOrWhiteSpace($SshUser)) { throw 'SSH username is required' }
ssh -o StrictHostKeyChecking=ask -p $SshPort "$SshUser@$SshHost" 'hostname; cat /proc/device-tree/model 2>/dev/null || true; . /etc/os-release && printf "%s %s\n" "$NAME" "$VERSION_ID"; uname -srmo; python3 --version; command -v systemctl || true; command -v rpicam-vid || command -v libcamera-vid || command -v ffmpeg || true'
```

记录首次提示中的 SHA256 host-key fingerprint，并与设备管理员提供的值核对。若不一致，停止验收。

### 2. 启动应用并连接

```powershell
git branch --show-current
git rev-parse HEAD
npm run electron
```

打开声明 `runtime.adapter: "linux-ssh"` 的 Python 项目，填写同一 host、port、username 和本次 credential。通过标准：

- 状态变为 Connected，密码框清空；
- capability 区域显示真实 hostname、architecture、Python 和可用能力；
- 远程文件能力、autostart 或 preview 不可用时显示明确 gating reason，而不是静默失败。

### 3. 运行、输出、PTY 输入、resize 和停止

运行以下脚本：

```python
import os
import platform
import socket
import sys
import time

print("AILY_LINUX_RUNTIME_ACCEPTANCE_START", flush=True)
print("hostname=" + socket.gethostname(), flush=True)
print("platform=" + platform.platform(), flush=True)
print("python=" + sys.version.replace("\n", " "), flush=True)
print("pid=" + str(os.getpid()) + " pgid=" + str(os.getpgrp()), flush=True)
value = input("AILY_INPUT>")
print("AILY_ECHO=" + value, flush=True)
while True:
    print("AILY_HEARTBEAT", flush=True)
    time.sleep(1)
```

在终端输入：

```text
raspberry-pi-pty
```

调整面板尺寸一次，然后点击 Stop。通过证据必须包含：

```text
PASS evidence:
- 完整出现 AILY_LINUX_RUNTIME_ACCEPTANCE_START
- 出现 AILY_ECHO=raspberry-pi-pty
- resize 后会话仍持续输出
- Stop 后状态回到可 Run，且不再出现 AILY_HEARTBEAT
- 设备上没有该 run 的残留进程组

Timestamp: <YYYY-MM-DDTHH:mm:ss+08:00>
Screenshot/log path: <TO_BE_RECORDED>
Result: <PASS|FAIL>
Failure/error code: <TO_BE_RECORDED_OR_N/A>
```

### 4. 文件、自启动和预览

- 在远程文件树的受管 workspace 下创建目录，写入 `main.py`，读取校验，重命名后删除，再删除空目录。
- 安装 autostart，查询状态，再立即 Remove Autostart。树莓派预期为 systemd；若 capability probe 明确返回 `none`，记录为 capability unavailable，不得人工绕过。
- Preview 可用时至少记录两个不同的 JPEG 画面时间点；不可用时记录 capability reason 和检测到的 camera backend。

证据模板：

```text
File CRUD/atomic transfer: <PASS|FAIL> — <LOG_OR_SCREENSHOT>
Autostart install/status/remove: <PASS|FAIL|CAPABILITY_UNAVAILABLE> — <UNIT_NAME_AND_LOG>
Preview frame 1 timestamp: <YYYY-MM-DDTHH:mm:ss+08:00|UNAVAILABLE>
Preview frame 2 timestamp: <YYYY-MM-DDTHH:mm:ss+08:00|UNAVAILABLE>
Preview cleanup: <PASS|FAIL|UNAVAILABLE>
```

### 5. Raspberry Pi 清理证据

先在 UI 依次执行 Stop Preview、Stop、Remove Autostart、Disconnect。仅在 UI 清理失败时，对同一明确 SSH host 执行下列受限清理；先填写并验证变量：

```powershell
$ProjectId = '<RECORDED_PROJECT_ID>'
$SessionId = '<RECORDED_SESSION_ID>'
$RemoteWorkspace = '<RECORDED_ABSOLUTE_WORKSPACE>'
if ($ProjectId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Unsafe project ID' }
if ($SessionId -notmatch '^[A-Za-z0-9._-]+$') { throw 'Unsafe session ID' }
if ($RemoteWorkspace -notmatch '^/[A-Za-z0-9._/-]+$' -or $RemoteWorkspace -match '(^|/)\.\.(/|$)') { throw 'Unsafe workspace' }
ssh -p $SshPort "$SshUser@$SshHost" "sudo -n systemctl disable --now 'aily-$ProjectId.service' 2>/dev/null || true; sudo -n rm -f '/etc/systemd/system/aily-$ProjectId.service'; sudo -n systemctl daemon-reload; rm -f -- '$RemoteWorkspace/$ProjectId/.aily-$ProjectId.service.tmp' '$RemoteWorkspace/$ProjectId/main.py' '$RemoteWorkspace/$ProjectId/autostart.log' '/tmp/aily-runtime/$SessionId/'*.json; rmdir -- '$RemoteWorkspace/$ProjectId' '/tmp/aily-runtime/$SessionId' 2>/dev/null || true"
```

记录：

```text
UI disconnect: <PASS|FAIL>
Run process group absent: <PASS|FAIL>
Preview process group absent: <PASS|FAIL|UNAVAILABLE>
aily-<project>.service absent: <PASS|FAIL|UNAVAILABLE>
Managed workspace temporary files absent: <PASS|FAIL>
Cleanup timestamp: <YYYY-MM-DDTHH:mm:ss+08:00>
Cleanup evidence: <COMMAND_OUTPUT_OR_SCREENSHOT_PATH>
```

## Independent WalnutPi：`linux-serial-shell` 实机验收

当前状态：**BLOCKED — hardware/credential unavailable**

### 1. 只枚举并选择 SERIAL-A

以下命令只读取 Windows 串口信息，不打开端口：

```powershell
$SerialInventory = Get-CimInstance Win32_SerialPort |
  Select-Object DeviceID, Name, PNPDeviceID
$SerialInventory | Format-Table -AutoSize
```

由验收人员根据核桃派文档、设备标签和 USB VID/PID/serial 明确选择 SERIAL-A：

```powershell
$SerialPort = '<USER_SELECTED_SERIAL_A_PORT>'
if ($SerialPort -notmatch '^COM[0-9]+$') { throw 'A concrete Windows COM port is required' }
if (-not ($SerialInventory.DeviceID -contains $SerialPort)) { throw 'Selected port is not in the enumerated inventory' }
```

不要依次尝试其他 COM 口，不要同时运行其他串口终端。

### 2. 启动应用并连接

```powershell
git branch --show-current
git rev-parse HEAD
npm run electron
```

打开声明 `runtime.adapter: "linux-serial-shell"` 的 Python 项目，只选择已记录的 `$SerialPort`。通过标准：

- shell nonce/prompt 验证成功；
- helper bootstrap SHA 校验成功并进入 framed mode；
- capability 区域显示真实 hostname、architecture、Python、文件、自启动、resize 和 preview 能力；
- 不可用能力显示明确 gating reason。

### 3. 运行、传输、输入、resize、停止和 preview

使用与 Raspberry Pi 相同的验收脚本，把输入改为：

```text
walnutpi-serial-pty
```

然后完成：

1. 运行并确认 `python3 -u` 输出实时回传；
2. 输入并确认 `AILY_ECHO=walnutpi-serial-pty`；
3. resize 后继续输出；
4. 文件树完成 write/read/stat/list/rename/delete/mkdir/rmdir；
5. 安装、查询并删除 `/boot/start/aily-<project>.sh`；
6. Preview 可用时记录两个不同 JPEG 画面，并确认高帧率下 UI 不积压；
7. Stop 后确认 token/starttime 对应的 run 已停止；
8. Disconnect 后确认 helper 已 shutdown、自删除且 COM 口已释放。

证据模板：

```text
Run/output/input/resize: <PASS|FAIL> — <LOG_OR_SCREENSHOT>
CRC/SHA file transfer and CRUD: <PASS|FAIL> — <LOG_OR_SCREENSHOT>
Token/starttime stop: <PASS|FAIL> — <LOG_OR_SCREENSHOT>
/boot/start install/status/remove: <PASS|FAIL|CAPABILITY_UNAVAILABLE> — <LOG_OR_SCREENSHOT>
Preview frame 1 timestamp: <YYYY-MM-DDTHH:mm:ss+08:00|UNAVAILABLE>
Preview frame 2 timestamp: <YYYY-MM-DDTHH:mm:ss+08:00|UNAVAILABLE>
Preview dropping/no backlog: <PASS|FAIL|UNAVAILABLE>
Helper shutdown/removal: <PASS|FAIL>
Serial port released: <PASS|FAIL>
Result: <PASS|FAIL>
```

### 4. Independent WalnutPi 清理证据

正常路径只使用 UI 的 Stop Preview、Stop、Remove Autostart、Disconnect。若异常断开留下文件，先断开 Aily，再由验收人员使用同一个已记录的 SERIAL-A 控制台执行；不要打开其他端口：

```sh
PROJECT_ID='<RECORDED_PROJECT_ID>'
SESSION_ID='<RECORDED_SESSION_ID>'
case "$PROJECT_ID" in (*[!A-Za-z0-9_-]*|'') exit 2;; esac
case "$SESSION_ID" in (*[!A-Za-z0-9._-]*|'') exit 2;; esac
rm -f -- "/boot/start/aily-${PROJECT_ID}.sh"
rm -f -- "/tmp/aily-serial-helper-${SESSION_ID}.py"
rm -f -- "/tmp/aily-runtime/${SESSION_ID}/main.py"
rmdir -- "/tmp/aily-runtime/${SESSION_ID}" 2>/dev/null || true
```

记录：

```text
UI disconnect: <PASS|FAIL>
Run process group absent: <PASS|FAIL>
Preview process absent: <PASS|FAIL|UNAVAILABLE>
/boot/start/aily-<project>.sh absent: <PASS|FAIL|UNAVAILABLE>
/tmp/aily-serial-helper-<session>.py absent: <PASS|FAIL>
/tmp/aily-runtime/<session> empty/absent: <PASS|FAIL>
Selected COM port reusable: <PASS|FAIL>
Cleanup timestamp: <YYYY-MM-DDTHH:mm:ss+08:00>
Cleanup evidence: <COMMAND_OUTPUT_OR_SCREENSHOT_PATH>
```

## 最终签字

只有两台独立物理设备各自完成身份记录、运行链路、能力测试和清理证据后，才可以把以下状态改为 PASS：

```text
Raspberry Pi real-device acceptance: <PASS|FAIL|BLOCKED>
Independent WalnutPi real-device acceptance: <PASS|FAIL|BLOCKED>
Accepted branch: codex/cybercam-main-integration
Accepted commit: <CONTROLLER_TO_REPLACE_AFTER_FINAL_COMMIT>
Acceptance completed at: <YYYY-MM-DDTHH:mm:ss+08:00>
Accepted by: <TO_BE_RECORDED>
```
