const definition = {
  name: 'get_pinmap_summary',
  description: '获取当前项目的引脚摘要信息。',
  input_schema: {
    type: 'object',
    properties: {
      pinmapIds: { type: 'array', items: { type: 'string' } },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: [],
  },
};

function createHandler(services) {
  return async function getPinmapSummary(args = {}) {
    const projectPath = services.projectContext.normalizeProjectPath(args.path || args.projectPath || '');
    const boardPackagePath = services.projectContext.resolveBoardPackagePath(projectPath);
    if (!boardPackagePath) {
      return { is_error: true, content: '当前没有打开的项目或未安装开发板包。' };
    }
    const packagesBasePath = services.projectContext.resolvePackagesBasePath(projectPath);
    const pinSummaries = [];
    const loadedPinmapIds = [];
    const pinmapIds = Array.isArray(args.pinmapIds) ? args.pinmapIds : [];

    const boardSummary = services.pinmapService.getBoardPinSummary(boardPackagePath);
    if (boardSummary) {
      pinSummaries.push(boardSummary);
    }
    if (pinmapIds.length > 0 && packagesBasePath) {
      for (const fullId of pinmapIds) {
        const summary = services.pinmapService.loadPinSummaryById(fullId, packagesBasePath);
        if (summary) {
          pinSummaries.push(summary);
          loadedPinmapIds.push(fullId);
        }
      }
    }
    if (!pinSummaries.length) {
      return { is_error: true, content: '未找到任何引脚配置文件（pinmap.json）。' };
    }

    const existingConnections = services.awsService.getConnectionGraph(projectPath);
    const result = { pinSummaries };
    if (loadedPinmapIds.length > 0) {
      result.loadedPinmapIds = loadedPinmapIds;
    }
    if (existingConnections) {
      result.existingConnectionGraph = {
        description: existingConnections.description,
        componentCount: existingConnections.components.length,
        connectionCount: existingConnections.connections.length,
        components: existingConnections.components.map((component) => ({
          refId: component.refId,
          pinmapId: component.pinmapId,
          componentId: component.componentId,
        })),
      };
    }
    if (!pinmapIds.length && packagesBasePath) {
      result.availableSensorPinmapIds = services.catalogService.getAvailablePinmapIds(packagesBasePath, { status: 'available' }).slice(0, 10);
      result.tip = '使用 get_project_context 工具可查看完整的组件目录。';
    }
    return { is_error: false, content: JSON.stringify(result, null, 2) };
  };
}

module.exports = {
  definition,
  createHandler,
};
