# Python 板卡运行与部署兼容性

更新时间：2026-08-20（Asia/Shanghai）

不同 Linux/Python 板卡不能仅凭“能运行 Python”共用同一个连接适配器。项目通过板卡 `runtime.adapter` 和连接后的 capability probe 明确协议边界，避免把串口误认为 REPL、把 SSH 误认为必然支持 SFTP，或把所有 Linux 系统都当成 `/boot/start`。

## 当前兼容矩阵

“已实现”只表示代码和自动化证据存在，不等于已在对应物理设备验收。

| 平台 / 连接方式 | Adapter | 已实现的自动化支持 | 自动化证据边界 | 真实设备验证 |
| --- | --- | --- | --- | --- |
| CyberCAM K230 / USBDBG | `canmv-k230` | 发现、连接、`runScript`、输出/状态、REPL 输入、停止、CanMV IO、预览、`/boot/start/*.sh` | Electron/Angular/E2E 回归和真实 COM9 冒烟脚本 | 2026-08-14 已完成基础真实设备冒烟；GPIO、摄像头、显示、音频、IMU、网络和 KPU 仍需专项验收 |
| 树莓派 Linux / SSH | `linux-ssh` | SSH 表单、TOFU 主机密钥、PTY、`python3 -u`、输出/输入/resize、token+starttime 校验的进程组停止、SFTP/原子写、systemd、JPEG 预览 | 确定性 fake peer 运行在真实 `LinuxSshDriver` 的 `clientFactory`/SFTP seam；没有网络监听器；UI E2E 使用 fake IPC | **BLOCKED — hardware/credential unavailable** |
| 核桃派 Linux / SSH | `linux-ssh` | 与树莓派共用 SSH 驱动；capability probe 可选择 `boot-start-sh`、systemd、SFTP 或 helper fallback | 当前 fake SSH 集成固定验证 Raspberry Pi 风格的 systemd/SFTP 能力，不证明核桃派镜像的 SSH 服务、权限或 `/boot/start` 行为 | **2026-08-20 PARTIAL PASS** — WalnutPi-2b `192.168.10.103` 已完成连接、PTY、SFTP、`/boot/start` 和停止；Preview 因 `/dev/video0` 读帧超时未拿到 JPEG |
| 独立核桃派 Linux / SERIAL-A shell | `linux-serial-shell` | shell 验证、helper bootstrap、`python3 -u`、分帧输出/输入/resize、token+starttime 停止、带 CRC/SHA/retry 的原子文件传输、`/boot/start/aily-*.sh`、JPEG 预览与丢帧控制、helper 清理 | 确定性 noisy/fragmented fake serial peer 运行在真实 serial driver/protocol seam；UI E2E 使用 fake IPC | **BLOCKED — hardware/credential unavailable** |

真实设备验收步骤和证据模板见 `docs/linux-python-runtime-hardware-acceptance.md`。

## Linux 运行数据流

```text
Blockly → main.py → contextual runtime IPC → runtime broker
                                           ├─ linux-ssh
                                           │  ├─ SSH PTY → python3 -u
                                           │  ├─ SFTP / atomic helper
                                           │  ├─ safe PGID stop
                                           │  ├─ systemd 或 /boot/start
                                           │  └─ JPEG stream
                                           └─ linux-serial-shell
                                              ├─ shell verification/bootstrap
                                              ├─ framed helper → python3 -u
                                              ├─ CRC/SHA file protocol
                                              ├─ token/starttime stop
                                              ├─ /boot/start
                                              └─ rate-limited JPEG frames
```

Linux adapter 的终端是 PTY 语义，stdout/stderr 通常合并回传。停止操作不会按裸 PID 或未经核验的 PGID 发信号：SSH 端读取控制文件并核对 token 与 `/proc/<pid>/stat` starttime；串口 helper 同样核对当前 run、token 和 starttime 后才停止进程组。

## CyberCAM 数据流保持不变

```text
Blockly → main.py → CanMV backend runScript
                    ├─ scriptOutput → 界面终端
                    ├─ scriptState  → 运行/停止状态
                    ├─ frame        → 摄像头预览
                    └─ io.*         → 远程文件面板
```

CyberCAM 仍使用原有板卡选择和连接表单。Linux runtime 使用带 adapter/session context 的 IPC，不把 SSH 或 serial-shell 状态混入 CyberCAM 会话。

## 能力和部署约束

- `linux-ssh` 只有在 capability probe 确认后才开放文件、自启动和预览；SSH 登录成功不代表 SFTP、无密码 `sudo -n`、systemd 或摄像头工具可用。
- systemd 安装需要目标用户能够对受管 unit 执行 `sudo -n`；权限不足时必须返回明确错误，不能弹出或保存 sudo 密码。
- `linux-serial-shell` 只应连接用户明确选择的 Linux shell 串口。枚举到串口不代表它是核桃派，也不授权打开其他端口。
- serial helper 是会话级临时文件；正常断开会请求 helper 停止并删除自身。异常断电后的残留路径必须按硬件验收文档人工核对。
- `/boot/start/aily-*.sh` 和 `/etc/systemd/system/aily-*.service` 是 Aily 受管命名空间；不得删除其他启动项或服务。
- PTY 通常合并 stdout/stderr，不能承诺始终分离两条流。
- 自动化 fake-peer、fake IPC 和 TypeScript 编译都不是物理树莓派或独立核桃派的验收证据。

## 板卡包与积木库边界

“能跑 Python”不等于共用同一套硬件积木。板卡包决定 runtime adapter；积木库按真实 Python API 拆分。

| 包 | 用途 | 过滤 |
| --- | --- | --- |
| `@aily-project/board-cybercam` | CyberCAM K230，`canmv-k230` | `type: python:k230:cybercam` |
| `@aily-project/board-raspberrypi` | 树莓派 Linux，`linux-ssh` | `type: linux:python:raspberrypi` |
| `@aily-project/board-walnutpi` | 独立核桃派 Linux SSH，`linux-ssh` | `type: linux:python:walnutpi` |
| `@aily-project/board-walnutpi_serial` | 独立核桃派 SERIAL-A，`linux-serial-shell` | `type: linux:python:walnutpi-serial` |
| `@aily-project/lib-python-core` | 可移植 CPython：语言、OpenCV、码识别、网络、文件 | `spec: true`，四个 Python 板 `type` |
| `@aily-project/lib-linux-python` | gpiozero / pyserial / `cv2.VideoCapture` / ALSA | `spec: true`，仅三个 Linux `type` |
| `@aily-project/lib-cybercam` | CanMV/`walnutpi`/`kpu`/`digitalio` 硬件，并自包含可移植积木 | `spec: true`，仅 CyberCAM |

CyberCAM 模板继续只依赖 `board-cybercam` + `lib-cybercam`，避免拆坏现有项目。Linux 模板依赖 `lib-python-core` + `lib-linux-python`，禁止依赖 `lib-cybercam`。

`raspberrypi_pico` 仍是 RP2040 Arduino 板，不是这套 Linux Python 运行时。

## 本地开发覆盖

正式产品列表仍然以远程 `boards.json` 为准。开发版之所以现在能看到 Raspberry Pi Linux、WalnutPi、WalnutPi Serial 和 CyberCAM，是因为应用从 Electron 目录解析兄弟仓库，把未发布包叠进内存中的板卡列表：

```text
<repo>/aily-blockly/electron
<repo>/aily-blockly-linux-boards/{cybercam,raspberrypi,walnutpi,walnutpi_serial}
<repo>/aily-blockly-linux-libraries/{cybercam,python-core,linux-python}
```

Python 板卡和积木优先读专用仓库 [aily-blockly-linux-boards](https://github.com/ailyProject/aily-blockly-linux-boards) 与 [aily-blockly-linux-libraries](https://github.com/ailyProject/aily-blockly-linux-libraries)。原来的 `aily-blockly-boards` / `aily-blockly-libraries` 仍可作为回退。

`localSource` 只留在内存，不写回 `boards.json` 缓存。本地板卡图走应用 `public/imgs/boards/`，品牌 logo 走 `public/brands/`，不会去远程 CDN 找还没上传的 `raspberrypi.webp`。

从这些板卡创建项目时：

- Linux 板复制本地板卡模板 + `lib-python-core` + `lib-linux-python`
- CyberCAM 复制本地板卡模板 + `lib-cybercam`
- 不会对未发布包执行 `npm install` / `npm view`

路径必须是兄弟仓库内的绝对路径。

要让正式安装包也能选这些板，还需要三件事一起发布：

1. npm 包：`@aily-project/board-*` 和对应积木库
2. 远程资源站 `boards.json` 增加目录条目
3. 远程 `imgs/boards/` 放同名 `webp`

待发布目录条目在 `docs/catalog-snippets/python-linux-boards.json`。

离线脚本仍可用：

```powershell
npm run create:linux-project -- --board raspberrypi --name "Raspberry Pi Starter"
npm run create:linux-project -- --board walnutpi --name "WalnutPi Starter"
npm run create:linux-project -- --board walnutpi_serial --name "WalnutPi Serial Starter"
```
