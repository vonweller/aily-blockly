const definition = {
  name: 'get_current_schematic',
  description: '读取当前项目已保存的连线图完整内容。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: [],
  },
};

function createHandler(services) {
  return async function getCurrentSchematic(args = {}) {
    const projectPath = services.projectContext.normalizeProjectPath(args.path || args.projectPath || '');
    const data = services.awsService.getConnectionGraph(projectPath);
    if (!data) {
      return {
        is_error: false,
        content: JSON.stringify({
          exists: false,
          message: '当前项目没有已保存的连线图。',
          tip: '请先调用 get_project_context + generate_schematic 生成连线方案。',
        }, null, 2),
      };
    }
    return {
      is_error: false,
      content: JSON.stringify({
        exists: true,
        description: data.description,
        summary: {
          componentCount: data.components.length,
          connectionCount: data.connections.length,
          components: data.components.map((component) => ({
            refId: component.refId,
            componentName: component.componentName,
            pinmapId: component.pinmapId,
            componentType: component.componentType || 'hardware',
          })),
        },
        schematicData: data,
        editingTip: [
          '如需修改连线：基于当前 schematicData 的连线信息，编写新的 AWS 格式内容',
          '如需添加组件：先调用 generate_schematic 获取新组件的引脚摘要',
          '修改完成后：调用 validate_schematic(aws: "你的AWS内容") 验证 + 保存 + 刷新（最终步骤）',
        ],
      }, null, 2),
    };
  };
}

module.exports = {
  definition,
  createHandler,
};
