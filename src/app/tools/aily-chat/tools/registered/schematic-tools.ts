/**
 * 已注册工具 - 连线图 / Schematic 类（显示文本注册）
 *
 * Phase 3: invoke() 已迁移至 lex IHostToolProvider (blockly-contributed-tools.ts)，
 * 此处仅保留 getStartText/getResultText 供 PartEventProcessor 使用。
 */

import { IAilyTool, ToolContext, ToolUseResult } from '../../core/tool-types';
import { ToolDisplayRegistry } from '../../core/tool-display-registry';
import { createDisplayOnlyToolSchema } from './display-only-tool-schema';

// ============================
// generate_schematic
// ============================

class GenerateSchematicTool implements IAilyTool {
  readonly name = 'generate_schematic';
  readonly schema = createDisplayOnlyToolSchema('generate_schematic', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'generate_schematic execution migrated to lex core' };
  }

  getStartText(): string {
    return '分析引脚信息，准备连线方案...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '连线方案生成失败';
    return '连线方案生成完成';
  }
}

// ============================
// get_pinmap_summary
// ============================

class GetPinmapSummaryTool implements IAilyTool {
  readonly name = 'get_pinmap_summary';
  readonly schema = createDisplayOnlyToolSchema('get_pinmap_summary', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_pinmap_summary execution migrated to lex core' };
  }

  getStartText(): string {
    return '获取引脚摘要信息...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '引脚摘要获取失败';
    return '引脚摘要获取成功';
  }
}

// ============================
// get_component_catalog
// ============================

class GetComponentCatalogTool implements IAilyTool {
  readonly name = 'get_component_catalog';
  readonly schema = createDisplayOnlyToolSchema('get_component_catalog', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_component_catalog execution migrated to lex core' };
  }

  getStartText(): string {
    return '扫描项目组件目录...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '组件目录获取失败';
    return '组件目录获取完成';
  }
}

// ============================
// get_project_context
// ============================

class GetProjectContextTool implements IAilyTool {
  readonly name = 'get_project_context';
  readonly schema = createDisplayOnlyToolSchema('get_project_context', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_project_context execution migrated to lex core' };
  }

  getStartText(): string {
    return '获取项目上下文和组件目录...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '项目上下文获取失败';
    return '项目上下文和组件目录获取完成';
  }
}

// ============================
// validate_schematic
// ============================

class ValidateSchematicTool implements IAilyTool {
  readonly name = 'validate_schematic';
  readonly schema = createDisplayOnlyToolSchema('validate_schematic', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'validate_schematic execution migrated to lex core' };
  }

  getStartText(): string {
    return '验证连线配置安全性...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '连线配置验证失败';
    return '连线配置验证完成';
  }
}

// ============================
// generate_pinmap
// ============================

class GeneratePinmapTool implements IAilyTool {
  readonly name = 'generate_pinmap';
  readonly schema = createDisplayOnlyToolSchema('generate_pinmap', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'generate_pinmap execution migrated to lex core' };
  }

  getStartText(): string {
    return '获取 pinmap 生成参考信息...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return 'Pinmap 参考信息获取失败';
    return 'Pinmap 参考信息获取完成';
  }
}

// ============================
// save_pinmap
// ============================

class SavePinmapTool implements IAilyTool {
  readonly name = 'save_pinmap';
  readonly schema = createDisplayOnlyToolSchema('save_pinmap', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'save_pinmap execution migrated to lex core' };
  }

  getStartText(): string {
    return '保存 pinmap 配置...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return 'Pinmap 配置保存失败';
    return 'Pinmap 配置保存成功';
  }
}

// ============================
// get_current_schematic
// ============================

class GetCurrentSchematicTool implements IAilyTool {
  readonly name = 'get_current_schematic';
  readonly schema = createDisplayOnlyToolSchema('get_current_schematic', { agents: ['mainAgent', 'schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'get_current_schematic execution migrated to lex core' };
  }

  getStartText(): string {
    return '读取当前连线图...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '当前连线图获取失败';
    return '当前连线图获取完成';
  }
}

// ============================
// apply_schematic (已废弃，功能已合并到 validate_schematic)
// ============================

class ApplySchematicTool implements IAilyTool {
  readonly name = 'apply_schematic';
  readonly schema = createDisplayOnlyToolSchema('apply_schematic', { agents: ['schematicAgent'] });
  readonly displayMode = 'appendMessage' as const;

  // Phase 3 stub: 执行已由 lex IHostToolProvider 接管 (apply_schematic 已废弃，转发到 validate_schematic)
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return { is_error: true, content: 'apply_schematic execution migrated to lex core' };
  }

  getStartText(): string {
    return '验证并保存连线图...';
  }

  getResultText(args: any, result?: ToolUseResult): string {
    if (result?.is_error) return '连线图验证保存失败';
    return '连线图验证并保存完成';
  }
}

// ============================
// 注册
// ============================

ToolDisplayRegistry.register(new GenerateSchematicTool());
ToolDisplayRegistry.register(new GetPinmapSummaryTool());
ToolDisplayRegistry.register(new GetComponentCatalogTool());
ToolDisplayRegistry.register(new ValidateSchematicTool());
ToolDisplayRegistry.register(new GeneratePinmapTool());
ToolDisplayRegistry.register(new SavePinmapTool());
ToolDisplayRegistry.register(new GetCurrentSchematicTool());
ToolDisplayRegistry.register(new ApplySchematicTool());
ToolDisplayRegistry.register(new GetProjectContextTool());
