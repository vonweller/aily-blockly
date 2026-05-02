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
  subtitle?: string;
  message: string;
  source?: string;
  actions?: readonly ToolApprovalAction[];
  primaryScope?: ToolApprovalScope;
  args?: any;
}

export interface ToolApprovalPresentation {
  readonly title?: string;
  readonly subtitle?: string;
  readonly message?: string;
  readonly source?: string;
  readonly actions?: readonly ToolApprovalAction[];
  readonly primaryScope?: ToolApprovalScope;
  readonly args?: any;
}

export type ToolApprovalScope = 'once' | 'session' | 'workspace' | 'session-all-terminal' | 'session-safe';

export interface ToolApprovalAction {
  readonly scope: ToolApprovalScope;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly disabled?: boolean;
  readonly isSecondary?: boolean;
}

export interface ToolApprovalResult {
  approved: boolean;
  reason?: string;
  scope?: ToolApprovalScope;
}

export type ToolApprovalCallback = (request: ToolApprovalRequest) => Promise<ToolApprovalResult>;

export function getToolApprovalTitle(toolName: string | undefined, fallbackTitle?: string): string {
  switch (toolName) {
    case 'run_terminal':
    case 'run_in_terminal':
      return '运行终端命令';
    case 'send_to_terminal':
      return '发送终端输入';
    case 'kill_terminal':
      return '结束终端会话';
    default:
      return fallbackTitle && !fallbackTitle.startsWith('确认执行: ')
        ? fallbackTitle
        : toolName
          ? `确认执行 ${toolName}`
          : (fallbackTitle || '确认操作');
  }
}

export function getToolApprovalSubtitle(toolName: string | undefined, source?: string): string | undefined {
  const normalizedToolName = toolName?.trim();
  const normalizedSource = source?.trim();

  if (normalizedToolName && normalizedSource) {
    return `${normalizedToolName} · ${normalizedSource}`;
  }

  return normalizedToolName || normalizedSource || undefined;
}

export function getToolApprovalActions(toolName: string | undefined): readonly ToolApprovalAction[] {
  switch (toolName) {
    case 'run_terminal':
    case 'run_in_terminal':
      return [
        {
          scope: 'session',
          label: '在当前对话中自动运行此命令',
          description: '后续相同命令将直接运行，不再重复询问。',
          tooltip: '记住这条命令，并在当前对话中自动运行。',
        },
        {
          scope: 'workspace',
          label: '在当前工作区中自动运行此命令',
          description: '把这条命令加入工作区级 allow list。',
          tooltip: '把这条命令写入当前工作区规则。',
        },
        {
          scope: 'session-all-terminal',
          label: '允许当前对话中的所有终端命令',
          description: '后续 terminal 命令在本对话中直接运行。',
          tooltip: '当前对话中的后续终端命令将不再逐条确认。',
          isSecondary: true,
        },
      ];
    default:
      return [
        {
          scope: 'session',
          label: '在当前对话中自动运行此工具',
          description: '同一工具的后续请求将不再重复询问。',
          tooltip: '当前对话中的同类工具请求将自动执行。',
        },
        {
          scope: 'workspace',
          label: '在当前工作区中自动运行此工具',
          description: '把此工具加入当前工作区级 permission rule。',
          tooltip: '当前工作区中的同类工具请求将自动执行。',
        },
      ];
  }
}

export function generateApprovalMessage(toolName: string, args: any): { title: string; message: string } {
  switch (toolName) {
    case 'run_terminal':
    case 'run_in_terminal':
      return {
        title: '运行终端命令',
        message: `即将运行终端命令：\n${args?.command || '(未知命令)'}${args?.goal ? '\n目标：' + args.goal : ''}`,
      };
    case 'send_to_terminal':
      return {
        title: '发送终端输入',
        message: `即将向终端发送输入：\n${args?.command || '(空输入 / 回车)'}`,
      };
    case 'kill_terminal':
      return {
        title: '结束终端会话',
        message: `即将结束终端会话：${args?.id || args?.terminalId || '(未知终端)'}`,
      };
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