# Linux Python 运行后端设计

日期：2026-08-18

## 目标

在不改变已完成的 CyberCAM K230 `canmv-k230` 行为的前提下，为 Python Blockly 增加两个 Linux 运行后端：

- `linux-ssh`：面向 Raspberry Pi 和支持 SSH 的 WalnutPi。
- `linux-serial-shell`：面向无法联网或需要通过 USB 串口操作的 WalnutPi。

两个后端均需支持：

- 使用 `python3 -u` 运行生成脚本；
- PTY 合并输出、交互输入和终端尺寸调整；
- PID、进程组和强制停止；
- 远程文件浏览与传输；
- 板端自启动部署；
- 摄像头预览；
- 能力探测、断线清理和明确的错误反馈。

最终验收包括自动化测试、CyberCAM 回归，以及真实 Raspberry Pi 和独立 WalnutPi 各一次实机验收。没有真实设备证据时不得宣称对应平台已完成实机兼容。

## 非目标

- 不在首版实现局域网自动发现 SSH 主机。
- 不把 SSH 密码、私钥内容或口令写入项目、板卡包或积木库元数据。
- 不要求所有 Linux 镜像安装 OpenCV、Picamera2、FFmpeg 或额外守护进程。
- 不改变 CyberCAM 的 CanMV 二进制协议、USBDBG 执行语义或现有板卡积木。
- 不提供任意 root 权限绕过；需要管理员权限的部署必须通过能力探测和显式错误说明。

## 方案选择

采用“统一 Runtime Broker + 两个独立 Transport + 公共 Linux 能力契约”：

```text
Angular Python Runtime
        │
        ▼
Electron Runtime Broker
        │
        ├── canmv-k230
        │     └── 现有 CanMV backend
        │
        ├── linux-ssh
        │     ├── SSH PTY
        │     ├── SFTP / 标准库文件降级
        │     ├── 远程进程组控制
        │     └── 独立预览 channel
        │
        └── linux-serial-shell
              ├── SerialPort
              └── 临时 Python helper
                    ├── PTY 与输入
                    ├── 运行及停止
                    ├── 文件分块传输
                    └── 摄像头帧复用
```

不选择以下方案：

- 两个完全独立的端到端后端：会重复状态、文件、运行、部署和预览逻辑。
- SSH 和串口都强制依赖同一个常驻 Agent：会让原本具有原生 PTY/SFTP 的 SSH 增加不必要的安装和恢复成本。

串口 helper 是临时组件，仅使用 Python 标准库。它通过当前 shell 启动，连接关闭后退出，不安装系统服务，不修改板端 Python 环境。

## Runtime Broker 与会话隔离

Electron 主进程增加 Runtime Broker。它按 `adapterId` 注册 driver，并按 renderer owner 和 `sessionId` 隔离连接。

所有 IPC 操作均带：

```ts
interface RuntimeRequestContext {
  adapterId: 'canmv-k230' | 'linux-ssh' | 'linux-serial-shell';
  sessionId?: string;
}
```

连接成功后返回随机 `sessionId`。运行、终端、文件、部署和预览操作必须使用同一会话。事件包含 `adapterId`、`sessionId` 和 payload，只发送给拥有该会话的 renderer。窗口销毁时 Broker 释放该窗口的运行、预览、SSH 和串口资源。

现有 CanMV backend 保持原类和协议，由轻量 driver 包装后注册到 Broker，避免 Linux 改造侵入已验证代码。

## 前端 Adapter 与连接端点

前端保留 `PythonRuntimeRegistry` 和 `PythonRuntimeClient`，新增两个 adapter 及各自绑定的 bridge：

- `linux-ssh-runtime.adapter.ts`
- `linux-serial-shell-runtime.adapter.ts`

连接端点使用可判别联合：

```ts
type PythonRuntimeEndpoint =
  | {
      kind: 'canmv';
      port: string;
      baudRate: number;
    }
  | {
      kind: 'ssh';
      host: string;
      port: number;
      username: string;
      credentialId?: string;
      privateKeyPath?: string;
    }
  | {
      kind: 'serial-shell';
      port: string;
      baudRate: number;
    };
```

CyberCAM 继续自动扫描 USB。串口 Linux 后端列出本机串口，但只在用户连接后执行非破坏性 shell 验证。SSH 首版使用手动主机配置和历史配置，不主动扫描局域网。

认证秘密不进入 endpoint 的持久化项目数据。密码和私钥口令由 Electron 安全存储管理；私钥路径可以作为非秘密配置保存。SSH host key 首次连接记录指纹，后续变化必须拒绝连接并提示用户。

## 能力探测

连接后返回统一能力对象：

```ts
interface LinuxRuntimeCapabilities {
  platform: 'raspberry-pi' | 'walnutpi' | 'linux';
  hostname: string;
  architecture: string;
  pythonVersion: string;
  homeDirectory: string;
  writableWorkspace: string;
  pty: boolean;
  terminalResize: boolean;
  processGroups: boolean;
  files: 'sftp' | 'agent' | 'none';
  autostart: 'systemd' | 'boot-start-sh' | 'none';
  preview: {
    available: boolean;
    backend?: 'rpicam' | 'v4l2-ffmpeg' | 'opencv';
    transports: Array<'ssh-binary' | 'serial-framed'>;
  };
}
```

基础连接只探测 Python、PTY、进程组、文件和部署机制。摄像头详细探测延迟到首次点击 Preview，避免连接时打开摄像头或明显延长连接时间。

UI 根据 capability 启用文件、自启动、resize 和预览操作。能力缺失时显示原因，不发送注定失败的请求。

## 运行、输出与 PTY

脚本上传到会话临时目录：

```text
/tmp/aily-runtime/<sessionId>/main.py
```

运行命令固定为：

```text
python3 -u /tmp/aily-runtime/<sessionId>/main.py
```

路径由后端生成，禁止把未经验证的用户路径拼接到 shell 命令。

统一运行事件：

```ts
type RuntimeEvent =
  | { type: 'started'; runId: string; pid: number; pgid: number }
  | { type: 'output'; runId: string; data: string }
  | { type: 'exited'; runId: string; exitCode: number | null; signal?: string }
  | { type: 'error'; runId?: string; code: string; message: string };
```

PTY 模式合并 stdout 和 stderr。`runScript` 在收到 `started` 后返回，后续输出和退出通过事件流回传。

### SSH

SSH driver 使用远端 PTY channel 启动受控 launcher。launcher 创建新 session/process group，先输出带随机 nonce 的控制行，再执行 `python3 -u`。普通程序输出不会被解析为控制命令。

终端输入直接写入 SSH channel；resize 使用 SSH window-change。状态和停止命令使用独立控制 channel，避免与用户程序输出竞争。

### 串口 Shell

连接分为：

1. 发送换行并识别 login、shell prompt 或已登录状态。
2. 使用随机 nonce 的 `printf` 验证 shell。
3. 通过小块 Base64 bootstrap 启动临时 helper。
4. helper 切换到带随机 magic、长度、类型和 CRC32 的 framed protocol。

helper 使用 `pty.openpty()` 和 `subprocess.Popen(..., start_new_session=True)`。用户输入写入 child PTY；resize 使用 `TIOCSWINSZ`。协议支持粘包、拆包、shell 回显、banner、内核日志噪声后的重新同步。

## 进程停止

每次运行记录：

- 随机 `runId`；
- PID 和 PGID；
- `/proc/<pid>/stat` 启动时间；
- 会话 token。

停止流程：

1. 验证 run token 与进程启动时间。
2. 对整个进程组发送 `SIGTERM`。
3. 最多等待 2 秒。
4. 仍存活则发送 `SIGKILL`。
5. 确认进程组退出后发送 `exited`。

断开连接、切换 adapter、窗口销毁和应用退出均触发相同清理。旧会话的迟到事件通过 session generation 丢弃。

## 文件传输

### SSH

优先使用 SFTP 实现：

- list/stat/read/write；
- mkdir/rmdir；
- rename/delete；
- 二进制文件；
- 临时文件写入和原子 rename。

若 SSH 可用但 SFTP subsystem 不可用，则降级到远端 Python 标准库文件 helper。降级协议仍包含分块序号、长度、CRC32、ACK、重试和最终 SHA-256。

### 串口

串口复用临时 helper 的 framed protocol：

- 控制、终端、文件和预览使用不同 frame type；
- 文件分块具有序号和 CRC32；
- 每个窗口有限流；
- 失败块可以重试；
- 完整文件校验 SHA-256；
- 写入临时文件后使用 `os.replace()` 原子替换；
- 路径必须是规范化绝对 POSIX 路径并拒绝 NUL 和穿越。

串口默认限制单文件大小和并发数。超过限制时返回明确错误，不允许大传输无限占用终端。

## 自启动

部署操作独立于即时 Run。

### WalnutPi

当探测到 `/boot/start` 约定时：

- Python 文件部署到固定应用目录；
- 在 `/boot/start` 写入受管理的 `.sh`；
- shell 脚本使用绝对路径和 `python3 -u`；
- 长任务以后台方式启动；
- 更新采用临时文件和原子替换；
- 支持查询、更新和卸载。

### Raspberry Pi

使用 systemd：

- 优先安装受管理的 system unit；
- 先探测目标 unit directory 和非交互 sudo 能力；
- 无权限时不得静默降级为不可靠方案；
- unit 使用固定工作目录、自动重启策略和日志标识；
- 支持 daemon-reload、enable、start、status、disable 和卸载；
- unit 名称由项目稳定 ID 派生并严格过滤。

部署结果返回已写文件、unit/script 状态和错误详情。任何部分失败都执行可安全回滚的清理。

## 摄像头预览

预览是独立 capability，不嵌入普通 shell 文本协议。

后端按顺序探测：

1. Raspberry Pi `rpicam`/libcamera 工具；
2. V4L2 + FFmpeg；
3. 已安装的 Python OpenCV。

不自动安装依赖。没有受支持后端时，Preview 按钮禁用并显示探测结果。

### SSH 预览

使用独立 SSH channel 输出 MJPEG/JPEG 二进制流。Electron 解析 JPEG 边界并继续复用现有 `frame` IPC 事件。预览停止只终止预览进程组，不影响用户脚本。

### 串口预览

helper 捕获 JPEG 后通过 preview frame 发送。默认使用低分辨率和低帧率，并实施：

- 最大 frame 大小；
- 每秒字节预算；
- 只保留最新待发送帧；
- terminal/control frame 优先；
- 超出预算时丢帧而不是阻塞程序输出。

Preview UI 继续显示最近帧，但应展示当前实际分辨率、帧率和降级提示。

## 错误模型

统一错误码至少包括：

- `RUNTIME_UNAVAILABLE`
- `INVALID_ENDPOINT`
- `AUTH_FAILED`
- `HOST_KEY_CHANGED`
- `SHELL_NOT_DETECTED`
- `PYTHON3_NOT_FOUND`
- `CAPABILITY_UNAVAILABLE`
- `SESSION_CLOSED`
- `RUN_ALREADY_ACTIVE`
- `RUN_START_FAILED`
- `RUN_STOP_FAILED`
- `FILE_TRANSFER_FAILED`
- `AUTOSTART_PERMISSION_DENIED`
- `PREVIEW_UNAVAILABLE`
- `PROTOCOL_DESYNC`

日志不得包含密码、私钥内容、口令或完整认证对象。用户可见错误包含失败阶段和建议动作；底层堆栈只进入诊断日志。

## 测试策略

所有实现遵循先写失败测试、再写最小实现、最后重构。

### Electron 单元测试

- Runtime Broker 路由、session/owner 隔离和资源释放。
- SSH 认证、host key、PTY、输入、resize、输出、断线和重连。
- SSH launcher 的 `python3 -u`、PID/PGID、TERM/KILL 和命令注入防护。
- SFTP 全部文件操作及标准库降级。
- 串口 discovery、prompt、bootstrap、framing、拆包、粘包、噪声和重同步。
- 串口 helper 的 PTY、输入、resize、运行状态和进程组停止。
- 文件 ACK、重试、校验、二进制、空文件、大文件限制和原子替换。
- systemd 和 `/boot/start` 部署、更新、查询、卸载和失败回滚。
- SSH/串口预览帧解析、限流、丢帧和独立停止。

### Angular 单元测试

- 两个 adapter 注册及 metadata 校验。
- endpoint、capability 和 session 状态。
- 旧会话结果隔离。
- SSH 配置界面。
- 文件、自启动和预览 capability gating。
- CyberCAM 原有 adapter 行为不变。

### E2E

- 假 SSH server：连接、运行、输出、输入、resize、停止、文件和预览。
- 模拟串口 Linux peer：shell 探测、helper bootstrap、运行、输出、文件、停止和协议恢复。
- 现有 CyberCAM E2E 全量回归。

### 实机验收

Raspberry Pi：

- SSH 登录和 host key；
- `python3 -u` 实时输出；
- PTY 输入和 resize；
- 进程组停止；
- 文件 CRUD；
- systemd 安装、启动、重启后运行和卸载；
- 摄像头预览。

独立 WalnutPi：

- 优先完成 SSH 全流程；
- 使用 USB SERIAL-A/115200 再完成串口 shell 全流程；
- `/boot/start/*.sh` 安装、重启后运行和卸载；
- 板载摄像头预览。

所有实机测试使用独立标识目录和 unit/script，结束后清理，不覆盖用户现有程序。

## 交付顺序

1. Runtime Broker、IPC context 和 CanMV 回归。
2. `linux-ssh` 连接、PTY、运行、停止和文件。
3. `linux-serial-shell` transport、helper、运行、停止和文件。
4. systemd 与 `/boot/start` 自启动。
5. SSH 与串口摄像头预览。
6. Angular 连接与 capability UI。
7. 自动化回归、Windows 开发版启动。
8. Raspberry Pi 与 WalnutPi 实机验收。

