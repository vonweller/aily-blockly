/**
 * 子代理注册表（纯数据层）
 *
 * 从 runSubagentTool.ts 提取的轻量级注册表，
 * 仅保留 SubagentDefinition 类型和注册/查询函数。
 * 工具执行逻辑已迁移到 lex 的 run_subagent 内置工具。
 */

export interface SubagentDefinition {
  name: string;
  displayName: string;
  description: string;
  useCases: string[];
  suggestedContext?: string;
  tools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  model?: string;
  endpoint?: string;
}

const _agentRegistry = new Map<string, SubagentDefinition>();

export function registerSubagent(def: SubagentDefinition): void {
  _agentRegistry.set(def.name, def);
}

export function getRegisteredSubagents(): SubagentDefinition[] {
  return [..._agentRegistry.values()];
}

export function getSubagentDefinition(name: string): SubagentDefinition | undefined {
  return _agentRegistry.get(name);
}

export function buildRunSubagentDescription(): string {
  const agents = getRegisteredSubagents();
  if (agents.length === 0) {
    return '启动子代理执行独立任务。当前没有可用的子代理。';
  }
  const agentDescriptions = agents.map(a => {
    const useCases = a.useCases.map(u => `  - ${u}`).join('\n');
    const ctxHint = a.suggestedContext ? `\n  注意: ${a.suggestedContext}` : '';
    return `**${a.name}** (${a.displayName}): ${a.description}\n  适用场景:\n${useCases}${ctxHint}`;
  }).join('\n\n');
  return `启动子代理执行独立任务。子代理拥有专属工具集，可以自主完成特定领域的工作。\n\n可用子代理:\n${agentDescriptions}`;
}

export function buildRunSubagentSchema(): any {
  const agents = getRegisteredSubagents();
  const agentNames = agents.map(a => a.name);
  return {
    name: 'run_subagent',
    description: buildRunSubagentDescription(),
    input_schema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: agentNames.length > 0 ? agentNames : undefined,
          description: `目标子代理名称。可选值: ${agentNames.join(', ')}`,
        },
        task: { type: 'string', description: '交给子代理的具体任务描述' },
        context: { type: 'string', description: '相关上下文信息' },
      },
      required: ['agent', 'task'],
    },
    agents: ['mainAgent'],
  };
}

// 内置 schematicAgent 注册
registerSubagent({
  name: 'schematicAgent',
  displayName: '接线图代理',
  description: '为用户生成开发板与电子模块的可视化接线图（电路原理图）。子代理会独立运行，使用专属工具集完成接线图的生成和编辑，完成后返回结果。',
  useCases: [
    '用户要求生成、更新或修改接线图/电路图',
    '涉及开发板引脚连线的可视化需求',
  ],
  suggestedContext: '调用前应先通过 get_context 和 get_project_info 获取当前项目信息',
});
