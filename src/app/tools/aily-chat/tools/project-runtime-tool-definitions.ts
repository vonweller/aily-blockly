export const PROJECT_RUNTIME_TOOL_DEFINITIONS = [
    {
        name: 'build_project',
        description: `编译当前项目，检测代码是否能正常编译通过。用于代码编写完成后验证语法和链接是否正确。编译耗时较长（可能数十秒到数分钟），请仅在需要验证时调用。

如果编译出现异常（如缓存损坏、切换开发板后残留旧缓存），可设置 clear_cache=true 在编译前清除缓存。`,
        input_schema: {
            type: 'object',
            properties: {
                preprocess_only: {
                    type: 'boolean',
                    description: '是否仅做预编译检查（更快但不生成完整产物，且为异步操作不会返回编译结果）',
                    default: false
                },
                clear_cache: {
                    type: 'boolean',
                    description: '编译前是否清除编译缓存（解决缓存损坏或切换开发板后的残留问题）',
                    default: false
                }
            },
            required: []
        },
        agents: ["mainAgent"]
    },
    {
        name: 'reload_project',
        description: `重新加载当前项目。在修改了库相关的JS文件（如块定义、生成器等）后调用，使修改生效。会先保存项目再重新加载。`,
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        },
        agents: ["mainAgent"]
    },
    {
        name: 'switch_board',
        description: `在当前项目中切换开发板。需要提供新的开发板包名称（如 "@aily-project/board-esp32_devkitc"）。
切换过程会自动卸载当前开发板包、安装新开发板包、更新项目配置并重新加载项目。

注意：
- 切换开发板会重置编译缓存
- 项目中非开发板相关的依赖库会被保留
- 如果不确定开发板名称，可先使用 search_boards_libraries 工具搜索`,
        input_schema: {
            type: 'object',
            properties: {
                board_name: {
                    type: 'string',
                    description: '开发板包名称，如 "@aily-project/board-esp32_devkitc"、"@aily-project/board-arduino_uno"'
                },
                board_version: {
                    type: 'string',
                    description: '开发板包版本号（可选，不指定则使用最新版）'
                }
            },
            required: ['board_name']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'get_board_config',
        description: `获取当前开发板的编译/烧录配置选项及其当前值。

返回信息包括：
- 当前开发板名称和类型
- 所有可配置项及其可选值（如上传速度、Flash模式、Flash大小、分区方案等）
- 每个配置项的当前选中值

支持的开发板配置：
- **ESP32**: 上传速度(UploadSpeed)、上传模式(UploadMode)、Flash模式(FlashMode)、Flash大小(FlashSize)、分区方案(PartitionScheme)、CDC启动(CDCOnBoot)、PSRAM
- **STM32**: 开发板型号(pnum)、USB配置(usb)
- **nRF5**: SoftDevice

如果当前开发板没有额外配置选项（如 Arduino UNO），会返回空列表。`,
        input_schema: {
            type: 'object',
            properties: {},
            required: []
        },
        agents: ["mainAgent"]
    },
    {
        name: 'set_board_config',
        description: `修改当前开发板的编译/烧录配置项。需先通过 get_board_config 工具获取可用的配置项和可选值。

使用方式：
1. 先调用 get_board_config 获取当前配置和可选值
2. 根据返回的 config_key 和 options 中的 value，调用此工具设置

示例：
- 设置ESP32上传速度: set_board_config({ config_key: "UploadSpeed", config_value: "921600" })
- 设置Flash大小: set_board_config({ config_key: "FlashSize", config_value: "16M" })
- 设置分区方案: set_board_config({ config_key: "PartitionScheme", config_value: "default" })

注意：配置变更后会自动触发预编译检查。`,
        input_schema: {
            type: 'object',
            properties: {
                config_key: {
                    type: 'string',
                    description: '配置项键名（从 get_board_config 返回的 config_key），如 UploadSpeed, FlashMode, FlashSize, PartitionScheme 等'
                },
                config_value: {
                    type: 'string',
                    description: '配置项的值（从 get_board_config 返回的 options 中的 value），如 "921600", "qio", "16M"'
                }
            },
            required: ['config_key', 'config_value']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'memory',
        description: `持久化记忆工具 — 跨会话保存和读取笔记、偏好、项目约定等信息。

两层作用域：
- **project**: 项目记忆，存储在项目根目录的 aily.md 中。记录项目特定的约定、架构决策、常见问题等。
- **global**: 全局记忆，跨项目持久化。记录用户偏好、通用模式、经验教训等。

**何时使用：**
- 用户明确要求"记住"某些偏好或约定时
- 发现重要的项目模式/约定需要记录时
- 遇到反复出现的问题，记录解决方案
- 读取之前保存的上下文以提供连续的协助体验

**不要滥用：** 不要每次对话都写入，只记录真正有价值的持久化知识。`,
        input_schema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    enum: ['read', 'write', 'append', 'replace', 'clear'],
                    description: '操作命令: read=读取, write=覆写, append=追加, replace=精确替换, clear=清空'
                },
                scope: {
                    type: 'string',
                    enum: ['project', 'global'],
                    description: '作用域: project=项目级(aily.md), global=全局级(跨项目)'
                },
                content: {
                    type: 'string',
                    description: 'write/append 时的内容'
                },
                old_text: {
                    type: 'string',
                    description: 'replace 时要替换的旧文本'
                },
                new_text: {
                    type: 'string',
                    description: 'replace 时的新文本'
                }
            },
            required: ['command', 'scope']
        },
        agents: ["mainAgent"]
    },
    {
        name: 'get_errors',
        description: `获取当前项目或指定文件的错误诊断信息。整合 lint 错误和编译错误，一次性返回所有已知问题。

数据来源：
1. **Lint 错误**: JSON/JS 文件的语法检查
2. **编译错误**: 上次 build_project 的编译结果

适合场景：
- 编辑文件后快速检查是否引入错误
- 编译失败后分析具体错误原因
- 修复错误前先了解全部问题再一次性修复

注意：编译错误来自上次 build_project 的缓存结果，如果代码已修改建议重新编译。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要检查的文件路径（可选，不指定则检查整个项目关键文件）'
                },
                include_lint: {
                    type: 'boolean',
                    description: '是否包含 lint 错误',
                    default: true
                },
                include_build: {
                    type: 'boolean',
                    description: '是否包含上次编译错误',
                    default: true
                }
            },
            required: []
        },
        agents: ["mainAgent"]
    },
];