const fs = require('fs');
const path = require('path');

function createPinmapService(projectContext, catalogService, runtimeAdapter) {
  function isUsableComponentConfig(config) {
    return !!config
      && typeof config.id === 'string'
      && typeof config.name === 'string'
      && Array.isArray(config.pins);
  }

  function inferProjectPathFromPackagesBasePath(packagesBasePath) {
    if (!packagesBasePath) {
      return null;
    }
    const candidate = path.dirname(packagesBasePath);
    return projectContext.resolveProjectPath(candidate);
  }

  function getBoardPinmapId(boardPackagePath) {
    const boardPkgName = path.basename(boardPackagePath || '') || 'board';
    return `${boardPkgName}:default:default`;
  }

  function getConnectionGraphPath(projectPath) {
    return projectPath ? path.join(projectPath, 'connection_output.json') : null;
  }

  function readConnectionGraph(projectPath) {
    try {
      const filePath = getConnectionGraphPath(projectPath);
      return filePath && fs.existsSync(filePath) ? projectContext.readJsonFile(filePath) : null;
    } catch (_error) {
      return null;
    }
  }

  function saveConnectionGraph(data, projectPath) {
    try {
      const filePath = getConnectionGraphPath(projectPath);
      if (!filePath) {
        return false;
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function buildPreviewPayloadFromGraph(graphData, boardPackagePath, packagesBasePath) {
    const payload = {
      componentConfigs: {},
      components: Array.isArray(graphData?.components) ? graphData.components : [],
      connections: Array.isArray(graphData?.connections) ? graphData.connections : [],
    };
    const boardConfig = boardPackagePath ? getBoardConfig(boardPackagePath) : null;
    if (boardConfig) {
      payload.componentConfigs.board = boardConfig;
    }
    if (!packagesBasePath) {
      return payload;
    }
    for (const component of payload.components) {
      if (!component || component.refId === 'board' || !component.refId || !component.pinmapId) {
        continue;
      }
      const config = loadPinmapById(component.pinmapId, packagesBasePath);
      if (isUsableComponentConfig(config)) {
        payload.componentConfigs[component.refId] = config;
      }
    }
    return payload;
  }

  function buildInitialPreviewPayload(packagesBasePath) {
    const projectPath = inferProjectPathFromPackagesBasePath(packagesBasePath);
    const boardPackagePath = projectPath ? projectContext.resolveBoardPackagePath(projectPath) : null;
    const existingGraph = projectPath ? readConnectionGraph(projectPath) : null;
    const hasStagedComponents = Array.isArray(existingGraph?.components) && existingGraph.components.length > 0;
    if (hasStagedComponents && Array.isArray(existingGraph?.connections) && existingGraph.connections.length === 0) {
      return buildPreviewPayloadFromGraph(existingGraph, boardPackagePath, packagesBasePath);
    }

    const boardConfig = boardPackagePath ? getBoardConfig(boardPackagePath) : null;
    if (!boardConfig) {
      return { componentConfigs: {}, components: [], connections: [] };
    }
    return {
      componentConfigs: { board: boardConfig },
      components: [{
        refId: 'board',
        componentId: boardConfig.id,
        componentName: boardConfig.name,
        pinmapId: getBoardPinmapId(boardPackagePath),
        isBoard: true,
      }],
      connections: [],
    };
  }

  function previewCircuitWindow(packagesBasePath) {
    const projectPath = inferProjectPathFromPackagesBasePath(packagesBasePath);
    if (!runtimeAdapter || !projectPath) {
      return;
    }
    const payload = buildInitialPreviewPayload(packagesBasePath);
    try {
      Promise.resolve(runtimeAdapter.previewSchematicComponents(payload, projectPath)).catch(() => {});
    } catch (_error) {
      // ignore preview failure
    }
  }

  function createTemporaryRefId(modelId, components) {
    const base = String(modelId || '').trim() || 'component';
    const used = new Set((components || []).map((item) => item?.refId).filter(Boolean));
    if (base !== 'board' && !used.has(base)) {
      return base;
    }
    let index = 2;
    let candidate = `${base}_${index}`;
    while (candidate === 'board' || used.has(candidate)) {
      index += 1;
      candidate = `${base}_${index}`;
    }
    return candidate;
  }

  function buildStagedSnapshot(pinmapId, config, packagesBasePath) {
    const projectPath = inferProjectPathFromPackagesBasePath(packagesBasePath);
    if (!projectPath) {
      return null;
    }

    const ref = catalogService.parsePinmapId(pinmapId);
    const boardPackagePath = projectContext.resolveBoardPackagePath(projectPath);
    const boardConfig = boardPackagePath ? getBoardConfig(boardPackagePath) : null;
    const existingGraph = readConnectionGraph(projectPath);
    const keepExistingComponents = Array.isArray(existingGraph?.components)
      && Array.isArray(existingGraph?.connections)
      && existingGraph.connections.length === 0;
    const components = [];

    if (boardConfig) {
      components.push({
        refId: 'board',
        componentId: boardConfig.id,
        componentName: boardConfig.name,
        pinmapId: getBoardPinmapId(boardPackagePath),
        isBoard: true,
      });
    }

    if (keepExistingComponents) {
      for (const component of existingGraph.components) {
        if (!component || component.refId === 'board') {
          continue;
        }
        components.push(component);
      }
    }

    if (!ref.packageSlug.startsWith('board-')) {
      const existingIndex = components.findIndex((item) => item && item.refId !== 'board' && item.pinmapId === pinmapId);
      const componentEntry = {
        refId: existingIndex >= 0
          ? components[existingIndex].refId
          : createTemporaryRefId(ref.modelId, components),
        componentId: config.id,
        componentName: config.name,
        pinmapId,
      };
      if (existingIndex >= 0) {
        components[existingIndex] = componentEntry;
      } else {
        components.push(componentEntry);
      }
    }

    return {
      projectPath,
      jsonData: {
        version: '1.0.0',
        description: keepExistingComponents && existingGraph?.description
          ? existingGraph.description
          : '连线方案（阶段保存）',
        components,
        connections: [],
      },
    };
  }

  function syncStagedSnapshot(pinmapId, config, packagesBasePath) {
    const stagedSnapshot = buildStagedSnapshot(pinmapId, config, packagesBasePath);
    if (!stagedSnapshot) {
      return;
    }
    if (!saveConnectionGraph(stagedSnapshot.jsonData, stagedSnapshot.projectPath)) {
      console.warn('[pinmap-service] 保存阶段性 connection_output.json 失败');
      return;
    }
    if (!runtimeAdapter) {
      return;
    }
    try {
      Promise.resolve(
        runtimeAdapter.notifySchematicSaved({ jsonData: stagedSnapshot.jsonData }, stagedSnapshot.projectPath),
      ).catch((error) => {
        console.warn('[pinmap-service] 阶段性电路连接窗口刷新失败:', error?.message || error);
      });
    } catch (error) {
      console.warn('[pinmap-service] 阶段性电路连接窗口刷新失败:', error?.message || error);
    }
  }

  function extractPinSummary(config) {
    const extractedPins = (config.pins || [])
      .filter((pin) => pin.visible !== false && pin.disabled !== true)
      .map((pin) => ({
        id: pin.id,
        functions: (pin.functions || [])
          .filter((fn) => fn.visible !== false && fn.disabled !== true)
          .map((fn) => ({ name: String(fn.name || '').trim(), type: fn.type })),
      }));

    return {
      componentId: config.id,
      componentName: config.name,
      pinCount: extractedPins.length,
      pins: extractedPins,
    };
  }

  function readComponentConfig(filePath) {
    try {
      return projectContext.readJsonFile(filePath);
    } catch (_error) {
      return null;
    }
  }

  function buildPinmapId(packageSlug, modelId, variantId) {
    return variantId && variantId !== 'default'
      ? `${packageSlug}:${modelId}:${variantId}`
      : `${packageSlug}:${modelId}:default`;
  }

  function resolveBoardPinmapPath(boardPackagePath) {
    const legacyPath = path.join(boardPackagePath, 'pinmap.json');
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    const catalog = catalogService.readPinmapCatalog(boardPackagePath);
    if (!catalog?.models?.length) {
      return null;
    }
    const model = catalog.models[0];
    const variant = model.variants.find((item) => item.isDefault)
      || model.variants.find((item) => item.status === 'available')
      || model.variants[0];
    if (!variant?.pinmapFile) {
      return null;
    }
    const resolvedPath = path.join(boardPackagePath, variant.pinmapFile);
    return fs.existsSync(resolvedPath) ? resolvedPath : null;
  }

  function getBoardPinSummary(boardPackagePath) {
    const pinmapPath = resolveBoardPinmapPath(boardPackagePath);
    if (!pinmapPath) {
      return null;
    }
    const config = readComponentConfig(pinmapPath);
    return isUsableComponentConfig(config) ? extractPinSummary(config) : null;
  }

  function getBoardConfig(boardPackagePath) {
    const pinmapPath = resolveBoardPinmapPath(boardPackagePath);
    const config = pinmapPath ? readComponentConfig(pinmapPath) : null;
    return isUsableComponentConfig(config) ? config : null;
  }

  function resolvePinmapPath(fullId, packagesBasePath) {
    const { packageSlug, modelId, variantId } = catalogService.parsePinmapId(fullId);
    const packagePath = path.join(packagesBasePath, '@aily-project', packageSlug);
    if (!fs.existsSync(packagePath)) {
      return null;
    }
    const catalog = catalogService.readPinmapCatalog(packagePath);
    if (!catalog) {
      const defaultPinmap = path.join(packagePath, 'pinmap.json');
      return fs.existsSync(defaultPinmap) ? defaultPinmap : null;
    }
    const model = catalog.models.find((item) => item.id === modelId);
    if (!model) {
      return null;
    }
    const variant = model.variants.find((item) => item.id === variantId);
    if (!variant) {
      return null;
    }
    if (variant.pinmapFile) {
      return path.join(packagePath, variant.pinmapFile);
    }
    if (variant.pinmapRef && catalog.sharedPinmaps?.[variant.pinmapRef]) {
      return path.join(packagePath, catalog.sharedPinmaps[variant.pinmapRef].file);
    }
    const defaultPinmap = path.join(packagePath, 'pinmap.json');
    return fs.existsSync(defaultPinmap) ? defaultPinmap : null;
  }

  function loadPinmapById(fullId, packagesBasePath) {
    const pinmapPath = resolvePinmapPath(fullId, packagesBasePath);
    const config = pinmapPath ? readComponentConfig(pinmapPath) : null;
    return isUsableComponentConfig(config) ? config : null;
  }

  function loadPinSummaryById(fullId, packagesBasePath) {
    const config = loadPinmapById(fullId, packagesBasePath);
    return config ? extractPinSummary(config) : null;
  }

  function getLibraryInfo(pinmapId, packagesBasePath) {
    previewCircuitWindow(packagesBasePath);

    const ref = catalogService.parsePinmapId(pinmapId);
    const packagePath = path.join(packagesBasePath, '@aily-project', ref.packageSlug);
    const result = {};

    const readmePath = path.join(packagePath, 'README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      result.readme = content.length > 4000 ? `${content.substring(0, 4000)}\n...(已截断)` : content;
    }

    const packageJsonPath = path.join(packagePath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        result.packageJson = projectContext.readJsonFile(packageJsonPath);
      } catch (_error) {
        // ignore
      }
    }

    const examplesDir = path.join(packagePath, 'examples');
    if (fs.existsSync(examplesDir)) {
      try {
        for (const fileName of fs.readdirSync(examplesDir)) {
          if (fileName.endsWith('.ino') || fileName.endsWith('.cpp') || fileName.endsWith('.c')) {
            const content = fs.readFileSync(path.join(examplesDir, fileName), 'utf8');
            result.exampleCode = content.length > 2000 ? `${content.substring(0, 2000)}\n...(已截断)` : content;
            break;
          }
        }
      } catch (_error) {
        // ignore
      }
    }

    const pinmapsDir = path.join(packagePath, 'pinmaps');
    if (fs.existsSync(pinmapsDir)) {
      try {
        result.existingPinmaps = fs.readdirSync(pinmapsDir).filter((item) => item.endsWith('.json'));
      } catch (_error) {
        // ignore
      }
    }

    return result;
  }

  function getPinmapTemplate(protocol) {
    const baseTemplate = {
      id: 'component_template',
      name: '传感器名称',
      width: 200,
      height: 100,
      images: [{ url: '组件图片的base64编码', x: 0, y: 0, width: 200, height: 100 }],
      pins: [],
      functionTypes: [
        { value: 'power', label: '电源', color: '#EF4444', textColor: '#FFFFFF' },
        { value: 'gnd', label: '接地', color: '#000000', textColor: '#FFFFFF' },
        { value: 'digital', label: '数字', color: '#3B82F6', textColor: '#FFFFFF' },
        { value: 'analog', label: '模拟', color: '#10B981', textColor: '#FFFFFF' },
        { value: 'i2c', label: 'I2C', color: '#8B5CF6', textColor: '#FFFFFF' },
        { value: 'spi', label: 'SPI', color: '#EC4899', textColor: '#FFFFFF' },
        { value: 'uart', label: 'UART', color: '#F59E0B', textColor: '#FFFFFF' },
        { value: 'pwm', label: 'PWM', color: '#06B6D4', textColor: '#FFFFFF' },
      ],
    };

    switch (protocol) {
      case 'i2c':
        baseTemplate.pins = [
          { id: 'pin_1', x: 10, y: 50, labelX: -20, labelY: 43, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'VCC', type: 'power' }] },
          { id: 'pin_2', x: 10, y: 70, labelX: -20, labelY: 63, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'GND', type: 'gnd' }] },
          { id: 'pin_3', x: 10, y: 90, labelX: -20, labelY: 83, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'SDA', type: 'i2c' }] },
          { id: 'pin_4', x: 190, y: 50, labelX: 212, labelY: 43, labelAnchor: 'left', layout: 'horizontal', functions: [{ name: 'SCL', type: 'i2c' }] },
        ];
        break;
      case 'spi':
        baseTemplate.pins = [
          { id: 'pin_1', x: 10, y: 30, labelX: -20, labelY: 23, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'VCC', type: 'power' }] },
          { id: 'pin_2', x: 10, y: 50, labelX: -20, labelY: 43, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'GND', type: 'gnd' }] },
          { id: 'pin_3', x: 10, y: 70, labelX: -20, labelY: 63, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'MOSI', type: 'spi' }] },
          { id: 'pin_4', x: 10, y: 90, labelX: -20, labelY: 83, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'MISO', type: 'spi' }] },
          { id: 'pin_5', x: 190, y: 30, labelX: 212, labelY: 23, labelAnchor: 'left', layout: 'horizontal', functions: [{ name: 'SCK', type: 'spi' }] },
          { id: 'pin_6', x: 190, y: 50, labelX: 212, labelY: 43, labelAnchor: 'left', layout: 'horizontal', functions: [{ name: 'CS', type: 'digital' }] },
        ];
        break;
      case 'uart':
        baseTemplate.pins = [
          { id: 'pin_1', x: 10, y: 50, labelX: -20, labelY: 43, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'VCC', type: 'power' }] },
          { id: 'pin_2', x: 10, y: 70, labelX: -20, labelY: 63, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'GND', type: 'gnd' }] },
          { id: 'pin_3', x: 10, y: 90, labelX: -20, labelY: 83, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'TX', type: 'uart' }] },
          { id: 'pin_4', x: 190, y: 50, labelX: 212, labelY: 43, labelAnchor: 'left', layout: 'horizontal', functions: [{ name: 'RX', type: 'uart' }] },
        ];
        break;
      case 'pwm':
        baseTemplate.pins = [
          { id: 'pin_1', x: 10, y: 50, labelX: -20, labelY: 43, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'VCC', type: 'power' }] },
          { id: 'pin_2', x: 10, y: 70, labelX: -20, labelY: 63, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'GND', type: 'gnd' }] },
          { id: 'pin_3', x: 10, y: 90, labelX: -20, labelY: 83, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'SIG', type: 'pwm' }] },
        ];
        break;
      case 'analog':
      case 'digital':
      default:
        baseTemplate.pins = [
          { id: 'pin_1', x: 10, y: 50, labelX: -20, labelY: 43, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'VCC', type: 'power' }] },
          { id: 'pin_2', x: 10, y: 70, labelX: -20, labelY: 63, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'GND', type: 'gnd' }] },
          { id: 'pin_3', x: 10, y: 90, labelX: -20, labelY: 83, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: protocol === 'analog' ? 'OUT' : 'DATA', type: protocol === 'analog' ? 'analog' : 'digital' }] },
        ];
    }

    return baseTemplate;
  }

  function deriveVariantProtocolFromPinmap(config) {
    const primary = new Set();
    for (const pin of config.pins || []) {
      if (pin.visible === false || pin.disabled === true) continue;
      for (const fn of pin.functions || []) {
        if (fn.visible === false || fn.disabled === true) continue;
        const type = String(fn.type || '').trim().toLowerCase();
        if (!type || type === 'power' || type === 'gnd') continue;
        primary.add(type);
      }
    }
    const order = ['i2c', 'spi', 'uart', 'pwm', 'analog', 'digital'];
    return order.find((item) => primary.has(item)) || (primary.size > 0 ? 'other' : undefined);
  }

  function derivePreviewPinsFromPinmap(config) {
    const names = [];
    for (const pin of config.pins || []) {
      if (pin.visible === false || pin.disabled === true) continue;
      const fns = pin.functions || [];
      const first = fns.find((fn) => fn.visible !== false && fn.disabled !== true) || fns[0];
      if (first?.name?.trim()) {
        names.push(first.name.trim());
      }
    }
    return names.length > 0 ? names : undefined;
  }

  function enrichVariantFromPinmapConfig(variant, config) {
    if (!config) return;
    const protocol = deriveVariantProtocolFromPinmap(config);
    const previewPins = derivePreviewPinsFromPinmap(config);
    if (protocol) variant.protocol = protocol;
    if (previewPins) variant.previewPins = previewPins;
  }

  function createNewCatalog(packageSlug, componentConfig) {
    const libName = packageSlug.replace('lib-', '').toUpperCase();
    return {
      version: '1.0.0',
      library: `@aily-project/${packageSlug}`,
      displayName: componentConfig?.name || `${libName} 系列`,
      type: 'library',
      models: [],
    };
  }

  function updateCatalogStatus(pinmapId, status, pinmapFile, resolvedPackagePath, componentConfig, options = {}) {
    try {
      const ref = catalogService.parsePinmapId(pinmapId);
      const catalogPath = catalogService.resolveCatalogPath(resolvedPackagePath)
        || path.join(resolvedPackagePath, 'pinmaps', 'pinmap_catalog.json');
      let catalog = fs.existsSync(catalogPath)
        ? projectContext.readJsonFile(catalogPath)
        : createNewCatalog(ref.packageSlug, componentConfig);
      let model = catalog.models.find((item) => item.id === ref.modelId);
      if (!model) {
        model = {
          id: ref.modelId,
          name: componentConfig?.name || ref.modelId.toUpperCase(),
          description: `${ref.packageSlug}:${ref.modelId}`,
          defaultVariant: ref.variantId,
          variants: [],
        };
        catalog.models.push(model);
      }
      let variant = model.variants.find((item) => item.id === ref.variantId);
      if (!variant) {
        variant = {
          id: ref.variantId,
          name: ref.variantId === 'default' ? '默认版本' : ref.variantId,
          fullId: pinmapId,
          status,
          pinmapFile,
          isDefault: model.variants.length === 0,
        };
        model.variants.push(variant);
      } else {
        variant.status = status;
        variant.pinmapFile = pinmapFile;
      }
      enrichVariantFromPinmapConfig(variant, componentConfig);
      if (options.catalogVersion !== undefined) {
        variant.version = options.catalogVersion;
      }
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function savePinmapConfig(pinmapId, config, packagesBasePath, options = {}) {
    try {
      const normalizedOptions = typeof options === 'object' && options !== null
        ? options
        : { catalogVersion: options };
      const ref = catalogService.parsePinmapId(pinmapId);
      let packagePath = path.join(packagesBasePath, '@aily-project', ref.packageSlug);
      if (!fs.existsSync(packagePath)) {
        const ailyProjectPath = path.join(packagesBasePath, '@aily-project');
        let matched = false;
        if (fs.existsSync(ailyProjectPath)) {
          for (const pkgName of fs.readdirSync(ailyProjectPath)) {
            if (pkgName.startsWith(`${ref.packageSlug}-`) || pkgName === ref.packageSlug) {
              packagePath = path.join(ailyProjectPath, pkgName);
              matched = true;
              break;
            }
          }
        }
        if (!matched) {
          fs.mkdirSync(packagePath, { recursive: true });
        }
      }

      const pinmapsDir = path.join(packagePath, 'pinmaps');
      fs.mkdirSync(pinmapsDir, { recursive: true });

      const fileName = `${ref.modelId}_${ref.variantId}.json`;
      const filePath = path.join(pinmapsDir, fileName);
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      updateCatalogStatus(pinmapId, 'available', `pinmaps/${fileName}`, packagePath, config, normalizedOptions);
      overwriteBoardRootPinmapIfPresent(ref.packageSlug, packagePath, config);
      syncStagedSnapshot(pinmapId, config, packagesBasePath);

      return {
        success: true,
        filePath,
        resolvedPackagePath: packagePath,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  function overwriteBoardRootPinmapIfPresent(packageSlug, resolvedPackagePath, config) {
    if (!packageSlug.startsWith('board-')) {
      return;
    }
    const rootPath = path.join(resolvedPackagePath, 'pinmap.json');
    if (fs.existsSync(rootPath)) {
      fs.writeFileSync(rootPath, JSON.stringify(config, null, 2));
    }
  }

  function findVariantInfo(pinmapId, packagesBasePath) {
    const ref = catalogService.parsePinmapId(pinmapId);
    const packagePath = path.join(packagesBasePath, '@aily-project', ref.packageSlug);
    const catalog = catalogService.readPinmapCatalog(packagePath);
    if (!catalog) {
      return null;
    }
    for (const model of catalog.models || []) {
      if (model.id !== ref.modelId) {
        continue;
      }
      for (const variant of model.variants || []) {
        if (variant.id === ref.variantId) {
          return variant;
        }
      }
    }
    return null;
  }

  return {
    extractPinSummary,
    readComponentConfig,
    buildPinmapId,
    resolveBoardPinmapPath,
    getBoardPinSummary,
    getBoardConfig,
    resolvePinmapPath,
    loadPinmapById,
    loadPinSummaryById,
    getLibraryInfo,
    getPinmapTemplate,
    savePinmapConfig,
    overwriteBoardRootPinmapIfPresent,
    findVariantInfo,
  };
}

module.exports = {
  createPinmapService,
};
