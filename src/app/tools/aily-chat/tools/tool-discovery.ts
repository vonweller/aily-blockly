/**
 * Deferred tool metadata and lightweight discovery helpers.
 *
 * This keeps deferred-tool grouping out of the large legacy TOOLS catalog so
 * runtime/bootstrap code does not need to import the full static schema set.
 */

export interface DeferredToolGroup {
  name: string;
  brief: string;
  tools: string[];
}

export const DEFERRED_TOOL_GROUPS: DeferredToolGroup[] = [
  {
    name: '文件工具',
    brief: '文件夹删除',
    tools: ['delete_folder'],
  },
  {
    name: '硬件/库搜索',
    brief: '搜索开发板和库、获取硬件分类、查询开发板参数',
    tools: ['search_boards_libraries', 'get_hardware_categories', 'get_board_parameters'],
  },
  {
    name: '项目管理',
    brief: '创建项目、重新加载项目、切换开发板、开发板配置',
    tools: ['create_project', 'reload_project', 'switch_board', 'get_board_config', 'set_board_config'],
  },
  {
    name: '终端工具',
    brief: '后台命令执行、获取终端输出',
    tools: ['start_background_command', 'get_terminal_output'],
  },
];

const DEFERRED_TOOL_NAMES = new Set(
  DEFERRED_TOOL_GROUPS.flatMap(group => group.tools),
);

export function getCoreTools(allTools: any[]): any[] {
  return allTools.filter(tool => !DEFERRED_TOOL_NAMES.has(tool.name));
}

export function getDeferredTools(allTools: any[]): any[] {
  return allTools.filter(tool => DEFERRED_TOOL_NAMES.has(tool.name));
}

export function isDeferredTool(name: string): boolean {
  return DEFERRED_TOOL_NAMES.has(name);
}