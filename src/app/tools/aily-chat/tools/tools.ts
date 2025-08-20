export const toolParamNames = [
    "command"
] as const;

export type ToolParamName = (typeof toolParamNames)[number];

// export interface ToolUse {
//     type: "tool_use"
//     name: ToolName
// }

export interface ToolUseResult {
    is_error: boolean;
    content: string;
}

export const TOOLS = [
    {
        name: 'create_project',
        description: `创建一个新项目，返回项目路径。需要提供开发板信息，包含名称、昵称和版本号。`,
        input_schema: {
            type: 'object',
            properties: {
                board: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: '板子名称' },
                        nickname: { type: 'string', description: '板子昵称' },
                        version: { type: 'string', description: '版本号' }
                    },
                    description: '开发板信息'
                },
            },
            required: ['board']
        }
    },
    {
        name: 'execute_command',
        description: `执行系统CLI命令。用于执行系统操作或运行特定命令来完成用户任务中的任何步骤。支持命令链，优先使用相对命令和路径以保持终端一致性。`,
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '执行的命令' },
                cwd: { type: 'string', description: '工作目录，可选' }
            },
            required: ['command']
        }
    },
    {
        name: "get_context",
        description: `获取当前的环境上下文信息，包括项目路径、当前平台、系统环境等。可以指定获取特定类型的上下文信息。`,
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
        }
    },
    {
        name: "list_directory",
        description: `列出指定目录的内容，包括文件和文件夹信息。返回每个项目的名称、类型、大小和修改时间。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要列出内容的目录路径'
                }
            },
            required: ['path']
        }
    },
    {
        name: "read_file",
        description: `读取指定文件的内容。支持文本文件的读取，可指定编码格式。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要读取的文件路径'
                },
                encoding: {
                    type: 'string',
                    description: '文件编码格式',
                    default: 'utf-8'
                }
            },
            required: ['path']
        }
    },
    {
        name: "create_file",
        description: `创建新文件并写入内容。如果目录不存在会自动创建。可选择是否覆盖已存在的文件。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要创建的文件路径'
                },
                content: {
                    type: 'string',
                    description: '文件内容',
                    default: ''
                },
                encoding: {
                    type: 'string',
                    description: '文件编码格式',
                    default: 'utf-8'
                },
                overwrite: {
                    type: 'boolean',
                    description: '是否覆盖已存在的文件',
                    default: false
                }
            },
            required: ['path']
        }
    },
    {
        name: "create_folder",
        description: `创建新文件夹。支持递归创建多级目录。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要创建的文件夹路径'
                },
                recursive: {
                    type: 'boolean',
                    description: '是否递归创建父目录',
                    default: true
                }
            },
            required: ['path']
        }
    },
    {
        name: "edit_file",
        description: `编辑文件工具。支持多种编辑模式：1) 替换整个文件内容（默认）；2) 在指定行插入内容；3) 替换指定行或行范围；4) 追加到文件末尾。可选择当文件不存在时是否创建新文件。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要编辑的文件路径'
                },
                content: {
                    type: 'string',
                    description: '要写入的内容。替换模式下是新的文件内容；插入/替换模式下可以是任意文本内容'
                },
                encoding: {
                    type: 'string',
                    description: '文件编码格式',
                    default: 'utf-8'
                },
                createIfNotExists: {
                    type: 'boolean',
                    description: '如果文件不存在是否创建',
                    default: false
                },
                insertLine: {
                    type: 'number',
                    description: '插入行号（从1开始）。指定此参数时会在该行插入内容'
                },
                replaceStartLine: {
                    type: 'number',
                    description: '替换起始行号（从1开始）。指定此参数时会替换指定行的内容'
                },
                replaceEndLine: {
                    type: 'number',
                    description: '替换结束行号（从1开始）。与replaceStartLine配合使用，可替换多行内容。如不指定则只替换起始行'
                },
                replaceMode: {
                    type: 'boolean',
                    description: '是否替换整个文件内容。true=替换整个文件（默认），false=执行其他操作（插入、替换行、追加）',
                    default: true
                }
            },
            required: ['path', 'content']
        }
    },
    {
        name: "delete_file",
        description: `删除指定文件。可选择是否在删除前创建备份。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要删除的文件路径'
                },
                createBackup: {
                    type: 'boolean',
                    description: '删除前是否创建备份',
                    default: true
                }
            },
            required: ['path']
        }
    },
    {
        name: "delete_folder",
        description: `删除指定文件夹及其内容。可选择是否在删除前创建备份。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要删除的文件夹路径'
                },
                createBackup: {
                    type: 'boolean',
                    description: '删除前是否创建备份',
                    default: true
                },
                recursive: {
                    type: 'boolean',
                    description: '是否递归删除',
                    default: true
                }
            },
            required: ['path']
        }
    },
    {
        name: "check_exists",
        description: `检查指定路径的文件或文件夹是否存在，返回详细信息包括类型、大小、修改时间等。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要检查的路径'
                },
                type: {
                    type: 'string',
                    description: '期望的类型：file(文件)、folder(文件夹)或any(任意类型)',
                    enum: ['file', 'folder', 'any'],
                    default: 'any'
                }
            },
            required: ['path']
        }
    },
    {
        name: "get_directory_tree",
        description: `获取指定目录的树状结构，可控制遍历深度和是否包含文件。适合了解项目结构。`,
        input_schema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '要获取树状结构的目录路径'
                },
                maxDepth: {
                    type: 'number',
                    description: '最大遍历深度',
                    default: 3
                },
                includeFiles: {
                    type: 'boolean',
                    description: '是否包含文件（false时只显示文件夹）',
                    default: true
                }
            },
            required: ['path']
        }
    },
    {
        name: "fetch",
        description: `获取网络上的信息和资源，支持HTTP/HTTPS请求，能够处理大文件下载。支持多种请求方法和响应类型。`,
        input_schema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要请求的URL地址'
                },
                method: {
                    type: 'string',
                    description: 'HTTP请求方法',
                    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                    default: 'GET'
                },
                headers: {
                    type: 'object',
                    description: '请求头（键值对）'
                },
                body: {
                    description: '请求体'
                },
                timeout: {
                    type: 'number',
                    description: '请求超时时间（毫秒）',
                    default: 30000
                },
                maxSize: {
                    type: 'number',
                    description: '最大文件大小（字节）',
                    default: 52428800
                },
                responseType: {
                    type: 'string',
                    description: '响应类型',
                    enum: ['text', 'json', 'blob', 'arraybuffer'],
                    default: 'text'
                }
            },
            required: ['url']
        }
    },
    {
        name: "reload_abi_json",
        description: `重新加载 project.abi 数据到 Blockly 工作区。可以从文件加载或直接提供 JSON 数据。适用于需要刷新 Blockly 块数据的场景。`,
        input_schema: {
            type: 'object',
            properties: {
                projectPath: {
                    type: 'string',
                    description: '项目路径，如果不提供将使用当前项目路径'
                },
                jsonData: {
                    type: 'object',
                    description: '直接提供.abi文件的内容'
                }
            },
            required: []
        }
    },
    {
        name: "edit_abi_file",
        description: `编辑ABI文件工具。支持多种编辑模式：1) 替换整个文件内容（默认）；2) 在指定行插入内容；3) 替换指定行或行范围；4) 追加到文件末尾。自动查找当前路径下的.abi文件，如果不存在会自动创建。`,
        input_schema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '要写入的内容。替换模式下必须是有效的JSON格式；插入/替换模式下可以是任意文本内容'
                },
                insertLine: {
                    type: 'number',
                    description: '插入行号（从1开始）。指定此参数时会在该行插入内容'
                },
                replaceStartLine: {
                    type: 'number',
                    description: '替换起始行号（从1开始）。指定此参数时会替换指定行的内容'
                },
                replaceEndLine: {
                    type: 'number',
                    description: '替换结束行号（从1开始）。与replaceStartLine配合使用，可替换多行内容。如不指定则只替换起始行'
                },
                replaceMode: {
                    type: 'boolean',
                    description: '是否替换整个文件内容。true=替换整个文件（默认），false=执行其他操作（插入、替换行、追加）',
                    default: true
                }
            },
            required: ['content']
        }
    }
]
