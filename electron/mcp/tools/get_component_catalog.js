const definition = {
  name: 'get_component_catalog',
  description: '获取当前项目的组件目录，包括开发板、硬件库和软件库。',
  input_schema: {
    type: 'object',
    properties: {
      libraryFilter: { type: 'string' },
      includeNeedsGeneration: { type: 'boolean', default: true },
      includeBoards: { type: 'boolean', default: true },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: [],
  },
};

function createHandler(services) {
  return async function getComponentCatalog(args = {}) {
    const projectPath = services.projectContext.normalizeProjectPath(args.path || args.projectPath || '');
    const currentProjectPath = services.projectContext.resolveProjectPath(projectPath);
    if (!currentProjectPath) {
      return { is_error: true, content: '当前没有打开的项目。' };
    }

    const packagesBasePath = services.projectContext.resolvePackagesBasePath(currentProjectPath);
    if (!packagesBasePath || !require('fs').existsSync(packagesBasePath)) {
      return { is_error: true, content: '项目的 node_modules 目录不存在，请先安装依赖。' };
    }

    const libraryResults = services.catalogService.scanAllLibraries(packagesBasePath).filter((lib) => {
      const filter = typeof args.libraryFilter === 'string' ? args.libraryFilter.trim() : '';
      if (!filter) return true;
      return lib.packageSlug === filter || lib.packageSlug === `lib-${filter}` || `@aily-project/${lib.packageSlug}` === filter;
    });

    let boardCatalog = null;
    if (args.includeBoards !== false) {
      const boardPackagePath = services.projectContext.resolveBoardPackagePath(currentProjectPath);
      if (boardPackagePath) {
        const catalog = services.catalogService.readPinmapCatalog(boardPackagePath);
        const boardPkgName = require('path').basename(boardPackagePath);
        if (catalog) {
          boardCatalog = {
            packageSlug: boardPkgName,
            displayName: catalog.displayName,
            type: 'board',
            icon: catalog.icon,
            catalogStatus: 'available',
            isCurrentBoard: true,
            models: (catalog.models || []).map((model) => ({
              id: model.id,
              name: model.name,
              description: model.description,
              defaultVariant: model.defaultVariant,
              variants: (model.variants || [])
                .filter((variant) => args.includeNeedsGeneration !== false || variant.status === 'available')
                .map((variant) => ({
                  id: variant.id,
                  name: variant.name,
                  fullId: variant.fullId,
                  protocol: variant.protocol,
                  manufacturer: variant.manufacturer,
                  status: variant.status,
                  isDefault: variant.isDefault,
                  previewPins: variant.previewPins,
                  version: variant.version,
                })),
            })).filter((model) => model.variants.length > 0),
          };
        } else {
          const boardConfig = services.pinmapService.getBoardConfig(boardPackagePath);
          boardCatalog = boardConfig
            ? {
                packageSlug: boardPkgName,
                displayName: boardConfig.name || boardPkgName,
                type: 'board',
                catalogStatus: 'legacy_pinmap',
                isCurrentBoard: true,
                tip: '该开发板使用旧版 pinmap.json 格式，可直接使用。如需更新可使用 generate_pinmap 工具。',
                pinmapId: `${boardPkgName}:default:default`,
              }
            : {
                packageSlug: boardPkgName,
                displayName: boardPkgName,
                type: 'board',
                catalogStatus: 'missing',
                isCurrentBoard: true,
                tip: `当前开发板缺少 pinmap 配置，使用 generate_pinmap 工具生成配置，pinmapId 格式：${boardPkgName}:{modelId}:default`,
              };
        }
      }
    }

    const catalogs = [];
    const softwareLibraries = [];
    const librariesMissingCatalog = [];
    for (const lib of libraryResults) {
      if (lib.hasPinmapCatalog && lib.catalog) {
        if (lib.catalog.type === 'software') {
          softwareLibraries.push({
            packageSlug: lib.packageSlug,
            displayName: lib.catalog.displayName,
            type: 'software',
            icon: lib.catalog.icon || lib.catalog.softwareMeta?.defaultIcon,
            libraryType: lib.catalog.softwareMeta?.libraryType || 'other',
            configTemplate: lib.catalog.softwareMeta?.configTemplate,
            catalogStatus: 'available',
            usage: '软件库不需要引脚连接，在连线图中显示为信息卡片',
          });
          continue;
        }
        catalogs.push({
          packageSlug: lib.packageSlug,
          displayName: lib.catalog.displayName,
          type: lib.catalog.type || 'library',
          icon: lib.catalog.icon,
          catalogStatus: 'available',
          models: (lib.catalog.models || []).map((model) => ({
            id: model.id,
            name: model.name,
            description: model.description,
            defaultVariant: model.defaultVariant,
            variants: (model.variants || [])
              .filter((variant) => args.includeNeedsGeneration !== false || variant.status === 'available')
              .map((variant) => ({
                id: variant.id,
                name: variant.name,
                fullId: variant.fullId,
                protocol: variant.protocol,
                manufacturer: variant.manufacturer,
                status: variant.status,
                isDefault: variant.isDefault,
                previewPins: variant.previewPins,
                version: variant.version,
              })),
          })).filter((model) => model.variants.length > 0),
        });
      } else {
        librariesMissingCatalog.push({
          packageSlug: lib.packageSlug,
          displayName: lib.displayName,
          catalogStatus: 'missing_catalog',
          tip: `使用 generate_pinmap 工具为此库生成配置，pinmapId 格式：${lib.packageSlug}:{modelId}:{variantId}`,
        });
      }
    }

    const result = {};
    if (boardCatalog) result.currentBoard = boardCatalog;
    if (catalogs.length > 0) {
      result.catalogCount = catalogs.length;
      result.catalogs = catalogs;
      result.usage = '使用 fullId（如 "lib-dht:dht20:asair"）作为 generate_schematic 的 pinmapIds 参数';
    }
    if (softwareLibraries.length > 0) {
      result.softwareLibraries = softwareLibraries;
      result.softwareUsage = '软件库（WiFi/MQTT/HTTP等）不需要物理引脚连接。在连线图中以信息卡片形式展示，使用 packageSlug 作为 generate_schematic 的 pinmapIds 参数（格式：{packageSlug}:default:default）';
    }
    if (librariesMissingCatalog.length > 0) {
      result.librariesMissingCatalog = librariesMissingCatalog;
      result.missingCatalogTip = '这些库没有 pinmap_catalog.json，你可以使用 generate_pinmap 工具为它们生成 pinmap 配置';
    }
    if (!catalogs.length && !softwareLibraries.length && !librariesMissingCatalog.length) {
      return {
        is_error: false,
        content: JSON.stringify({
          message: '未找到已安装的 lib-* 传感器库。',
          tip: '请先安装传感器库，如 npm install @aily-project/lib-dht',
        }, null, 2),
      };
    }
    return { is_error: false, content: JSON.stringify(result, null, 2) };
  };
}

module.exports = {
  definition,
  createHandler,
};
