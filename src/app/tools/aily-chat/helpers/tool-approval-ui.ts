/**
 * Tool approval UI contracts and message formatting.
 *
 * Ownership now lives with the user-interaction layer.
 * core/index.ts re-exports these contracts directly for the remaining barrel path.
 */

export interface ToolApprovalRequest {
  toolCallId: string;
  toolName: string;
  title: string;
  message: string;
  args?: any;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason?: string;
  scope?: 'once' | 'session' | 'session-safe';
}

export type ToolApprovalCallback = (request: ToolApprovalRequest) => Promise<ToolApprovalResult>;

export function generateApprovalMessage(toolName: string, args: any): { title: string; message: string } {
  switch (toolName) {
    case 'execute_command':
      return {
        title: '执行命令',
        message: `即将执行命令：\n${args?.command || '(未知命令)'}${args?.cwd ? '\n工作目录：' + args.cwd : ''}`,
      };
    case 'start_background_command':
      return {
        title: '启动后台命令',
        message: `即将在后台启动命令：\n${args?.command || '(未知命令)'}`,
      };
    case 'create_project':
      return {
        title: '创建项目',
        message: `即将创建新项目：${args?.name || args?.projectName || '(未命名)'}${args?.board ? '\n开发板：' + args.board : ''}`,
      };
    case 'build_project':
      return {
        title: '编译项目',
        message: '即将编译当前项目，这可能需要一些时间。',
      };
    case 'switch_board':
      return {
        title: '切换开发板',
        message: `即将切换开发板为：${args?.board || args?.boardId || args?.board_name || '(未知)'}`,
      };
    case 'set_board_config':
      return {
        title: '修改开发板配置',
        message: `即将修改开发板配置：${args?.key || '(未知配置项)'} = ${args?.value ?? '(未知值)'}`,
      };
    case 'delete_file':
      return {
        title: '删除文件',
        message: `即将删除文件：${args?.path || args?.filePath || '(未知路径)'}`,
      };
    case 'delete_folder':
      return {
        title: '删除文件夹',
        message: `即将删除文件夹及其所有内容：${args?.path || args?.folderPath || '(未知路径)'}`,
      };
    case 'clone_repository':
      return {
        title: '克隆仓库',
        message: `即将克隆 Git 仓库：${args?.url || args?.repoUrl || '(未知地址)'}`,
      };
    case 'agent':
      return {
        title: `调用子代理: ${args?.agentName || '(Agent)'}`,
        message: `即将调用子代理 ${args?.agentName || '(Agent)'} 执行任务：\n${args?.prompt?.slice(0, 200) || args?.description || '(未指定任务)'}`,
      };
    default:
      return {
        title: `执行 ${toolName}`,
        message: `即将执行工具 ${toolName}，请确认是否继续。`,
      };
  }
}