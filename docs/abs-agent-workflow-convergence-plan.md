# ABS Agent 工作流收敛执行方案

日期：2026-09-17。依据：用户提供的温湿度计会话、当前 Blockly / Lex 源码和实际 portable 产物。

当前推进：第六轮“发送前准备当前快照 / Agent 操作流程收敛”。第五轮身份策略保留；第六轮替代旧版要求发送前 inspect=ready 才允许保存的流程。以下各轮为历史实施记录，旧分发验收只证明对应时间的构建，不代表本轮代码已加载。

## 目标与不变量

README 与当前项目约束充分时，直接编写整份 ABS，一次提交候选验证；查询工具用于填补具体信息缺口，不是每个块族的固定审批步骤。ABS 参数仍遵循原生定义顺序；坐标、身份、保护属性留在 ABI / map；大数据继续由 Project Data 管理。

不修改库，不增加第二套 ABS 语法，不放宽候选隔离、模型身份、保存回读和编译验收，不重新扩展任意异步能力。

## 已确认原因

1. 源码与 portable 内置技能文件不一致。仅构建 aily-agent 不会刷新主程序加载的 aily-chat/runtime/resources。
2. 技能入口声明 README 优先，但 ABS、库生命周期和文档工具提示又要求新块族先查 block_info。
3. 下拉框本来知道可用值，变量字段本来知道类型限制，但候选跨窗口异常被 String(error) 扁平化，丢失错误码和上下文。
4. 一些初始化块在 generator 执行时才注册库对象；引用绑定发生得更早。仅按引用名补无类型变量不成立，也不能把所有缺失引用都当声明。
5. 搜索默认返回 50 项，模型投影包含不相关元数据；应用搜索还把截断后的数量当作总匹配数。
6. 当前 get_board_config 描述只覆盖编译/上传设置，缺少明确的引脚入口。board.json 的选项值是 ABS 的板卡约束来源；pinmap.json 是连线图资源，不能替代字段契约，也不能靠 D3 字面猜 GPIO3。原会话 Agent 没读 pinmap.json，上轮诊断读取的是分析者。

## 分阶段执行与验收

| 顺序 | 工作 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| 1 | 复用 portable 输入摘要、构建回执和启动一致性检查；冻结改动后重建完整 subapp | 源码技能与实际发布包逐文件一致；回执验证通过；不能以 agent/dist 测试代替分发包测试 | 新包构建/服务启动/安装验证/真实 MCP 验收通过；聊天面板需重新打开 |
| 2 | 删除新块族必查元数据的固定规则，统一 README → 整份候选验证 → 按诊断补查询 | 所有提示入口一致；保留验证/提交/回读/编译关口；无逐块工具循环 | 已实现并回归 |
| 3 | 统一有界、纯数据诊断，贯通字段校验 → 隔离候选 → 工具返回 | 错误含 code、块/字段、源码范围、实际输入、可用值或模型类型；失败不写项目 | 已实现下拉值/模型类型诊断并回归 |
| 4 | 通用初始化模型准备 | 在同一候选内捕获原生注册机制的声明效果，证明归属和类型，确定性准备后再绑定；引用本身不能创建模型 | 同步原生注册路径已实现；844 项 ABS 回归、真实 DHT/MAX31865、事务/回执验收通过；完整分发重建与实际 MCP 验收通过 |
| 5 | 小默认、显式可扩展的发现/文档输出 | maxResults 默认 10、范围 1–50；显示真实总数与截断；README 按需读取，返回板卡约束与精简模型要求，不返回整库元数据 | 已实现并回归 |
| 6 | 复用 get_board_config 暴露 board.json 约束，库文档复用同一读取/投影模块 | 返回引脚选项实际值和总线映射；不读取 pinmap 图片；缺失/多板卡明确报告而不是猜测 | 已实现并回归 |

## 初始化模型准备的边界

应复用原生 registerVariableToBlockly 等注册入口，而不是解析 generator 源码、按字段名猜类型或增加 DHT 白名单。需要独立验证：生产者先于/后于消费者、多个对象、已有同名异类型、重复声明、删除或重命名、验证重入与失败回滚，以及最终 generator 效果与准备结果一致。

同步注册入口的所有权闭环已实现。仍保留显式 typed createVariables 事务能力作为文档证明的高级模型意图；它不是普通初始化块的必经步骤。文档中的“消费字段类型”不是初始化块声明效果的证明，不能据此自行创建模型。

实现遵循以下内部数据流，外部仍然一次提交整份 ABS：

1. 在隔离原生候选中建立模型声明效果记录器，记录受控注册入口的调用、实际类型和所属 ABS 调用；不扫描 generator 文本猜声明。
2. 分离字段配置与模型引用绑定，使原生声明效果能在引用解析之前被准备；必须证明配置/生成回调无未授权 I/O、注册变更或身份修改。
3. 将声明效果变为确定性的候选模型身份，与显式 createVariables、已有模型合并并检查冲突。引用消费者不具有声明权限。
4. 在 `abs-native-reconciliation` 的初次绑定、最终身份重放、最终 ABI 生成校验中比对效果；任何不一致都拒绝整个候选。
5. 将派生模型证据加入生成回执及 Lex 的 `host-candidate` 验证。目前 `preparedVariables` 与显式 createVariables 精确对应，不能静默塞入额外模型冒充已有协议。
6. 验收生产者/消费者顺序、多对象、同名异类型、重复声明、删除/重命名、失败回滚和重开持久性后，再移除库对象的手工模型准备要求。此阶段不扩大任意异步支持。

## 本轮落地细节

- 板卡读取集中在 Lex `services/project/board-constraints.ts`。`get_board_config(section="pins")` 可单独获取已安装板卡的引脚/总线约束，不发起编译选项 RPC；默认 all 保持原工具编译/上传选项语义，并附带同一份约束。该数据注明 installed-board，不能伪装成未加载工作区的运行时字段快照。
- `library_docs` 保留完整 README 优先，新增 maxChars（1000–30000，默认 30000）、totalChars/returnedChars/truncated、boardConstraints 和去重的模型类型要求。没有新增强制 block_info 调用，也没有返回所有块定义。
- 搜索在工具参数和主程序执行端双重限制预算；返回真实总匹配数。模型投影去掉整行无关字段，保留包名、说明及必要的板卡/库兼容信息。
- `abs-diagnostics.ts` 是无 Blockly 依赖的纯数据边界。下拉错误返回 ABS_FIELD_OPTION_INVALID；模型缺失/同名异类型分别返回 ABS_SYMBOL_MISSING / ABS_SYMBOL_TYPE_MISMATCH。诊断附带块、字段、UTF-16 范围和工具层行列号。允许值最多 64 项，文本有长度上限，截断明确标记；不传递模型 ID、任意对象或成功回执。暂不宣称汇总整份候选的所有错误。
- 删除了把“默认元数据没有列出的动态字段”直接判为不支持的旧提示。仍要求使用有依据的具体变体，禁止枚举语法碰运气及绕过实际拒绝。
- 真实运行版本核查：主程序加载的 npm-global 子应用是指向 Lex 源码包目录的 junction，但进程回执为 2026-09-16 21:55:12。首次完整构建被该进程占用目录而中止，旧输出回执随后验证仍完整。经用户明确同意且再次确认没有会话后，仅停止了该空闲子应用进程；主程序未关闭。

## 发现与文档的控制方式

采用服务端安全默认值与上限 + LLM 可调参数，而非只靠提示词节流或硬编码“一律只读 N 字”。常用工具直接可用，大目录按需发现；文档保留完整 README 的默认语义，提供字符预算与明确截断/续读位置，避免隐藏关键生命周期规则。

参考的是渐进披露原则，不声称照搬产品内部实现或其数值限制：[OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search)、[OpenAI skills](https://learn.chatgpt.com/docs/build-skills)、[VS Code/Copilot tools](https://code.visualstudio.com/docs/agents/run/tools)。默认 10、上限 50 是本项目设计选择。

## 验证与交付

先做纯模块、提示契约和跨候选诊断回归，再构建真实 portable 产物并验证输入/输出回执。运行中的旧进程不能因磁盘文件更新而宣称自动生效，应独立验证新进程加载并明确现有会话需重启。测试只用临时项目，不改变用户原始项目、库及登录信息。未执行项如实保留，不能把单次编译成功写成所有能力完成。

### 本轮验收记录

- Blockly ABS 全量最终回归：831/831，包含真实隔离窗口、纯合并路径、工具行列号、搜索预算及不变性检查；`D:/codes/aily-blockly/.tmp-workflow-abs-final.log`。
- Lex ABS / 文件发布联合回归：119/119；`D:/codes/aily-lex-pro/.tmp-workflow-agent-final.log`。
- 构建完整性测试：3/3，覆盖输入变化、输出缺失/变更和旧执行代码不能认领新回执；`.tmp-workflow-integrity-tests.log`。
- 完整 subapp 构建通过，含实际服务健康回执比对、MCP/Pi/worker 启动和 npm pack/install 后再次启动；`.tmp-workflow-portable-build.log`。包构建时间为 `2026-09-17 15:00:39`，输入摘要 `a85da69e475b92cef6f938cbc3f1d3a7c7b98fcaca219aff8751450431fdc4f8`，输出摘要 `3332ba9e8eb5babc4d41ff13f2ca5451758c93523fd94c3b2e65cf301df59e2c`。
- 新增 `packages/aily-chat/tests/portable-abs-workflow.test.mjs`，直接启动发布包 MCP：检查真实工具 schema、block_info 描述、library_docs、get_board_config(section=pins)、skill_read 与源码一致；1/1 通过，日志 `.tmp-workflow-portable-acceptance.log`。该测试不调用 LLM、不使用用户登录信息。
- 发布包内 42 个技能文件与源码逐文件字节比对一致；旧子应用进程已按授权停止，Blockly 主进程仍运行。重新打开聊天面板后由主程序加载新包，不把已经停止的旧会话描述为自动热更新成功。
- 实际 `project_sep17c` 只读核对：返回 board-xiao_esp32s3 的 LED_BUILTIN/D0–D10 选项、DHT 消费模型类型、README 直写验证提示；读取前后 ABI 哈希一致。原 `project_jul13d_353995` ABI 哈希仍为 `d556530fc57380bf8fab311d13e11f7ba52d3c39a39a67fd03fd24bc1e4de743`。
- Blockly 服务架构检查：170 files、0 baseline violations、0 cycles。本轮未修改库、原工程、登录信息、Auth/积分业务、依赖解析选项；未提交或推送。
- 这里的分发工具验收不是新的 LLM 自主会话，也不是固件编译；第 4 项自动初始化模型准备仍未完成，不据此宣称六项全部收口。

### 第 4 项实现与验收（续）

上述记录属于第 1/2/3/5/6 项。本节记录后续的第 4 项实现，不把旧构建视为新代码已经生效。

- `blockly-native-model-preparation.ts` 只执行已经配置、没有未解析引用依赖的原生 generator 子树。未解析的 FieldVariable 延后绑定，不填假值，不调用消费者来猜声明，不输出假代码。生产者位于消费者之前或之后不影响整批候选提交。
- `blockly-native-model-effects.ts` 在同步 generator 调用栈上记录 `registerVariableToBlockly(name,type)` 的实际生产者，保留原 helper 执行；吞掉异常、替换注册函数/生成器表、直接创建非归属模型都不能绕过失败。这里只开放现有公共注册入口，不扫描 generator 源码，不按库/块名设白名单。
- `abs-native-model-declarations.ts` 负责纯数据校验与合并。模型 ID 由 generation、完整 ABS 内容、生产者源码位置和序号确定。既有同名模型必须名称大小写、类型、身份完全一致；同一生产者重复注册幂等，不同生产者同名冲突拒绝。每批最多 128 条，单项文本有长度上限。
- 初次原生绑定 → 唯一身份合并器 → 最终身份原生重放 → 完整 ABI 原生生成，每层核对声明证据；字段、资源、保护属性、跨页引用及保存事务仍走已有机制。纯 JSON 形状不能证明 generator 没有模型副作用，因此存在新块时也进入原生准备，覆盖“只有初始化块、没有消费者”的情况。
- 新增独立 `preparedModels` 回执（生产者位置/块类型/模型 ID/名称/类型），不改变 `preparedVariables` 与显式 `createVariables` 的一一对应。apply 重新准备并与 validate 比对；Lex 校验源码归属、确定性 ID、旧模型冲突、validate/apply 一致性和保存后模型。证据不写进 ABS，也不要求 LLM 手填。
- 不隐式重命名或垃圾回收共享模型。保留块不能自动引入替代模型；删除生产者/引用后旧共享模型保留，显式生命周期操作另行处理。没有改变原有 `$name` / `variables_get($name)` / 裸 `$name` 值输入兜底或参数顺序。
- 明确边界：异步注册、需要未解析模型才能完成配置/生成的初始化器、绕过公共入口直接创建模型，不在本次自动准备范围。按现有错误退出或使用有文档依据的显式模型意图，不逐库添加特例，不宣称任意 generator 均可自动准备。

验收记录：

- Blockly ABS 全量：844/844，`.tmp-model-abs-final.log`；新增真实隔离 realm 测试覆盖完整 DHT generator、MAX31865 README 的硬件/软件 SPI 写法、前后顺序、多对象、重复/类型冲突、禁用/缺失生产者、生成器表污染、完整生成缺失注册，以及调用方不能伪造主程序准备证据。整理缩进后的原生专项另过 9/9（`.tmp-model-native-final.log`）。
- 事务测试覆盖验证不变性、篡改回执拒绝、原生重放、初始化器单独创建、应用生成失败回滚、持久化/重开、隐式改名拒绝、删除后保留共享模型。
- Lex ABS/文件发布联合最终回归 121/121（`.tmp-model-agent-final.log`），包含派生模型回执被删除、类型变化和保存后丢失的拒绝；实际发布包 MCP 与构建完整性测试 4/4（`.tmp-model-portable-acceptance.log`）。
- Angular 服务架构检查：170 files，0 baseline violations，0 cycles。库只读，原工程、登录信息和用户 Auth/积分改动未触碰。本轮不提交/推送。
- LLM 自主对话及固件编译尚未在本轮重新执行；上述代码生成验收不等同于硬件功能/编译验收。
- 完整 subapp 构建通过，包含 npm pack/install、已安装 MCP/Pi/服务启动；`.tmp-model-portable-build.log`。构建时间 `2026-09-17 15:37:58`，输入摘要 `2fa955de2435a9a26159a6d4894ef675219ac994e43af0301942adccbf5be1ea`，输出摘要 `119d0996b53bdd034ff02ec12263ed8a02ec80e8fdbdd022e945289eabd74c7b`。重新确认 openSessions=0、streamingSessions=0 后，按本轮用户授权仅停止空闲子应用 PID 34136；Blockly 主进程 PID 32716 保持运行。聊天面板需重新打开加载新包，不宣称旧进程自动生效。
- 发布包 42 个技能文件与源码逐文件 SHA-256 一致；主程序安装 junction 仍指向 `D:/codes/aily-lex-pro/packages/aily-chat`。原工程 `project_jul13d_353995/project.abi` SHA-256 仍为 `d556530fc57380bf8fab311d13e11f7ba52d3c39a39a67fd03fd24bc1e4de743`。

## 第二轮：非阻塞改写与发送前快照（2026-09-17）

### 证据与根因

会话 `2026-09-17T08-08-24-448Z_01a0ae68-e280-7078-872e-2140ff8b111c.jsonl`：第一轮校验、应用、编译均成功；第二轮把采样显示语句整体移入条件分支并新增 `lastUpdate`，连续 8 次校验均报 `ABS_IDENTITY_AMBIGUOUS`，没有第二次应用或编译。

不是需要逐库适配或改 ABS 参数规则。旧匹配器仅在同一 owner/input 内匹配，并在末尾把“任一未匹配旧块与新块同类型”当作跨父身份冲突。正常的包裹/解包导致旧子树未认领，新建 `math_number(0)` 或 `variables_get($lastUpdate)` 也被连带拒绝。编辑本来已是一次 edit 的多处替换；一律建议改用 targeted edit 没有解释实际缺口，诱导修改数值、改块类型和无关 `block_info` 查询。

同时 before_agent_start 已自动保存并导出，但上下文丢弃了 ABS 正文；技能仍强制 Start with abs_export。画布与 ABI 相同时又直接跳过，不能证明 ABS/map 新鲜。由此产生重复导出与新 generation，也无法在新会话直接提供可编辑基线。

### 实施顺序与模块边界

1. **身份匹配独立化：已实现。** `abs-identity-matcher.ts` 只输入前后 AST/文本及可选编辑证据，输出对应关系，不访问 UI、磁盘或库 generator。精确 token 证据允许跨 owner；已认领 owner 内的相同内容/唯一同类型更新优先；唯一完整序列或唯一结构内容可移动。每认领一个跨 owner 父节点，先处理其孩子，防止新建相同字面量抢走旧 owner 的孩子。
2. **删除全局“同类型即冲突”规则：已实现。** 不同未匹配内容按删除/新建进入原有 ABI 合并；可区分的移动保留 ID、opaque metadata、保护和 dormant shadow。真正不可区分的重复调用仍拒绝，返回 `reason`、块类型、范围、候选数和恢复提示。字段约束、禁用状态、保护删除、模型作用域、原生连接/完整读回与事务门禁均不放宽。
3. **发送前快照：已实现。** 复用 before_agent_start 与现有 host projection，不新增 LLM 工具或另一条写入通道。每轮验证当前投影；画布脏时先做只读 generation inspection，草稿/pending/scope conflict 阻止自动保存。projection 仍核对 ABI 字节、镜像、作用域、运行时合同和工作区版本；仅这些与已提交基线一致时，内部 `reuseCurrent` 才复用 generation，不重复落盘。删除进程内 pending Set，因为每轮都验证，失败下轮自然重试。
4. **有界上下文：已实现。** 返回路径、generation、scope、三文件 hash、字节/行数及验证结果。ABS 不超过 12000 个 JS 字符时完整内联；超出只给可读取的绝对路径和摘要，不给可被误当完整代码的截断正文。`changed` 明确只代表画布对已保存 ABI；generation/hash 用于识别投影是否改变。回合内其他写入仍由已有 stale-baseline/CAS 检查拒绝，不声称快照永远有效。
5. **统一作者入口：已实现。** ABS 技能、validate/apply/import schema 描述、export 描述及自定义函数说明均允许当前轮已验证快照直接作为基线。保留已有调用不必重新读取所有相关库；已读且版本未变的文档可以复用，只读取本次新增用法需要的库。没有把“元数据足够”变成不验证候选。

不把坐标、ID 或 meta 塞回 ABS，不修改任一库，不新增异步结构支持，不把程序重写拆成逐块 validate/apply。`$name` 字段选择、显式 getter、裸值输入兜底及原生参数顺序保持不变。

### 验收与交付状态

- Blockly 第一轮 850/850、补充 owner 优先与实际工作区测试后 854/854；`.tmp-structure-abs-first.log`、`.tmp-structure-abs-final.log`。
- 真实渲染 Workspace 测试一次整段包裹 + 新建同值数值 + 删除 delay；validate 不变性、单次 apply、原 ID/保护/metadata 保留、保存重开通过。另测解包重复序列、不可区分重复拒绝、禁用状态保护与 generation 复用/草稿拒绝。
- Lex ABS/文件发布/回合上下文回归 132/132；`.tmp-structure-agent-full.log`。覆盖新会话干净画布、保存后投影失败再试、保存失败、草稿/pending/scope conflict、完整短 ABS 与超预算路径上下文。
- 原会话源程序和参数合同的独立回归见 `abs-thermometer-session.spec.ts`；只复制程序与合同，没有复制用户路径、模型 ID、凭据或整份私有基线。
- 最终 Blockly ABS 全量 **857/857**（`.tmp-structure-abs-release.log`），包含原会话显式数值/裸数值两种改写和身份诊断 wire 回归；Lex 最终联合回归 **133/133**（`.tmp-structure-agent-release.log`）。Angular 应用类型检查、development build 均通过，服务架构为 177 files / 0 baseline violations / 0 cycles。
- 完整分发构建、实际进程加载及新 LLM 自主会话须独立验收，不能由上述单元/集成测试代替。本轮未提交或推送；不触碰原工程或库。

分发收尾：

- 用户授权后再次检查 openSessions=0 / streamingSessions=0，仅停止旧 Aily Chat 子进程。首次重建因重新启动的空闲子进程占用目录失败；复核空闲后停止该进程并重建成功。Blockly 主进程 PID 47052 全程保持运行。
- 完整 portable 构建通过（`.tmp-structure-portable-build.log`），包含 MCP / Pi / worker / server、npm pack / install、安装后服务启动及构建回执验证。构建时间 `2026-09-17 17:08:07`，输入摘要 `3d4a3d1728d3facd17bf44ed26f5a7ac1f9f4a71b6688ae96bd1f11a90def9b4`，输出摘要 `96e66635b816b8360809a4cd9d2ad92588b57c434513cebcdfffc5be802fb7c6`。
- 实际发布包 MCP 与构建完整性验收 **4/4**（`.tmp-structure-portable-acceptance.log`），明确核对 validate/apply/import 的实际 schema 描述接受 verified turn snapshot，以及实际 skill_read 不再要求 Start with abs_export。
- 发布包内 42 个技能文件与当前源码逐文件字节比对一致。
- 新包已位于主程序安装 junction 指向的目录；聊天面板需要重新打开。安装后服务启动不等同于用户原会话已热更新，也不等同于新的 LLM 自主会话或正式固件编译。本轮未重跑这两项。

## 第三轮：旧草稿就绪诊断与保留刷新（2026-09-17）

### 证据与设计边界

会话 `2026-09-17T09-14-25-028Z_01a0aea5-5184-7279-bc9f-b526902e33c4.jsonl` 最终 validate/apply/build 均成功，但发送前只有 `ABS_SOURCE_CONFLICT`，Agent 花费约 6 分钟查找 map/ABI/私有基线并手工恢复 ABS，之后实际修改到应用约 18 秒。不能把 Agent 声称“已归档”视为持久备份证据。

只读对比原工程前后权威基线：ABS、完整 ABI 哈希、saved ABI 哈希相同；合同仅两处串口 dropdown 删除了未使用的 `SerialCustom` 选项，实际选值仍为 `Serial`。严格比较全部合同使可继续验证的草稿被误报 `ABS_RUNTIME_CONTRACT_STALE`。这属于通用动态选项域问题，不是串口专属语法问题。

不变量：公开 ABS 是候选，不等同于已提交工作区；草稿不得自动覆盖/应用；结构、字段协议、模型约束、实际选值仍须验证。新代数不能直接赋予旧候选。继续使用现有 immutable baseline + CAS + prepared/committed journal，不另建一套事务/私有文件布局；不修改库、ABS 语法或原工程。

### 实施与模块职责

1. `abs-contract-compatibility.ts`：纯合同比较。仅 dropdown options/标签变化且当前已选值仍合法、其余合同相同时兼容。参数结构、selector、符号表、字段类型/范围/模型类型变化继续拒绝。候选字段使用当前定义验证；保留字段也更新候选合同快照。
2. `abs-draft-readiness.ts`：只读就绪检查，验证当前完整文档、saved ABI 和运行时合同；Project Data 仅解析，不写资源。一次返回 source conflict 与 runtime/baseline stale。就绪不等于候选语法或语义已通过校验。
3. 发送前遇草稿冲突后自动 inspect：有效基线返回 `state=draft-ready`、原 generation、候选哈希、baselineAbsHash 和有界完整源码，Agent 可直接整份 validate；真正过期返回组合诊断与受控刷新 token。发送消息本身不调用 refresh，不丢弃草稿。
4. 现有 `project_recover` 扩展 `refresh(token)` / `read_draft(generation)`。刷新 token 绑定 scope、三个镜像哈希、committed pointer、当前文档和合同；刷新在 workspace lease 内复核。仅同一已保存工作区且 map/基线完整、无 pending 时允许，不处理独立画布改动、外部 ABI 冲突或跨作用域草稿。
5. 刷新沿用 export 事务。新不可变记录先保存原候选 `inputAbs`、原 `inputMap`、`draftBaseGeneration`，校验字节哈希并读回成功后才发布新 ABS/map。ABI、图形块及代码生成不变。响应携带 `draftArchive`；归档可单独读取原文，不暴露完整私有 ABI/map。归档失败不覆盖，发布中断复用原 recovery journal，归档仍保留。
6. Lex 核对诊断与当前镜像、baseline binding、刷新回执、归档哈希/字节、新投影的三文件落盘证据；refresh 不标记候选 applied/verified。统一回合提示、verification、abs-syntax 和恢复工具说明，删除遗漏的强制开场 export，禁止把手工复制私有基线当恢复流程。

### 验收记录

- 首轮 Blockly ABS 回归 865/865；补充归档失败测试后独立最终回归 **866/866**（`.tmp-draft-abs-release.log`）。Lex 定向 25/25、ABS/文件发布/回合上下文联合 **120/120**（`.tmp-draft-agent-focused.log` / `.tmp-draft-agent-full.log`）。
- 已覆盖：未使用选项变化可继续，候选选择已删除选项仍失败；字段范围变化合并诊断；token 随源码/画布/合同变化失效；原文含中文/emoji/CRLF 精确保留；归档损坏拒绝；刷新中断恢复不保存 ABI；兼容草稿发送前可直接使用；伪造/矛盾跨进程回执拒绝。
- 分发包重建和实际进程加载单独记录；源码测试通过不能代表运行中的上一版已更新。原工程与库保持只读。本轮不提交/推送。

分发与实证补充：

- 用本轮实际合同比较模块，只读加载原工程 `05264867...` / `63842c4d...` 两份不可变记录：ABS、baseAbiHash、savedAbiHash 全部相同，新结果为 `compatible`，仅 `serial_println.SERIAL` / `serial_begin.SERIAL` 两项 `dropdown-domain-changed`。没有执行用户候选或改写工程文件。
- 用户授权后复核空闲（openSessions=0 / streamingSessions=0），停止旧聊天子进程 PID 47896。Blockly 主进程 PID 47052 保持运行。
- Portable 完整构建通过（`.tmp-draft-portable-build.log`），含 npm pack/install、安装后 MCP/Pi/server 启动检查。构建时间 `2026-09-17 17:53:49`，inputHash `fae36559bbcd7e46e1155b0a99b36218165528e7e545506540bbeb5cbf835a17`，outputHash `61b97e96c5006c0b473ad5cee4253d68aa2deb8cd41de0140bc86e1ecc15e31e`。
- 实际 portable MCP + 构建完整性验收 **4/4**（`.tmp-draft-portable-acceptance.log`），核对 `refresh/read_draft/token` schema、草稿说明、实际 skill_read 的 verification/abs-syntax。42 个发布技能文件与源码逐文件 SHA-256 相同。
- 中途全量测试与重构建并行时，两项既有 native media 用例触发 5 秒 Jasmine 超时，故不算通过；保留 `.tmp-draft-abs-final.log`。分发结束后独立全量复测 **866/866**，两项均通过。本轮未修改产品时限或这些测试的超时阈值来掩盖失败。
- Angular 类型检查、最终 development build（`.tmp-draft-blockly-build.log`）均通过，服务架构 177 files / 0 baseline violations / 0 cycles，双方 `git diff --check` 通过。运行中的编辑器不由磁盘构建自动证明已更新；重开聊天/加载新主程序页面后才能做用户侧新会话验收。本轮未重新运行 LLM 自主会话或正式固件编译。

## 第四轮：批量替换证据、失败诊断与新会话入口（2026-09-17）

### 范围与证据

按用户选择仅执行本轮分析中的第 1、2、5 项；第 3 项成功校验回执瘦身、第 4 项 library_docs 聚焦与元数据压缩暂缓，不混入本轮。

10:03 会话使用新基线，没有重复导出或 block_info；第一次 edit 已一次提交两处替换。第二处同时调整两行坐标并增加第三个显示调用。原编辑记录只裁剪共同首尾，将中间未改动的湿度调用名覆盖进 splice；于是 1 个旧调用对应 2 个候选新调用，连续两次出现 ABS_IDENTITY_AMBIGUOUS。最终恢复旧湿度坐标依靠结构精确匹配通过，并不能说明坐标本身非法。

该会话共 18 次工具调用，3 次 validate、1 次 apply，最后编译成功。重复校验耗时主要在模型决策和修改往返，不是校验后端耗时。发送前注入了完整 ABS 后又 read 同一文件，应采用单一正文来源。新会话不存在可复用的上轮正文上下文。

### 实现原则及模块边界

1. **批量编辑证据**：Lex 新增纯文本 `abs-edit-splices.ts`，对已经唯一定位且精确重放成功的 ordinary edit 替换，识别前后均唯一、顺序一致的未变文本窗口。交叉匹配双方排除，矛盾重叠双方排除；不使用块名白名单、AST 身份猜测或任意 LCS 平局选择。共同首尾继续保留。单替换内部搜索上限 64 Ki UTF-16 单元、窗口 24 单元；无足够证据或超预算退回原有保守 splice。细化后再次精确重放，保留既有 generation/hash、历史批数、编辑数、体积和发布事务限制。整文件 write 不自动推断证据。
2. **宿主匹配与诊断**：同一 replay 同时返回保留 token 对应关系和被覆盖 token 集合，删除无调用方的旧包装入口。身份匹配算法和保护删除策略不放宽。`diagnostic.identity` 包含 missing/tracked、批次/编辑数、baseline/candidate 数量及各自 UTF-16 调用名范围、被覆盖的旧调用名范围；列表最多 8 项，越界字段丢弃，不返回源码、模型 ID 或私有基线。Lex 校验失败也报告证据是否提供及数量，不泄露 splice 正文。提示保留草稿/generation、针对范围澄清身份，禁止通过改字面量或查询 block_info 试错。
3. **单一正文入口**：发送前仍检查工作区、generation 和草稿就绪情况，继续执行此前已验证的保护刷新规则，但只注入路径、hash、generation、scope、状态等元数据。删除 12000 字符分支与内联 helper。正常投影和 draft-ready 均为 `source: { read: absFile }`。新会话必须读取当前文件；只有本会话已读且 hash 未变时才能复用正文。不会因已有元数据就省掉新会话的文件读取，也不额外强制 abs_export。
4. **按需阅读流程**：abs-syntax.md 包含常规整份候选 validate/apply、成功回执和失败阻断规则；verification.md 保留恢复/不确定提交/增量持久化细则。已安装库的日常编辑不强制预读 library-lifecycle.md；依旧 README 优先、具体缺口才查 block_info。build/upload 规则不削弱。成功回执和库文档数据形状不改。

ABS 语法、变量引用、参数顺序、map 身份存储、库只读、Project Data 与原有事务边界不变。窗口证据不保证任意重排/重复文本均可识别；缺少唯一证据时仍拒绝猜测。

### 验收记录

- 原会话只读跨端回放：实际 Lex 编辑记录接入浏览器内宿主解析/身份匹配；旧记录复现 ABS_IDENTITY_AMBIGUOUS，新记录一次保留全部 52 个旧调用，候选共 92 个调用，三行 Y 为 18/37/56，前两行保留旧身份、第三行为新增。不读取或改写原工程，也不执行用户代码。
- 固化去身份化温湿度回归及常规多行 edit 测试，覆盖 UTF-16/中文/emoji/CRLF、内部未变文本、重复/交叉匹配拒绝、预算退化、精确重放、保护/metadata 保留、诊断跨工具边界与新会话只传路径。
- Blockly ABS 全量 **870/870**（`.tmp-identity-abs-final.log`），Lex ABS/文件发布/回合上下文联合 **126/126**（`.tmp-identity-agent-final.log`）；Lex 构建、Angular 应用类型检查通过，服务架构 **177 files / 0 baseline violations / 0 cycles**，双方 `git diff --check` 通过。
- 主程序 development build 通过（`.tmp-identity-blockly-build.log`）。用户授权后重新确认 openSessions=0 / streamingSessions=0，已停止旧聊天子进程 PID 43468，Blockly 主进程 PID 47052 保持运行。聊天分发包重建、实际工具验收结果另记，不把磁盘构建视为用户页面已热更新。
- 日志回放不是新的 LLM 自主会话，也不是正式固件编译；本轮未重跑这两项。库与原工程保持只读，不提交/推送。

分发收尾：

- 完整 portable 构建通过（`.tmp-identity-portable-build.log`），含 MCP/Pi/worker/server 与 npm pack/install 后启动验收。构建时间 `2026-09-17 18:49:34`，inputHash `b07e7be438953d59ef64035409ecaf2b05d4e6cc7a9f94561895360ff4ce5dd7`，outputHash `557cd54fdc6781137ddfd1c0fe2d606d2f6bfe17e47892cea9661b6bc5c644ab`。
- 实际发布包 MCP 与完整性测试 **4/4**（`.tmp-identity-portable-acceptance.log`），确认 metadata-only/read absFile、身份范围诊断说明、按需加载生命周期/恢复参考；42 个发布技能文件与源码逐文件字节一致。
- 新包已生成；需要重新打开聊天面板、加载当前主程序页面后进行用户侧新会话验收，未声称旧页面自动热更新成功。

## 第五轮：身份策略纠偏与完整候选原子提交（2026-09-17）

### 问题与证据

10:53 会话确实运行第四轮新提示和诊断，并非单纯旧版本部署问题。用户要求优化屏幕内容/布局，实际 18 分钟约 79 次工具调用、16 次 validate、5 次 apply；validate 总耗时约 29 秒。7 次身份错误与 3 次基线过期推动了反复试错，主要成本在模型决策、改写和恢复往返。

第一份完整候选把 3 个绘制调用改为 6 个。旧调用名被普通批量替换覆盖后，匹配器把剩余同类型节点全部判为身份冲突。最后 Agent 为绕过校验，先删除显示主体并成功 apply，用户暂停时尚未重建：原工程实际只剩屏幕初始化，显示功能已从已提交程序删除。事务机制没有失效；提交的候选本身就是一个错误的中间步骤。不得将这类问题继续解释成“应多做 targeted edit”。本轮不自动修改或恢复原工程。

另外，两对相邻基线的 ABS 和磁盘 ABI 哈希完全相同，文档只改变页面 viewState 的 scale/scrollX/scrollY，却触发 ABS_BASELINE_STALE。编辑历史存在 A→B→A→C 循环仍从第一次 A 回放的问题，已经撤销的 B 会永久污染调用 token 证据。干净镜像的 inspect 只查磁盘，也会对已改动画布错误返回 ready。

### 决策：是否改为内联 @meta

@meta **可以**表达任意深度嵌套，并非语法上无法实现。例如下式仅用于比较设计，**不属于已实现 ABS 语法**：

```text
draw(math_number(4) @meta:{"id":"n1"}, math_number(14) @meta:{"id":"n2"}) @meta:{"id":"n3"}
```

标记只属于紧邻的调用，不传给子块；语句容器标在调用末尾，缩进中的每个子块各自标记；同一行多个值块也需分别标记。槽名、坐标、保护属性不应因此复制进源码。仅写最外层标记不能解决内层块身份。

| 维度 | 每个调用内联最小 ID | 无 meta + 分离身份/状态保护 |
| --- | --- | --- |
| 保留任意旧 ID | 标记正确保留时直接查找，更简单 | 没有信息时不能保证；普通块允许新 ID |
| README 直写、整体布局改写 | 要携带每个值块标记，新增/复制需处理重复及遗漏 | 与当前 README 相同，直接整份候选 |
| 嵌套 | 每个 AST 调用各自标记，语法可明确但更长 | 原有调用嵌套、参数顺序和缩进不变 |
| 复制/跨工程 | 仍需作用域校验、重复 ID 检查、新旧身份规则 | 新调用由宿主分配 ID，原项目基线仍受保护 |
| 隐藏数据及事务 | 仍需 baseline/map、状态保护、CAS 和回读 | 复用现有机制，不能删除这些安全检查 |

结论：若产品目标是“任意编辑后每个旧 ID 都必须精确保留”，最小显式 ID 比不断猜测更合理；但那不是普通 ABS 编程所必需的语义。本产品目标是用简洁 ABS 批量修改程序，同时避免隐藏数据损失。选择无 meta 方案，以**能否安全重建状态**而非“是否保留所有旧 ID”作为接受条件，不再追加越来越复杂的文本身份猜测。现有 map 是可靠匹配时的状态来源，不是能够从任意源码改写恢复唯一身份的魔法索引。

### 实施边界与模块职责

1. **匹配与保护分离**：`abs-identity-matcher.ts` 只继承可靠匹配，接收纯 `requiresIdentity` 策略。`abs-identity-policy.ts` 根据序列化合同判断隐藏字段、未知属性、保护/禁用状态、休眠 shadow、连接附加数据、过程身份和外部序列化引用。无库名、块名白名单。未匹配的普通可重建块在同一个候选中分配新 ID；受保护删除、不可解析模型和隐藏状态歧义继续失败。普通显式删除仍允许，不把“包含注释”解释为永远不可删除。
2. **不增加平行转换器**：沿用现有 reconciler、隔离原生形状准备、Project Data、完整 readback、CAS/journal 和原子提交。新建、重写、整文件 write 不要求编辑证据；同一次事务中替换块不等于先提交删空再提交重建。可靠匹配继续保留 metadata/默认 shadow/ID，不能随机把隐藏状态分配给某个新块。
3. **视口与程序比较分离**：`abs-program-state.ts` 只排除页面 viewState 的三个已知有限数值（scale、scrollX、scrollY），保留未知扩展数据、块坐标、页面结构、字段和共享模型。用于 export reuse、候选基线比较、准备期检查及 inspect。沿用原 map 哈希定义；磁盘 ABI、ABS、map 的逐字节 CAS 和提交期持久化 revision 检查不变。validate 与 apply 之间仅视口变化可继续，应用保留当前视口；真实代码修改仍拒绝。
4. **历史仅作辅助**：Lex 撤销回到已知文本时裁掉旧分支，查询使用最近的匹配基线；私有缓存同时绑定实际草稿 inode/字节与 map 字节，换 generation 不复用旧证据。不增加模型可见工具或编辑格式，不把缓存可用当作普通改写的前置条件。
5. **一次完整提交的引导**：技能和 apply 描述统一支持 edit/多行替换/完整 rewrite。明确禁止为绕过身份错误先 apply 删除显示、清空主体等临时退化程序；真正有状态风险时保留完整草稿并报告，不改字面量、不读 block_info 试错。此规则是工作流引导，不宣称宿主能从源码推断任意用户需求是否完整。
6. **就绪检查补齐**：没有草稿冲突时也核对当前画布、保存基线和运行时合同，避免 status=ready 与真实基线过期矛盾；inspect 仍只读，不授予 apply 权限。

### 验收要求

- 失败会话的第一份完整候选去身份化回放：无 provenance 和整文件粗粒度 provenance 均可一次生成全部 6 个绘制调用，不改变字面量、不提交中间删空。
- 常规重复块 2→3、嵌套、重排、完整 write 通过；保护块、opaque data、未知属性、休眠 shadow 和外部引用无法可靠保留时继续拒绝；不增加逐库适配。
- 真实 Blockly SVG 工作区验证/应用/持久化/重载，故障注入回滚完整原程序；验证阶段不修改工作区或镜像。
- 缩放/滚动不产生无意义的新 generation，不使有效草稿或 validate 回执过期；真实代码、另一页面、资源、合同、磁盘并发改变仍拒绝。
- A→B→A→C 只携带最后一段编辑；跨进程与相同正文的新 map 均覆盖。应用和分发测试分别记录，不用单元测试数量替代新的 LLM 会话或固件编译。

### 验证记录（持续补充）

- 原会话不可变基线只读浏览器回放：实际 92 个旧调用 → 135 个候选调用，保留 65 个可可靠匹配的身份，完整候选包含 6 个绘制调用，全部 3 个受保护根保留。无 sourceEdits、整文件覆盖 sourceEdits 均通过身份检查。此项验证的是实际基线身份/保护策略，不冒充完整原生生成或固件编译。
- 原工程两组只有视口变化的相邻基线，旧 full hash 均不同、ABS 均相同；新 sameAbsProgram 均为 true。没有修改原工程、候选或基线文件。
- 失败会话去身份化完整源代码回归通过；真实 Blockly SVG 工作区验证/应用/回滚/重载等定向 **138/138**（`.tmp-identity-policy-focused.log`）。原有 wrap/unwrap 和 opaque metadata 保护回归同时通过。
- Lex 编辑历史/缓存/ABS/回合上下文/文件发布联合 **130/130**（`.tmp-identity-policy-agent-final.log`）；包括 publication 中途换 map 不把旧证据重新绑定到新 generation。技能/工具提示不再强制依赖 targeted edit。
- 全量首次运行发现并修复结构 type 与已声明字面量恰好同 ID 导致的引用误判、诊断 hint 超出 256 字符裁剪，以及测试夹具缺少 number 声明。并行构建下出现一次既有原生异步隔离 5 秒超时；保留失败日志，待独立全量复跑，不调高产品/用例时限掩盖失败。
- 应用与 ABS spec 类型检查已通过；服务架构 177 files / 0 baseline violations / 0 cycles。最终全量、主程序 build 和 portable 分发验收另记。
- 独立最终 Blockly ABS 全量 **887/887**（`.tmp-identity-policy-abs-release.log`），此前超时的既有隔离用例通过，没有修改其 5 秒时限。源码和 Lex 联合测试通过后，按本轮授权再次确认聊天 openSessions=0 / streamingSessions=0，仅停止旧聊天 PID 36900；Blockly 主进程 PID 47052 保持运行。

### 分发收尾

- 主程序 development build 成功（`.tmp-identity-policy-blockly-build.log`），最终应用类型检查通过；双方 `git diff --check` 通过。
- Portable 完整构建、npm pack/install、安装后 MCP/Pi/server 启动验收成功（`.tmp-identity-policy-portable-build.log`）。构建时间 `2026-09-17 20:28:14`，inputHash `68a02d92437bc20d3f3a01e1a16e62ab7093f8de89274cd1df29a61d28e0b06a`，outputHash `52fbd3c4fcd2c5c01f15782e80614d5222ef2984fb83984a742d0f66be4fb996`。
- 实际发布包 MCP/构建完整性验收 **4/4**（`.tmp-identity-policy-portable-acceptance.log`）；skill_read 返回“编辑证据可选、完整候选一次提交、禁止临时删空绕过保护”的新规则。`aily-blockly-project` 的全部 14 个技能文件与源码逐文件字节相同；完整输入及产品输出摘要核对通过。
- Blockly 主进程仍在运行，未擅自刷新页面。必须加载新主程序页面并重新打开聊天面板，才可做用户侧新会话验收；构建成功不代表旧页面已热更新。此次未运行新的 LLM 自主会话或正式固件编译。
- 原测试工程仍未改写：此前提交中删除的显示代码没有自动恢复。需要独立、明确的恢复操作，不能用验证本次修复之名覆盖当前工程。

库与原工程保持只读，不自动推送 Git；新的 LLM 自主会话和正式固件编译尚未在本轮执行。用户已授权通过测试后重建空闲聊天子应用；执行停止前须再次核对会话计数和进程身份，不能关闭 Blockly 主程序。

## 第六轮：发送前准备当前快照，而非恢复旧候选（2026-09-17）

### 证据与根因

13:47 会话的旧基线有 67 块，当前画布仅 3 个空保护根。不存在未应用草稿冲突和待处理事务。第五轮 inspect 开始如实报告画布变化后，Lex 仍要求旧基线 status=ready 才允许保存/导出，形成“需要刷新，却要求旧快照有效”的循环。Agent 后来普通 abs_export 一次成功。inspect 返回至 export 完成约 2 分 14 秒，工具自身约 8 秒，其余还包括文档处理，不能全算作基线推理。两次 validate 均成功，最终 apply 和编译成功，并非身份分配错误重演。

此前双方测试分别模拟“脏画布 + ready”和验证“脏画布 + blocked”，没有检验同一调用边界，导致组合语义不成立。本轮验收以发送后第一次读取获得当前程序为标准，不以单测数量替代流程验收。

### 第一性原则与数据职责

| 对象 | 职责 | Agent 的使用方式 |
| --- | --- | --- |
| 当前 Blockly 画布 / ABI | 当前程序及完整可持久化状态 | 宿主统一捕获、保存，Agent 不手改 ABI |
| project.abs | 当前程序的简洁编辑投影；也可能是尚未应用的草稿 | 新会话按当前路径读取，以完整候选编辑 |
| map / immutable baseline | 保存身份、隐藏状态及并发证据 | 宿主管理；不进入 ABS 语法，不由模型修补 |
| 生成 C++ / 生成头文件 | 当前程序的派生产物 | 按具体编译错误或语义缺口读取，不作为常规编辑源 |
| 用户维护的 C++ 文件 | 独立源文件，不是可丢弃缓存 | 保留；仅在请求范围内修改，不假定可反向转换为 ABS |

“旧候选是否还能 apply”与“能否为当前画布准备新快照”是两个问题。普通画布编辑或运行时变化使旧候选过期，不意味着不能准备新基线。真实草稿、pending、跨作用域、损坏 map、外部 ABI 与画布双重修改仍必须保护。

### 实现与解耦边界

1. **宿主原子准备**：复用 `abs_projection` 的内部 `synchronize=true` 模式；不新增模型工具。`AbsWorkspaceSyncService` 在同一 FIFO/lease 中检查镜像、双编辑、捕获当前文档、必要时准备保存与代码、生成投影，通过已有 CAS/journal 一次发布 ABI/ABS/map。普通 export 仍不保存 ABI，内部同步不能与 initialize/rebind/只读输出/替换草稿混用。保存后的部分发布继续 quarantine/recovery，不将未知状态视为成功。
2. **保持原生模型准备**：生成器同步创建模型时允许本次生成推进 revision，随后重新捕获并封存最终文档；提交前后仍检查上下文、revision 与磁盘。代码生成诊断保留为警告，不能阻止保存可编辑程序或被误称为编译成功。没有程序修改、只有缩放滚动时不为同步而生成 C++。
3. **Lex 只验证准备结果**：删除 `project_abi_check → inspect → project_save → export` 的正常分支，只请求一次同步投影。回执必须含 `synchronized=true` 与原 ABI 字节哈希，输出 ABI/ABS/map 再逐字节核对，旧主程序忽略新参数不能伪装成功。普通会话仅得到 ready、路径、代数与必要哈希；不注入旧合同差异。只有真实 ABS 草稿冲突才额外 inspect 并复用现有 draft-ready / 显式归档恢复机制。
4. **模型结果与机器证据分离**：成功 validate 的模型可见内容默认只含代数、候选摘要、验证状态、准备模型数量与警告。完整已验证回执保留在 structured result，不改变 apply 的校验边界。`includeSyntaxAdvice=true` 按需返回动态签名；失败诊断不压缩。禁止为了拿元数据重复成功校验。
5. **提示单一主线**：删除正常发送中的长恢复说明，恢复参考仅在真实失败时加载；取消手工编译失败必调 project_user_changes，以及常规 build 必须再读 verification.md / 全量 C++ 的固定步骤。README 足够即可完整编写，不恢复逐块查询要求。核对既有 `absApplyLiveFirst` 已先执行 prepareHostAbsCandidate，再把精确验证回执交给宿主 apply，因此常规 Agent 只需调用 abs_apply；独立 abs_validate 保留给 dry-run/诊断/只验证请求，省掉重复校验与模型往返，不改变内部校验或提交权限。

### Agent 操作流程

正常编辑：发送 → 宿主同步/复用 → 读取当前 ABS（本会话已读且 hash 相同可复用）→ 按需补齐库文档 → 一次完整编辑 → abs_apply（内部先 validate，再提交）→ 按请求/必要性 build。独立 abs_validate 为可选 dry-run；成功 apply 已保存并生成派生产物，不再固定 save/export。

编译失败：先读现有诊断 → 对照当前 ABS → 需要时只读相关 C++ 片段 → 判断源头是 ABS 用法、项目配置还是生成器缺陷 → 修正源头 → validate/apply → 必要时重新编译。无修改不重复编译以“获取错误”；不直接补丁生成目录，库默认只读。旧手工编译结果可能早于当前画布，时间戳不证明输入一致。

| 用户后续修改场景 | 处理方式 |
| --- | --- |
| 用户改动画布后再次发送 | 宿主准备最新 ABS；当前内容优先于上一轮回答，只实现本次增量，不恢复旧程序 |
| 用户正常保存 ABI，画布与磁盘一致 | 允许导出新的当前基线，不要求旧 runtime contract 有效 |
| 新会话没有旧源码上下文 | 从 absFile 读取，不从历史摘要猜测，不额外 export |
| 现有 ABS 草稿、当前基线仍可用 | draft-ready；先确认草稿意图，不能称为已应用 |
| 草稿与画布都变了，或外部 ABI 未加载 | 保留两方，不自动丢弃/改绑；准确报告冲突再协调 |
| Agent 开始后用户继续改画布 | validate/apply 的 revision/hash 保护继续拒绝过期候选，不能反复换 generation 试错 |
| 用户直接改生成 C++ | 不能通用无损反向还原为块；相关时用现有 diff/文件读取确认意图，在再生成前协调。没有宣称新增全项目 C++ 编辑检测/合并能力 |
| 用户改自己维护的 C++ 源文件 | 保留独立源文件，不作为生成缓存清理；按编译诊断判断是否属于本次任务 |

### 验收清单

- [x] 67 → 3 根块真实 Blockly 工作区回归；旧 inspect blocked，单次准备成功，保护根保留，保存 ABI 与返回 ABS 一致。
- [x] 正常字段改动、下一轮复用、视口不生成、正常手工保存、运行时结构变更、初始无镜像。
- [x] 草稿/map/作用域/外部 ABI 冲突无覆盖；并发磁盘写、部分发布、旧回执仍失败，故障可恢复。
- [x] Lex 单次请求接受输入与输出 ABI 不同但已验证的同步回执；拒绝旧宿主、错误输入哈希、后续外部写及 requiresReload。
- [x] 成功验证结果瘦身，按需签名和完整失败信息；新会话/手工修改/按需 C++ 流程规则回归。
- [x] 全量 ABS 与 Lex 联合回归、类型检查、主程序构建；分发构建/实际加载单独记录。

### 本轮验证记录

- Blockly ABS 全量 **904/904**（`.tmp-turn-sync-abs-final.log`），定向初测 **135/135** 后又补充生成器模型变更、手工已保存及运行时合同刷新回归，均进入全量。
- Lex ABS/回合上下文/文件发布联合 **138/138**（`.tmp-turn-sync-agent-final.log`）；既有 apply 测试明确验证一次公开调用内部顺序为 abs_validate → abs_apply，校验失败不会进入提交，超时不自动重放。
- 原 13:47 会话两份成功 validate 结果只读回放：模型文本各 **12441 → 295 字符**，完整 structured evidence 未删除。发送前固定规则缩短到 **1931 字符**，不包含完整 ABS 源码。这是返回内容体积，不冒充实际新会话 token/耗时测量。
- 应用及 ABS spec 类型检查通过；服务架构 **177 files / 0 baseline violations / 0 cycles**。主程序 development build 成功（`.tmp-turn-sync-blockly-build.log`）。
- 用户授权后再次确认聊天 openSessions=0 / streamingSessions=0、监听端口及进程身份一致，仅停止子应用 PID **47252**；Blockly 主进程 **8776** 保持运行。Portable 重建及安装后验收另记。
- 本轮测试包括浏览器内真实 Blockly 协调器、故障注入和 Lex HTTP 回执验证，不宣称已完成一轮新的真实 LLM 会话或固件编译。

### 分发收尾

- 主程序与 Lex 均已构建通过，双方 `git diff --check` 通过，最终 ABS spec 类型检查通过。
- 完整 portable 构建、npm pack/install、安装后的 MCP/Pi/server 启动验收通过（`.tmp-turn-sync-portable-build.log`）。构建时间 **2026-09-17 22:31:33**，inputHash `6227d6869a14a4385731f0f00bbc7b3ebae5ff1dc44df88ead9c28404a4d3cf0`，outputHash `b598f6e404a30af7a11c2cc4a980c1b8f6fdc27f38851f0fb6fd24ee2e003ff1`。
- 实际 portable MCP 与构建完整性验收 **4/4**（`.tmp-turn-sync-portable-acceptance.log`），确认 includeSyntaxAdvice 默认 false、当前 ABS 优先和按需变更 diff 规则。全部 **14 个** Blockly 技能文件与源码逐文件 SHA-256 相同。
- 未刷新仍在运行的 Blockly 页面，也未重新打开用户会话。需要加载新主程序页面并重新打开聊天面板；旧主程序忽略同步请求时，新 Lex 明确返回 **ABS_HOST_UPDATE_REQUIRED**，提示更新页面，不让 Agent 把版本不匹配解释成草稿恢复问题。
- 本轮没有修改用户工程或库，没有提交/推送 Git。新 LLM 会话的实际耗时与固件编译仍需独立验收，不能由本轮单元/协议/分发测试替代。

本轮不修改原工程、不变更 ABS 语法与 ID 规则、不修改库、不自动推送。测试与运行中版本是否加载必须分别报告。
