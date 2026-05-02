/**
 * 已注册工具 - 项目与系统操作类（显示文本注册）
 *
 * Phase 3: invoke() 已迁移至 lex core / IHostToolProvider，
 * 此处仅保留 getStartText/getResultText 供 PartEventProcessor 使用。
 */

import { IAilyTool, ToolContext, ToolUseResult } from '../../core/tool-types';
import { ToolDisplayRegistry } from '../../core/tool-display-registry';
import { migratedToLexCoreResult, withDisplayOnlyCompat } from './display-only-compat';
import { createDisplayOnlyToolSchema } from './display-only-tool-schema';

// ============================
// create_project
// ============================

class CreateProjectTool implements IAilyTool {
  readonly name = 'create_project';
  readonly schema = createDisplayOnlyToolSchema('create_project');

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'create_project execution migrated to lex core' };
  }

  getStartText() { return '正在创建项目...'; }
  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '项目创建异常,即将重试';
    return '项目创建成功';
  }
}

// ============================
// execute_command
// ============================

class ExecuteCommandTool implements IAilyTool {
  readonly name = 'execute_command';
  readonly schema = createDisplayOnlyToolSchema('execute_command');

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'execute_command execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const parts = (args?.command || '').trim().split(/\s+/);
    const cmd = parts[0] || 'unknown';
    const cmdArg = parts[1] || '';
    if (cmd.toLowerCase() === 'npm') return `执行: ${cmd} ${cmdArg}`;
    const display = cmdArg.length > 20 ? '...' + cmdArg.slice(-20) : cmdArg;
    return `执行: ${cmd} ${display}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const parts = (args?.command || '').trim().split(/\s+/);
    const cmd = parts[0] || 'unknown';
    const cmdDisplay = cmd.toLowerCase() === 'npm' && parts[1] ? `${cmd} ${parts[1]}` : cmd;

    if (result?.metadata?.npmInstallFailure) {
      return 'npm install命令执行失败，请检查网络或依赖配置';
    }
    if (result?.is_error || result?.warning) {
      return `命令 ${cmdDisplay} 执行异常, 即将重试`;
    }
    return `命令 ${cmdDisplay} 执行成功`;
  }
}

// ============================
// get_context
// ============================

class GetContextTool implements IAilyTool {
  readonly name = 'get_context';
  readonly schema = createDisplayOnlyToolSchema('get_context', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_context execution migrated to lex core' };
  }

  getStartText() { return '获取 上下文信息...'; }
  getResultText(args: any, result?: ToolUseResult): string {
    return result?.is_error ? '获取 上下文信息 异常, 即将重试' : '获取 上下文信息 成功';
  }
}

// ============================
// get_project_info
// ============================

class GetProjectInfoTool implements IAilyTool {
  readonly name = 'get_project_info';
  readonly schema = createDisplayOnlyToolSchema('get_project_info', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_project_info execution migrated to lex core' };
  }

  getStartText() { return '获取 项目信息...'; }
  getResultText(args: any, result?: ToolUseResult): string {
    return result?.is_error ? '获取 项目信息 异常, 即将重试' : '获取 项目信息 成功';
  }
}

// ============================
// build_project
// ============================

class BuildProjectTool implements IAilyTool {
  readonly name = 'build_project';
  readonly schema = createDisplayOnlyToolSchema('build_project');

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'build_project execution migrated to lex core' };
  }

  getStartText() { return '正在编译项目...'; }
  getResultText(args: any, result?: ToolUseResult): string {
    return result?.is_error ? '编译失败' : '编译成功';
  }
}

// ============================
// reload_project
// ============================

class ReloadProjectTool implements IAilyTool {
  readonly name = 'reload_project';
  readonly schema = createDisplayOnlyToolSchema('reload_project');

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'reload_project execution migrated to lex core' };
  }

  getStartText() { return '重新加载项目...'; }
  getResultText(args: any, result?: ToolUseResult): string {
    return result?.is_error ? '项目重新加载失败' : '项目重新加载成功';
  }
}

// ============================
// switch_board
// ============================

class SwitchBoardTool implements IAilyTool {
  readonly name = 'switch_board';
  readonly schema = createDisplayOnlyToolSchema('switch_board');

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'switch_board execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const board = args?.board_name || '未知开发板';
    const shortName = board.replace('@aily-project/board-', '');
    return `正在切换开发板: ${shortName}...`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const board = args?.board_name || '未知开发板';
    const shortName = board.replace('@aily-project/board-', '');
    return result?.is_error ? `切换开发板 ${shortName} 失败` : `开发板已切换为 ${shortName}`;
  }
}

// ============================
// get_board_config
// ============================

class GetBoardConfigTool implements IAilyTool {
  readonly name = 'get_board_config';
  readonly schema = createDisplayOnlyToolSchema('get_board_config');

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_board_config execution migrated to lex core' };
  }

  getStartText() { return '获取开发板配置...'; }
  getResultText(args: any, result?: ToolUseResult): string {
    return result?.is_error ? '获取开发板配置失败' : '获取开发板配置成功';
  }
}

// ============================
// set_board_config
// ============================

class SetBoardConfigTool implements IAilyTool {
  readonly name = 'set_board_config';
  readonly schema = createDisplayOnlyToolSchema('set_board_config');

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'set_board_config execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const key = args?.config_key || '';
    const value = args?.config_value || '';
    return `设置 ${key} = ${value}...`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const key = args?.config_key || '';
    return result?.is_error ? `设置 ${key} 失败` : `${key} 设置成功`;
  }
}

// ============================
// ask_approval
// ============================

class AskApprovalTool implements IAilyTool {
  readonly name = 'ask_approval';
  readonly displayMode = 'silent' as const;
  readonly schema = {
    name: 'ask_approval',
    description: withDisplayOnlyCompat('请求用户确认操作'),
    input_schema: { type: 'object', properties: {}, required: [] },
    agents: ['mainAgent']
  };

  // Phase 3 stub: 执行已由 lex ApprovalProtocol 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return migratedToLexCoreResult(this.name);
  }
}

// ============================
// ask_user（参考 Copilot vscode_askQuestions）
// ============================

class AskUserTool implements IAilyTool {
  readonly name = 'ask_user';
  readonly schema = createDisplayOnlyToolSchema('ask_user', {
    description: '向用户提问并等待回答。',
    agents: ['mainAgent', 'schematicAgent'],
  });
  readonly displayMode = 'silent' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return migratedToLexCoreResult(this.name);
  }

  getStartText(args: any): string {
    const q = args?.question || '向用户提问';
    return q.length > 30 ? q.substring(0, 30) + '...' : q;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.metadata?.skipped) return '用户跳过了问题';
    if (result?.is_error) return '提问失败';
    return '已获取用户回答';
  }
}

// ============================
// search_boards_libraries
// ============================

class SearchBoardsLibrariesTool implements IAilyTool {
  readonly name = 'search_boards_libraries';
  readonly schema = createDisplayOnlyToolSchema('search_boards_libraries');
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'search_boards_libraries execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const searchType = args?.type || 'boards';
    const searchTypeDisplay = searchType === 'boards' ? '开发板' : searchType === 'libraries' ? '库' : '开发板和库';

    let searchDisplayText = '';
    // Parse filters (may be JSON string or object)
    let parsedFilters: any = null;
    if (args?.filters) {
      if (typeof args.filters === 'string') {
        try {
          const trimmed = args.filters.trim();
          if (trimmed && trimmed !== '{}') {
            parsedFilters = JSON.parse(trimmed);
          }
        } catch { /* ignore */ }
      } else if (typeof args.filters === 'object') {
        parsedFilters = args.filters;
      }
    }

    // Prioritize filters.keywords display
    if (parsedFilters?.keywords) {
      const keywords = Array.isArray(parsedFilters.keywords)
        ? parsedFilters.keywords
        : String(parsedFilters.keywords).split(/\s+/);
      if (keywords.length > 0) {
        searchDisplayText = keywords.slice(0, 3).join(', ');
        if (keywords.length > 3) {
          searchDisplayText += ` 等${keywords.length}个关键词`;
        }
      }
    }

    // Show other filter keys (excluding keywords)
    if (parsedFilters) {
      const otherFilterKeys = Object.keys(parsedFilters).filter(k => k !== 'keywords');
      if (otherFilterKeys.length > 0) {
        const filterDisplay = otherFilterKeys.slice(0, 3).map(k => {
          const val = parsedFilters[k];
          if (Array.isArray(val)) return `${k}:[${val.slice(0, 2).join(',')}${val.length > 2 ? '...' : ''}]`;
          return `${k}:${val}`;
        }).join(', ');
        searchDisplayText += searchDisplayText ? ` + ${filterDisplay}` : filterDisplay;
      }
    }

    if (!searchDisplayText) searchDisplayText = '未知查询';
    return `正在搜索${searchTypeDisplay}: ${searchDisplayText}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const searchType = args?.type || 'boards';
    const searchTypeDisplay = searchType === 'boards' ? '开发板' : searchType === 'libraries' ? '库' : '开发板和库';
    if (result?.is_error) return `搜索 ${searchTypeDisplay} 失败: ${result?.content || '未知错误'}`;
    const totalMatches = result?.metadata?.totalMatches || 0;
    // Build search summary for display
    let searchDisplayText = this.getStartText(args).replace(/^正在搜索[^:]*:\s*/, '');
    const searchSummary = searchDisplayText.length > 20 ? searchDisplayText.substring(0, 20) + '...' : searchDisplayText;
    return `搜索 ${searchTypeDisplay} 「${searchSummary}」完成，找到 ${totalMatches} 个匹配项`;
  }
}

// ============================
// get_hardware_categories
// ============================

class GetHardwareCategoriesTool implements IAilyTool {
  readonly name = 'get_hardware_categories';
  readonly schema = createDisplayOnlyToolSchema('get_hardware_categories');
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_hardware_categories execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const type = args?.type === 'boards' ? '开发板' : '库';
    return `正在获取${type}分类...`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const type = args?.type === 'boards' ? '开发板' : '库';
    if (result?.is_error) return `获取 ${type} 分类失败`;
    const count = result?.metadata?.categories?.length || 0;
    return `获取 ${type} 分类完成，共 ${count} 个分类`;
  }
}

// ============================
// get_board_parameters
// ============================

class GetBoardParametersTool implements IAilyTool {
  readonly name = 'get_board_parameters';
  readonly schema = createDisplayOnlyToolSchema('get_board_parameters', { agents: ['mainAgent', 'schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_board_parameters execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const params = Array.isArray(args?.parameters) ? args.parameters.join(', ') : (args?.parameters || '所有参数');
    return `正在获取当前开发板参数 (${params})`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return `获取开发板参数失败`;
    const boardName = result?.metadata?.boardName || '未知';
    return `获取开发板 "${boardName}" 参数成功`;
  }
}

// ============================
// fetch
// ============================

class FetchTool implements IAilyTool {
  readonly name = 'fetch';
  readonly schema = createDisplayOnlyToolSchema('fetch', { agents: ['mainAgent', 'schematicAgent'] });

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'fetch execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const url = args?.url || 'unknown';
    return `进行网络请求: ${url}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '网络请求异常，即将重试';
    return `网络请求 ${args?.url || ''} 成功`;
  }
}

// ============================
// clone_repository
// ============================

class CloneRepositoryTool implements IAilyTool {
  readonly name = 'clone_repository';
  readonly schema = createDisplayOnlyToolSchema('clone_repository');

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'clone_repository execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const url = args?.url || '';
    const parts = url.replace(/\.git\/?$/, '').split('/');
    const repoName = parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : url;
    return `克隆仓库: ${repoName}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '仓库克隆失败';
    const fileCount = result?.metadata?.fileCount || 0;
    return `仓库克隆完成，${fileCount} 个文件`;
  }
}

// ============================
// web_search
// ============================

class WebSearchTool implements IAilyTool {
  readonly name = 'web_search';
  readonly schema = createDisplayOnlyToolSchema('web_search');

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'web_search execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `搜索: ${args?.query || ''}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '搜索失败，即将重试';
    const count = result?.metadata?.resultCount || 0;
    return `搜索完成，找到 ${count} 条结果`;
  }
}

// ============================
// todo_write_tool
// ============================

class TodoWriteTool implements IAilyTool {
  readonly name = 'todo_write_tool';
  readonly schema = createDisplayOnlyToolSchema('todo_write_tool');
  readonly displayMode = 'silent' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'todo_write_tool execution migrated to lex core' };
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return 'TODO操作异常,即将重试';
    const op = args?.operation || 'unknown';
    const itemTitle = args?.content || args?.title || '项目';
    const texts: Record<string, string> = {
      add: `TODO项目添加成功: ${itemTitle}`,
      batch_add: 'TODO项目批量添加成功',
      list: 'TODO列表获取成功',
      update: 'TODO项目更新成功',
      toggle: 'TODO项目状态切换成功',
      delete: 'TODO项目删除成功',
      clear: 'TODO列表清空成功',
      query: 'TODO查询完成',
      stats: 'TODO统计完成',
    };
    return texts[op] || 'TODO操作完成';
  }
}

// ============================
// 注册
// ============================

ToolDisplayRegistry.register(new CreateProjectTool());
ToolDisplayRegistry.register(new ExecuteCommandTool());
ToolDisplayRegistry.registerAlias('run_terminal', 'execute_command');
ToolDisplayRegistry.register(new GetContextTool());
ToolDisplayRegistry.register(new GetProjectInfoTool());
ToolDisplayRegistry.register(new BuildProjectTool());
ToolDisplayRegistry.register(new ReloadProjectTool());
ToolDisplayRegistry.register(new SwitchBoardTool());
ToolDisplayRegistry.register(new GetBoardConfigTool());
ToolDisplayRegistry.register(new SetBoardConfigTool());
ToolDisplayRegistry.register(new AskApprovalTool());
ToolDisplayRegistry.register(new AskUserTool());
ToolDisplayRegistry.register(new SearchBoardsLibrariesTool());
ToolDisplayRegistry.register(new GetHardwareCategoriesTool());
ToolDisplayRegistry.register(new GetBoardParametersTool());
ToolDisplayRegistry.register(new FetchTool());
ToolDisplayRegistry.register(new CloneRepositoryTool());
ToolDisplayRegistry.register(new WebSearchTool());
ToolDisplayRegistry.register(new TodoWriteTool());

// ============================
// memory — 记忆工具
// ============================

class MemoryTool implements IAilyTool {
  readonly name = 'memory';
  readonly schema = createDisplayOnlyToolSchema('memory');
  readonly displayMode = 'silent' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'memory execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const scope = args?.scope === 'global' ? '全局' : '项目';
    const cmd = args?.command || 'read';
    return `${scope}记忆: ${cmd}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    const scope = args?.scope === 'global' ? '全局' : '项目';
    if (result?.is_error) return `${scope}记忆操作失败`;
    return `${scope}记忆操作成功`;
  }
}

ToolDisplayRegistry.register(new MemoryTool());

// ============================
// get_errors — 错误诊断工具
// ============================

class GetErrorsTool implements IAilyTool {
  readonly name = 'get_errors';
  readonly schema = createDisplayOnlyToolSchema('get_errors');
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_errors execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const path = args?.path;
    return path ? `检查错误: ${path.split(/[\\/]/).pop()}` : '检查项目错误...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '错误检查失败';
    const count = result?.metadata?.errorCount || 0;
    return count > 0 ? `发现 ${count} 个问题` : '未发现错误';
  }
}

ToolDisplayRegistry.register(new GetErrorsTool());

// ============================
// start_background_command — 后台命令执行
// ============================

class StartBackgroundCommandTool implements IAilyTool {
  readonly name = 'start_background_command';
  readonly schema = createDisplayOnlyToolSchema('start_background_command');

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'start_background_command execution migrated to lex core' };
  }

  getStartText(args: any): string {
    const cmd = (args?.command || '').split(/\s+/).slice(0, 3).join(' ');
    return `后台启动: ${cmd}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '后台命令启动失败';
    return `后台命令已启动 (${result?.metadata?.sessionId || ''})`;
  }
}

// ============================
// get_terminal_output — 获取后台命令输出
// ============================

class GetTerminalOutputTool implements IAilyTool {
  readonly name = 'get_terminal_output';
  readonly schema = createDisplayOnlyToolSchema('get_terminal_output');
  readonly displayMode = 'silent' as const;

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_terminal_output execution migrated to lex core' };
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '获取终端输出失败';
    const status = result?.metadata?.status || 'unknown';
    return `终端输出获取成功 (${status})`;
  }
}

ToolDisplayRegistry.register(new StartBackgroundCommandTool());
ToolDisplayRegistry.register(new GetTerminalOutputTool());
ToolDisplayRegistry.registerAlias('send_to_terminal', 'get_terminal_output');
ToolDisplayRegistry.registerAlias('kill_terminal', 'get_terminal_output');

// ============================
// save_arch — 框架图保存工具
// ============================

class SaveArchTool implements IAilyTool {
  readonly name = 'save_arch';
  readonly schema = createDisplayOnlyToolSchema('save_arch');
  readonly displayMode = 'silent' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'save_arch execution migrated to lex core' };
  }

  getStartText(): string {
    return '保存框架图到 arch.md...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    return result?.is_error ? '框架图保存失败' : '框架图保存成功';
  }
}

ToolDisplayRegistry.register(new SaveArchTool());
