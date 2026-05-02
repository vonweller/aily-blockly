/**
 * 已注册工具 - Blockly 块操作类（显示文本注册）
 *
 * Phase 3: invoke() 已迁移至 lex IHostToolProvider，
 * 此处仅保留 getStartText/getResultText 供 PartEventProcessor 使用。
 */

import { IAilyTool, ToolContext, ToolUseResult } from '../../core/tool-types';
import { ToolDisplayRegistry } from '../../core/tool-display-registry';
import { createDisplayOnlyToolSchema } from './display-only-tool-schema';

// ============================
// smart_block_tool
// ============================

class SmartBlockTool implements IAilyTool {
  readonly name = 'smart_block_tool';
  readonly schema = createDisplayOnlyToolSchema('smart_block_tool', { description: '智能创建Blockly块' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'smart_block_tool execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `创建Blockly块: ${args?.type || 'unknown'}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '智能块操作失败';
    return `智能块操作成功: ${args?.type || 'unknown'}`;
  }
}

// ============================
// connect_blocks_tool
// ============================

class ConnectBlocksTool implements IAilyTool {
  readonly name = 'connect_blocks_tool';
  readonly schema = createDisplayOnlyToolSchema('connect_blocks_tool', { description: '连接Blockly块' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'connect_blocks_tool execution migrated to lex core' };
  }

  getStartText(): string {
    return '连接Blockly块...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '块连接失败';
    return `块连接成功: ${args?.connectionType || 'unknown'}连接`;
  }
}

// ============================
// create_code_structure_tool
// ============================

class CreateCodeStructureTool implements IAilyTool {
  readonly name = 'create_code_structure_tool';
  readonly schema = createDisplayOnlyToolSchema('create_code_structure_tool', { description: '创建代码结构' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'create_code_structure_tool execution migrated to lex core' };
  }

  getStartText(args: any): string {
    return `创建代码结构: ${args?.structure || 'unknown'}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '代码结构创建失败';
    return `代码结构创建成功: ${args?.structure || 'unknown'}`;
  }
}

// ============================
// configure_block_tool
// ============================

class ConfigureBlockTool implements IAilyTool {
  readonly name = 'configure_block_tool';
  readonly schema = createDisplayOnlyToolSchema('configure_block_tool', { description: '配置Blockly块' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'configure_block_tool execution migrated to lex core' };
  }

  getStartText(): string {
    return '配置Blockly块...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '块配置失败';
    return `块配置成功: ID ${args?.blockId || 'unknown'}`;
  }
}

// ============================
// delete_block_tool
// ============================

class DeleteBlockTool implements IAilyTool {
  readonly name = 'delete_block_tool';
  readonly schema = createDisplayOnlyToolSchema('delete_block_tool', { description: '删除Blockly块' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'delete_block_tool execution migrated to lex core' };
  }

  getStartText(): string {
    return '删除Blockly块...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '块删除失败';
    return '块删除成功';
  }
}

// ============================
// get_workspace_overview_tool
// ============================

class GetWorkspaceOverviewTool implements IAilyTool {
  readonly name = 'get_workspace_overview_tool';
  readonly schema = createDisplayOnlyToolSchema('get_workspace_overview_tool');
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_workspace_overview execution migrated to lex core' };
  }

  getStartText(): string {
    return '分析工作区全览...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '工作区分析失败';
    return '工作区分析完成';
  }
}

// ============================
// queryBlockDefinitionTool
// ============================

class QueryBlockDefinitionTool implements IAilyTool {
  readonly name = 'queryBlockDefinitionTool';
  readonly schema = createDisplayOnlyToolSchema('queryBlockDefinitionTool', { description: '查询块定义信息' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'queryBlockDefinitionTool execution migrated to lex core' };
  }

  getStartText(): string {
    return '查询块定义信息...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '块定义查询失败';
    return '块定义查询完成';
  }
}

// ============================
// analyze_library_blocks
// ============================

class AnalyzeLibraryBlocksTool implements IAilyTool {
  readonly name = 'analyze_library_blocks';
  readonly schema = createDisplayOnlyToolSchema('analyze_library_blocks');
  readonly environment = 'gui' as const;
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'analyze_library_blocks execution migrated to lex core' };
  }

  getStartText(args: any): string {
    let names = '未知库';
    try {
      let parsed: string[] = [];
      if (typeof args?.libraryNames === 'string') {
        parsed = args.libraryNames.startsWith('[')
          ? JSON.parse(args.libraryNames)
          : args.libraryNames.split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (Array.isArray(args?.libraryNames)) {
        parsed = args.libraryNames;
      }
      if (parsed.length > 0) names = parsed.join(', ');
    } catch { /* fallback */ }
    return `正在分析库: ${names}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return `库分析失败: ${result?.content || '未知错误'}`;
    const metadata = result?.metadata;
    if (metadata) {
      return `库分析完成: 分析了 ${metadata.librariesAnalyzed || 0} 个库，找到 ${metadata.totalBlocks || 0} 个块定义`;
    }
    return '库分析完成';
  }
}

// ============================
// verify_block_existence
// ============================

class VerifyBlockExistenceTool implements IAilyTool {
  readonly name = 'verify_block_existence';
  readonly displayMode = 'appendMessage' as const;
  readonly schema = createDisplayOnlyToolSchema('verify_block_existence', { description: '验证块存在性' });
  readonly environment = 'gui' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'verify_block_existence execution migrated to lex core' };
  }

  getStartText(args: any): string {
    let display = '未知块';
    try {
      const blockTypes = typeof args?.blockTypes === 'string'
        ? JSON.parse(args.blockTypes)
        : args?.blockTypes;
      if (Array.isArray(blockTypes)) {
        display = blockTypes.join(', ');
      }
    } catch { /* fallback */ }
    return `正在验证块: ${display}`;
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return `块验证失败: ${result?.content || '未知错误'}`;
    const metadata = result?.metadata;
    if (metadata) {
      const existingCount = metadata.existingBlocks?.length || 0;
      const missingCount = metadata.missingBlocks?.length || 0;
      return `块验证完成: ${existingCount}个块存在，${missingCount}个块缺失`;
    }
    return '块验证完成';
  }
}

// ============================
// 注册
// ============================

ToolDisplayRegistry.register(new SmartBlockTool());
ToolDisplayRegistry.register(new ConnectBlocksTool());
ToolDisplayRegistry.register(new CreateCodeStructureTool());
ToolDisplayRegistry.register(new ConfigureBlockTool());
ToolDisplayRegistry.register(new DeleteBlockTool());
ToolDisplayRegistry.register(new GetWorkspaceOverviewTool());
ToolDisplayRegistry.register(new QueryBlockDefinitionTool());
ToolDisplayRegistry.register(new AnalyzeLibraryBlocksTool());
ToolDisplayRegistry.register(new VerifyBlockExistenceTool());
