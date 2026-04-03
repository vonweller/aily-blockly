/**
 * 内置子代理声明式配置 — 编译时打包
 *
 * 所有 .agent.md 文件通过 import 打包到前端 bundle 中，
 * 由 initBundledAgents() 在引擎启动时批量解析注册。
 */

import schematicAgentMd from './schematic.agent.md';
import { loadAgentDefinitionsFromMarkdown } from '../core/agent-loader';

/** 所有内置 .agent.md 文件的原始内容 */
const BUNDLED_AGENT_MARKDOWNS: string[] = [
  schematicAgentMd,
  // 在此添加新的 .agent.md import
];

let _initialized = false;

/**
 * 从打包的 .agent.md 文件中解析并注册子代理
 * 幂等：多次调用只执行一次
 *
 * @returns 本次新注册的代理名称列表
 */
export function initBundledAgents(): string[] {
  if (_initialized) return [];
  _initialized = true;

  const registered = loadAgentDefinitionsFromMarkdown(BUNDLED_AGENT_MARKDOWNS);
  if (registered.length > 0) {
    console.log(`[BundledAgents] 注册了 ${registered.length} 个 .agent.md 定义:`, registered);
  }
  return registered;
}
