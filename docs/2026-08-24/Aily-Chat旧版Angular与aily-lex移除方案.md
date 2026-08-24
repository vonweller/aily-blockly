# Aily Chat 旧版 Angular 与 `aily-lex` 移除方案

日期：2026-08-24
状态：阶段 A 与非 E2E 单测清理已实施，阶段 B～D 待执行
范围：`aily--blockly` 主软件、`aily-lex-pro/packages/aily-chat` 新版子应用

## 1. 结论

主软件中的 Aily Chat UI 已可以只保留新版 React 子应用。旧 Angular UI 不再承担回退职责，也不应继续作为 `/aily-chat`、右侧工具栏或独立窗口的可达入口。

本次已完成第一阶段切换：

- `aily-chat` 工具 ID 强制进入通用 `ChildToolHostComponent`；
- `/aily-chat` 兼容地址重定向到 `/child-tool/aily-chat`；
- 删除旧 `AilyChatComponent` 的 TS、HTML、SCSS；
- 删除只服务于早期 React Child 协议的 `AilyChatChildProtocolService`；
- 删除 160 个旧 Angular 展示层文件，包括旧消息 Viewer、设置页、会话列表、调试页、动态渲染指令等；
- 将仍被新版宿主使用的 Subapp Activity Dock、认证快照类型和 Mermaid 弹窗迁出 `tools/aily-chat`；
- 新增主链守卫，禁止旧组件或旧协议重新接回应用 Shell。
- 按当前仓库策略删除根 `e2e/` 外的单元测试、Karma/Jasmine 配置与依赖，只保留 Playwright E2E。

但是，`aily-lex` 还不能在同一个提交中直接从依赖中删除。当前仍存在一条独立于旧 UI 的兼容执行链：

```text
Angular App Initializer
  -> ChatRuntimeHostBootstrapService
  -> Electron chat-runtime-host
  -> chat-runtime-lex-execution-runtime
  -> aily-lex
```

这条链还被 Simulator 场景代码协调、项目场景提案、部分 Blockly 宿主工具和旧会话运行态清理逻辑使用。直接删除会造成非 Chat 页面功能回归。因此应先迁移这些调用方，再删除 `aily-lex` 和 Electron 兼容宿主。

## 2. 目标架构

```text
主软件 Angular
├── 子应用安装、升级、进程和窗口生命周期
├── token-free 认证状态、项目上下文、主题和宿主能力
├── Blockly/Simulator/Builder 的产品能力适配器
└── ChildToolHost + Penpal/Node IPC
      │
      ▼
@aily-project/subapp-aily-chat
├── React UI
├── Aily Chat Node Server
└── @aily-project/aily-agent + Pi
    ├── session / model / permission / settings
    ├── prompt / stream / tools / subagent
    └── JSONL 和运行时状态
```

边界规则：

1. Chat UI、会话、模型、权限、流式消息和 Agent 运行时只由新版子应用拥有。
2. Angular 主软件只提供宿主能力，不维护第二套 Chat 会话模型。
3. 主软件传给子应用的是 token-free 认证状态；真实凭证继续由宿主/Node 进程持有。
4. Blockly、Simulator、Builder 的能力应放在产品集成目录或通用宿主桥中，不再放在 `tools/aily-chat` 名下。
5. 后台 Agent 应复用新版 `@aily-project/aily-agent` 或子应用 Agent RPC，不再启动 `aily-lex` 兼容运行时。

## 3. 当前代码审计

### 3.1 新版主链

| 层 | 当前入口 | 结论 |
| --- | --- | --- |
| 默认安装 | `src/app/services/default-aily-chat-bootstrap.ts` | 安装并固定 `aily-chat` 子应用，是正式入口 |
| 工具宿主 | `src/app/tools/child-tool-host/child-tool-host.component.ts` | 负责 iframe、Penpal、进程、认证状态、关闭握手 |
| 子应用包 | `aily-lex-pro/packages/aily-chat` | 当前 React/Node 实现 |
| Agent | `aily-lex-pro/packages/aily-agent` | 新版运行时和 Blockly 能力实现 |
| 发布包名 | `@aily-project/subapp-aily-chat` | 主软件通过 Subapp Catalog 安装 |

新版 UI 的 `invoke()` 在自身 `ui-model/actions.ts` 内直接调用 Agent session store，并不调用 Angular 的 `AilyChatChildProtocolService`。因此旧 Child 协议可以删除。

### 3.2 已退休的旧 UI 主链

```text
MainWindow <app-aily-chat>
  -> AilyChatComponent
  -> AILY_CHAT_VIEW_PROVIDERS
  -> ChatEngineService
  -> AilyChatChildProtocolService
  -> aily-lex/browser
```

此路径已从应用 Shell、路由和源码入口中移除。`scripts/guard-aily-chat-mainline.js` 会阻止以下回归：

- 重新引入 `AilyChatComponent`；
- 重新引入 `AilyChatChildProtocolService`；
- 重新注册 `AILY_CHAT_VIEW_PROVIDERS`；
- 在主窗口重新渲染 `<app-aily-chat>`；
- 将 `/aily-chat` 从新版子应用重定向改回旧组件。

### 3.3 旧目录中仍存活的内容

当前 `src/app/tools/aily-chat` 仍约 11 MiB、404 个文件，并有 112 个生产文件、161 处导入直接依赖 `aily-lex` 或其子路径。它已不再等同于“旧 Aily Chat UI”，而是混合了以下四类内容：

| 类别 | 示例 | 处理方式 |
| --- | --- | --- |
| 旧 `aily-lex` 运行时适配 | `helpers/lex-*`、`services/chat-runtime-owner-*` | 阶段 C 替换后删除 |
| Blockly 产品能力 | `tools/atomicBlockTools.ts`、`tools/syncAbsFileTool.ts`、`tools/abiAbsConverter.ts` | 阶段 B 迁到 Blockly 集成层 |
| Simulator/场景 Agent 协议 | `core/project-scene-proposal-*`、`core/scene-code-reconciliation-*` | 阶段 C 改接新版 Agent |
| 少量共享兼容状态 | session inventory、edit checkpoint、quota state | 逐个确认调用方后迁出或删除 |

目录名已经不能代表真实职责，是后续误删风险的主要来源。

## 4. 移除清单

### 4.1 可直接移除，已完成

| 内容 | 原因 | 状态 |
| --- | --- | --- |
| `aily-chat.component.ts/html/scss` | 新版子应用已是唯一 UI，旧入口无保留价值 | 已删除 |
| `AilyChatChildProtocolService` | 新版 UI 使用自身 Agent store/HTTP/WS，不消费该协议 | 已删除 |
| 主窗口 `<app-aily-chat>` 分支 | 会造成安装状态竞态时回退旧 UI | 已删除 |
| `AILY_CHAT_VIEW_PROVIDERS` | 只服务旧组件和旧 Child 协议 | 已删除 |
| `/aily-chat` 旧路由 | 保留地址兼容，但目标改为新版子应用 | 已重定向 |
| `/aily-chat-process-detail/...` | 旧 Angular 进程详情窗口，新 UI 已有自己的详情展示 | 已删除 |
| 旧 Viewer、会话、设置、调试、动态渲染组件 | 旧入口删除后不再进入生产编译图 | 已删除 |
| 根 `e2e/` 外的单元测试与专项 spec 配置 | 当前策略仅保留可重建的 Playwright E2E | 已删除，Karma/Jasmine 依赖与非 E2E test scripts 同步移除 |

### 4.2 已解耦并迁出旧目录

| 能力 | 新位置 | 原因 |
| --- | --- | --- |
| Subapp Activity Dock | `src/app/components/subapp-activity-dock` | 属于通用子应用宿主，不属于旧 Chat UI |
| Mermaid 预览弹窗 | `src/app/components/mermaid` | Blockly、Schematic 和兼容渲染共同使用 |
| 认证快照类型 | `src/app/services/auth-snapshot.ts` | 属于宿主认证边界，不属于 Chat 内部模型 |

### 4.3 迁移后可移除

| 当前内容 | 当前调用方 | 目标位置/替代方案 | 删除门槛 |
| --- | --- | --- | --- |
| `components/chat-delete-dialog`、`chat-rename-dialog` | `ChatSessionActionsService` | 新版 React 会话动作 | 旧 session action service 无生产调用 |
| `components/memory/project-related-file-*` | Blockly/Coder prompt profile、ResourceManager | `integrations/blockly/project-context` | prompt 和资源测试迁移完成 |
| `services/auth-quota-state.service.ts` | User Center、旧运行时 | 通用 account/usage service 或新版子应用 | User Center 不再引用旧目录 |
| `services/chat-perf-tracer.ts` | Blockly builder 和旧渲染 | 通用 performance tracer | Builder 改用通用接口 |
| `public-api.ts` 中 ABI/ABS 转换 | BlocklyService | `integrations/blockly/abs` | Blockly 转换测试保持通过 |
| `services/abs-auto-sync.service.ts` | Blockly/Simulator 宿主桥 | `integrations/blockly/abs-sync` | 新 Agent 和 Simulator 共用新端口 |
| `tools/*` 中宿主工具 | BlocklyLiveOperationBridge、Schematic、Simulator | `integrations/blockly/tools` | 子应用工具调用与手工操作均通过 |
| `core/host.ts`、`host-api.ts` | 多个主软件服务 | 通用 host capability ports | 所有外部 import 清零 |
| 旧 `i18n`、主题 Token、Tiktoken Worker/资产 | 旧显示/旧上下文预算 | 新版子应用自带 i18n 和预算 | Angular 构建不再引用资源 |

### 4.4 暂不能移除

| 内容 | 阻塞原因 |
| --- | --- |
| `package.json` / `package-lock.json` 中 `aily-lex` | Electron 兼容执行运行时仍直接 import |
| `electron/chat-runtime-lex-execution-runtime.mjs` 及 bundle | 打包脚本仍将其配置为 execution host |
| `electron/chat-runtime-host*.js`、execution host worker/controller | Simulator/场景 Agent 和旧宿主会话仍通过它调度 |
| `app.config.ts` 中 `AILY_CHAT_SHARED_PROVIDERS` / `AILY_CHAT_RUNTIME_OWNER_PROVIDERS` | ProjectService、资源操作和旧后台运行态仍有依赖 |
| `ChatRuntimeHostResourceOperationHandlerService` | 仍处理旧 execution host 到 Angular 的资源操作 |
| Project Scene Proposal / Scene Code Reconciliation Provider | 仍通过 `createElectronChatRuntimeHostTransport()` 发起 scoped Agent |
| `ProjectService -> ChatRuntimeHostInventoryService` | 仍用旧运行态判断项目是否有活跃会话 |

### 4.5 `aily-lex` 必须迁移的生产能力

以下是物理删除 `aily-lex` 前必须完成的工作包。并非旧目录中的 404 个文件都要搬迁：产品能力迁到通用集成层，运行时能力改接新版 Agent，纯兼容投影和重复实现直接删除。

| 工作包 | 当前生产链/文件 | 目标 | 完成标志 |
| --- | --- | --- | --- |
| M1 新版 scoped Agent RPC | `ProjectSceneProposalProviderService`、`SceneCodeReconciliationProviderService` 调用 `createElectronChatRuntimeHostTransport()` | 在 `packages/aily-chat` Agent Channel 增加 host-only `scoped.run` / `scoped.cancel`，内部使用 `@aily-project/aily-agent#createAilyHarness()` 和临时 Session | request ID、取消、超时、单结果提交语义保持一致 |
| M2 Project Scene Proposal | `core/project-scene-proposal-*`、`core/blockly-project-scene-tools.ts` | 调用 M1；DTO 迁到 `src/app/integrations/agent/project-scene` | 创建项目、生成场景提案、取消均不经过旧 runtime host |
| M3 Scene Code Reconciliation / Simulator | `core/scene-code-reconciliation-*`、Simulator reconciliation service/product port | 调用 M1；DTO 迁到 `src/app/integrations/simulator/scene-code` | 真实 Simulator 生成、候选校验、取消、构建通过 |
| M4 Blockly 宿主工具 | `tools/atomicBlockTools.ts`、`searchBoardsLibrariesTool.ts`、`buildProjectTool.ts`、`syncAbsFileTool.ts`、`editBlockTool.ts`、`connectionGraphTool.ts` | 工具实现迁到 `src/app/integrations/blockly/tools`；新版 Agent 继续通过 CLI Bridge、MCP、Penpal 或 `SubappAgentBridgeService` 调用 | `BlocklyLiveOperationBridgeService` 和 Schematic 不再 import `tools/aily-chat` |
| M5 ABS/ABI 与自动同步 | `public-api.ts`、`AbsAutoSyncService`、ABI/ABS converter | 迁到 `src/app/integrations/blockly/abs` | Blockly 打开、转换、同步、编译不依赖 Chat 目录 |
| M6 通用宿主端口 | `core/host.ts`、`host-api.ts`、`AilyHost`、编辑摘要和 performance tracer | 拆到通用 host capability、diff、performance 服务 | Coder diff、Builder、Schematic 外部 import 清零 |
| M7 会话/消息/流式模型 | `ChatEngineService`、`ChatHistoryService`、`TurnResponse*`、`RenderEvent*`、`helpers/lex-*`、runtime owner/store/projection | 不迁 Angular 会话模型；由新版 Aily Chat Server/Agent session snapshot、JSONL、事件流完全接管 | Angular 不再拥有 Chat session、turn、stream、interaction 状态 |
| M8 旧会话数据 | host session index/record/debug export、checkpoint、旧 snapshot restore | 制定一次性只读导入或明确归档策略，写入新版 Agent session 格式时保留原文件备份 | 旧用户会话可读取/迁移，且未静默丢失 |
| M9 生命周期与阻塞判断 | `ChatRuntimeHostInventoryService`、`ProjectService.hasBlockingChatRequest()`、升级/关闭处理 | 改读 `ChildToolProcessService`、ChildAppHostRegistry 和新版 Agent active-session 状态 | 项目关闭、软件升级、窗口关闭不再读取旧 inventory |
| M10 宿主资源操作 | `ChatRuntimeHostResourceOperationHandlerService`、旧 `subapp-agent`/文件/编辑/构建 operation | 将仍需要的操作收敛到通用 host RPC；删除已经由 CLI Bridge/MCP/SubappAgentBridge 覆盖的分支 | MainWindow 不再启动旧 resource handler |
| M11 认证、模型、额度与配置 | `AilyChatConfigService`、request quota、permission policy、model routing | 新版子应用继续消费 token-free host state；真实凭证由 Node/host auth IPC 持有；通用账号状态迁出 Chat 目录 | 无凭证进入 React，User Center 不依赖旧 Chat 服务 |
| M12 图片、编辑与交互 | image attachment/media store、external edit capture、approval/question/plan 兼容事件 | 使用新版 Agent attachment、tool event、permission/interaction 协议；本地文件操作保留 host allowlist | 图片、多模态、diff、审批、问题、计划真实流程通过 |
| M13 Prompt/工具/Agent 定义 | `blockly-*provider`、prompt profiles、slash command、subagent extension、tool catalog | 与 `packages/aily-agent/src/blockly` 做逐项去重；缺失能力补到新版 Agent，重复代码直接删除 | 新版 Agent 工具/技能/Prompt 清单覆盖产品需求，Angular 无 `aily-lex` 类型导入 |
| M14 Electron runtime host | `electron/chat-runtime-*`、execution host worker/controller、preload IPC、`window.js` 注册 | M1～M13 完成后整组删除，不再维护第二套 Agent 进程 | Electron 主进程无 `aily-chat-runtime-host-*` channel |
| M15 构建、依赖与资产 | `aily-lex` npm/lock、worker bundle、build metadata、clean/setup/run scripts、旧 Tiktoken/i18n | 删除依赖和兼容构建链；新版包自行携带运行时资源 | 源码、asar、dependency tree 均无 `aily-lex` |

## 5. 后续实施阶段

### 阶段 B：迁出产品能力，清空外部反向依赖

目标：`src/app` 其他模块不再从 `tools/aily-chat` import 通用能力。

建议顺序：

1. 将 ABI/ABS 转换迁到 `src/app/integrations/blockly/abs`。
2. 将 Blockly 编辑、构建、库搜索、同步工具迁到 `src/app/integrations/blockly/tools`。
3. 将 `AbsAutoSyncService` 迁到 Blockly 集成层，并保留单一实例。
4. 将 quota/account 状态迁到通用 account service。
5. 将 session-active 查询改为新版子应用进程/活动状态，不再读取旧 Host session inventory。
6. 删除剩余 Angular Chat 对话框、旧 session view/store 和旧显示辅助代码。

阶段 B 完成条件：

```bash
rg -n "tools/aily-chat" src/app -g '!tools/aily-chat/**'
```

除显式的临时兼容入口外应无结果，且每个临时入口必须在本文件中有负责人和删除条件。

### 阶段 C：替换旧后台 Agent 和 Electron Runtime Host

目标：Simulator 和主软件后台任务改用新版 `@aily-project/aily-agent` 能力。

推荐方案：

- 在新版 Aily Chat Agent Channel 增加 host-only `scoped.run` / `scoped.cancel` 命令，复用 `@aily-project/aily-agent` 的 `createAilyHarness()`、`AilySessionHandle.prompt()` 和内存 Session；
- 由主软件新增窄接口桥接该命令；复用现有子应用进程认证/发现机制，不把 token 或 Server URL 暴露给 React；
- 若某能力必须在主软件进程内运行，抽取一个不含 Chat UI/Session View 的 `@aily-project/aily-agent` host adapter；
- Project Scene Proposal 和 Scene Code Reconciliation 保留现有 request ID、取消、deadline、单次 candidate 提交约束，只替换 runner；
- 项目关闭/升级前的运行态判断改为子应用进程与 Agent RPC 的权威状态；
- 完成真实 Simulator 生成、场景代码协调、构建、取消和窗口关闭验证后，再关停旧 runtime host。

阶段 C 完成条件：

```bash
rg -n "chat-runtime-host|chat-runtime-lex|aily-lex" src electron scripts package.json angular.json
```

结果只允许出现在迁移文档或待删除清单中。

### 阶段 D：物理删除 `aily-lex` 与兼容构建链

在阶段 C 完成后，一次性删除：

1. `package.json` 和 lockfile 中的 `aily-lex`；
2. `scripts/clean_lex_cache.sh`、旧 setup 注释和 `run-electron-lex-execution-host.js`；
3. `build-electron-worker.js` 及构建脚本中的 `ailyChatExecutionHost*` metadata；
4. `electron/chat-runtime-lex-*`、`chat-runtime-host-*`、execution host worker/controller；
5. preload/type declaration中的旧 runtime IPC；
6. `app.config.ts` 中旧 shared/runtime owner provider；
7. Angular 的旧 Tiktoken asset 配置、旧 i18n/主题资源（非 E2E 测试脚本已提前删除）；
8. 最终剩余的 `src/app/tools/aily-chat` 目录。

最后重新安装依赖并验证发布包中不存在 `aily-lex`、旧 runtime bundle 或旧 Angular Chat 符号。

## 6. 验证矩阵

### 阶段 A 自动验证

```bash
npm run guard:aily-chat-mainline
npx tsc -p tsconfig.app.json --noEmit
npx ng build --base-href ./
```

仓库当前不保留根 `e2e/` 之外的单元测试，因此阶段门禁由静态守卫、TypeScript、production build 和真实 Playwright E2E 组成。删除单测不等于功能已验收；M1～M15 的完成必须以真实 Electron/E2E 证据为准。

新版子应用：

```bash
cd /Users/downey/Projects/aily-lex-pro
pnpm --dir packages/aily-chat/ui typecheck
pnpm --filter aily-chat build:ui
```

本次实际结果：新版 UI TypeScript 检查和 UI build 均通过；build 仅保留已有的 FontAwesome vendor、Penpal script 和 chunk size 警告。

### Electron 验收

本次未重启现有 Electron 进程。对本机已有 `http://localhost:4200` 开发服务做了只读检查：访问旧 `/aily-chat` 地址时已进入 `ChildToolHostComponent` 构造链，页面中未出现 `<app-aily-chat>`；随后由于纯浏览器环境没有 Electron 注入的 `regions.cn` 配置，`ConfigService` 抛错并取消导航。因此这次检查只能证明路由目标已切换，不能替代 iframe、新版 Node Server、登录态和窗口关闭的真实 Electron 验收。

每一阶段至少覆盖：

1. 首次安装后工具栏出现 Aily Chat，点击只打开 React 子应用。
2. 已存在旧 `/aily-chat` 链接时自动进入 `/child-tool/aily-chat`。
3. 主窗口和独立窗口均不加载旧 Angular component chunk。
4. 新会话首条消息、停止、恢复、切换会话、外部输入信号正常。
5. 登录、退出、账号切换、token 失效不把凭证暴露给 React。
6. 软件升级前 `beforeClose` 能中止或阻止正在运行的新版会话。
7. 项目打开/关闭、Blockly 编辑、编译、库搜索和 Schematic 正常。
8. Simulator 场景生成、代码协调、取消和构建正常。

### 发布物门禁

阶段 D 必须新增以下扫描：

- renderer bundle 不包含 `AilyChatComponent`、`AilyChatChildProtocolService`；
- Electron/asar 不包含 `chat-runtime-lex-execution-runtime`；
- npm dependency tree 不包含 `aily-lex`；
- 安装后的 Aily Chat 包版本与 Subapp Catalog 一致；
- Windows 和 macOS 各完成一次真实安装、启动、首轮对话和升级关闭验证。

## 7. 风险与回滚

| 风险 | 控制 |
| --- | --- |
| 子应用未安装时工具栏残留 | `aily-chat` 仍走 ChildToolHost，显示安装/配置错误，不回退旧 UI |
| 升级时运行中会话未中断 | 依赖通用 ChildAppHostRegistry 的 `beforeClose`，不再调用旧 Child 协议 |
| 删除目录时误删 Blockly/Simulator 能力 | 先迁出外部 import，再删除旧目录 |
| `aily-lex` 提前删除导致场景 Agent 失效 | 以阶段 C 真实 Simulator 验收作为删除门槛 |
| 旧代码被重新接回 | `guard:aily-chat-mainline` 在 CI/本地测试中失败 |
| 非 E2E 单测删除后回归发现变晚 | 每个迁移工作包必须补充或更新根 `e2e/` 场景，并保留构建与运行态证据 |

回滚应按阶段回滚提交，不再把旧 Angular UI 作为运行时 fallback。若新版子应用安装失败，应修复 Catalog、安装或 ChildToolHost 链路，而不是恢复双主链。

## 8. 本次变更边界

本次完成的是“旧 UI 主链移除 + 公共能力初步迁出”，不是“`aily-lex` 已全部删除”。当前可确认：

- React 子应用是唯一可达 Aily Chat UI；
- 旧 Angular 主组件、旧 Child 协议和绝大多数旧展示组件已删除；
- 主软件仍保留旧后台 execution host，因此 `aily-lex` 依赖暂时保留；
- 在 Simulator/场景 Agent 改接新版 Agent 前，不应宣称旧运行时已完全移除。
