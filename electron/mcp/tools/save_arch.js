const definition = {
  name: 'save_arch',
  description: `保存或覆盖项目目录下的 arch.md 框架图文件。生成 Mermaid 框架图后应直接调用此工具持久化，无需等待用户手动点击保存。

图表格式要求：
1. 必须使用 flowchart TD 或 flowchart LR
2. 节点 ID 使用简洁英文标识，例如 MCU、SENSOR、WIFI
3. 节点显示文本必须使用 []，不要使用 {} 或 ()
4. 数据流使用 -->，物理连接使用 ---
5. 逻辑分组优先使用 subgraph

图中应覆盖：
1. setup 到 loop 的主要执行流程
2. 项目架构和模块设计
3. 必要的注释说明

调用本工具时，code 字段必须只传原始 Mermaid DSL，不要包含 aily-mermaid 这类 fenced code block。

保存成功后框架图会自动在对话中渲染展示，请勿再次输出 Mermaid 源码。`,
  input_schema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Mermaid 图表原始 DSL，仅传 raw code，不含 fenced code block。建议使用 flowchart TD/LR，并遵循 save_arch 工具描述中的节点与连线规范。',
      },
    },
    required: ['code'],
  },
};

function createHandler(services) {
  return async function saveArch(args = {}) {
    try {
      const result = await services.archSaveService.save(args);
      return {
        is_error: false,
        content: `框架图已保存到 ${result.archPath}（已写入 arch.md）`,
      };
    } catch (error) {
      return {
        is_error: true,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

module.exports = {
  definition,
  createHandler,
};
