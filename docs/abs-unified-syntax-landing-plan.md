# ABS 统一简洁语法与无损同步落地方案

> 日期：2026-09-15
>
> 状态：阶段 A/B/C 的既定核心主线已完成并验收；最终构建、启动断线、选中块上下文及大数据重开证据见第 11 节。任意库动态创建、全部历史字面量兜底及硬件运行不是本次验收范围。第 9、10 节保留为对应批次的历史证据，不代表当前尚未实施。
>
> 主线：沿用熟悉的 ABS 表达，复用已经实现的无损同步内核，消除 Agent 的双重规则。
>
> 替代范围：本方案接替旧执行文档第 41.4 节及其后的工作排序；旧文档保留为问题和测试证据档案，不再继续按“新增合同批次”扩写主线。
>
> 仓库边界：主程序 `D:/codes/aily-blockly`；Agent/Chat `D:/codes/aily-lex-pro`；`aily-blockly-libraries` 及用户原工程保持只读。

## 1. 决策摘要

这次要交付的不是另一套 ABS 语言，而是“原来易写的 ABS，往返后不丢数据”。

1. 对外保留位置参数、`$变量`、单语句槽直接缩进、同一语句体内顺序串联、多分支命名槽。
2. 规范示例采用用户确认的 `variable_define("counter", int, math_number(7))` 和 `variables_set($counter, variables_get($counter))`，必须作为完整工程测试的一部分通过，不只测试字符串解析。
3. 区分规范写法与兼容兜底：`$counter` 直接选择变量字段，`variables_get($counter)` 显式创建值块；裸 `$counter` 在值输入中自动展开为 getter 的既有兜底继续保留。具名参数和既有带引号的变量字段值可作为同一语言的输入接受，但不再并列推荐两套变量规则；规范导出固定一种写法，不让 Agent 选择“旧 ABS”或“v2 ABS”模式。
4. 变量声明只写一次。宿主从已验证声明中准备模型，普通任务不再额外要求 Agent 手写 `createVariables`、变量 ID 或 `@var`。
5. 继续保留 ABI 基线、map、generation、Project Data、保护检查、完整读回和可恢复提交。它们是内部一致性机制，不是改写使用习惯的理由。
6. 不回退到旧转换器的“生成全新 ABI → 清空工作区”。所有可接受写法最终进入同一个规范 AST、同一个候选准备与无损合并流程。
7. 完成标准是实际嵌入式 Chat 的 LLM 能自主编辑、再次编辑、正式编译和保存重开；专项测试数量、生成代码或连接成功不能代替它。

## 2. 找回的旧 ABS 规范及可信边界

### 2.1 原始资料

| 来源 | 已核实内容 | 用法 |
| --- | --- | --- |
| [库仓库 ABS 总规范](D:/codes/aily-blockly-libraries/ABS_SYNTAX_REFERENCE.md) | 位置参数、4 空格缩进、单语句槽省略标记、多槽 `@NAME:`、字段/值输入中的 `$name`、动态块示例 | 主要历史语法来源；不是当前所有块均可创建的证明 |
| [core-variables 文档](D:/codes/aily-blockly-libraries/core-variables/readme_ai.md) | `variable_define`、`variables_set($name, ...)`、`variables_get($name)`，按 block.json args 顺序 | 普通变量任务的历史用户写法 |
| Agent Git 版本中的 `references/abs-syntax.md` | 单语句槽规范导出省略标记，多语句槽使用实际 input 名，括号必须保留 | 校对更接近实际使用的旧语法要求 |
| Agent Git 版本中的 `abs-syntax-guide.md`、`references/variables.md` | `$name`、`@var`、字面量简写；同时存在省略括号、模型声明与 C++ 声明混淆 | 记录并消除冲突，不整份恢复旧提示 |
| [主程序旧解析器](D:/codes/aily-blockly/src/app/integrations/blockly/abs/abs-parser.ts)、[旧导出器](D:/codes/aily-blockly/src/app/integrations/blockly/abs/abi-abs-converter.ts) | 位置映射、变量引用、缩进与别名的具体实现；也含猜测与旧转换行为 | 提取经过验证的语言行为，不重新接入旧写入路径 |
| [当前新解析器](D:/codes/aily-blockly/src/app/integrations/blockly/abs/abs-syntax.ts)、[统一语法测试](D:/codes/aily-blockly/src/app/integrations/blockly/abs/abs-unified-syntax.spec.ts) | 已接通原定义顺序、简洁语句体、变量字段与值输入 `$` 兜底、字符串/JSON 及来源范围 | 在现有模块补齐基础，不另写第三套解析器；普通全局声明准备已通过真实工具闭环 |

Git 取证快照：Agent `58601328b1a4d59edb0dc6fb86c7668769e512ba`，主程序 `924f337e79e46ba0f91f946939aa0951df196366`，库仓库 `b487c71dbc86f4efcdd5807a577179d5bdae0f1c`。工作区有未提交修改，Git 内容和当前文件不等同；上述 Agent 历史语法通过以下只读命令恢复，不切换分支、不覆盖文件：

```powershell
git -C D:\codes\aily-lex-pro show 58601328b1a4d59edb0dc6fb86c7668769e512ba:packages/aily-agent/src/skills/aily-blockly-project/references/abs-syntax.md
git -C D:\codes\aily-lex-pro show 58601328b1a4d59edb0dc6fb86c7668769e512ba:packages/aily-agent/src/appdata/prompts/blockly/abs-syntax-guide.md
git -C D:\codes\aily-lex-pro show 58601328b1a4d59edb0dc6fb86c7668769e512ba:packages/aily-agent/src/skills/aily-blockly-project/references/variables.md
```

旧 ABS 没有一份足以单独代表实际系统的机器可读 JSON Schema：它是文本 DSL，具体块参数由 Blockly 定义提供。必须合并规范、实际定义和实现证据，不能把某一份 README 当作全部事实。

旧 parser 的 `assignArguments` 和旧 converter 的 `argsOrder` 循环一直存在；此前缺口是新 generation 生产入口没有接回这份参数顺序，不是原能力被删除。本轮直接复用既有 `parseBlockDefinition(...).argsOrder`，不再维护平行的顺序提取逻辑。具体兜底、调用者与迁移状态见[旧能力迁移审计](D:/codes/aily-blockly/docs/abs-legacy-capability-migration-audit.md)。

### 2.2 不能照搬的旧行为

- 总规范第 4 节写“字段在前、值输入在后”，但 I/O 示例允许值输入先于字段，core-variables 又明确写实际 args 顺序。统一以宿主证明的原始顺序为准，不按 token 外观或字段/输入分类重排。
- 总规范允许 `$name` 在值输入中展开为 getter，core-variables 文档要求值输入使用显式 `variables_get($name)`。按用户确认，将前者保留为兼容兜底、后者作为推荐写法和规范输出，两者绑定后语义相同。这不是两套模式：字段上下文决定是模型选择还是生成值块；不能反向向 field_variable 填入一个 getter 块。
- “同级即 next”只适用于一个已确定的语句体，不适用于把顶层 setup、loop 或独立块栈连起来。
- 未知参数落到 `EXTRA_0`、`FIELD0`，未知输入猜成 `INPUT0`，任意 mutator 根据参数数目推断状态，均不恢复。
- `@var` 曾只注册 Blockly 模型，不等于 C++ 存储声明。它不进入新的普通编辑流程；有此写法的旧文本由可信 ABI 重新导出或给出明确迁移诊断，不将初始化值静默忽略，也不凭它推断 native model type。
- 不恢复丢 ID/保护/禁用块、大值转成 `[object Object]`、枚举失败退默认值等缺陷。

## 3. 统一后的公开 ABS 语法

本节是已实现并验收的核心语法；具体能力边界和运行产物仍需核对宿主合同与构建证据。

### 3.1 完整的最小验收程序

```text
# ABS Schema: 2
# Project Data Schema: 1 (external-only)

arduino_global()
    variable_define("counter", int, math_number(7))

arduino_setup()
    variables_set($counter, math_number(8))

arduino_loop()
    variables_set($counter, variables_get($counter))
    time_delay(math_number(1000))
```

预期 C++ 语义：全局 `int counter = 7;`，setup 赋值 8，loop 赋值为自身并 `delay(1000)`。不额外传普通变量创建清单。再次将 8 改成 9 必须保留原块和变量模型 ID。

这里的 `"counter"` 是声明名字的文本字段，`int` 是下拉枚举，赋值块中的 `$counter` 是变量下拉选择，`variables_get($counter)` 才是连接到值输入的变量块。规范导出保持上述形式；既有的 `variables_set($counter, $counter)` 仍可作为兜底输入接受，但导出时第二个参数明确为 `variables_get($counter)`。

### 3.2 语法与绑定规则

| 语法 | 统一规则 | 约束 |
| --- | --- | --- |
| `block(...)` | 块调用保留括号；位置参数按证明过的顺序绑定 | args0、args1 等按数字顺序，保留各组内部 field/value 的交错顺序；跳过 UI-only 项和 statement 槽 |
| `FIELD=value` | 同一语言的具名参数，可跟在位置参数后 | 不允许重复绑定、具名之后再接位置参数，或无依据的额外参数 |
| 子行直接缩进 | 父块仅有一个明确 statement input 时填入该槽 | 不根据 `DO` 等名字猜测；没有或有多个候选槽时要求实际名称 |
| 同语句体内同级子行 | 建立 next 链 | 终结块后仍有语句必须报错，不能丢弃后续行 |
| `@NAME:` 后缩进 | 明确的命名输入 | statement/value 类型来自合同；多个槽不得选“第一个” |
| `@NAME: value_block()` | 命名值输入的同行简写 | 只允许 value 槽；同时支持换行嵌套的同一语义 |
| 顶层同级块 | 独立根或独立块栈 | 不隐式跨根串联；罕见的根级 next 链保留现有明确表达 |
| `@next:` | 接受现有明确 next 表达 | 普通语句体导出用同级顺序，不要求每行增加注解 |
| `@extra:{...}`、`@disabled` | 保持已有受支持语义与完整读回 | 简化语言不放开未知动态形状或保护状态修改 |
| 注释、跨行参数、JSON | 使用现有词法扫描和来源范围 | 4 空格缩进；字符串中的 `#`、括号、`$`、JSON 不参与结构改写 |

新建固定形状的参数顺序来自当前已验证声明目录；既有动态实例来自导出基线捕获的实例合同。只有字段名而没有可信顺序时输出/要求具名参数，绝不能重新创建临时块来试探顺序。必要的顺序及输入种类随基线合同存储并计入 contractsHash，不能只存在会变化的全局目录中。

这里的“位置参数”仅指调用实参顺序，不是图形坐标。坐标、ID、保护等保留在 ABI，map/可信基线负责关联，不加入 ABS 元数据。示例中的 `VAR, TYPE, VALUE` 来自当前 core-variables 实际定义；若实际定义为 `NAME, VALUE, TYPE`，ABS 就必须使用 `block("counter", math_number(7), int)`，不得按块名固定字段顺序。

### 3.3 `$变量` 的精确定义

`$counter` 是变量引用 token，不是字符串替换规则，也不是变量模型创建指令。是否形成块节点由已绑定的目标槽决定，不能只看 `$` 字符就生成块。

| 目标位置 | 推荐写法 / 规范输出 | 既有兜底 | 绑定结果 |
| --- | --- | --- | --- |
| 声明名字的文本字段 | `"counter"` | 不把 `$counter` 当成名字文本 | 普通字符串；仅经验证的声明合同可据此准备模型 |
| `field_variable` | `$counter` | 既有 `"counter"` 字段值可按实际名字绑定，不作为另一套推荐语法 | 选择模型 ID，不生成 `variables_get` 块 |
| `input_value` | `variables_get($counter)` | 保留裸 `$counter` 自动展开 | 一个真实 getter 块，其变量字段选择对应模型 |
| 普通文本字段 | `"$counter"` | 不做变量替换 | 原样字符串 |

- 例如 `variables_set($counter, $counter)` 的第一个引用只选择字段，第二个引用按值输入兜底生成 getter；规范化结果为 `variables_set($counter, variables_get($counter))`。除赋值块本身外，恰好新增一个 getter 节点，不因字段引用多生成块。
- 兜底只在目标已证明是 value input、`variables_get` 合同可用且连接类型匹配时展开；不匹配时在装载前给出具体诊断，不猜字段、不执行库代码试探、不静默丢值。向 field_variable 传 getter 块仍报错，不做反向“自动拆块”。
- 具名参数改变绑定方式，不改变值的语义，例如 `VAR=$counter` 仍是变量字段选择。带引号的旧字段值属于兼容读取；Agent 主指引和导出统一采用 `$counter`，不要求 Agent 试换引号来解决模型缺失。
- 支持 `$"显示名"` 表达既有特殊名字。兼容读取模型字段的 `"$counter"` 时，它指名字本身含 `$` 的模型，不得擅自去掉字符；普通文本字段也必须保持原文值。
- 引用只查已有模型与本候选的明确声明。兜底生成的是 getter **块**，不是变量 **模型**；拼错、缺失、同名歧义、native type 不兼容必须在装载前拒绝。
- 已有同名不同类型引用仍按可信基线保留身份；发生引用变化时不能选择列表中的第一项。显式 getter 与兜底写法共用相同的引用解析、身份匹配和保护检查。

### 3.4 字面量及动态形状的有限兼容

- 数字/文本字段保持其真实类型；dropdown 按实际选项绑定，规范输出合法裸标识符，如 `int`、`Serial`、`OUTPUT`，不统一加引号。含空格或不能无歧义表达为裸 token 的选项使用字符串形式；既有 `"int"` 输入可兼容归一为 `int`。`false` 的解释由目标字段决定，不全局改成 `FALSE`，也不把字符串选项错误转为布尔值。
- 普通 value input 优先使用 `math_number(...)`、`text(...)`、`logic_boolean(...)` 或其它真实值块。历史 `number(n)` 可按固定别名展开成 math_number；其它历史字面量简写只有在目标槽和对应宿主块合同均明确时才展开，否则给出具体写法诊断，不试探执行库代码。
- 多分支 `@IF0/@DO0/@ELSE` 的语法可接受不等于任意 mutator 可新建；实际形状准备继续由具名宿主合同负责。现有原生过程/自定义函数合同继续复用。
- 本轮不承诺恢复所有历史别名、任意动态参数数量、无括号根块或任意库对象创建。旧示例遇到这些边界应一次明确说明，不能让 Agent 轮换括号、引号和变量写法反复试错。

### 3.5 大数据及文件版本

保留 `# ABS Schema: 2`、Map Schema 1、Project Data Schema 1；不再增加一个对外“ABS v3”或模式开关。它们的作用分别是标识解析家族、身份索引和资源格式，不要求人维护具体 ID/哈希。

- `.abs` 是可编辑程序投影；`.abi` 保存完整状态；`.abs.map.json` 和不可变基线由宿主管理。
- 已有 `$ailyData` / `$ailyProjectDataValue` JSON 原样接受，不能被 `$变量` 扫描器误处理。
- 沿用现有通用大值外置和还原路径；不得按 field_multilinetext、u8g2、tft 等字段或库名单修补。
- 生成的头文件继续写到工程 `src`；必须在正式编译中证明引用可解析。文件存在不是编译成功。
- 不新增 `@meta`、第二份 meta 文件或数据协议。现有 @extra 中的原生身份由合同保护；不能为了“看起来简洁”直接删去。

## 4. 最小实现架构与模型准备

唯一数据流：

```text
ABS 原文 + 基线/当前宿主合同
    → 词法与结构绑定 → 规范 AST（保留原文范围）
    → 声明/引用准备 → 身份合并 → Project Data 准备
    → 同一租约内实际装载、完整读回、生成、提交
    → 同一语法前端规范导出 ABS/map
```

### 4.1 模块职责

| 模块 | 本轮调整 | 不承担的职责 |
| --- | --- | --- |
| `abs-syntax.ts`、`abs-field-values.ts` | 扩展引用 token、简洁语句体、命名值同行表达；复用已有位置参数和词法器 | 不创建 Blockly 块/变量，不分配真实 ID，不访问文件 |
| `abs-declarative-contracts.ts`、声明目录、基线合同 | 复用原 `parseBlockDefinition` 顺序，暴露输入种类和声明能力；`abs-syntax-contracts.ts` 选取一致的基线合同 | 不维护第二套顺序提取器，不按字段名字推断“这是模型声明”，不实例化库块探测 |
| 新增一个纯 `abs-declaration-intents.ts` | 收集并校验候选声明，产生已有变量准备层需要的意图 | 不扫描 JS 猜效果，不加载工作区，不另建模型数据库 |
| `abs-variable-intents.ts`、`abs-symbols.ts` | 复用确定性 ID 准备和已有模型绑定 | 不由孤立引用隐式创建，不删除未使用模型 |
| `abs-identity-map.ts` | 将渲染职责提取为小型 `abs-renderer.ts`；按同一合同简洁导出并建立 map | 不保留两套规范输出器，不把元数据复制进 ABS |
| `abs-reconciler.ts`、`abs-prepared-reconciliation.ts` | 消费规范 AST 和模型计划；保留身份、资源与完整检查 | 不放宽歧义匹配，不做模糊自动合并 |
| `abs-workspace-sync.service.ts`、既有存储/Runtime | 协调同一准备、装载、读回和提交 | 不增加第二个 Generator Realm、后台重放或新事务框架 |
| Agent 工具与 Chat 构建 | 单一规则来源、真实宿主调用、实际 bundle 一致性检查 | 不独立解释 ABI 或回退到旧转换器救场 |

优先修改现有模块。新增的合同选取纯函数只解决导出/解析对同一冻结顺序的共享，不增加服务；声明意图与渲染各保持单一职责，不为每一种拼写、每一个库再增加一层服务。

### 4.2 变量声明的一次性准备

1. 先将所有表面写法绑定为规范 AST，获得实际字段/输入，不先执行库 init/generator。
2. 依据宿主确认的声明能力收集声明：包含名字字段、native model type、声明作用域和角色。ABS 下拉字段 `TYPE=int` 的内部选项值为字符串 `"int"`，不等于 native model type 为 `"int"`；普通变量沿用空 native type。
3. 优先匹配并保留既有声明块/模型身份。重复编辑同一声明复用模型；不能把修改已有声明名字当成“创建新变量并遗留旧引用”。重命名/重定向仍需独立明确操作。
4. 只有明确新增的声明才准备缺失模型。多个互相冲突的声明、重复存储声明、作用域不可证明或同名歧义拒绝；不能通过两个不同 ID 的同名模型来掩盖冲突。
5. 用完整候选的声明集合解析引用，支持合理的前向引用，但仍校验作用域/库对象生命周期。`$counetr` 不会因为存在 `$counter` 而被自动纠正。
6. 在同一 detached 候选中应用模型计划和块计划；validate 与 apply 使用同一个推导逻辑。实际 native load 产生额外模型仍判读回失败，不再把 Generator 副作用当成模型创建方案。
7. 原有 `createVariables` 准备实现保留为内核能力。普通 Agent 工具不再要求平行清单；过渡期显式清单如仍被旧内部调用传入，只能与声明推导一致并去重，冲突必须报错。统一工具指引后移除不必要的外层参数暴露，不长期维护两套创建工作流。

首个新增声明合同覆盖实际普通全局变量创建/赋值/读取。已有过程/函数参数的声明意图复用其已经审计的合同；局部重名变量、任意库对象、函数重命名不借本轮顺便放开。库无需新增 Project Data 或声明配置文件；宿主登记经验证的实现来源与声明效果，不以块名前缀建立猜测白名单。

### 4.3 身份、范围与版本升级

- 只有值输入中的裸 `$counter` 兜底才展开 getter；变量字段的 `$counter` 不产生块节点。展开出的 getter 必须成为真正参与 map/身份合并的节点，保留原 token 的来源范围；不能等身份匹配完再偷偷插入。显式 getter 与兜底写法互换时语义指纹一致，既有 ID 不重建；重复展开、导出再读取均不得增加额外 getter。
- 字段 token 先完成语义归一化再计算匹配指纹；普通字符串 `"$counter"` 与引用 token 不得碰撞。所有诊断指向输入原文，不指向改写后的临时文本。
- 调整规范输出和合同结构须推进内部 `ABS_PROJECTION_VERSION`（本轮已由 `abs-v2.preview.3` 推进至 `abs-v2.preview.4`），不能用新渲染器重新解释旧 map 的偏移后宣称其可信。
- 对内部未发布 preview，仅提供一次显式的安全升级：复用已有 inspect → 绑定原字节/范围的 token → export 重建流程，补充 projection-upgrade 诊断；保留旧 ABS/map/基线。旧基线读取只服务升级/恢复，不回到旧有损应用入口。
- 仅在无 pending、无未应用 ABS 修改、可信 ABI/基线可验证且上下文未变时升级。否则保留原候选并报告需要处理的冲突；不能让 Agent 删除 map、强行 initialize 或换一个 generation 重放旧候选。
- generation、页面/项目租约、完整文档 revision、CAS 和跨页共享引用覆盖继续按现有协议校验。本轮不新增隐式 export/rebase，不把单页候选变成全项目覆盖。

## 5. 三个交付阶段

### 阶段 A：一套语法与一次声明准备

交付：第 3 节核心语法、规范输出、普通声明推导、来源范围/map、旧 preview 显式升级。

- 先将第 3.1 节和原库典型例子固化成可执行用例；同一 AST 分别从简洁写法和既有具名写法产生，核对身份与字段值。显式 `variables_get($counter)` 与裸 `$counter` 值输入兜底必须单独做往返等价测试，确认变量字段无额外块、值输入只有一个 getter、来回改写后 ID 保持。
- 一次串通 parse → prepare → apply → export；不以“解析已支持，实际加载以后再做”为阶段完成。
- 复用现有模型/保护/大文本/回滚测试；新增陌生类型字段、混合参数顺序、`$` 字符串、重复引用、终结块和多槽歧义反例。
- 退出条件：普通变量完整工程无需外层 createVariables 即可提交；二次编辑 ID 不变，所有拒绝场景不落半状态；主程序与 Agent 类型检查/构建通过。

### 阶段 B：统一真实产品入口并清理冲突路径

交付：Agent 工具、技能、库文档提示及 portable Chat 使用同一语义与同一次实际构建。

- 以 Agent 工程技能的 ABS reference 为唯一维护的语法正文；通用工具描述只保留短约束/指路，内嵌完整说明由构建时派生，不手工维护第二份相反规则。
- 主指引明确保留：`variable_define("varName", ...)` 声明 `$varName`；field_variable 直接传 `$varName`，input_value 推荐 `variables_get($varName)`；类型枚举示例使用 `int`。值输入中裸 `$varName` 的历史自动展开单列为已支持的兼容兜底，不与推荐写法并列成两套规则，也不得在工具提示中声称该兜底非法。
- `library_docs` 不再附加“不要用下面示例的 $ 写法”。宿主能力/字段信息应解释语法和实际约束；具体库 API 仍需核对，不把历史 README 的错误参数变为许可。
- `block_info` / `blocks_list` 的签名、语法样例和能力来自同一合同；名称/类型未知时一次给出明确缺口，不返回貌似可调用的猜测签名。
- 构建 aily-agent 后必须构建 Chat 的 portable 产物（`build:subapp`），而不只是确认开发链接存在。现有规则文件前置检查继续使用；补充能对照实际 Agent JS、规则资源及相关构建输入的版本/摘要证据，不能只看文件时间戳、Git HEAD 或 README 哈希。
- 构建开始/结束校验输入未变化；实际加载包与证据对应。旧包在模型调用前明确报出需更新的宿主/Agent 状态，不消耗一次会话去发现规则冲突。不自动重启用户窗口。
- 盘点 `abs-auto-sync`、`prepareAbsCandidate`、旧 converter/parser 和 Agent abs-core 的调用者。项目写入全部落到唯一协调器；确属无调用的代码再删除，仍被只读文档/迁移使用的部分明确隔离。禁止按文件名批量删除旧代码。
- 退出条件：同一真实 Chat 加载到的规则、schema 与执行代码一致；无相反变量/结构提示；旧写入入口不可达；必要的原只读消费者继续通过测试。

### 阶段 C：真实 LLM、编译、重开验收

交付：可重复运行的完整场景报告，不再只给外部工具脚本结果。

1. 通过真实 Electron 页面输入自然语言任务，不预写工具调用或手工提供创建清单；使用同一实际 Chat 后端观察会话。
2. 空板工程：第一轮变量声明/赋值/读取/延时；同会话第二轮改值并再次编译。覆盖用户给出的简洁 ABS 与规范导出。
3. 含真实大数据的工程副本：LLM 修改一个普通业务参数，保留动画/数组；正式构建验证 `src/*.h` 引用，保存关闭重开后核对资源哈希、块 ID、保护与模型。至少完成一轮后再进行第二次小改动，不能只验证首次导入。
4. 已有函数专项继续覆盖创建、参数、返回值与调用的真实生命周期；本轮声明推导不得退化这些已支持合同。
5. 本轮基础故障检查至少包含陈旧 generation 拒绝、缺失资源拒绝和完整读回失败回滚；不能因简写而绕过保护/共享引用门槛。
6. 一个简单任务如再次陷入交替修改 `$`/引号/缩进，应停止重复试探，定位同一规则链并修复；失败输入、实际加载产物和恢复状态保留为回归夹具。

阶段 C 失败就回修 A/B，不扩展下一类动态库来替代验收。三个阶段可在同一工作批次连续完成，阶段退出条件不能跳过。

## 6. 必须提交的验收证据

| 范围 | 必须证明 | 不足以作为证明 |
| --- | --- | --- |
| 使用体验 | 真实 LLM 两轮自主编辑完成；记录重试原因、工具调用数和会话耗时 | 手写 Agent 工具序列成功 |
| 语法 | 简洁/具名写法归一后等价；裸变量值输入兜底保留，规范导出显式 getter；枚举 `int` 不加引号；原文范围正确 | 单次 parser 返回 success |
| 变量 | 声明、native model、读写引用、C++ 存储一致；字段引用不生块，值输入生成一个 getter；两种值输入写法互换及二次编辑复用 ID | 只有变量表或只有声明块；兜底生成重复块或隐式创建模型 |
| Project Data | ABS/ABI 紧凑，通用文本/数组及已有资源本体哈希一致，重开可还原 | 只检查资源文件存在 |
| 保护和隐藏状态 | 根 ID、deletable:false、禁用状态、已知 extraState/影子块保持 | 仅比较生成 C++ |
| 提交/恢复 | COMMITTED、完整读回通过、内存与磁盘一致；故障后可验证恢复 | 工具外层未抛异常或 pending=null |
| C++ 编译 | 正式 project_build 非 preprocess-only 成功；新 buildInfo、对应源码、实际 ELF/固件及头文件引用 | 旧缓存状态、代码生成、`.h` 存在 |
| 产品产物 | 真实进程加载的 bundle/规则与本次验证构建一致 | Agent 源码已更新或链接路径正确 |

首次加载/SDK 复制耗时与 LLM 编辑耗时分开统计；同规则失败重试单列，不能被后续成功掩盖。保留有限总时限和无进展 watchdog，区分模型服务、宿主环境与 ABS 功能错误，不通过外部编译器绕过正式构建。

原工程、库和源登录记录在测试前后核对哈希；只复制用户授权的登录到独立 profile，不输出令牌，不操作默认聊天历史。退出清除测试凭据；运行期与关闭期错误分别记录。硬件上传/运行不在本轮范围，编译成功不能声称实际动画播放或设备行为已验证。

## 7. 收敛范围与停止条件

本轮完成后可宣称：在已验证块合同内，单一简洁 ABS 的普通编辑、声明模型准备、大数据保留、正式编译和重开闭环可用。

不能宣称：任意库和 serializer 全覆盖、跨页批量自动重写、任意模型重命名/删除、完整恢复 UI、历史资源 pin/GC 或硬件功能完整。GC 继续关闭；这些独立能力不再作为普通变量任务迟迟不能完成的理由。

以下任一情况阻止阶段交付：

- 简单变量任务仍要求用户/Agent维护额外模型表或手工编辑 map。
- 同一会话收到冲突规则，或真实 Chat 仍运行旧 bundle。
- parser 支持简写，但导出、来源范围、完整读回或重开不支持。
- 为通过验证放宽保护、未知字段/动态状态、额外模型、跨页或陈旧写入检查。
- 只报告编译成功，却没有证明这是本次候选的实际代码和产物。

## 8. 当前状态与下一步

- [x] 找回并完整读取旧 ABS 总规范，核对变量库示例、Agent Git 版本和现有解析/导出实现。
- [x] 固定单一公开语法、最小架构、三个阶段及真实验收标准。
- [x] 旧执行文档指向本方案，保留历史失败与回归证据。
- [x] 接回既有参数顺序来源，贯通当前 parse / prepare / apply / export，覆盖交错输入与第二次编辑。
- [x] 实现简洁单槽语句体、变量字段 `$name`、值输入裸 `$name` 兜底及规范显式 getter 输出；保留来源范围、块 ID 和保护状态。
- [x] 内部投影升级至 preview.4；旧 preview.3 只用于严格校验/恢复及显式重新导出，不允许普通应用。
- [x] 完成[主要旧兜底与入口迁移审计](D:/codes/aily-blockly/docs/abs-legacy-capability-migration-audit.md)，清理确认无调用的旧私有代码。
- [x] 本轮基础验证：主测试 553 项、加载专项 9 项通过，TypeScript 检查与 Angular 开发构建通过；架构检查另报 4 处本轮未修改的 user-center 跨层导入，详见审计记录。这些验证不等于 C++ 编译或真实 LLM 验收。
- [x] 普通全局 `variable_define(...)` 从声明一次性准备模型，无需外层 createVariables；真实 Electron 中实际 Agent 工具两轮编辑与保存重开通过。
- [x] 阶段 A：语法、普通全局模型推导、规范输出与基线升级。局部/高级声明与任意库对象不借此扩展。
- [x] 阶段 B 子项：统一 Agent 规则、移除重复语法正文、修复 block_info 的 fields-first 重排及 argsN 截断；正式 ABS 工具均指向 live 宿主协调器。
- [x] 阶段 B 子项：Node 22 / ABI 127 下 build:subapp 成功，portable/安装后运行验证通过；14 份 Blockly Agent 规则与源码一致。
- [x] 阶段 B 子项：真实嵌入式 Chat 页面构建标记/入口 JS 摘要与 portable 文件一致，复用隔离登录后完成实际 LLM 会话。
- [x] 阶段 C 子项：真实 LLM 同一会话两轮普通变量编辑、两次正式 C++ 编译、72 KB 外置文本保留和保存重开通过，详见第 10 节。
- [x] 阶段 C 子项：真实动画例程副本两轮坐标编辑、两次正式 C++ 编译、资源/头文件/原生状态保留及保存重开通过。
- [x] 阶段 B：规则来源、构建输入/产物/实际执行 JS 代次校验、选中块上下文迁移及无调用旧写入路径清理；真实 Electron 正常启动与目录断线恢复通过。
- [x] 阶段 C：既定普通变量/动画核心场景的真实 LLM 两轮编辑、正式编译、大数据和保存重开；主回归 565 项通过。启动连接异常另列待修，不代表产品发布门槛全部完成。

阶段 B 收敛记录见第 11 节。普通变量和真实动画两条 LLM/正式编译链路均已通过，不再把它们列为尚未运行。不要再次改写已经通过的普通声明与参数顺序。数字/字符串/HIGH/LOW/var 等历史值输入兜底尚未全部实现，属于后续有边界的能力扩展，不是继续搁置核心闭环的理由。

## 9. 普通声明闭环与 Agent 统一实施记录（2026-09-15）

### 9.1 已实现

- `blockly-variable-declaration-contract.ts` 在既有 iframe 加载边界证明模型效果；声明式目录另外证明字段/连接。无新服务、Realm、probe 块或库侧修改。当前明确覆盖普通 variable_define 直接位于 arduino_global 的语句体，native type 为空，不与 TYPE=int 混淆。
- `abs-declaration-intents.ts` 在身份匹配后、引用绑定前做纯准备，复用 `prepareAbsVariableCreations`。新声明产生确定性模型；同候选前向引用可绑定，二次编辑复用 ID。重复存储声明、同名类型/大小写冲突、隐式重命名和缺失既有模型拒绝。已有特殊名字和未改变的非全局声明不被新的名字/作用域限制重写。
- 显式高级模型清单仍供过程/FUNC/参数协议使用；普通全局不再需要。与声明一致的过渡清单复用同一模型，不一致则拒绝。没有放宽完整读回、资源、保护、跨页或提交边界。
- Agent 语法帮助直接编译技能 `references/abs-syntax.md`，删除重复的 `appdata/prompts/blockly/abs-syntax-guide.md`。工具提示、library_docs 桥接说明、字段指引和变量/自定义函数示例改为同一 `$` 语义。
- 宿主 capability 的 `shape.argumentOrder` 原样传给 Agent 签名；校验完整覆盖、唯一性和槽种类。缺少可信顺序时不生成伪位置签名。独立只读元数据解析也按数字遍历所有 argsN，不再截断到 args10。
- 正式 abs_export / validate / apply / import 的注册入口已确认调用 live 宿主；移除该入口依赖桶中未使用的 offline import 导出。旧解析/转换代码仍有迁移和恢复消费者，不批量删除。

### 9.2 真实 Electron 证据

通过正式主程序、完整 preload、真实 Blockly 和用户源工程依赖的独立空白板卡副本运行实际 Agent 工具（不是 LLM 自动规划）。最终候选包含本方案的 `variable_define("counter", int, math_number(7))`、setup 赋值 8、loop 读写变量与 delay(1000)；第二次编辑把 8 改为 9。

首轮使用裸 `$counter` 值输入兜底，规范导出出现显式 getter。全程未传普通 createVariables；拼错引用被拒绝，重复显式创建被拒绝。实际生成 C++、保存与关闭重开后核对模型/引用、根 ID、deletable、ABI 内存/磁盘哈希和 ABS/map 字节。

- [最终真实页面报告](C:/Users/LENOVO/AppData/Local/Temp/aily-project-data-ui-HqoDHD/result.json)
- [最终运行日志](D:/codes/aily-blockly/.tmp-abs-declarations-electron-final.log)
- 先前不含 delay 的基础场景也通过：[基础闭环报告](C:/Users/LENOVO/AppData/Local/Temp/aily-project-data-ui-IxGC93/result.json)，Agent 场景用时 62.558 秒，运行/关闭错误列表为空。

失败并修复的证据不隐藏：首次发现技能正文被导入却未列入 Rslib 资源入口，导致实际 Agent 启动缺少 abs-syntax.js；已补入口并新增产物正文一致性测试。第二次已完成两个提交，在最后 inspect 时触发旧的 90 秒场景总时限；多事务变量场景总时限调整为 270 秒，单步无进展仍为 90 秒，并记录各阶段耗时。之后完整重跑通过，不以超时前的部分成功冒充完整验收。

### 9.3 验证与尚未完成项

| 验证 | 本轮结果 |
| --- | --- |
| 主程序 abs-sync | 565 项通过；`.tmp-abs-declarations-final-tests.log` |
| 项目加载专项 | 9 项通过；`.tmp-abs-declarations-load.log` |
| Agent ABS 专项 | 最终重新构建后 62 项通过；`packages/aily-agent/.tmp-abs-declarations-agent-final.log`；包含规范帮助与技能同源、args11 顺序、capability 反例 |
| 主程序类型检查/开发构建 | 通过；`.tmp-abs-declarations-final-types.log`、`.tmp-abs-declarations-final-build.log` |
| Agent 构建及声明文件 | 通过；`.tmp-abs-declarations-agent-build2.log` |
| 真实 Electron / 实际 Agent 工具 | 两轮编辑、生成、保存重开通过；不是 LLM 会话，也不是正式 C++ 编译 |
| 服务架构检查 | 仍报 4 处本轮未修改的 user-center 深层导入，0 个环；未顺带修改 |
| Chat portable | **通过**。Node 22.19.0 / ABI 127 下构建、结构/JS 语法、Agent 工具发现、MCP/Server/worker/Pi CLI、npm 打包及安装后运行验证均通过；14 份规则一致，资源检查自身 2 项测试通过 |

portable 构建时间标记 `2026-09-15 13:58:05`，产物 `D:/codes/aily-lex-pro/packages/aily-chat/dist/aily-chat`，日志 `.tmp-abs-declarations-portable-node22.log`（位于 aily-lex-pro）。初次 Node 24 / ABI 137 与现有 isolated-vm / ABI 127 不匹配而失败；通过临时包缓存中的 Node 22 和 npm 重试，没有重编译或修改仓库原生依赖，也没有修改全局 PATH。可复用命令：

```powershell
pnpm.cmd --package=npm@10.9.3 dlx npm exec --yes --package=node@22.19.0 -- node packages/aily-chat/scripts/build-portable-js.mjs
```

构建内置运行验证不是已打开用户 Chat 进程的替换证明。本轮没有重启用户窗口、复用登录或调用真实 LLM。下一阶段仍需证明嵌入式 Chat 实际加载本产物；构建输入/实际 JS 的自动摘要门槛还未完整接入产品，不能用 14 份文本比对代替它。

最终完整最小程序的 Agent 工具场景耗时 74.474 秒，运行/关闭错误列表为空；保存与重开后内存/磁盘哈希均为 `68ce2f788665756ee797e20db37c061dd01b7d72a2da864df0728554c47fd16c`。源工程 ABI 哈希仍为 `d556530fc57380bf8fab311d13e11f7ba52d3c39a39a67fd03fd24bc1e4de743`。

本节记录时的剩余主线：嵌入式 Chat 实际加载一致性 → 真实 LLM 两轮自主编辑及正式 project_build → 大数据副本保存重开。本节对应批次未修改库、用户原工程及登录资料，也没有使用登录凭据。后续真实会话见第 10 节。公开 ABS Schema 2、Map Schema 1 和 Project Data Schema 1 均未变化。

## 10. 真实 LLM / 正式编译收敛记录（2026-09-15）

### 10.1 本批修复与验收结构

- 修复 Agent `project_status` 的旧 ABI 统计：分页 ABI 从所有页面的原生 block 树与共享 procedureBlocks 计数，共享变量只统计一次，不遍历大值/extraState、不将共享定义重复组合到每页。不改变任何文件或模型。损坏或无法读取的 ABI 返回未知计数及 readError，不再伪装成 0 个块的空工程；结果标明 `summaryScope=persisted-project`。
- 修正交付指引：`blocks_tidy` 是布局修改，不是只读校验。只改字段值、要求布局不变时不调用；正式编译在最后一次修改之后进行。保留实际 apply、完整读回、提交及构建证据检查。
- 将真实会话驱动与证据判断提取为 `project-data-llm-round.cjs` / `project-data-llm-evidence.cjs`，普通变量与真实动画场景共享。自然语言通过实际 Chat composer 提交；E2E 接口只读观察，不替模型安排 ABS 或工具调用。
- 两轮按新用户消息与 toolCallId 区分，旧回复/旧工具成功不能满足第二轮。每轮有 12 分钟总上限、180 秒无进展上限；读取快照产生的 revision 增长不算 Agent 进展，编译期间 Ninja 日志推进计入可观察进展。准备/复制工具链与会话耗时分开记录。
- 编译证据必须同时满足本轮成功工具结果、新 buildInfo、新 sketch 和本轮修改时间之后的非空 ELF。保存重开要求模型/保护属性/资源值一致、内存与磁盘 ABI 相等、ABI/ABS/map 三份字节不变。
- 新增验收自身反例测试，拒绝旧轮结果、陈旧 ELF/源文件和无进展快照；不是通过延长无限超时取得成功。

### 10.2 空白板卡 + 72 KB 大文本：真实会话通过

[完整报告](C:/Users/LENOVO/AppData/Local/Temp/aily-project-data-ui-s87s7o/result.json)，同目录保存两轮会话和真实页面截图。使用用户样例的依赖复制出空白板卡，仅预置三个原生入口及独立大文本哨兵，不预置变量模型或业务代码。

- 实际模型为 `aily-services/auto`。第一轮自主查询后写出 `variable_define("abs_counter", int, math_number(7))`，field_variable 用 `$abs_counter`，值输入用 `variables_get($abs_counter)`；没有提交普通 createVariables，没有切换语法，没有失败重试。
- 第二轮同一会话只把 setup 赋值 8 改成 9，变量模型 ID 保持。两次 abs_validate / abs_apply / project_build 全部成功，运行及关闭错误列表为空。
- 第一轮会话 394.485 秒，正式构建 110.55 秒，30 次工具调用；第二轮会话 298.851 秒，正式构建 46.14 秒，16 次工具调用。失败工具数均为 0。会话/核对总计 699.268 秒，不含先前隔离工具链复制。
- 两个新 ELF 均为 6,311,384 字节，摘要分别为 `6bad1f8201208542c91b58ef360b5bf8f6dc156a6278b18b5c78b8faf8995f51`、`73051f591be6c5c39f9cc28ac08e977df17261b3994b1af7ce377016b305df30`；源码摘要也分别对应 8、9，不是复用旧固件。
- 最终保存/重开后内存与磁盘 ABI 摘要均为 `e749db445b6f987350ba8f2893b61abaf2e09e58a619b0a4f0b71d04ea01964d`，72 KB 文本逐字符一致，三个入口 ID/deletable 保留，三份镜像字节一致。
- 实际嵌入 UI 构建时间为 `2026-09-15 13:58:05`，入口 JS 的服务端响应摘要与 portable 文件一致：`92526201de4b47953b61bb6071461f32b0d7c8ce7f44758d9c26d72d4cc165ea`；14 份规则在启动前比对通过。本次运行发现的 project_status/布局指引遗漏在会话结束后重建到下一份 portable，不声称本报告已使用这些后续修复。
- 原工程 ABI 摘要仍为 `d556530fc57380bf8fab311d13e11f7ba52d3c39a39a67fd03fd24bc1e4de743`；源配置/登录文件摘要复核不变，隔离登录副本已删除，未上传硬件。

### 10.3 真实动画 / C++ 大数组：两轮通过

[完整报告](D:/codes/.abs-generation-smoke-20260915/aily-project-data-ui-gkgL7m/result.json)，同目录保留两轮会话、每轮即时构建证据及真实页面截图。使用 `project_jul13d_353995` 的独立副本，模型从自然语言自行将播放 X 坐标 60→61→62，不重建动画，不传特定资源操作序列。

- 两轮均一次通过 abs_validate / abs_apply / project_build。第一轮 343.838 秒、14 次工具调用、正式构建 76.79 秒；第二轮 146.712 秒、7 次工具调用、正式构建 38.30 秒。失败工具数为 0；隔离 SDK/CLI 复制单独耗时 308.356 秒。
- 比较完整原生工作区，除请求修改的 X 数值外均不变，包括所有块 ID、坐标、deletable、变量、动态字段与动画配置；新指引下没有为字段修改调用 blocks_tidy。
- 原始帧数据 374,400 字节，带存储封装的资源文件 374,627 字节；与 1,011,174 字节源视频一起，在两次编辑、编译及重开后逐文件摘要一致。资源文件摘要 `fea743a13dc27ee582712c618383a5d6df5475a4fc8bd186401ee342dec827ea`，视频摘要 `679c507f3119b58f61273347f61a0b17ff1df8a666493dd522350ad6b7e402d4`。
- `src/variables_seeed_gfx_animation_a538eec171dc8cc1-d179ecaf.h` 共 1,530,987 字节，摘要 `fb69112ad244078797dafa1de083fd7ee1a90fd924c2c907c9a69168e5398302`。两轮确认 sketch 保留 include，编译工作目录中的头文件与项目 src 完全一致；生成调用分别使用 `(tft, 61, 60, ...)`、`(tft, 62, 60, ...)`。
- 两次新 ELF 均为 8,537,204 字节，摘要分别为 `786a60eee42586ee1c189579dd217a008c407e6071114a0a3767ac3c5f456a5b`、`11f02d22e0ccc8ffddb2e209c88ded772b51dab56b8f8904ebca881e6529ca1c`。四次构建记录的 lastBuildCode 均与对应 sketch 摘要一致；当前测试辅助函数也已固化此检查。
- 最终内存/磁盘及重开摘要均为 `5e739ec8e012d5af4c7e018deeeb09fddfb85327e6d687d78e6c52412810b494`；三份 ABI/ABS/map 镜像字节未变，原工程/登录源文件未修改，隔离凭据已清除。
- 新 portable 标记 `2026-09-15 14:28:02`；实际 project_status 在会话中返回 9 个块、2 个变量和 `summaryScope=persisted-project`，证明本批后端统计修复已被使用。Agent/Chat 构建、portable 结构、JS、各运行入口、npm 打包安装验证全部通过，14 份规则重新比对通过。

保留启动异常，不以成功结果掩盖：14:29:05 的启动阶段记录了一次 WebSocket 连接断开，产生 1 条 console 和 4 条 pageerror（未处理 Promise rejection），随后自行恢复；两轮编辑/编译/重开阶段没有错误。现有证据不能确定是启动竞态还是测试与构建时间重叠所致，应在构建完全结束、单独启动的条件下复现并修复 Promise 处理，不能先归咎于 Project Data 或忽略异常。此次未为此修改连接层。

早期报告中的 `linkedChat.llmTurnTested=false` 是连接探测子步骤的原始标记，真实会话证据在 `llmGeneration` / `llmAssets`；当前脚本已修正汇总标记，并将规则比对增加到实际加载之后。保留原始报告，不改写历史证据。

### 10.4 本批验证与剩余项

- Agent 构建及声明文件通过；`node --test test/abs-*.test.mjs test/abi-project-status.test.mjs` 共 **66 项通过**，含分页统计、损坏状态、能力/参数顺序/变量指引、持久化和旧离线写入拒绝。
- 验收守卫 `node --test scripts/project-data-linked-chat-smoke.test.cjs scripts/project-data-llm-evidence.test.cjs` 共 **5 项通过**；相关 CJS 语法检查通过。
- 本批重新运行 `node node_modules/@angular/cli/bin/ng.js test --configuration=abs-sync --watch=false --browsers=ChromeHeadless --progress=false`，**565 项通过**，包括现有函数/模型、陈旧 generation、缺失资源、完整读回与回滚。主程序业务代码本批未改；页面使用上一批成功构建的主程序，不声称本批重新执行了 Angular 产品构建。
- 真实动画资源副本与普通变量专项均已通过；共四轮自主 LLM 编辑、四次正式编译及两次保存关闭重开，不需要继续把这两个场景列为“尚未部署 Agent / 尚未真实测试”。未验证硬件实际播放或电气行为。
- 阶段 B 尚有明确剩余：构建前后输入摘要和实际后端 JS 的产品级启动门槛未完整接入；当前 UI 摘要/规则比对不能替代它。旧 converter 仍被 Blockly 选中块上下文/行号回退使用，Agent 旧解析器仍有元数据与受限恢复消费者，不能按文件名删除。需要先迁移这些实际消费者，再移除无调用服务及对应重复实现。
- 本批没有更改 ABS/Map/Project Data schema、参数顺序、变量 token 语义或库内容。通过上述最小程序只证明受支持闭环可用，不等于所有动态块、局部/高级对象创建与历史字面量兜底全面完成。

### 10.5 重复执行

先在 aily-lex-pro 完成第 9 节的 portable 构建并等待其全部验证结束，再运行以下命令。主程序 development 产物也须与源码匹配；不要同时构建与启动验收。Node 版本使用与当前 isolated-vm 一致的 Node 22 / ABI 127；下面 node.exe 路径为本机已验证的临时包缓存路径，不改变全局 PATH。

```powershell
# 工作目录 D:\codes\aily-blockly；环境变量只影响本终端及测试子进程。
$env:AILY_AGENT_ROOT='D:\codes\aily-lex-pro\packages\aily-agent'
$env:AILY_ABS_AUTH_SOURCE='C:\Users\LENOVO\AppData\Local\aily-project'
$env:AILY_ABS_AUTH_FILE='.aily'
$env:AILY_ABS_VARIABLE_ONLY='0'
$env:AILY_ABS_LLM_ONLY='1'
$env:AILY_ABS_LLM_DATA_ONLY='0' # 0: 普通变量两轮；1: 原动画例程两轮
& 'C:\Users\LENOVO\AppData\Local\npm-cache\_npx\992a19d7d9bf36d4\node_modules\node\bin\node.exe' scripts/project-data-electron-smoke.cjs 'C:\Users\LENOVO\Documents\aily-project\project_jul13d_353995'
```

每次创建新临时工程、独立登录/会话状态及编译环境，结果位置由 `RESULT=` 输出；不得改为用户原工程直接编辑。若要把临时文件放到 D 盘，先选定已存在的测试目录，再仅为此终端设置 TEMP/TMP。完整报告保留启动错误、工具失败、每轮固件摘要及清理结果，不删改失败记录。

历史依据：[原无损同步执行文档](D:/codes/aily-blockly/docs/abs-abi-lossless-sync-execution-plan.md)、[第 27 批实际失败](D:/codes/aily-blockly/docs/abs-abi-lossless-sync-execution-plan.md:2248)、[Generator Runtime 隔离约束](D:/codes/aily-blockly/docs/blockly-generator-runtime-isolation-design.md)、[工具协议](D:/codes/aily-blockly/contracts/abs-generation-tools-v2.md)、[存储协议](D:/codes/aily-blockly/contracts/abs-generation-storage-v1.md)。旧文档中“必须全面具名 / 禁止 $ / 普通声明必须额外 createVariables”的表述记录的是当前 preview 实现，后续以本方案的目标为准；未实施前不把文档目标当作运行时能力。

## 11. 主线收敛执行（2026-09-15）

### 11.1 一个写入入口，一个上下文来源

- `BlocklyService` 不再调用旧 converter 生成选中积木片段或猜测行号。`AbsBlockContextIndex` 只切取正式 ABS/map 的来源范围，不重新排列参数、不反向猜变量模型、不执行库代码。
- 正式 export/apply 完整提交后发布只读上下文索引；preview、验证、部分提交、失败和恢复不发布新索引。读取时验证项目、页、runtime 和完整工程 revision；租约占用时隐藏，修改或重开后失效，提示先执行 abs_export。
- 上下文标出基线 generation，行号不冒充独立编辑后的当前文件；无绑定时不借父块位置猜测。片段限制 6 行预览和 2000 字符，大单行也不能灌入 Agent 上下文。
- 删除无正式调用方的 `AbsAutoSyncService`、`prepareAbsCandidate` 及旧专项测试；移除旧 `absBlockLineMap` 状态和生成代码后的清空分支。选中上下文迁移后，确认无其它调用者的 `convertBlockTreeToAbs` 也已删除。旧专项的队列/租约/board revision/跨页预检/分块期间保存隔离迁入 `abs-workspace-sync.service.spec.ts`。其余保护、完整读回、失败回滚、提交不确定和数据外置由现行协调器测试覆盖。
- 主程序历史 converter/parser 保留为语法迁移比较夹具及旧资料消费者；Agent abs-core 仍承担元数据及显式受限离线恢复，不重新接入正式工程写入。

### 11.2 构建证据及实际运行门槛

- `portable-build-inputs.mjs` 盘点工作区源码、规则、配置、构建脚本、静态输入及依赖锁；构建开始、产物完成、安装后验证结束时比较同一内容摘要。生成/已提交两种图标输入在封存前确定，文件新增、删除、修改均会使摘要改变。
- `portable-integrity.ts` 负责内容清单和校验，不依赖 Blockly/ABS；文件读取并发上限 16。`runtime/build-evidence.json` 记录输入及实际 server/runtime/UI/i18n/vendor/package.json 产物摘要，清单自身不参与自身摘要。
- 实际 server JS 内嵌构建输入摘要，启动监听前校验执行代码的代次和磁盘产物；防止旧进程代码仅通过读取新清单冒充新构建。开发链接启动器另校验当前源码输入，发现旧构建立刻报错，不等模型调用失败、不自动重启用户窗口。
- `/health` 返回无凭据、无绝对路径的 buildEvidence；真实嵌入式验收将此证据与当前源码、产物、所加载 UI 摘要共同核对。非 portable workspace 服务返回 null，不冒称已验收产物。
- 该机制是本地构建/运行一致性检查，不是发行签名，也不保证第三方依赖可重现安装；依赖锁覆盖解析输入，已安装依赖被打入产物后的字节受产物清单校验。

### 11.3 启动异常根因与修复

`refreshRuntimeCatalogs()` 并行发起模型、偏好、工具、内存、设置五项读取，却只给模型 Promise 接入 allSettled；另四项在等待模型之后才接入。如果连接断开，尤其是上下文已过期而提前 return，四个拒绝无人接收，与上一批四条 pageerror 对应。

现改为首次 await 前立即接管全部 Promise；模型优先显示、逐项错误提示和重连行为不变，没有全局吞错，也未调整 ABS 或 WebSocket 协议。确定性测试执行真实目录协调函数，只替换 transport/state 端口：延迟模型返回，另外四项拒绝，切换上下文提前退出，确认无 unhandledRejection 且不污染新页面。

### 11.4 验证记录

- 主程序最终 ChromeHeadless **515 项通过**（原 565 项减去旧服务专属 60 项，新增/迁移 10 项）；不是用保留死服务来维持测试数量。Angular development 构建及应用 TypeScript 检查通过。
- Agent ABS/分页统计 **66 项通过**；原验收辅助 **5 项通过**；新增构建一致性/真实目录断线逻辑 **4 项通过**，包括执行 JS 代次与磁盘新清单不一致的反例。
- 全量 UI 原测试尝试：217 项通过，2 个测试文件因 Node 直接加载无扩展名 TypeScript 导入而失败；未修改相关 UI 模块，不将其计作通过。架构检查仍报告之前的 4 处 user-center 跨层导入，无新增循环。
- 首次 portable 检查在安装后冷启动超过原 20 秒窗口；保留 `.tmp-abs-closure-portable.log`。文件读取改为有限并发并将冷启动验收窗口设为 60 秒后，第二次完整构建/安装启动通过（安装后服务 9.45 秒）。最终执行代码嵌入摘要后的构建也全部通过，安装后服务 9.64 秒；不删改初次失败记录。

### 11.5 最终真实 Electron 证据

结果：[result.json](C:/Users/LENOVO/AppData/Local/Temp/aily-project-data-ui-vHksTt/result.json)，`success=true`、`errors=[]`；截图：[真实页面](C:/Users/LENOVO/AppData/Local/Temp/aily-project-data-ui-vHksTt/project-data-page.png)。

- portable 最终构建时间 `2026-09-15 15:06:34`，2323 个打包文件；Agent/worker/MCP/Pi CLI、服务启动、npm pack/install 及安装后运行验证全部通过。构建日志 `.tmp-abs-closure-portable-sealed.log`；构建完成后才启动 Electron，没有与运行验收交叠。
- 实际后端与源码一致的 inputHash：`fa6b3c68768acddf070c33a34fc0577e0db0028d2976f4857989b034a46239bc`；实际产物 outputHash：`3d57a289c876c8fbd489ff518c3737339ddaf2957e1033cb226b7c6f251b06e4`。
- 实际嵌入式 UI：`assets/index-DdrhXJNK.js`，SHA-256 `b37931258b7c6ef60728dba2ccc19843dde0c47f9000e0fb536f003e18ed355a`，UI 构建时间与后端相同；14 份 Blockly 规则重新比对通过。
- 先检查正常启动无错误，再对实际 UI 的五个并行只读目录请求注入一次 WebSocket 断开。记录 2 次 open（首次及重连）、重连后 5 个成功目录响应，无 console error / pageerror。没有修改生产 WebSocket 协议，也未调用模型。
- 实际 Agent 工具完成空板变量两轮编辑、保存和关闭重开；11 个块的片段/行号/generation 全部匹配正式 ABS/map，ID、变量模型、保护及 C++ 生成语义保持。
- 原动画例程副本增加 90,000 UTF-16 单元（120,000 UTF-8 字节）的普通 text 字段，按通用 Project Data 外置。9 个块的上下文与正式映射一致，片段仅含资源引用且不超过 2000 字符；关闭重开后不复用旧代次行号，画面正常恢复动画与文本积木。
- 原工程 ABI 摘要仍为 `d556530fc57380bf8fab311d13e11f7ba52d3c39a39a67fd03fd24bc1e4de743`；原配置/登录文件摘要未变，隔离登录副本已删除。库与用户原工程没有写入。
- 本次为真实页面与实际工具回归，不冒称重新进行了 LLM 自主会话或正式编译；四轮 LLM/四次固件编译证据仍见第 10 节。本批未改 ABS/Map/Project Data schema、参数顺序、变量语义、数据物化或 C++ 生成规则。

复现：完成最终主程序/portable 构建并等待退出后，在第 10.5 节环境基础上设置 `AILY_ABS_LLM_ONLY=0`、`AILY_ABS_VARIABLE_ONLY=1`、`AILY_ABS_DISCONNECT_SMOKE=1`，运行同一 Electron 脚本。结果会写入新的隔离目录；不要将临时目录改为用户原工程。

主线结论：原文档中阻止核心闭环落地的剩余三项已关闭。后续工作仅按明确能力边界扩展历史字面量、局部/高级声明和特定动态形状的通用合同，不再并行设计另一套 ABS 语言。前述 UI 测试运行器和 user-center 架构债仍单独保留，不能据此宣称全仓库所有测试或所有库功能已完成。

## 12. 提交边界与隔离快照复核（2026-09-15）

本次仅纳入 Blockly 的无损同步、Project Data、文件发布及其协议/测试，与 Lex 的对应工具、指引、发布保护和运行一致性检查。登录额度、用户中心、模型供应商、临时日志、登录配置及构建产物不纳入；库仓库和用户原工程仍保持只读。

使用 Git 暂存区导出两个相邻的独立源码副本，仅复用已安装依赖，不借用工作区未提交源码。复核结果：

- Blockly development 构建通过，ABS 专项 **515 项通过**。
- 文件写入/资源复制/验收守卫 **48 项通过**；真实 Electron 桥接及跨进程 Agent 发布 **5 项通过**。
- Agent 与 Chat 服务重新构建及声明文件生成通过；Agent ABS、工程统计及文件发布扩展回归 **97 项通过**。
- portable 输入/产物/执行代码一致性与目录请求断线回归 **4 项通过**。
- 共 **669 项专项测试通过**；暂存差异检查通过，未纳入本地登录数据与测试产物。此轮不重跑 LLM 会话及固件编译，相关证据仍为第 10 节，不扩大为全库/全仓库验收。

隔离副本中 pnpm 的依赖一致性检查因非交互环境拒绝自动重装；未启用强制安装或清理依赖，改为直接运行已安装的 Rslib 入口，构建成功。该环境分支不修改依赖锁或应用代码。
