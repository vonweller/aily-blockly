/**
 * Tool Display Registry - 工具显示文案注册表
 *
 * 单例模式，所有工具通过 ToolDisplayRegistry.register() 自注册显示文案能力。
 *
 * Phase 0 / P0-B3:
 * - 这里只保留 UI 显示映射（getStartText / getResultText）
 * - 不再承担 schema 查询、agent 过滤、工具执行等 runtime 语义
 * - 工具实际执行已由 lex AgentExecutor / contributed tools 接管
 */

import type { IAilyTool, ToolUseResult } from './tool-types';

type ToolDisplayRegistration = Pick<IAilyTool, 'name' | 'getStartText' | 'getResultText'>;

class ToolDisplayRegistryImpl {
  private tools = new Map<string, ToolDisplayRegistration>();

  /**
   * 注册一个工具的显示文案能力
   */
  register(tool: ToolDisplayRegistration): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolDisplayRegistry] 工具 "${tool.name}" 已注册，将被覆盖`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 判断工具显示文案是否已注册
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具开始执行时的显示文本
   */
  getStartText(name: string, args?: any): string {
    const cleanName = name.startsWith('mcp_') ? name.substring(4) : name;
    const tool = this.tools.get(cleanName);
    if (tool?.getStartText) {
      return tool.getStartText(args);
    }
    return `执行工具: ${cleanName}`;
  }

  /**
   * 获取工具执行完成后的显示文本
   */
  getResultText(name: string, args?: any, result?: ToolUseResult): string {
    const cleanName = name.startsWith('mcp_') ? name.substring(4) : name;
    const tool = this.tools.get(cleanName);

    if (result?.is_error) {
      if (tool?.getResultText) {
        return tool.getResultText(args, result);
      }
      return `${cleanName} 执行失败`;
    }

    if (tool?.getResultText) {
      return tool.getResultText(args, result);
    }
    return `${cleanName} 执行成功`;
  }

  /**
   * 获取已注册工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 获取所有已注册工具名称
   */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }
}

/** 全局显示文案注册表 */
export const ToolDisplayRegistry = new ToolDisplayRegistryImpl();