/**
 * register_agent 工具 — 显示文本注册
 *
 * Phase 3: invoke() 已迁移至 lex core，此处仅保留 display text 供 PartEventProcessor 使用。
 */

import { IAilyTool, ToolContext, ToolSchema, ToolUseResult } from '../../core/tool-types';
import { ToolDisplayRegistry } from '../../core/tool-display-registry';
import { migratedToLexCoreResult, withDisplayOnlyCompat } from './display-only-compat';

class RegisterAgentTool implements IAilyTool {
  readonly name = 'register_agent';
  readonly displayMode = 'silent' as const;

  get schema(): ToolSchema {
    return {
      name: this.name,
      description: withDisplayOnlyCompat('动态注册一个新的子代理（subagent），注册后即可通过 agent 工具调用。已注册的同名代理不会被覆盖。'),
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '子代理唯一标识（英文，如 dataAnalysisAgent）' },
          displayName: { type: 'string', description: '人类可读名称（如"数据分析代理"）' },
          description: { type: 'string', description: '功能描述（帮助 LLM 判断何时使用此代理）' },
          useCases: { type: 'array', items: { type: 'string' }, description: '适用场景列表' },
          suggestedContext: { type: 'string', description: '调用前建议获取的上下文' },
          maxTurns: { type: 'number', description: '最大工具调用轮次（默认 30）' },
        },
        required: ['name', 'displayName', 'description'],
      },
      agents: ['mainAgent'],
    };
  }

  // Phase 3 stub: 执行已由 lex core 接管
  async invoke(_args: any, _ctx: ToolContext): Promise<ToolUseResult> {
    return migratedToLexCoreResult(this.name);
  }

  getStartText(args: any): string {
    return `正在注册子代理 ${args.name}...`;
  }

  getResultText(args: any, result: ToolUseResult): string {
    if (result.is_error) return `注册失败: ${result.content}`;
    return `已注册子代理 ${args.name}`;
  }
}

ToolDisplayRegistry.register(new RegisterAgentTool());
