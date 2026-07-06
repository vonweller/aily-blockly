const fs = require('fs');
const path = require('path');

class SchematicBackendService {
  constructor(options = {}) {
    this.getCurrentProjectPath = typeof options.getCurrentProjectPath === 'function'
      ? options.getCurrentProjectPath
      : () => '';
  }

  normalizeProjectPath(value) {
    return typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
  }

  readCurrentProjectPath() {
    return this.normalizeProjectPath(this.getCurrentProjectPath());
  }

  resolveProjectPath(projectPath) {
    const candidate = this.normalizeProjectPath(projectPath) || this.readCurrentProjectPath();
    if (!candidate) return null;
    return fs.existsSync(path.join(candidate, 'package.json')) ? candidate : null;
  }

  resolvePackagesBasePath(projectPath) {
    const resolvedProjectPath = this.resolveProjectPath(projectPath);
    return resolvedProjectPath ? path.join(resolvedProjectPath, 'node_modules') : null;
  }

  readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  resolveBoardPackagePath(projectPath) {
    const resolvedProjectPath = this.resolveProjectPath(projectPath);
    if (!resolvedProjectPath) return null;

    const packageJsonPath = path.join(resolvedProjectPath, 'package.json');
    let packageJson = null;
    try {
      if (fs.existsSync(packageJsonPath)) {
        packageJson = this.readJsonFile(packageJsonPath);
      }
    } catch (_error) {
      packageJson = null;
    }

    const dependencyBlocks = [packageJson?.dependencies, packageJson?.boardDependencies];
    for (const block of dependencyBlocks) {
      if (!block || typeof block !== 'object') continue;
      const boardModule = Object.keys(block).find((dep) =>
        dep.startsWith('@aily-project/board-') || dep.startsWith('@aily-project/coder-'),
      );
      if (boardModule) {
        return path.join(resolvedProjectPath, 'node_modules', boardModule);
      }
    }

    const aciPath = path.join(resolvedProjectPath, 'project.aci');
    try {
      if (fs.existsSync(aciPath)) {
        const aci = this.readJsonFile(aciPath);
        const boardPackage = String(aci?.target?.boardPackage ?? '').trim();
        const board = String(aci?.target?.board ?? '').trim();
        const boardModule = boardPackage || (board.startsWith('@aily-project/') ? board : '');
        if (boardModule) {
          return path.join(resolvedProjectPath, 'node_modules', boardModule);
        }
      }
    } catch (_error) {
      // ignore
    }

    return null;
  }

  extractPinSummary(config) {
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

  resolveCatalogPath(packagePath) {
    const newPath = path.join(packagePath, 'pinmaps', 'pinmap_catalog.json');
    if (fs.existsSync(newPath)) return newPath;
    const legacyPath = path.join(packagePath, 'pinmap_catalog.json');
    if (fs.existsSync(legacyPath)) return legacyPath;
    return null;
  }

  readPinmapCatalog(packagePath) {
    const catalogPath = this.resolveCatalogPath(packagePath);
    if (!catalogPath) return null;
    try {
      return this.readJsonFile(catalogPath);
    } catch (_error) {
      return null;
    }
  }

  parsePinmapId(fullId) {
    const parts = String(fullId || '').split(':');
    return {
      fullId: String(fullId || ''),
      packageSlug: parts[0] || '',
      modelId: parts[1] || '',
      variantId: parts[2] || 'default',
    };
  }

  buildPinmapId(packageSlug, modelId, variantId) {
    return variantId && variantId !== 'default'
      ? `${packageSlug}:${modelId}:${variantId}`
      : `${packageSlug}:${modelId}:default`;
  }

  readComponentConfig(filePath) {
    try {
      return this.readJsonFile(filePath);
    } catch (_error) {
      return null;
    }
  }

  resolveBoardPinmapPath(boardPackagePath) {
    const legacyPath = path.join(boardPackagePath, 'pinmap.json');
    if (fs.existsSync(legacyPath)) return legacyPath;
    const catalog = this.readPinmapCatalog(boardPackagePath);
    if (!catalog?.models?.length) return null;
    const model = catalog.models[0];
    const variant = model.variants.find((item) => item.isDefault)
      || model.variants.find((item) => item.status === 'available')
      || model.variants[0];
    if (!variant?.pinmapFile) return null;
    const resolvedPath = path.join(boardPackagePath, variant.pinmapFile);
    return fs.existsSync(resolvedPath) ? resolvedPath : null;
  }

  getBoardPinSummary(boardPackagePath) {
    const pinmapPath = this.resolveBoardPinmapPath(boardPackagePath);
    if (!pinmapPath) return null;
    const config = this.readComponentConfig(pinmapPath);
    return config ? this.extractPinSummary(config) : null;
  }

  getBoardConfig(boardPackagePath) {
    const pinmapPath = this.resolveBoardPinmapPath(boardPackagePath);
    return pinmapPath ? this.readComponentConfig(pinmapPath) : null;
  }

  resolvePinmapPath(fullId, packagesBasePath) {
    const { packageSlug, modelId, variantId } = this.parsePinmapId(fullId);
    const packagePath = path.join(packagesBasePath, '@aily-project', packageSlug);
    if (!fs.existsSync(packagePath)) return null;
    const catalog = this.readPinmapCatalog(packagePath);
    if (!catalog) {
      const defaultPinmap = path.join(packagePath, 'pinmap.json');
      return fs.existsSync(defaultPinmap) ? defaultPinmap : null;
    }
    const model = catalog.models.find((item) => item.id === modelId);
    if (!model) return null;
    const variant = model.variants.find((item) => item.id === variantId);
    if (!variant) return null;
    if (variant.pinmapFile) return path.join(packagePath, variant.pinmapFile);
    if (variant.pinmapRef && catalog.sharedPinmaps?.[variant.pinmapRef]) {
      return path.join(packagePath, catalog.sharedPinmaps[variant.pinmapRef].file);
    }
    const defaultPinmap = path.join(packagePath, 'pinmap.json');
    return fs.existsSync(defaultPinmap) ? defaultPinmap : null;
  }

  loadPinmapById(fullId, packagesBasePath) {
    const pinmapPath = this.resolvePinmapPath(fullId, packagesBasePath);
    return pinmapPath ? this.readComponentConfig(pinmapPath) : null;
  }

  loadPinSummaryById(fullId, packagesBasePath) {
    const config = this.loadPinmapById(fullId, packagesBasePath);
    return config ? this.extractPinSummary(config) : null;
  }

  getCatalogByFullId(fullId, packagesBasePath) {
    const { packageSlug } = this.parsePinmapId(fullId);
    return this.readPinmapCatalog(path.join(packagesBasePath, '@aily-project', packageSlug));
  }

  checkSoftwareComponent(fullId, packagesBasePath) {
    const catalog = this.getCatalogByFullId(fullId, packagesBasePath);
    return {
      isSoftware: catalog?.type === 'software',
      catalog: catalog?.type === 'software' ? catalog : undefined,
    };
  }

  scanPinmapCatalogs(packagesBasePath) {
    const catalogs = [];
    const root = path.join(packagesBasePath, '@aily-project');
    if (!fs.existsSync(root)) return catalogs;
    for (const pkgName of fs.readdirSync(root)) {
      const pkgPath = path.join(root, pkgName);
      if (!fs.statSync(pkgPath).isDirectory()) continue;
      const catalog = this.readPinmapCatalog(pkgPath);
      if (catalog) catalogs.push(catalog);
    }
    return catalogs;
  }

  scanAllLibraries(packagesBasePath) {
    const results = [];
    const root = path.join(packagesBasePath, '@aily-project');
    if (!fs.existsSync(root)) return results;
    for (const pkgName of fs.readdirSync(root)) {
      if (!pkgName.startsWith('lib-')) continue;
      const pkgPath = path.join(root, pkgName);
      if (!fs.statSync(pkgPath).isDirectory()) continue;
      let displayName = pkgName;
      const pkgJsonPath = path.join(pkgPath, 'package.json');
      try {
        if (fs.existsSync(pkgJsonPath)) {
          const pkgJson = this.readJsonFile(pkgJsonPath);
          displayName = pkgJson.displayName || pkgJson.name || pkgName;
        }
      } catch (_error) {
        // ignore
      }
      const catalog = this.readPinmapCatalog(pkgPath);
      results.push({
        packageSlug: pkgName,
        packagePath: pkgPath,
        displayName: catalog?.displayName || displayName,
        hasPinmapCatalog: catalog !== null,
        catalog: catalog || undefined,
        catalogStatus: catalog ? 'available' : 'missing_catalog',
      });
    }
    return results;
  }

  getAvailablePinmapIds(packagesBasePath, filter = {}) {
    const ids = [];
    for (const catalog of this.scanPinmapCatalogs(packagesBasePath)) {
      if (filter.type && catalog.type !== filter.type) continue;
      for (const model of catalog.models || []) {
        for (const variant of model.variants || []) {
          if (filter.status && variant.status !== filter.status) continue;
          if (filter.protocol && variant.protocol !== filter.protocol) continue;
          ids.push(variant.fullId);
        }
      }
    }
    return ids;
  }

  validateConnectionGraph(data) {
    const results = [];
    const { connections = [], components = [] } = data || {};

    for (const conn of connections) {
      const fromIsGnd = conn.from.function === 'GND' || conn.type === 'gnd';
      const toIsPower = /VCC|3V3|5V/.test(conn.to.function) || conn.type === 'power';
      const fromIsPower = /VCC|3V3|5V/.test(conn.from.function) || conn.type === 'power';
      const toIsGnd = conn.to.function === 'GND' || conn.type === 'gnd';
      if ((fromIsGnd && toIsPower) || (fromIsPower && toIsGnd)) {
        results.push({ ruleId: 'vcc_to_gnd', level: 'error', message: `连线 ${conn.id}: GND 直连 VCC/电源，会导致短路` });
      }
    }

    for (const conn of connections) {
      if (conn.type === 'uart') {
        if (conn.from.function === 'TX' && conn.to.function === 'TX') {
          results.push({ ruleId: 'uart_crossover', level: 'error', message: `连线 ${conn.id}: UART TX 应连接到 RX，不应 TX→TX` });
        }
        if (conn.from.function === 'RX' && conn.to.function === 'RX') {
          results.push({ ruleId: 'uart_crossover', level: 'error', message: `连线 ${conn.id}: UART RX 应连接到 TX，不应 RX→RX` });
        }
      }
    }

    const pinUsage = new Map();
    for (const conn of connections) {
      const fromKey = `${conn.from.ref}.${conn.from.pinId}`;
      const toKey = `${conn.to.ref}.${conn.to.pinId}`;
      if (!pinUsage.has(fromKey)) pinUsage.set(fromKey, []);
      if (!pinUsage.has(toKey)) pinUsage.set(toKey, []);
      pinUsage.get(fromKey).push(conn.id);
      pinUsage.get(toKey).push(conn.id);
    }
    for (const [pin, connIds] of pinUsage.entries()) {
      if (connIds.length > 1) {
        const connTypes = connIds.map((id) => connections.find((c) => c.id === id)?.type);
        const allBus = connTypes.every((type) => type === 'i2c' || type === 'spi');
        if (!allBus) {
          results.push({ ruleId: 'pin_conflict', level: 'warning', message: `引脚 ${pin} 被多条连线使用: ${connIds.join(', ')}` });
        }
      }
    }

    const refs = new Set();
    for (const conn of connections) {
      refs.add(conn.from.ref);
      refs.add(conn.to.ref);
    }
    const boardRef = components.length > 0 ? components[0].refId : '';
    for (const ref of refs) {
      if (ref === boardRef) continue;
      const hasPower = connections.some((c) => (c.to.ref === ref && c.type === 'power') || (c.from.ref === ref && c.type === 'power'));
      const hasGnd = connections.some((c) => (c.to.ref === ref && c.type === 'gnd') || (c.from.ref === ref && c.type === 'gnd'));
      if (!hasPower) results.push({ ruleId: 'missing_power', level: 'warning', message: `组件 ${ref} 缺少电源连接` });
      if (!hasGnd) results.push({ ruleId: 'missing_power', level: 'warning', message: `组件 ${ref} 缺少接地连接` });
    }
    return results;
  }

  getConnectionGraphPath(projectPath) {
    const basePath = this.resolveProjectPath(projectPath) || this.readCurrentProjectPath();
    return path.join(basePath, 'connection_output.json');
  }

  getConnectionGraph(projectPath) {
    try {
      const filePath = this.getConnectionGraphPath(projectPath);
      return fs.existsSync(filePath) ? this.readJsonFile(filePath) : null;
    } catch (_error) {
      return null;
    }
  }

  hasConnectionGraph(projectPath) {
    return fs.existsSync(this.getConnectionGraphPath(projectPath));
  }

  getAWSFilePath(projectPath) {
    const basePath = this.resolveProjectPath(projectPath) || this.readCurrentProjectPath();
    return path.join(basePath, 'connection.aws');
  }

  getJSONFilePath(projectPath) {
    return this.getConnectionGraphPath(projectPath);
  }

  saveAWSFile(awsContent, projectPath) {
    try {
      fs.writeFileSync(this.getAWSFilePath(projectPath), String(awsContent || ''));
      return true;
    } catch (_error) {
      return false;
    }
  }

  readAWSFile(projectPath) {
    try {
      const filePath = this.getAWSFilePath(projectPath);
      return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    } catch (_error) {
      return null;
    }
  }

  hasAWSFile(projectPath) {
    return fs.existsSync(this.getAWSFilePath(projectPath));
  }

  saveJSONFile(data, projectPath) {
    try {
      this.writeJsonFile(this.getJSONFilePath(projectPath), data);
      return true;
    } catch (_error) {
      return false;
    }
  }

  getLibraryInfo(pinmapId, packagesBasePath) {
    const ref = this.parsePinmapId(pinmapId);
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
        result.packageJson = this.readJsonFile(packageJsonPath);
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

  getPinmapTemplate(protocol) {
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
      case 'digital':
      case 'analog':
      default:
        baseTemplate.pins = [
          { id: 'pin_1', x: 10, y: 50, labelX: -20, labelY: 43, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'VCC', type: 'power' }] },
          { id: 'pin_2', x: 10, y: 70, labelX: -20, labelY: 63, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: 'GND', type: 'gnd' }] },
          { id: 'pin_3', x: 10, y: 90, labelX: -20, labelY: 83, labelAnchor: 'right', layout: 'horizontal', functions: [{ name: protocol === 'analog' ? 'OUT' : 'DATA', type: protocol === 'analog' ? 'analog' : 'digital' }] },
        ];
    }
    return baseTemplate;
  }

  deriveVariantProtocolFromPinmap(config) {
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

  derivePreviewPinsFromPinmap(config) {
    const names = [];
    for (const pin of config.pins || []) {
      if (pin.visible === false || pin.disabled === true) continue;
      const fns = pin.functions || [];
      const first = fns.find((fn) => fn.visible !== false && fn.disabled !== true) || fns[0];
      if (first?.name?.trim()) names.push(first.name.trim());
    }
    return names.length > 0 ? names : undefined;
  }

  enrichVariantFromPinmapConfig(variant, config) {
    if (!config) return;
    const protocol = this.deriveVariantProtocolFromPinmap(config);
    const previewPins = this.derivePreviewPinsFromPinmap(config);
    if (protocol) variant.protocol = protocol;
    if (previewPins) variant.previewPins = previewPins;
  }

  createNewCatalog(packageSlug, componentConfig) {
    const libName = packageSlug.replace('lib-', '').toUpperCase();
    return {
      version: '1.0.0',
      library: `@aily-project/${packageSlug}`,
      displayName: componentConfig?.name || `${libName} 系列`,
      type: 'library',
      models: [],
    };
  }

  updateCatalogStatus(pinmapId, status, pinmapFile, resolvedPackagePath, componentConfig, options = {}) {
    try {
      const ref = this.parsePinmapId(pinmapId);
      const catalogPath = this.resolveCatalogPath(resolvedPackagePath)
        || path.join(resolvedPackagePath, 'pinmaps', 'pinmap_catalog.json');
      let catalog = fs.existsSync(catalogPath)
        ? this.readJsonFile(catalogPath)
        : this.createNewCatalog(ref.packageSlug, componentConfig);
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
      this.enrichVariantFromPinmapConfig(variant, componentConfig);
      if (options.catalogVersion !== undefined) {
        variant.version = options.catalogVersion;
      }
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      return true;
    } catch (_error) {
      return false;
    }
  }

  savePinmapConfig(pinmapId, config, packagesBasePath, options = {}) {
    try {
      const normalizedOptions = typeof options === 'object' && options !== null ? options : { catalogVersion: options };
      const ref = this.parsePinmapId(pinmapId);
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
      this.updateCatalogStatus(pinmapId, 'available', `pinmaps/${fileName}`, packagePath, config, normalizedOptions);
      return { success: true, filePath, resolvedPackagePath: packagePath };
    } catch (error) {
      return { success: false, error: error.message || String(error) };
    }
  }

  overwriteBoardRootPinmapIfPresent(packageSlug, resolvedPackagePath, config) {
    if (!packageSlug.startsWith('board-')) return;
    const rootPath = path.join(resolvedPackagePath, 'pinmap.json');
    if (fs.existsSync(rootPath)) {
      fs.writeFileSync(rootPath, JSON.stringify(config, null, 2));
    }
  }

  findVariantInfo(pinmapId, packagesBasePath) {
    const ref = this.parsePinmapId(pinmapId);
    const packagePath = path.join(packagesBasePath, '@aily-project', ref.packageSlug);
    const catalog = this.readPinmapCatalog(packagePath);
    if (!catalog) return null;
    for (const model of catalog.models || []) {
      if (model.id !== ref.modelId) continue;
      for (const variant of model.variants || []) {
        if (variant.id === ref.variantId) return variant;
      }
    }
    return null;
  }
}

module.exports = {
  SchematicBackendService,
};
