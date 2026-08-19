# SSH Linux Runtime 审查修复进度交接

日期：2026-08-19

分支：`codex/cybercam-main-integration`

状态：5 项审查修复均已完成并经过新鲜测试；代码仍未提交、未推送。2026-08-20 又用真实 WalnutPi SSH 修了 `setsid` EPERM、SFTP 覆盖 rename 和递归工作区创建。

## 交接结论

已完成并验证全部 5 项：

1. SSH 文件传输 ACK/NACK 身份隔离。
2. capability probe 获取并统一使用实际 Python 绝对路径。
3. `runScript` 与 `startPreview` 启动互斥及失败后的 sentinel 清理。
4. systemd 安装失败回滚。
5. `JsonKnownHostStore` 并发写串行化。

主体实现已随 `a150d7e4` 提交；本审查交接文件本身未单独推送。

## 已修改文件

本轮审查修复涉及：

- `electron/python-runtime/linux-shared/endpoint.js`
- `electron/python-runtime/linux-ssh/driver.js`
- `electron/test/linux-shared.test.js`
- `electron/test/linux-ssh-driver.test.js`

注意：工作区在本任务开始前已经存在大量其他用户改动和未跟踪文件，本轮未重置、删除或覆盖这些既有改动。

## 已完成内容

### 1. ACK/NACK 传输响应隔离

已为 SSH fallback 文件传输加入：

- transfer ID；
- chunk ID；
- attempt 编号；
- Python helper 与 JavaScript 端双向回显和校验；
- 丢弃迟到 ACK/NACK、跨块 ACK 以及身份不匹配的响应。

已覆盖：

- 超时后的迟到 NACK；
- 连续迟到 ACK；
- 前一块 ACK 污染下一块。

### 2. Python 解释器路径统一

已完成：

- capability probe 使用 `command -v python3`；
- 严格验证探测结果为绝对 POSIX 路径；
- `status.capabilities.pythonExecutable` 保存探测路径；
- run launcher 使用探测路径；
- stop helper 使用探测路径；
- preview wrapper 及 OpenCV helper 使用探测路径；
- SSH 文件 helper 使用探测路径；
- systemd unit 与 boot-start 脚本使用探测路径；
- 禁止运行链路继续硬编码 `/usr/bin/python3`。

共享 `createLaunchPlan()` 现在要求传入严格绝对 POSIX Python 路径，并拒绝裸 `python3` 以及包含 `..` 的路径。

### 3. run/preview 启动互斥

已完成：

- 增加 run 启动 sentinel；
- 并发第二次 run 在远端启动前返回 `RUN_ALREADY_ACTIVE`；
- 增加 preview 启动 sentinel；
- 并发 preview 请求复用同一个启动 Promise；
- run/preview 启动成功或失败后均清理 sentinel；
- 启动失败后允许再次重试。

## 第 4、5 项完成记录

### 4. systemd 安装失败回滚

已添加 RED 测试并实现：`enable --now` 失败后只回滚当前 `aily-<project>.service`，依次执行 `disable --now`、删除 unit、删除临时文件、`daemon-reload`。任一步失败也继续后续回滚，最终仍抛出原始 `AUTOSTART_PERMISSION_DENIED`。

### 5. JsonKnownHostStore 并发写串行化

已将实例内完整 read-modify-write 串行化。一次失败会从队列中清除，不会永久毒化后续写。Windows 上覆盖已有文件时，对 `rename` 的 `EPERM`/`EEXIST` 做删除后重试。

## TDD 测试记录

### 第 1 项：ACK/NACK 身份隔离

RED：

```powershell
node --test --test-name-pattern="timed-out chunk NACK|consecutive late ACKs|prior chunk ACK" electron/test/linux-ssh-driver.test.js
```

结果：3 条失败，符合预期暴露旧实现问题。

GREEN：

```powershell
node --test electron/test/linux-ssh-driver.test.js
```

结果：11/11 通过。

### 第 2 项：Python 解释器路径

RED：

```powershell
node --test electron/test/linux-shared.test.js electron/test/linux-ssh-driver.test.js
```

结果：21 条中 17 条通过、4 条失败，失败集中在 launcher、capability 保存、文件 helper 和自启动路径。

GREEN：

同一命令重新运行后：21/21 通过。

### 第 3 项：run/preview 并发启动互斥

RED：

```powershell
node --test --test-name-pattern="concurrent run start|run-start sentinel|concurrent preview starts|preview-start sentinel" electron/test/linux-ssh-driver.test.js
```

结果：4/4 失败，符合预期暴露启动竞态。

GREEN：

```powershell
node --test --test-name-pattern="concurrent run start|run-start sentinel|concurrent preview starts|preview-start sentinel" electron/test/linux-ssh-driver.test.js
node --test electron/test/linux-ssh-driver.test.js electron/test/linux-shared.test.js
```

结果：

- 定向并发测试：4/4 通过；
- SSH driver + shared 回归：25/25 通过。

## 最后一次测试结果

最后一次运行的命令是：

```powershell
node --test electron/test/linux-ssh-driver.test.js electron/test/linux-shared.test.js
```

结果：25/25 通过，0 失败，0 取消。

这次测试覆盖已完成的第 1–3 项，但不代表第 4、5 项已经完成。

## 继续开发建议

从第 4 项开始严格继续 RED→GREEN：

1. 在 `electron/test/linux-ssh-driver.test.js` 或 `electron/test/linux-autostart.test.js` 加 systemd 安装失败注入测试；
2. 运行测试确认旧实现 RED；
3. 仅修改 `electron/python-runtime/linux-ssh/driver.js`，实现受管 unit 的 best-effort 回滚；
4. 再为 `JsonKnownHostStore` 添加并发首次写测试；
5. 运行 RED 后仅修改 `driver.js` 实现串行化；
6. 最后运行限定完整回归、Node 语法检查、`git diff --check` 和工作区范围核对。

## Git 状态

- 未提交。
- 未推送。
- 不应使用 `git reset --hard` 或其他会覆盖既有用户改动的操作。
