import { MAIN_AGENT_TYPE } from '../core/agent-identifiers';

export const BLOCKLY_TOOL_DEFINITIONS = [
    {
        name: "syncAbs",
        description: `🔄 ABS 文件同步工具 - 在 Blockly 工作区和 ABS 文件之间同步。

**项目中的 ABS 文件（Aily Block Syntax）：**
每个项目目录下会有一个 \`project.abs\` 文件，以人类可读的 ABS 格式保存代码结构。

**操作类型：**
1. \`export\` - 将当前 Blockly 工作区导出为 ABS 文件
2. \`import\` - 从 ABS 文件导入并替换当前工作区
3. \`status\` - 获取 ABS 文件状态和内容预览

**推荐工作流：**
1. 首先使用 \`syncAbs action="status"\` 或 \`syncAbs action="export"\` 获取/生成 ABS 文件
2. 使用 \`read_file\` 读取 \`project.abs\` 了解当前代码结构
3. 使用 \`edit_file\` 修改 ABS 文件（像编辑普通代码一样！）
4. 使用 \`syncAbs action="import"\` 将修改应用到 Blockly 工作区

**这种方式的优势：**
- 📖 直接看到完整的代码结构
- ✏️ 用熟悉的文件编辑方式修改代码
- 🔄 支持撤销和版本控制
- 🎯 避免复杂的位置计算`,
        input_schema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['export', 'import', 'status'],
                    description: '操作类型：export=导出到ABS文件，import=从ABS文件导入，status=查看状态'
                },
                includeHeader: {
                    type: 'boolean',
                    description: '导出时是否包含文件头注释（默认 true）',
                    default: true
                }
            },
            required: ['action']
        }
    },
    {
        name: "get_workspace_overview_tool",
        description: `工作区全览分析工具。提供工作区的完整分析，包括结构分析、代码生成、复杂度评估、连接关系和树状结构展示。支持多种输出格式：JSON、Markdown、详细报告和控制台输出。`,
        input_schema: {
            type: 'object',
            properties: {
                outputFormat: {
                    type: 'string',
                    enum: ['json', 'markdown', 'detailed', 'console'],
                    description: '输出格式',
                    default: 'console'
                },
                includeCode: {
                    type: 'boolean',
                    description: '是否包含生成的C++代码',
                    default: true
                },
                includeStructure: {
                    type: 'boolean',
                    description: '是否包含结构分析',
                    default: true
                },
                includeConnections: {
                    type: 'boolean',
                    description: '是否包含连接关系分析',
                    default: true
                },
                includeComplexity: {
                    type: 'boolean',
                    description: '是否包含复杂度分析',
                    default: true
                },
                maxDepth: {
                    type: 'number',
                    description: '树状结构的最大深度',
                    default: 10
                },
                showDetails: {
                    type: 'boolean',
                    description: '是否显示详细信息',
                    default: false
                }
            },
            required: []
        }
    },
    {
        name: "todo_write_tool",
        description: `Manage a structured todo list to track progress and plan tasks.

Task states: not-started | in-progress (limit ONE) | completed

Workflow: plan todos → mark in-progress → do work → mark completed → next

Operations:
- **update**: 全量替换todo列表（传入完整的todos数组，替换当前所有任务）
- **add**: 追加任务（传todos数组追加，或传content追加单个任务）
- **toggle**: 切换任务状态（需id）
- **list**: 查看当前任务列表
- **delete**: 删除指定任务（需id）
- **clear**: 清空所有任务

IMPORTANT: update是全量替换，必须包含所有任务。只想添加新任务时用add。Mark todos completed as soon as they are done.`,
        input_schema: {
            type: 'object',
            properties: {
                operation: {
                    type: 'string',
                    enum: ['update', 'add', 'toggle', 'list', 'delete', 'clear'],
                    description: '操作类型'
                },
                sessionId: {
                    type: 'string',
                    description: '会话ID',
                    default: 'default'
                },
                content: {
                    type: 'string',
                    description: '任务内容（add单项时使用，也接受title字段）'
                },
                status: {
                    type: 'string',
                    enum: ['not-started', 'in-progress', 'completed'],
                    description: '任务状态'
                },
                priority: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: '任务优先级',
                    default: 'medium'
                },
                id: {
                    type: 'number',
                    description: '任务ID（delete时必需）'
                },
                todos: {
                    type: 'array',
                    description: '任务数组（update时全量替换，add时追加）',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'number', description: '任务ID' },
                            content: { type: 'string', description: '任务内容（也接受title）' },
                            status: { type: 'string', enum: ['not-started', 'in-progress', 'completed'] },
                            priority: { type: 'string', enum: ['high', 'medium', 'low'] }
                        },
                        required: ['content']
                    }
                }
            },
            required: ['operation']
        },
        agents: [MAIN_AGENT_TYPE]
    },
    {
        name: 'analyze_library_blocks',
        description: `分析指定库的块定义，生成 ABS (Aily Block Syntax) 格式的块定义文档。优先使用read_file工具读取库readme，当库对应的 readme 不存在或描述不准确时，使用此工具补充和完善库的文档说明。`,
        input_schema: {
            type: 'object',
            properties: {
                libraryNames: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要分析的库名称列表，如 ["@aily-project/lib-blinker", "@aily-project/lib-sensor"]'
                },
                mode: {
                    type: 'string',
                    enum: ['auto', 'readme_ref', 'analysis'],
                    description: 'auto 优先返回 readme_ai.md 路径；readme_ref 只返回 readme 路径；analysis 强制返回块分析结果',
                    default: 'auto'
                }
            },
            required: ['libraryNames']
        },
        agents: [MAIN_AGENT_TYPE]
    },
];