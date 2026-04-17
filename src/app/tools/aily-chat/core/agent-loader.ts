/**
 * 声明式代理配置加载器
 *
 * 支持从 .agent.md 文件的 YAML frontmatter 中加载 SubagentDefinition，
 * 参考 Claude Code 的 loadAgentsDir 和 Copilot 的 .agent.md 配置。
 *
 * 用法：
 * 1. 在 agents/ 目录下创建 xxx.agent.md 文件
 * 2. 在 YAML frontmatter 中声明 name/displayName/description/tools/maxTurns 等
 * 3. 调用 loadAgentDefinitionsFromMarkdown() 解析并注册
 */

import { SubagentDefinition, registerSubagent, getSubagentDefinition } from './subagent-registry';

/**
 * 从 YAML frontmatter 文本中解析 SubagentDefinition
 *
 * 支持的 frontmatter 字段（与 SubagentDefinition 一一对应）：
 * - name (required)
 * - displayName (required)
 * - description (required)
 * - useCases (string[])
 * - suggestedContext (string)
 * - tools (string[]) — 白名单
 * - disallowedTools (string[]) — 黑名单
 * - maxTurns (number)
 * - model (string)
 * - endpoint (string)
 */
export function parseAgentFrontmatter(markdown: string): SubagentDefinition | null {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const def: Partial<SubagentDefinition> = {};

  // 简易 YAML 解析（仅支持平面 key: value 和数组）
  const lines = frontmatter.split('\n');
  let currentKey = '';
  let multilineValue = '';
  let inMultiline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 多行值继续（以 > 开头的块标量）
    if (inMultiline) {
      if (line.match(/^\s/) && !line.match(/^\S+:/)) {
        multilineValue += ' ' + line.trim();
        continue;
      } else {
        (def as any)[currentKey] = multilineValue.trim();
        inMultiline = false;
      }
    }

    // 数组项：  - value
    const arrayMatch = line.match(/^\s+-\s+(.+)/);
    if (arrayMatch && currentKey) {
      if (!Array.isArray((def as any)[currentKey])) {
        (def as any)[currentKey] = [];
      }
      (def as any)[currentKey].push(arrayMatch[1].trim());
      continue;
    }

    // key: value
    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === '>' || value === '|') {
        // 块标量
        inMultiline = true;
        multilineValue = '';
      } else if (value === '') {
        // 可能是数组头（下一行以 - 开头）
      } else {
        // 简单值
        if (value === 'true') (def as any)[currentKey] = true;
        else if (value === 'false') (def as any)[currentKey] = false;
        else if (/^\d+$/.test(value)) (def as any)[currentKey] = parseInt(value, 10);
        else (def as any)[currentKey] = value;
      }
    }
  }

  // 处理最后一个多行值
  if (inMultiline && currentKey) {
    (def as any)[currentKey] = multilineValue.trim();
  }

  // 验证必填字段
  if (!def.name || !def.displayName || !def.description) {
    console.warn('[AgentLoader] 缺少必填字段 (name/displayName/description):', def);
    return null;
  }

  return {
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    useCases: def.useCases || [],
    suggestedContext: def.suggestedContext,
    tools: def.tools,
    disallowedTools: def.disallowedTools,
    maxTurns: def.maxTurns,
    model: def.model,
    endpoint: def.endpoint,
  };
}

/**
 * 从 markdown 内容数组中批量解析并注册子代理
 * 跳过已注册的（不覆盖代码级注册）
 *
 * @returns 新注册的代理名称列表
 */
export function loadAgentDefinitionsFromMarkdown(markdowns: string[]): string[] {
  const registered: string[] = [];

  for (const md of markdowns) {
    const def = parseAgentFrontmatter(md);
    if (!def) continue;

    // 已有代码级注册的不覆盖
    if (getSubagentDefinition(def.name)) {
      console.log(`[AgentLoader] ${def.name} 已注册，跳过 .md 配置`);
      continue;
    }

    registerSubagent(def);
    registered.push(def.name);
    console.log(`[AgentLoader] 从 .md 注册子代理: ${def.name} (${def.displayName})`);
  }

  return registered;
}
