const {
  AWS_SYNTAX_REFERENCE,
  CONNECTION_COLORS,
  formatErrors,
  generatePinmapSummary,
  hasErrors,
  inferDataFlow,
  parseAWS,
  resolvePin,
} = require('./aws-utils');

function createBackendSchematicTools(backendService, runtimeClient) {
  function normalizeProjectPath(args = {}) {
    return backendService.normalizeProjectPath(args.path || args.projectPath || '');
  }

  async function getComponentCatalog(args = {}) {
    const projectPath = normalizeProjectPath(args);
    const currentProjectPath = backendService.resolveProjectPath(projectPath);
    if (!currentProjectPath) {
      return { is_error: true, content: '当前没有打开的项目。' };
    }

    const packagesBasePath = backendService.resolvePackagesBasePath(currentProjectPath);
    if (!packagesBasePath || !require('fs').existsSync(packagesBasePath)) {
      return { is_error: true, content: '项目的 node_modules 目录不存在，请先安装依赖。' };
    }

    const libraryResults = backendService.scanAllLibraries(packagesBasePath).filter((lib) => {
      const filter = typeof args.libraryFilter === 'string' ? args.libraryFilter.trim() : '';
      if (!filter) return true;
      return lib.packageSlug === filter || lib.packageSlug === `lib-${filter}` || `@aily-project/${lib.packageSlug}` === filter;
    });

    let boardCatalog = null;
    if (args.includeBoards !== false) {
      const boardPackagePath = backendService.resolveBoardPackagePath(currentProjectPath);
      if (boardPackagePath) {
        const catalog = backendService.readPinmapCatalog(boardPackagePath);
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
          const boardConfig = backendService.getBoardConfig(boardPackagePath);
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
  }

  async function getProjectContext(args = {}) {
    const catalogResult = await getComponentCatalog(args);
    if (catalogResult.is_error) {
      return { is_error: true, content: `获取项目上下文失败: ${catalogResult.content}` };
    }
    const merged = JSON.parse(catalogResult.content);
    try {
      const response = await runtimeClient.invoke('get_generated_cpp_code', {}, {
        targetProjectPath: normalizeProjectPath(args),
      });
      if (response?.ok === true && typeof response?.result?.cppCode === 'string' && response.result.cppCode.trim()) {
        merged.cppCode = response.result.cppCode;
      }
    } catch (_error) {
      // ignore cppCode fallback
    }
    return { is_error: false, content: JSON.stringify(merged, null, 2) };
  }

  async function getPinmapSummary(args = {}) {
    const projectPath = normalizeProjectPath(args);
    const boardPackagePath = backendService.resolveBoardPackagePath(projectPath);
    if (!boardPackagePath) {
      return { is_error: true, content: '当前没有打开的项目或未安装开发板包。' };
    }
    const packagesBasePath = backendService.resolvePackagesBasePath(projectPath);
    const pinSummaries = [];
    const loadedPinmapIds = [];
    const pinmapIds = Array.isArray(args.pinmapIds) ? args.pinmapIds : [];

    const boardSummary = backendService.getBoardPinSummary(boardPackagePath);
    if (boardSummary) pinSummaries.push(boardSummary);
    if (pinmapIds.length > 0 && packagesBasePath) {
      for (const fullId of pinmapIds) {
        const summary = backendService.loadPinSummaryById(fullId, packagesBasePath);
        if (summary) {
          pinSummaries.push(summary);
          loadedPinmapIds.push(fullId);
        }
      }
    }
    if (!pinSummaries.length) {
      return { is_error: true, content: '未找到任何引脚配置文件（pinmap.json）。' };
    }
    const existingConnections = backendService.getConnectionGraph(projectPath);
    const result = { pinSummaries };
    if (loadedPinmapIds.length > 0) result.loadedPinmapIds = loadedPinmapIds;
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
      result.availableSensorPinmapIds = backendService.getAvailablePinmapIds(packagesBasePath, { status: 'available' }).slice(0, 10);
      result.tip = '使用 get_project_context 工具可查看完整的组件目录。';
    }
    return { is_error: false, content: JSON.stringify(result, null, 2) };
  }

  async function generatePinmap(args = {}) {
    const pinmapId = typeof args.pinmapId === 'string' ? args.pinmapId.trim() : '';
    if (!pinmapId) {
      return { is_error: true, content: '缺少必需参数 pinmapId。请提供目标组件的完整标识符，如 "lib-servo:sg90:default"。' };
    }
    const packagesBasePath = backendService.resolvePackagesBasePath(normalizeProjectPath(args));
    if (!packagesBasePath) {
      return { is_error: true, content: '当前没有打开的项目，无法定位组件包。' };
    }
    const ref = backendService.parsePinmapId(pinmapId);
    const variantInfo = backendService.findVariantInfo(pinmapId, packagesBasePath);
    const libraryInfo = backendService.getLibraryInfo(pinmapId, packagesBasePath);
    const protocol = variantInfo?.protocol || 'other';
    const template = backendService.getPinmapTemplate(protocol);
    const result = {
      targetPinmapId: pinmapId,
      parsedRef: ref,
      variantInfo: variantInfo ? {
        name: variantInfo.name,
        protocol: variantInfo.protocol,
        manufacturer: variantInfo.manufacturer,
        voltage: variantInfo.voltage,
        note: variantInfo.note,
      } : undefined,
      readme: libraryInfo.readme,
      exampleCode: libraryInfo.exampleCode,
      pinmapTemplate: template,
      instructions: `根据 pinmapTemplate 结构和 readme 信息生成 pinmap 配置。\n\n## 关键规则\n\n1. **id**: 使用 "component_${ref.modelId}_${ref.variantId}"\n2. **尺寸计算**:\n   - height = max(左侧引脚数, 右侧引脚数) × 20 + 40\n   - width = 根据引脚名称长度调整，通常 120-200，名称长则增大\n3. **引脚位置**:\n   - y 值: 首个 y≈32，间距 20\n   - 左侧引脚: x≈10, labelX≈-20, labelAnchor="right"\n   - 右侧引脚: x≈width-15, labelX≈width+12, labelAnchor="left"\n   - labelY = y - 7\n4. **images.url**: 使用可渲染图片的 base64（如 data:image/png;base64,...）\n5. **images**: 必须保留 images 字段\n\n## 保存\n\n生成后调用：save_pinmap(pinmapId="${pinmapId}", pinmapConfig={JSON})`,
    };
    return { is_error: false, content: JSON.stringify(result, null, 2) };
  }

  async function savePinmap(args = {}) {
    const pinmapId = typeof args.pinmapId === 'string' ? args.pinmapId.trim() : '';
    if (!pinmapId) return { is_error: true, content: '缺少必需参数 pinmapId。' };
    if (!args.pinmapConfig) return { is_error: true, content: '缺少必需参数 pinmapConfig。请提供完整的 pinmap 配置 JSON。' };
    const packagesBasePath = backendService.resolvePackagesBasePath(normalizeProjectPath(args));
    if (!packagesBasePath) return { is_error: true, content: '当前没有打开的项目，无法保存 pinmap。' };
    const config = typeof args.pinmapConfig === 'string' ? JSON.parse(args.pinmapConfig) : args.pinmapConfig;
    if (!config.id || !config.name || !Array.isArray(config.pins)) {
      return { is_error: true, content: 'pinmapConfig 缺少必需字段（id, name, pins）。请确保配置完整。' };
    }
    const saveResult = backendService.savePinmapConfig(pinmapId, config, packagesBasePath);
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
  }

  async function getCurrentSchematic(args = {}) {
    const projectPath = normalizeProjectPath(args);
    const data = backendService.getConnectionGraph(projectPath);
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
  }

  async function generateSchematic(args = {}) {
    const projectPath = normalizeProjectPath(args);
    const boardPackagePath = backendService.resolveBoardPackagePath(projectPath);
    if (!boardPackagePath) {
      return { is_error: true, content: '当前没有打开的项目或未安装开发板包，请先创建/打开一个项目。' };
    }
    const boardConfig = backendService.getBoardConfig(boardPackagePath);
    if (!boardConfig) {
      return { is_error: true, content: '开发板引脚配置不存在，无法生成连线图。请先使用 generate_pinmap + save_pinmap 为该开发板生成 pinmap 配置。' };
    }
    const packagesBasePath = backendService.resolvePackagesBasePath(projectPath);
    const boardSummary = backendService.getBoardPinSummary(boardPackagePath);
    const pinSummaries = [];
    const componentInstances = [];
    const softwareComponents = [];
    const failedPinmapIds = [];
    const loadedPinmapIds = [];
    if (boardSummary) pinSummaries.push(boardSummary);
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
        const ref = backendService.parsePinmapId(pinmapId);
        alias = instanceIndex === 0 ? ref.modelId : `${ref.modelId}_${instanceIndex + 1}`;
      }
      if (pinmapId.startsWith('board-')) {
        loadedPinmapIds.push(pinmapId);
        continue;
      }
      if (packagesBasePath) {
        const softwareCheck = backendService.checkSoftwareComponent(pinmapId, packagesBasePath);
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
        const summary = backendService.loadPinSummaryById(pinmapId, packagesBasePath);
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
    }

    if (pinSummaries.length <= 1 && softwareComponents.length === 0) {
      return {
        is_error: failedPinmapIds.length > 0,
        content: JSON.stringify({
          message: '当前只检测到开发板的引脚配置，未发现外设配置。',
          failedPinmapIds: failedPinmapIds.length > 0 ? failedPinmapIds : undefined,
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
    if (boardSummary) awsSummaryParts.push(generatePinmapSummary(boardSummary, 'board', boardPinmapId));
    for (const instance of componentInstances) {
      const summary = pinSummaries.find((item) => item.componentId === instance.alias);
      if (summary) awsSummaryParts.push(generatePinmapSummary(summary, instance.alias, instance.pinmapId));
    }
    const awsPinmapSummary = awsSummaryParts.join('\n\n');

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
          const config = backendService.loadPinmapById(instance.pinmapId, packagesBasePath);
          if (!config) continue;
          componentConfigs[instance.alias] = config;
          previewComponents.push({
            refId: instance.alias,
            componentId: config.id,
            componentName: instance.label || config.name,
            pinmapId: instance.pinmapId,
            instance: instance.instance,
          });
        }
        await runtimeClient.invoke('preview_schematic_components', {
          componentConfigs,
          components: previewComponents,
          connections: [],
        }, { targetProjectPath: projectPath });
      } catch (_error) {
        // ignore preview failure
      }
    }

    return {
      is_error: false,
      content: JSON.stringify({
        awsPinmapSummary,
        loadedPinmapIds,
        failedPinmapIds: failedPinmapIds.length > 0 ? failedPinmapIds : undefined,
        componentInstances: componentInstances.length > 0 ? componentInstances : undefined,
        softwareComponents: softwareComponents.length > 0 ? softwareComponents : undefined,
      }, null, 2),
    };
  }

  async function validateSchematic(args = {}) {
    const projectPath = normalizeProjectPath(args);
    const currentProjectPath = backendService.resolveProjectPath(projectPath);
    if (!currentProjectPath) return { is_error: true, content: '当前没有打开的项目，请先创建或打开一个项目。' };
    const boardPackagePath = backendService.resolveBoardPackagePath(currentProjectPath);
    if (!boardPackagePath) return { is_error: true, content: '当前项目没有配置开发板，请先选择开发板。' };

    const awsFilePath = backendService.getAWSFilePath(currentProjectPath);
    const jsonFilePath = backendService.getJSONFilePath(currentProjectPath);
    let awsContent = typeof args.aws === 'string' ? args.aws : '';
    if (!awsContent) {
      if (backendService.hasAWSFile(currentProjectPath)) {
        awsContent = backendService.readAWSFile(currentProjectPath) || '';
      } else {
        const existingData = backendService.getConnectionGraph(currentProjectPath);
        if (!existingData) {
          return { is_error: true, content: '没有可验证的连线数据。请先使用 generate_schematic 生成连线，然后传入 aws 参数。' };
        }
        const validationResults = backendService.validateConnectionGraph(existingData);
        const errors = validationResults.filter((item) => item.level === 'error');
        const warnings = validationResults.filter((item) => item.level === 'warning');
        return {
          is_error: false,
          content: JSON.stringify({
            valid: errors.length === 0,
            saved: false,
            summary: {
              totalConnections: existingData.connections.length,
              totalComponents: existingData.components.length,
              errors: errors.length,
              warnings: warnings.length,
            },
            issues: validationResults.length > 0 ? validationResults : undefined,
            message: errors.length === 0
              ? (warnings.length > 0 ? `连线配置基本安全，但有 ${warnings.length} 条警告需要注意。` : '连线配置安全，所有检查通过。')
              : `发现 ${errors.length} 个安全问题，请修正后重新验证。`,
            tip: '用户可以点击右侧工具栏的「电路连接」按钮查看连线图。',
          }, null, 2),
        };
      }
    }

    const parsed = parseAWS(awsContent);
    if (hasErrors(parsed)) {
      return {
        is_error: true,
        content: JSON.stringify({
          success: false,
          errors: parsed.errors,
          warnings: parsed.warnings,
          errorMessage: formatErrors(parsed),
          syntaxReference: AWS_SYNTAX_REFERENCE,
          tip: '请根据上述错误信息修正 AWS 语法后重试。',
        }, null, 2),
      };
    }

    const packagesBasePath = backendService.resolvePackagesBasePath(currentProjectPath);
    const configMap = new Map();
    const boardConfig = backendService.getBoardConfig(boardPackagePath);
    if (boardConfig) configMap.set('board', boardConfig);
    const loadErrors = [];
    for (const use of parsed.uses) {
      const config = backendService.loadPinmapById(use.pinmapId, packagesBasePath);
      if (!config) {
        loadErrors.push({ pinmapId: use.pinmapId, error: '无法加载组件配置，请检查 pinmapId 是否正确或 pinmap 文件是否存在', line: use.line });
        continue;
      }
      configMap.set(use.alias, config);
    }
    if (loadErrors.length > 0) {
      return {
        is_error: true,
        content: JSON.stringify({
          success: false,
          loadErrors,
          message: '部分组件配置加载失败',
          tip: '请调用 get_project_context 确认组件状态，使用 generate_pinmap + save_pinmap 补全缺失配置后重试。',
          syntaxReference: AWS_SYNTAX_REFERENCE,
        }, null, 2),
      };
    }

    const connections = [];
    const resolveErrors = [];
    let connIndex = 1;
    for (const conn of parsed.connections) {
      const fromConfig = configMap.get(conn.fromRef);
      const toConfig = configMap.get(conn.toRef);
      if (!fromConfig) {
        resolveErrors.push({ message: `找不到组件 "${conn.fromRef}" 的配置`, line: conn.line, source: `${conn.fromRef}.${conn.fromPin}` });
        continue;
      }
      if (!toConfig) {
        resolveErrors.push({ message: `找不到组件 "${conn.toRef}" 的配置`, line: conn.line, source: `${conn.toRef}.${conn.toPin}` });
        continue;
      }
      const fromResolved = resolvePin(fromConfig, conn.fromPin);
      if (!fromResolved) {
        resolveErrors.push({ message: `在组件 "${conn.fromRef}" (${fromConfig.name}) 中找不到引脚 "${conn.fromPin}"`, line: conn.line, source: `${conn.fromRef}.${conn.fromPin}` });
        continue;
      }
      const toResolved = resolvePin(toConfig, conn.toPin);
      if (!toResolved) {
        resolveErrors.push({ message: `在组件 "${conn.toRef}" (${toConfig.name}) 中找不到引脚 "${conn.toPin}"`, line: conn.line, source: `${conn.toRef}.${conn.toPin}` });
        continue;
      }
      const connType = CONNECTION_COLORS[conn.type] ? conn.type : 'other';
      const label = conn.note || `${conn.type.toUpperCase()}: ${conn.fromPin} → ${conn.toPin}`;
      const flow = inferDataFlow(conn.type, fromResolved.functionName, toResolved.functionName, conn.arrow);
      connections.push({
        id: `conn_${connIndex++}`,
        from: { ref: conn.fromRef, pinId: fromResolved.pinId, function: fromResolved.functionName },
        to: { ref: conn.toRef, pinId: toResolved.pinId, function: toResolved.functionName },
        type: conn.type,
        label,
        color: CONNECTION_COLORS[connType],
        bus: conn.bus,
        direction: flow.direction,
        half: flow.half,
        animationPattern: flow.animationPattern,
      });
    }

    if (resolveErrors.length > 0) {
      return {
        is_error: true,
        content: JSON.stringify({
          success: false,
          resolveErrors,
          message: '引脚解析失败',
          tip: '请检查引脚名称是否正确。可使用 generate_schematic 获取正确的引脚名称。',
          syntaxReference: AWS_SYNTAX_REFERENCE,
        }, null, 2),
      };
    }

    const description = parsed.comments.length > 0
      ? parsed.comments[0]
      : `连线方案（${parsed.uses.map((item) => item.label || item.alias).join(' + ')}）`;
    const components = [];
    const boardPkgName = require('path').basename(boardPackagePath) || 'board';
    if (boardConfig) {
      components.push({ refId: 'board', componentId: boardConfig.id, componentName: boardConfig.name, pinmapId: `${boardPkgName}:default:default`, isBoard: true });
    }
    for (const [index, use] of parsed.uses.entries()) {
      const config = configMap.get(use.alias);
      const sameTypeCount = parsed.uses.slice(0, index).filter((item) => item.pinmapId === use.pinmapId).length;
      components.push({ refId: use.alias, componentId: config.id, componentName: use.label || config.name, pinmapId: use.pinmapId, instance: sameTypeCount });
    }
    const jsonData = { version: '1.0.0', description, components, connections };
    const validationResults = backendService.validateConnectionGraph(jsonData);
    const errors = validationResults.filter((item) => item.level === 'error');
    const warnings = validationResults.filter((item) => item.level === 'warning');

    if (awsContent) backendService.saveAWSFile(awsContent, currentProjectPath);
    backendService.saveJSONFile(jsonData, currentProjectPath);

    try {
      await runtimeClient.invoke('notify_schematic_saved', { jsonData }, { targetProjectPath: projectPath });
    } catch (_error) {
      // ignore UI refresh failure
    }

    return {
      is_error: false,
      content: JSON.stringify({
        valid: errors.length === 0,
        saved: true,
        summary: {
          totalConnections: jsonData.connections.length,
          totalComponents: jsonData.components.length,
          errors: errors.length,
          warnings: warnings.length,
        },
        issues: validationResults.length > 0 ? validationResults : undefined,
        message: errors.length === 0
          ? (warnings.length > 0 ? `连线配置基本安全，但有 ${warnings.length} 条警告需要注意。数据已保存。` : '连线配置安全，所有检查通过。数据已保存。')
          : `发现 ${errors.length} 个安全问题，请修正后重新验证。`,
        awsWarnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
        tip: '用户可以点击右侧工具栏的「电路连接」按钮查看连线图。',
      }, null, 2),
    };
  }

  return {
    get_component_catalog: getComponentCatalog,
    get_project_context: getProjectContext,
    get_pinmap_summary: getPinmapSummary,
    generate_pinmap: generatePinmap,
    save_pinmap: savePinmap,
    get_current_schematic: getCurrentSchematic,
    generate_schematic: generateSchematic,
    validate_schematic: validateSchematic,
  };
}

module.exports = {
  createBackendSchematicTools,
};
