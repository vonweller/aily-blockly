import type { Tool } from '../core/chat-types';
import { MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE } from '../core/agent-identifiers';
import { LEGACY_HOST_EXTERNAL_TOOLS } from './legacy-host-tool-definitions';

export type ToolSettingsCatalogEntry = Pick<Tool, 'name' | 'description' | 'agents'>;

const CORE_TOOL_SETTINGS: ToolSettingsCatalogEntry[] = [
  { name: 'ask_user', description: '向用户提问并等待回答；当前 lex 路径由 lex core 内建实现。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'search_available_tools', description: '旧 blockly 聊天链路中搜索并加载按需延迟注册工具的入口。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'load_skill', description: '加载或卸载领域技能；当前 lex 路径由 lex core + blockly skill provider 协同实现。', agents: [MAIN_AGENT_TYPE] },
  { name: 'register_agent', description: '兼容入口：动态注册新的子代理定义，当前 lex 主链路默认不暴露。', agents: [MAIN_AGENT_TYPE] },
];

const PROJECT_TOOL_SETTINGS: ToolSettingsCatalogEntry[] = [
  { name: 'create_project', description: '创建新项目并初始化开发板。', agents: [MAIN_AGENT_TYPE] },
  { name: 'execute_command', description: '在 PowerShell 中执行系统命令。', agents: [MAIN_AGENT_TYPE] },
  { name: 'start_background_command', description: '在后台启动长时间运行的命令。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_terminal_output', description: '读取后台命令当前输出。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_context', description: '获取项目、平台和系统上下文。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'get_project_info', description: '读取当前项目开发板和库信息。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'build_project', description: '编译当前项目。', agents: [MAIN_AGENT_TYPE] },
  { name: 'reload_project', description: '重新加载当前项目。', agents: [MAIN_AGENT_TYPE] },
  { name: 'switch_board', description: '切换项目开发板。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_board_config', description: '读取开发板配置。', agents: [MAIN_AGENT_TYPE] },
  { name: 'set_board_config', description: '修改开发板配置。', agents: [MAIN_AGENT_TYPE] },
  { name: 'search_boards_libraries', description: '搜索开发板和库。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_hardware_categories', description: '获取开发板或库的分类信息。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_board_parameters', description: '获取当前开发板参数。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'fetch', description: '获取网页或 HTTP API 内容。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'clone_repository', description: '下载远程 Git 仓库源码。', agents: [MAIN_AGENT_TYPE] },
  { name: 'web_search', description: '执行联网搜索。', agents: [MAIN_AGENT_TYPE] },
  { name: 'todo_write_tool', description: '管理任务清单。', agents: [MAIN_AGENT_TYPE] },
  { name: 'memory', description: '读写会话或项目记忆。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_errors', description: '收集项目中的诊断错误。', agents: [MAIN_AGENT_TYPE] },
];

const FILE_TOOL_SETTINGS: ToolSettingsCatalogEntry[] = [
  { name: 'read_file', description: '读取文件内容。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'create_file', description: '创建新文件。', agents: [MAIN_AGENT_TYPE] },
  { name: 'create_folder', description: '创建文件夹。', agents: [MAIN_AGENT_TYPE] },
  { name: 'edit_file', description: '编辑现有文件。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'replace_string_in_file', description: '精确替换文件中的字符串。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'multi_replace_string_in_file', description: '批量精确替换多个文件内容。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'delete_file', description: '删除文件。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'delete_folder', description: '删除文件夹。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'grep_tool', description: '按内容搜索文件。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
  { name: 'glob_tool', description: '按文件名模式搜索文件。', agents: [MAIN_AGENT_TYPE, SCHEMATIC_AGENT_TYPE] },
];

const BLOCKLY_TOOL_SETTINGS: ToolSettingsCatalogEntry[] = [
  { name: 'smart_block_tool', description: '智能创建 Blockly 块。', agents: [MAIN_AGENT_TYPE] },
  { name: 'connect_blocks_tool', description: '连接 Blockly 块。', agents: [MAIN_AGENT_TYPE] },
  { name: 'create_code_structure_tool', description: '创建代码结构。', agents: [MAIN_AGENT_TYPE] },
  { name: 'configure_block_tool', description: '配置 Blockly 块。', agents: [MAIN_AGENT_TYPE] },
  { name: 'delete_block_tool', description: '删除 Blockly 块。', agents: [MAIN_AGENT_TYPE] },
  { name: 'get_workspace_overview_tool', description: '获取 Blockly 工作区总览。', agents: [MAIN_AGENT_TYPE] },
  { name: 'queryBlockDefinitionTool', description: '查询块定义信息。', agents: [MAIN_AGENT_TYPE] },
  { name: 'analyze_library_blocks', description: '分析库中的块定义。', agents: [MAIN_AGENT_TYPE] },
  { name: 'verify_block_existence', description: '验证块是否存在。', agents: [MAIN_AGENT_TYPE] },
];

const ABS_TOOL_SETTINGS: ToolSettingsCatalogEntry[] = [
  { name: 'syncAbs', description: '同步 ABS 文件和图形化工作区。', agents: [MAIN_AGENT_TYPE] },
  { name: 'edit_abi_file', description: '编辑 ABI 文件。', agents: [MAIN_AGENT_TYPE] },
  { name: 'reload_abi_json', description: '重新加载 Blockly ABI 数据。', agents: [MAIN_AGENT_TYPE] },
];

export const TOOL_SETTINGS_CATALOG: ToolSettingsCatalogEntry[] = [
  ...CORE_TOOL_SETTINGS,
  ...PROJECT_TOOL_SETTINGS,
  ...FILE_TOOL_SETTINGS,
  ...BLOCKLY_TOOL_SETTINGS,
  ...ABS_TOOL_SETTINGS,
  ...LEGACY_HOST_EXTERNAL_TOOLS,
];