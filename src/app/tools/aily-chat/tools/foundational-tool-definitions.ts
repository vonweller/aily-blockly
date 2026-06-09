export const FOUNDATIONAL_TOOL_DEFINITIONS = [
    {
        name: 'ask_user',
        description: `向用户提出一个或多个问题并等待回答。当你需要用户做出决策、提供额外信息或确认操作时使用此工具。
    当前 lex 路径中的 ask_user 由 lex core 内建实现；这里保留兼容 schema，供旧 blockly catalog / prompt 注入复用。
工具会暂停对话，在聊天界面显示问题和可选项，等待用户回答后继续。

传入 questions 数组，单问题即长度为 1 的数组。

使用场景：
- 需要用户在多个方案中做选择（提供 options）
- 需要用户提供多项关键信息（如项目名称 + 开发板类型 + 语言偏好）
- 需要用户确认重要操作前的决策
- 需求有歧义时主动澄清

注意：
- 不要滥用此工具，只在确实需要用户输入时使用
- 如果可以合理推断，优先自行决定而非打断用户
- 相关问题可合并为一次调用，减少打断次数`,
        input_schema: {
            type: 'object',
            properties: {
                questions: {
                    type: 'array',
                    description: '问题列表（单问题传长度为 1 的数组即可）',
                    items: {
                        type: 'object',
                        properties: {
                            question: { type: 'string', description: '问题内容' },
                            options: {
                                type: 'array',
                                description: '可选项列表',
                                items: {
                                    type: 'object',
                                    properties: {
                                        label: { type: 'string', description: '选项文本' },
                                        description: { type: 'string', description: '选项说明（可选）' },
                                        recommended: { type: 'boolean', description: '是否为推荐选项' }
                                    },
                                    required: ['label']
                                }
                            },
                            allow_freeform: { type: 'boolean', description: '是否允许自由输入（有 options 时默认 false）', default: false },
                            multi_select: { type: 'boolean', description: '是否允许多选（默认 false）', default: false }
                        },
                        required: ['question']
                    }
                }
            },
            required: ['questions']
        },
        agents: ["mainAgent", "schematicAgent"]
    },
    {
        name: 'search_available_tools',
        description: `旧 blockly 聊天链路中的延迟工具搜索入口。当你需要使用未在当前工具列表中的工具时，调用此工具按关键词搜索。
    此工具仅用于 legacy search_available_tools 路径；lex runtime 使用独立的 deferred listing 与 tool_search。
成功后工具会被加载，可在后续对话中直接调用。

搜索示例：
- search_available_tools({query: "schematic"}) — 加载接线图相关工具
- search_available_tools({query: "grep"}) — 加载代码搜索工具
- search_available_tools({query: "fetch"}) — 加载网络请求工具
- search_available_tools({query: "abs"}) — 加载 ABS/Blockly 工具`,
        input_schema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '搜索关键词（工具名、分组名或功能描述）'
                }
            },
            required: ['query']
        },
        agents: ["mainAgent", "schematicAgent"]
    },
    {
        name: 'load_skill',
        description: `管理领域技能。search/list 用于发现可用 skill；load/unload 按名称管理当前会话的 skill 状态。
    当前 lex 路径中的 load_skill 由 lex core + blockly skill provider 协同实现；这里保留兼容 schema，供旧 blockly catalog / prompt 注入复用。
使用示例：
- load_skill({action: "load", name: "abs-syntax"}) — 加载 ABS 语法 skill；返回 SKILL.md 上下文和 related files
- load_skill({action: "search", query: "abs"}) — 搜索可用 skill；这是可选发现步骤，不是 load 前置条件
- load_skill({action: "list"}) — 列出当前已加载 skill
- load_skill({action: "unload", name: "abs-syntax"}) — 卸载已加载 skill
- load_skill({action: "load", name: "review-rules", task: "Review the latest changes."}) — 运行 fork-mode skill`,
        input_schema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['search', 'load', 'unload', 'list'],
                    description: '操作类型：search（搜索），load（加载），unload（卸载），list（列出已加载）'
                },
                query: {
                    type: 'string',
                    description: '搜索关键词（仅 search 使用）'
                },
                name: {
                    type: 'string',
                    description: 'skill 名称（load/unload 使用）'
                },
                task: {
                    type: 'string',
                    description: 'fork-mode skill 的可选任务描述；未传时默认使用当前用户请求'
                }
            },
            required: ['action']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'register_agent',
        description: '兼容入口：动态注册一个新的子代理（subagent），注册后即可通过 agent 工具调用。旧前端 catalog 仍保留此定义，但当前 lex 主链路默认不暴露该工具。已注册的同名代理不会被覆盖。',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '子代理唯一标识（英文，如 dataAnalysisAgent）' },
                displayName: { type: 'string', description: '人类可读名称（如"数据分析代理"）' },
                description: { type: 'string', description: '功能描述（帮助 LLM 判断何时使用此代理）' },
                useCases: { type: 'array', items: { type: 'string' }, description: '适用场景列表' },
                suggestedContext: { type: 'string', description: '调用前建议获取的上下文' },
                maxTurns: { type: 'number', description: '最大工具调用轮次（默认 30）' },
            },
            required: ['name', 'displayName', 'description']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'create_project',
        description: '创建一个新项目，返回项目路径。需要提供使用的开发板（如 "@aily-project/board-arduino_uno", "@aily-project/board-arduino_uno_r4_minima"），传入的开发板名称以`https://blockly.yysc.tech/boards.json`中的内容为准。',
        input_schema: {
            type: 'object',
            properties: {
                board: { type: 'string', description: '开发板名称' },
            },
            required: ['board']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'execute_command',
        description: `在 PowerShell 中执行系统 CLI 命令。用于执行系统操作或运行特定命令来完成用户任务中的任何步骤。支持命令链，优先使用相对命令和路径以保持终端一致性。

如果命令需要长时间运行（如服务器、监控），请使用 start_background_command 代替。`,
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '执行的命令' },
                cwd: { type: 'string', description: '工作目录，可选' }
            },
            required: ['command']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'start_background_command',
        description: `在后台启动一个长时间运行的命令，不等待完成即返回。返回 session_id 用于后续查询输出。

适合场景：
- 启动开发服务器（如 npm run dev）
- 启动串口监控
- 执行耗时较长的编译/下载任务

启动后使用 get_terminal_output 查看实时输出。`,
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的命令' },
                cwd: { type: 'string', description: '工作目录（可选，默认当前项目路径）' },
                label: { type: 'string', description: '可选标签，用于识别该会话（如 "build", "server"）' }
            },
            required: ['command']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'get_terminal_output',
        description: `获取后台命令的当前输出。默认返回自上次读取以来的新输出（增量模式）。

使用场景：
- 检查后台命令的执行进度和输出
- 获取服务器启动日志
- 监控编译进度`,
        input_schema: {
            type: 'object',
            properties: {
                session_id: { type: 'string', description: '终端会话 ID（由 start_background_command 返回）' },
                incremental: { type: 'boolean', description: '是否仅获取新输出（默认 true）', default: true },
                max_chars: { type: 'number', description: '最大返回字符数（默认 50000）', default: 50000 }
            },
            required: ['session_id']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'get_context',
        description: '获取当前的环境上下文信息，包括项目路径、当前平台、系统环境等。可以指定获取特定类型的上下文信息。',
        input_schema: {
            type: 'object',
            properties: {
                info_type: {
                    type: 'string',
                    description: '要获取的上下文信息类型',
                    enum: ['all', 'project', 'platform', 'system'],
                    default: 'all'
                }
            },
            required: ['info_type']
        },
        agents: ["mainAgent", "schematicAgent"]
    },
    {
        name: 'get_project_info',
        description: '获取当前项目信息。如果项目已创建，返回当前项目使用的开发板及已安装的库列表。如果库中包含 readme_ai.md 文档，则同时输出该文件的路径。可用于了解项目配置、查找库文档等。',
        input_schema: {
            type: 'object',
            properties: {
                include_readme: {
                    type: 'boolean',
                    description: '是否检查并返回库的 readme_ai.md 文件路径',
                    default: true
                }
            },
            required: []
        },
        agents: ["mainAgent", "schematicAgent"]
    },
];