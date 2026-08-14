# CyberCAM Python Blockly 开发续接检查点

生成时间：2026-08-14（Asia/Shanghai）

## 目标与当前结论

目标是交付完整 CyberCAM Python 积木能力，包括摄像头、屏幕/图像、AI/KPU、GPIO/PWM/UART、网络、文件、音频、IMU 和系统能力，并让 Aily Blockly 支持 CanMV K230 的 Python 项目生成、运行、终端、远端文件和摄像头预览。

相关代码已提交并推送到 `vonweller` GitHub 仓库。下一台电脑应以 `codex/cybercam-main-integration` 作为主应用的可测试交付分支。`codex/python-runtime-foundation` 是同一功能的分步开发线，保留用于追溯和对照，不要直接叠加合并到最终集成分支。

## 已推送仓库与精确提交

| 范围 | 仓库 | 分支 | 功能实现提交/基线 |
| --- | --- | --- | --- |
| 主应用最终集成 | `https://github.com/vonweller/aily-blockly.git` | `codex/cybercam-main-integration` | `7c691649b848c3ec08f83f83d167ce400733d79f`（handoff 文档在后续提交） |
| 主应用分步开发线 | `https://github.com/vonweller/aily-blockly.git` | `codex/python-runtime-foundation` | `88d6f84787c499fa11733f46d03fd14e93be8667` |
| CyberCAM 主板包 | `https://github.com/vonweller/aily-blockly-boards.git` | `codex/cybercam-python-board` | `8a4e81b2e73a988170250fabedfe4e74e9e0370c` |
| CyberCAM 完整积木库 | `https://github.com/vonweller/aily-blockly-libraries.git` | `codex/cybercam-python-blocks` | `694d358289ff79d0e9bb7b5146e469c681ba1c87` |

推送后已用 `git ls-remote --heads origin <branch>` 对账，四个分支的本地 SHA 与远端 SHA 全部一致。

## 新电脑建议目录与拉取命令

三个仓库保持同级目录：

```text
Aily/
├── aily-blockly/
├── aily-blockly-boards/
└── aily-blockly-libraries/
```

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

git -C aily-blockly rev-parse HEAD
git -C aily-blockly-boards rev-parse HEAD
git -C aily-blockly-libraries rev-parse HEAD
```

主应用安装依赖：

```powershell
Set-Location aily-blockly
npm ci
```

## 已完成能力

- CyberCAM 主板包：Python-only 项目模式、`canmv-k230` 运行时元数据、`main.py` 入口、模板、USB 识别信息、板载能力说明与图片授权。
- CyberCAM 积木库：自包含 Python 基础积木，以及摄像头、显示/图像、二维码/条码/AprilTag、14 类已验证 KPU 模型、AI 结果、GPIO、PWM、UART、Socket、MQTT、HTTP、文件、音频、QMI8658 IMU、CPU 温度与芯片 ID。
- 主应用：按主板元数据识别 Python 项目，生成并保存 `main.py`，绕开 Arduino 预处理和固件上传；支持运行/停止、终端、远端文件、摄像头帧、后端状态和资源清理。
- 桌面打包：内置六个平台架构的 CanMV 后端资源及许可文件，运行时按平台解析并延迟启动。
- 自动化：Electron 单元测试、Angular 专项测试、Electron E2E、打包资源检查和硬件冒烟文档。

详细设计和实施计划不要复制维护，直接查看最终集成分支中的：

- `docs/superpowers/specs/2026-08-11-cybercam-python-blockly-design.md`
- `docs/superpowers/plans/2026-08-11-cybercam-python-blockly.md`
- `docs/cybercam-hardware-smoke-test.md`
- 积木覆盖清单：相邻积木库的 `cybercam/API-COVERAGE.md`

## 最近一次验证证据

在提交 `7c691649` 和上述两个子仓库提交上执行：

- `aily-blockly-boards/cybercam`: `npm test`，主板包契约与合规检查全部通过。
- `aily-blockly-libraries/cybercam`: `npm test`，25/25 通过。
- 主应用 Electron/CanMV/Python wiring：26/26 通过。
- 主应用 Angular Python/Blockly 专项：69/69 通过。
- `npx tsc -p e2e/tsconfig.json --noEmit`：通过。
- `npm run test:e2e:fast -- --grep "CyberCAM"`：通过，退出码 0。
- `npx ng build --configuration development`：通过，退出码 0。
- `git diff --check`：通过。

测试机没有 Google Chrome；Angular Karma 测试使用 Edge：

```powershell
$env:CHROME_BIN='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npx ng test --watch=false --browsers=ChromeHeadless `
  --include 'src/app/services/python-runtime/*.spec.ts' `
  --include 'src/app/editors/blockly-editor/**/*.spec.ts'
```

## 下一步优先事项

1. 用真实 CyberCAM 按 `docs/cybercam-hardware-smoke-test.md` 完成 USB 检测、连接、运行/停止、终端、文件、预览与断线恢复测试。
2. 在实际固件上分别验证摄像头、屏幕、KPU、GPIO/PWM/UART、MQTT/HTTP、音频和 IMU 生成代码；记录固件/API 差异，不要凭猜测扩展 API。
3. 若要合入默认分支，先同步目标仓库最新默认分支并处理冲突，再在合并结果上重跑上述验证。当前只推送了功能分支，没有创建 PR。
4. 如果需要发版，确认主板包 `1.1.0` 与积木库 `1.0.0` 的发布流程和仓库 CI，再发布包版本。

## 已知残余风险与注意事项

- 尚未在真实 CyberCAM 硬件上执行测试；自动化使用 Fake CanMV backend。
- 主应用最终集成分支和 `codex/python-runtime-foundation` 有重叠实现，后续开发只选一条线；默认选最终集成分支。
- 本机没有 `gh` CLI，因此未自动创建 PR。
- 原积木库工作区存在未提交且与 CyberCAM 无关的 `.baoyu-skills/baoyu-translate/EXTEND.md` 删除，以及本地 `.learnings/`；它们没有被提交或推送。新电脑不需要复制这些状态。
- 最终独立审查 Agent 未在超时前返回；已做本地聚焦复核，未发现阻断项。真实硬件测试仍是最终质量门槛。

## Suggested skills

新会话建议依次调用：

- `using-superpowers`：先确定适用流程。
- `executing-plans`：继续执行现有 CyberCAM 计划和硬件检查点。
- `systematic-debugging`：处理真实设备、串口、后端或生成代码失败。
- `test-driven-development`：修复任何硬件/API 差异时先补回归测试。
- `verification-before-completion`：每次声称修复或可发布前重跑完整验证。
- `requesting-code-review`：准备合入默认分支或发版前做最终审查。
- `finishing-a-development-branch`：验证通过后选择 PR、合并或保留分支。

## 给下一位 Agent 的启动提示

```text
请先读取这份 handoff，然后在三个同级仓库中核对四个远端 SHA。主应用以 codex/cybercam-main-integration 为唯一继续开发基线，不要叠加合并 codex/python-runtime-foundation。先重跑自动化，再按 docs/cybercam-hardware-smoke-test.md 进行真实 CyberCAM 验证；发现问题时补回归测试并提交到对应 codex/* 分支。
```
