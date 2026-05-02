/**
 * 已注册工具 - ABS / ABI / 工具类（显示文本注册）
 *
 * Phase 3: invoke() 已迁移至 lex IHostToolProvider (blockly-contributed-tools.ts)，
 * 此处仅保留 getStartText/getResultText 供 PartEventProcessor 使用。
 */

import { IAilyTool, ToolContext, ToolUseResult } from '../../core/tool-types';
import { ToolDisplayRegistry } from '../../core/tool-display-registry';
import { createDisplayOnlyToolSchema } from './display-only-tool-schema';

// ============================
// syncAbs
// ============================

class SyncAbsTool implements IAilyTool {
  readonly name = 'syncAbs';
  readonly schema = createDisplayOnlyToolSchema('syncAbs');
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'syncAbs execution migrated to lex core' };
  }

  getStartText(args: any): string {
    // Only show UI for 'import' operation
    if (args?.action === 'import') return '加载 图形化代码...';
    return ''; // empty → executeRegisteredTool skips startToolCall
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '项目文件 同步失败';
    if (args?.action === 'import') return '加载 图形化代码 完成';
    return ''; // export/status → no completeToolCall display
  }
}

// ============================
// abs_version_control
// ============================

// class AbsVersionControlTool implements IAilyTool {
//   readonly name = 'abs_version_control';
//   readonly schema = findLegacySchema('abs_version_control');
//   readonly environment = 'gui' as const;

//   async invoke(args: any, ctx: ToolContext): Promise<ToolUseResult> {
//     if (!ctx.host?.absSync) return { is_error: true, content: 'ABS 同步服务不可用' };
//     return absVersionControlHandler(args, ctx.host.absSync);
//   }

//   getStartText(args: any): string {
//     const action = args?.action || 'unknown';
//     const texts: Record<string, string> = {
//       snapshot: '创建 ABS 快照...',
//       list: '列出历史快照...',
//       restore: '恢复 ABS 快照...',
//       diff: '对比 ABS 快照...',
//     };
//     return texts[action] || `ABS 版本控制: ${action}`;
//   }

//   getResultText(args: any, result?: ToolUseResult): string {
//     if (result?.is_error) return 'ABS 版本控制操作失败';
//     return 'ABS 版本控制操作成功';
//   }
// }

// ============================
// get_abs_syntax
// ============================

// class GetAbsSyntaxTool implements IAilyTool {
//   readonly name = 'get_abs_syntax';
//   readonly schema = findLegacySchema('get_abs_syntax');
//   readonly displayMode = 'appendMessage' as const;

//   async invoke(args: any, ctx: ToolContext): Promise<ToolUseResult> {
//     return getAbsSyntaxHandler();
//   }

//   getStartText(): string {
//     return '获取 ABS 语法规范...';
//   }

//   getResultText(args: any, result?: ToolUseResult): string {
//     if (result?.is_error) return 'ABS 语法规范获取失败';
//     return 'ABS 语法规范获取成功';
//   }
// }

// ============================
// edit_abi_file
// ============================

class EditAbiFileTool implements IAilyTool {
  readonly name = 'edit_abi_file';
  readonly schema = {
    name: 'edit_abi_file',
    description: '编辑ABI文件',
    input_schema: { type: 'object', properties: {} },
    agents: ['mainAgent']
  };
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'edit_abi_file execution migrated to lex core' };
  }

  getStartText(args: any): string {
    if (args?.replaceStartLine !== undefined) {
      if (args.replaceEndLine !== undefined && args.replaceEndLine !== args.replaceStartLine) {
        return `替换ABI文件第 ${args.replaceStartLine}-${args.replaceEndLine} 行内容...`;
      }
      return `替换ABI文件第 ${args.replaceStartLine} 行内容...`;
    } else if (args?.insertLine !== undefined) {
      return `ABI文件第 ${args.insertLine} 行插入内容...`;
    } else if (args?.replaceMode === false) {
      return '向ABI文件末尾追加内容...';
    }
    return '编辑ABI文件...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return 'ABI文件编辑失败';
    if (args?.insertLine !== undefined) {
      return `ABI文件第 ${args.insertLine} 行插入内容成功`;
    } else if (args?.replaceStartLine !== undefined) {
      if (args?.replaceEndLine !== undefined && args.replaceEndLine !== args.replaceStartLine) {
        return `ABI文件第 ${args.replaceStartLine}-${args.replaceEndLine} 行替换成功`;
      }
      return `ABI文件第 ${args.replaceStartLine} 行替换成功`;
    } else if (args?.replaceMode === false) {
      return 'ABI文件内容追加成功';
    }
    return 'ABI文件编辑成功';
  }
}

// ============================
// reload_abi_json
// ============================

class ReloadAbiJsonTool implements IAilyTool {
  readonly name = 'reload_abi_json';
  readonly schema = {
    name: 'reload_abi_json',
    description: '重新加载Blockly工作区数据',
    input_schema: { type: 'object', properties: {} },
    agents: ['mainAgent']
  };
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'reload_abi_json execution migrated to lex core' };
  }

  getStartText(): string {
    return '重新加载Blockly工作区数据...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return 'ABI数据重新加载异常';
    return 'ABI数据重新加载成功';
  }
}

// ============================
// 注册
// ============================

ToolDisplayRegistry.register(new SyncAbsTool());
// ToolDisplayRegistry.register(new AbsVersionControlTool());
// ToolDisplayRegistry.register(new GetAbsSyntaxTool());
ToolDisplayRegistry.register(new EditAbiFileTool());
ToolDisplayRegistry.register(new ReloadAbiJsonTool());
