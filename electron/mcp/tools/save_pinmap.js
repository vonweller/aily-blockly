const definition = {
  name: 'save_pinmap',
  description: '保存生成的 pinmap JSON 到库目录，并更新 catalog 状态。',
  input_schema: {
    type: 'object',
    properties: {
      pinmapId: { type: 'string' },
      pinmapConfig: { type: 'object' },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: ['pinmapId', 'pinmapConfig'],
  },
};

function createHandler(services) {
  return async function savePinmap(args = {}) {
    const pinmapId = typeof args.pinmapId === 'string' ? args.pinmapId.trim() : '';
    if (!pinmapId) {
      return { is_error: true, content: '缺少必需参数 pinmapId。' };
    }
    if (!args.pinmapConfig) {
      return { is_error: true, content: '缺少必需参数 pinmapConfig。请提供完整的 pinmap 配置 JSON。' };
    }
    const packagesBasePath = services.projectContext.resolvePackagesBasePath(args.path || args.projectPath || '');
    if (!packagesBasePath) {
      return { is_error: true, content: '当前没有打开的项目，无法保存 pinmap。' };
    }
    const config = typeof args.pinmapConfig === 'string'
      ? JSON.parse(args.pinmapConfig)
      : args.pinmapConfig;
    if (!config.id || !config.name || !Array.isArray(config.pins)) {
      return { is_error: true, content: 'pinmapConfig 缺少必需字段（id, name, pins）。请确保配置完整。' };
    }
    const saveResult = services.pinmapService.savePinmapConfig(pinmapId, config, packagesBasePath);
    if (!saveResult.success) {
      return { is_error: true, content: `保存 pinmap 失败: ${saveResult.error}` };
    }
    return {
      is_error: false,
      content: JSON.stringify({
        success: true,
        pinmapId,
        filePath: saveResult.filePath,
        message: `Pinmap 配置已保存到 ${saveResult.filePath}，catalog 状态已更新为 "available"。`,
        tip: '现在可以在 generate_schematic 工具中使用此 pinmapId 了。',
      }, null, 2),
    };
  };
}

module.exports = {
  definition,
  createHandler,
};
