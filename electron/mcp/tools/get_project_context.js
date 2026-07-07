const { createHandler: createGetComponentCatalogHandler } = require('./get_component_catalog');

const definition = {
  name: 'get_project_context',
  description: '获取组件目录和当前生成的 C++ 代码。',
  input_schema: {
    type: 'object',
    properties: {
      includeNeedsGeneration: { type: 'boolean', default: true },
      includeBoards: { type: 'boolean', default: true },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: [],
  },
};

function createHandler(services) {
  const getComponentCatalog = createGetComponentCatalogHandler(services);
  return async function getProjectContext(args = {}) {
    const catalogResult = await getComponentCatalog(args);
    if (catalogResult.is_error) {
      return { is_error: true, content: `获取项目上下文失败: ${catalogResult.content}` };
    }
    const merged = JSON.parse(catalogResult.content);
    const targetProjectPath = services.projectContext.normalizeProjectPath(args.path || args.projectPath || '');
    const cppCode = await services.runtimeAdapter.getGeneratedCppCode(targetProjectPath);
    if (cppCode.trim()) {
      merged.cppCode = cppCode;
    }
    return { is_error: false, content: JSON.stringify(merged, null, 2) };
  };
}

module.exports = {
  definition,
  createHandler,
};
