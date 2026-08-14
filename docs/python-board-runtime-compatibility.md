# Python 板卡运行与部署兼容性

不同 Linux/Python 板卡不能仅凭“能运行 Python”共用同一个连接适配器。项目通过板卡 `runtime.execution` 和 `runtime.deployment` 元数据明确描述协议边界，避免把串口误认为 REPL、把 SSH 误认为必然支持 SFTP，或把所有系统都当成 `/boot/start`。

## Profile 字段

`execution` 描述即时运行：

- `transport`：`canmv-usbdbg`、`serial-shell` 或 `ssh`；
- `output`：结构化 `event-stream` 或 PTY 合并输出；
- `input`：设备 `repl` 或 shell `pty`；
- `stop`：设备中断或远端进程组；
- `files`：CanMV IO、明确实现的串口传输或 SFTP；
- `temporaryRun`：是否支持不安装为系统服务的临时运行。

`deployment.autostart` 描述开机运行：

- `boot-start-sh`：系统执行指定目录中的 `.sh`；
- `systemd`：安装和管理 systemd unit。

元数据只描述能力，不会自动注册尚不存在的 adapter。

## 当前兼容矩阵

| 平台 | Adapter 状态 | 即时运行 | 输出与输入 | 停止 | 文件 | 自启动 |
| --- | --- | --- | --- | --- | --- | --- |
| CyberCAM K230 | `canmv-k230` 已实现 | CanMV USBDBG `runScript` | `scriptOutput`/`scriptState` 事件；REPL 输入 | 设备中断 | CanMV IO | `/boot/start/*.sh`，长任务末尾加 `&` |
| 核桃派 Linux | serial/SSH shell 待实现 | 计划使用 `python3 -u` | PTY 合并输出；PTY 输入 | PID/进程组 | 必须由具体协议确认，或 SFTP | `/boot/start/*.sh`，长任务末尾加 `&` |
| 树莓派 Linux | SSH adapter 待实现 | 计划使用 `python3 -u` | SSH PTY 合并输出；PTY 输入 | PID/进程组 | SCP/SFTP，需连接能力确认 | systemd |

## CyberCAM 已实现的数据流

```text
Blockly → main.py → CanMV backend runScript
                    ├─ scriptOutput → 界面终端
                    ├─ scriptState  → 运行/停止状态
                    ├─ frame        → 摄像头预览
                    └─ io.*         → 远程文件面板
```

Python Device 面板激活时会初始化 backend 并自动执行设备扫描。检测到板卡后预选第一项；用户连接后才能运行、停止、输入、预览和访问远程文件。

## 设计约束

- PTY 通常合并 stdout/stderr，不能承诺始终分离两条流。
- SSH 连接成功不代表目标端启用了 SFTP/SCP。
- 串口枚举成功不代表目标端提供可交互 Python REPL 或文件传输协议。
- CanMV 的远程执行语义不能直接等同于 Linux 上可追踪 PID 的进程。
- 树莓派不应使用 CyberCAM/核桃派的 `/boot/start` 约定。
- 在对应 adapter、回归测试和真实设备证据完成前，不得宣称核桃派或树莓派已可用。
