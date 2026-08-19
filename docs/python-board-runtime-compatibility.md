# Python 板卡运行与部署兼容性

更新时间：2026-08-18（Asia/Shanghai）

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
