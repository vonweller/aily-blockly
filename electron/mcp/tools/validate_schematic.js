const definition = {
  name: 'validate_schematic',
  description: '验证 AWS 接线图并保存，这是接线工作流的最终步骤。',
  input_schema: {
    type: 'object',
    properties: {
      aws: { type: 'string' },
      path: { type: 'string' },
      projectPath: { type: 'string' },
    },
    required: [],
  },
};

function createHandler(services) {
  return async function validateSchematic(args = {}) {
    const projectPath = services.projectContext.normalizeProjectPath(args.path || args.projectPath || '');
    const currentProjectPath = services.projectContext.resolveProjectPath(projectPath);
    if (!currentProjectPath) {
      return { is_error: true, content: '当前没有打开的项目，请先创建或打开一个项目。' };
    }
    const boardPackagePath = services.projectContext.resolveBoardPackagePath(currentProjectPath);
    if (!boardPackagePath) {
      return { is_error: true, content: '当前项目没有配置开发板，请先选择开发板。' };
    }

    let awsContent = typeof args.aws === 'string' ? args.aws : '';
    if (!awsContent) {
      if (services.awsService.hasAWSFile(currentProjectPath)) {
        awsContent = services.awsService.readAWSFile(currentProjectPath) || '';
      } else {
        const existingData = services.awsService.getConnectionGraph(currentProjectPath);
        if (!existingData) {
          return { is_error: true, content: '没有可验证的连线数据。请先使用 generate_schematic 生成连线，然后传入 aws 参数。' };
        }
        const validationResults = services.awsService.validateConnectionGraph(existingData);
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

    const parsed = services.awsService.parseAWS(awsContent);
    if (services.awsService.hasErrors(parsed)) {
      return {
        is_error: true,
        content: JSON.stringify({
          success: false,
          errors: parsed.errors,
          warnings: parsed.warnings,
          errorMessage: services.awsService.formatErrors(parsed),
          syntaxReference: services.awsService.AWS_SYNTAX_REFERENCE,
          tip: '请根据上述错误信息修正 AWS 语法后重试。',
        }, null, 2),
      };
    }

    const packagesBasePath = services.projectContext.resolvePackagesBasePath(currentProjectPath);
    const configMap = new Map();
    const boardConfig = services.pinmapService.getBoardConfig(boardPackagePath);
    if (boardConfig) {
      configMap.set('board', boardConfig);
    }
    const loadErrors = [];
    for (const use of parsed.uses) {
      const config = services.pinmapService.loadPinmapById(use.pinmapId, packagesBasePath);
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
          syntaxReference: services.awsService.AWS_SYNTAX_REFERENCE,
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
      const fromResolved = services.awsService.resolvePin(fromConfig, conn.fromPin);
      if (!fromResolved) {
        resolveErrors.push({ message: `在组件 "${conn.fromRef}" (${fromConfig.name}) 中找不到引脚 "${conn.fromPin}"`, line: conn.line, source: `${conn.fromRef}.${conn.fromPin}` });
        continue;
      }
      const toResolved = services.awsService.resolvePin(toConfig, conn.toPin);
      if (!toResolved) {
        resolveErrors.push({ message: `在组件 "${conn.toRef}" (${toConfig.name}) 中找不到引脚 "${conn.toPin}"`, line: conn.line, source: `${conn.toRef}.${conn.toPin}` });
        continue;
      }
      const connType = services.awsService.CONNECTION_COLORS[conn.type] ? conn.type : 'other';
      const label = conn.note || `${conn.type.toUpperCase()}: ${conn.fromPin} → ${conn.toPin}`;
      const flow = services.awsService.inferDataFlow(conn.type, fromResolved.functionName, toResolved.functionName, conn.arrow);
      connections.push({
        id: `conn_${connIndex++}`,
        from: { ref: conn.fromRef, pinId: fromResolved.pinId, function: fromResolved.functionName },
        to: { ref: conn.toRef, pinId: toResolved.pinId, function: toResolved.functionName },
        type: conn.type,
        label,
        color: services.awsService.CONNECTION_COLORS[connType],
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
          syntaxReference: services.awsService.AWS_SYNTAX_REFERENCE,
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
    const validationResults = services.awsService.validateConnectionGraph(jsonData);
    const errors = validationResults.filter((item) => item.level === 'error');
    const warnings = validationResults.filter((item) => item.level === 'warning');

    if (awsContent) {
      services.awsService.saveAWSFile(awsContent, currentProjectPath);
    }
    services.awsService.saveJSONFile(jsonData, currentProjectPath);

    let runtimeSync = { ok: true, saved: true, windowUpdated: false };
    try {
      const syncResult = await services.runtimeAdapter.notifySchematicSaved({ jsonData }, projectPath);
      if (syncResult && typeof syncResult === 'object') {
        runtimeSync = {
          ok: syncResult.ok !== false,
          saved: syncResult.saved !== false,
          windowUpdated: syncResult.windowUpdated === true,
          ...(syncResult.error ? { error: syncResult.error } : {}),
        };
      }
    } catch (error) {
      runtimeSync = {
        ok: false,
        saved: false,
        windowUpdated: false,
        error: error && error.message ? error.message : String(error),
      };
    }

    return {
      is_error: false,
      content: JSON.stringify({
        valid: errors.length === 0,
        saved: true,
        runtimeSync,
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
  };
}

module.exports = {
  definition,
  createHandler,
};
