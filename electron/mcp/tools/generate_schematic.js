const definition = {
  name: 'generate_schematic',
  description: '生成硬件接线图的核心工具，返回引脚摘要与 AWS 编写依据。',
  input_schema: {
    type: 'object',
    properties: {
      pinmapIds: {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                id: { type: 'string' },
                alias: { type: 'string' },
                label: { type: 'string' },
              },
              required: ['id'],
            },
          ],
        },
      },
      components: { type: 'array', items: { type: 'string' } },
      requirements: { type: 'string' },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: [],
  },
};

function createHandler(services) {
  function findComponentInCatalogs(compName, catalogs, packagesBasePath) {
    const lowerName = String(compName || '').toLowerCase();
    for (const catalog of catalogs) {
      for (const model of catalog.models || []) {
        if (String(model.id || '').toLowerCase() === lowerName || String(model.name || '').toLowerCase().includes(lowerName)) {
          const defaultVariant = model.variants.find((variant) => variant.isDefault) || model.variants[0];
          if (defaultVariant && defaultVariant.status === 'available') {
            const summary = services.pinmapService.loadPinSummaryById(defaultVariant.fullId, packagesBasePath);
            if (summary) {
              return { fullId: defaultVariant.fullId, summary };
            }
          }
        }
      }
    }
    return null;
  }

  return async function generateSchematic(args = {}) {
    const projectPath = services.projectContext.normalizeProjectPath(args.path || args.projectPath || '');
    const boardPackagePath = services.projectContext.resolveBoardPackagePath(projectPath);
    if (!boardPackagePath) {
      return { is_error: true, content: '当前没有打开的项目或未安装开发板包，请先创建/打开一个项目。' };
    }
    const boardConfig = services.pinmapService.getBoardConfig(boardPackagePath);
    if (!boardConfig) {
      return { is_error: true, content: '开发板引脚配置不存在，无法生成连线图。请先使用 generate_pinmap + save_pinmap 为该开发板生成 pinmap 配置。' };
    }

    const packagesBasePath = services.projectContext.resolvePackagesBasePath(projectPath);
    const boardSummary = services.pinmapService.getBoardPinSummary(boardPackagePath);
    const pinSummaries = [];
    const componentInstances = [];
    const softwareComponents = [];
    const failedPinmapIds = [];
    const loadedPinmapIds = [];

    if (boardSummary) {
      pinSummaries.push(boardSummary);
    }

    const rawPinmapIds = Array.isArray(args.pinmapIds) ? args.pinmapIds : [];
    const pinmapIdCountMap = new Map();
    for (const item of rawPinmapIds) {
      let pinmapId;
      let alias;
      let label;
      if (typeof item === 'string') {
        pinmapId = item;
      } else if (item && typeof item === 'object') {
        pinmapId = item.id;
        alias = item.alias;
        label = item.label;
      } else {
        continue;
      }
      const instanceIndex = pinmapIdCountMap.get(pinmapId) || 0;
      pinmapIdCountMap.set(pinmapId, instanceIndex + 1);
      if (!alias) {
        const ref = services.catalogService.parsePinmapId(pinmapId);
        alias = instanceIndex === 0 ? ref.modelId : `${ref.modelId}_${instanceIndex + 1}`;
      }
      if (pinmapId.startsWith('board-')) {
        loadedPinmapIds.push(pinmapId);
        continue;
      }
      if (!packagesBasePath) {
        continue;
      }
      const softwareCheck = services.catalogService.checkSoftwareComponent(pinmapId, packagesBasePath);
      if (softwareCheck.isSoftware && softwareCheck.catalog) {
        softwareComponents.push({
          pinmapId,
          alias,
          label,
          libraryType: softwareCheck.catalog.softwareMeta?.libraryType || 'other',
          displayName: softwareCheck.catalog.displayName,
          configTemplate: softwareCheck.catalog.softwareMeta?.configTemplate,
        });
        loadedPinmapIds.push(pinmapId);
        continue;
      }
      const summary = services.pinmapService.loadPinSummaryById(pinmapId, packagesBasePath);
      if (summary) {
        pinSummaries.push({ ...summary, componentId: alias, componentName: label || summary.componentName });
        loadedPinmapIds.push(pinmapId);
        componentInstances.push({ pinmapId, alias, label, instance: instanceIndex });
      } else {
        failedPinmapIds.push({
          pinmapId,
          reason: 'pinmap 文件不存在或无法读取。请先使用 get_project_context 确认该组件的 pinmap 状态，如果状态为 needs_generation 或 missing_catalog，需先调用 generate_pinmap + save_pinmap 生成配置。',
        });
      }
    }

    const notFoundComponents = [];
    const componentList = Array.isArray(args.components)
      ? args.components.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];
    if (componentList.length > 0 && packagesBasePath) {
      const catalogs = services.catalogService.scanPinmapCatalogs(packagesBasePath);
      for (const compName of componentList) {
        const found = findComponentInCatalogs(compName, catalogs, packagesBasePath);
        if (found) {
          if (!loadedPinmapIds.includes(found.fullId)) {
            pinSummaries.push(found.summary);
            loadedPinmapIds.push(found.fullId);
          }
        } else {
          notFoundComponents.push(compName);
        }
      }
    }

    if (pinSummaries.length <= 1 && softwareComponents.length === 0) {
      return {
        is_error: failedPinmapIds.length > 0,
        content: JSON.stringify({
          message: '当前只检测到开发板的引脚配置，未发现外设配置。',
          failedPinmapIds: failedPinmapIds.length > 0 ? failedPinmapIds : undefined,
          notFoundComponents: notFoundComponents.length > 0 ? notFoundComponents : undefined,
          pinSummaries,
          loadedPinmapIds,
          componentInstances: componentInstances.length > 0 ? componentInstances : undefined,
          instructions: failedPinmapIds.length > 0
            ? '请先调用 get_project_context 确认组件状态，再使用 generate_pinmap + save_pinmap 为缺失配置的组件生成 pinmap。'
            : '请根据上面的引脚信息和用户需求，输出符合 connection_output.json 格式的连线 JSON。输出完成后，请调用 validate_schematic 工具验证连线安全性。',
        }, null, 2),
      };
    }

    const boardPkgName = require('path').basename(boardPackagePath) || 'board';
    const boardPinmapId = `${boardPkgName}:default:default`;
    const awsSummaryParts = [];
    if (boardSummary) {
      awsSummaryParts.push(services.awsService.generatePinmapSummary(boardSummary, 'board', boardPinmapId));
    }
    for (const instance of componentInstances) {
      const summary = pinSummaries.find((item) => item.componentId === instance.alias);
      if (summary) {
        awsSummaryParts.push(services.awsService.generatePinmapSummary(summary, instance.alias, instance.pinmapId));
      }
    }

    if (packagesBasePath && componentInstances.length > 0) {
      try {
        const previewComponents = [{
          refId: 'board',
          componentId: boardConfig.id,
          componentName: boardConfig.name,
          pinmapId: boardPinmapId,
          isBoard: true,
        }];
        const componentConfigs = { board: boardConfig };
        for (const instance of componentInstances) {
          const config = services.pinmapService.loadPinmapById(instance.pinmapId, packagesBasePath);
          if (!config) {
            continue;
          }
          componentConfigs[instance.alias] = config;
          previewComponents.push({
            refId: instance.alias,
            componentId: config.id,
            componentName: instance.label || config.name,
            pinmapId: instance.pinmapId,
            instance: instance.instance,
          });
        }
        await services.runtimeAdapter.previewSchematicComponents({
          componentConfigs,
          components: previewComponents,
          connections: [],
        }, projectPath);
      } catch (_error) {
        // ignore preview failure
      }
    }

    return {
      is_error: false,
      content: JSON.stringify({
        awsPinmapSummary: awsSummaryParts.join('\n\n'),
        loadedPinmapIds,
        failedPinmapIds: failedPinmapIds.length > 0 ? failedPinmapIds : undefined,
        notFoundComponents: notFoundComponents.length > 0 ? notFoundComponents : undefined,
        componentInstances: componentInstances.length > 0 ? componentInstances : undefined,
        softwareComponents: softwareComponents.length > 0 ? softwareComponents : undefined,
      }, null, 2),
    };
  };
}

module.exports = {
  definition,
  createHandler,
};
