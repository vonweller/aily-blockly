const { createErrorToolResult, fromToolUseResult } = require('./result');

function normalizePath(value) {
  return typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArgsRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

function normalizeTargetProjectPath(args) {
  return normalizePath(args.path || args.projectPath || '');
}

function normalizePinmapIds(pinmapIds) {
  if (!Array.isArray(pinmapIds)) {
    return undefined;
  }
  return pinmapIds
    .map((item) => {
      if (typeof item === 'string') {
        const value = item.trim();
        return value ? value : null;
      }
      if (!item || typeof item !== 'object') {
        return null;
      }
      const id = normalizeString(item.id);
      if (!id) {
        return null;
      }
      const normalized = { id };
      const alias = normalizeString(item.alias);
      const label = normalizeString(item.label);
      if (alias) {
        normalized.alias = alias;
      }
      if (label) {
        normalized.label = label;
      }
      return normalized;
    })
    .filter(Boolean);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizePinmapConfig(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      throw new Error('pinmapConfig 不是有效的 JSON 格式。');
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return null;
}

async function invokeRuntimeTool(runtimeClient, method, args, options = {}) {
  const response = await runtimeClient.invoke(method, args, options);
  if (!response || response.ok !== true) {
    return createErrorToolResult(
      response && typeof response.message === 'string'
        ? response.message
        : `Renderer bridge call failed for ${method}.`,
    );
  }
  return fromToolUseResult(response.result || {});
}

async function runGenerateSchematic(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  const normalizedArgs = { ...args };
  const pinmapIds = normalizePinmapIds(args.pinmapIds);
  const components = normalizeStringArray(args.components);
  const requirements = normalizeString(args.requirements);

  if (pinmapIds) {
    normalizedArgs.pinmapIds = pinmapIds;
  }
  if (components) {
    normalizedArgs.components = components;
  }
  if (requirements) {
    normalizedArgs.requirements = requirements;
  }

  return invokeRuntimeTool(runtimeClient, 'generate_schematic', normalizedArgs, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runGetPinmapSummary(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  const normalizedArgs = { ...args };
  const pinmapIds = normalizeStringArray(args.pinmapIds);
  if (pinmapIds) {
    normalizedArgs.pinmapIds = pinmapIds;
  }
  return invokeRuntimeTool(runtimeClient, 'get_pinmap_summary', normalizedArgs, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runGetComponentCatalog(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  const normalizedArgs = {
    libraryFilter: normalizeString(args.libraryFilter) || undefined,
    includeNeedsGeneration: normalizeBoolean(args.includeNeedsGeneration, true),
    includeBoards: normalizeBoolean(args.includeBoards, true),
  };
  return invokeRuntimeTool(runtimeClient, 'get_component_catalog', normalizedArgs, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runGetProjectContext(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  return invokeRuntimeTool(runtimeClient, 'get_project_context', {
    includeNeedsGeneration: normalizeBoolean(args.includeNeedsGeneration, true),
  }, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runValidateSchematic(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  const aws = normalizeString(args.aws);
  const normalizedArgs = aws ? { aws } : {};
  return invokeRuntimeTool(runtimeClient, 'validate_schematic', normalizedArgs, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runGetCurrentSchematic(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  return invokeRuntimeTool(runtimeClient, 'get_current_schematic', {}, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runGeneratePinmap(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  const pinmapId = normalizeString(args.pinmapId);
  if (!pinmapId) {
    return createErrorToolResult('缺少必需参数 pinmapId。');
  }
  const referenceSource = normalizeString(args.referenceSource) || 'auto';
  return invokeRuntimeTool(runtimeClient, 'generate_pinmap', {
    pinmapId,
    referenceSource,
  }, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

async function runSavePinmap(runtimeClient, rawArgs) {
  const args = normalizeArgsRecord(rawArgs);
  const pinmapId = normalizeString(args.pinmapId);
  if (!pinmapId) {
    return createErrorToolResult('缺少必需参数 pinmapId。');
  }

  let pinmapConfig;
  try {
    pinmapConfig = normalizePinmapConfig(args.pinmapConfig);
  } catch (error) {
    return createErrorToolResult(error.message || String(error));
  }

  if (!pinmapConfig) {
    return createErrorToolResult('缺少必需参数 pinmapConfig。');
  }

  return invokeRuntimeTool(runtimeClient, 'save_pinmap', {
    pinmapId,
    pinmapConfig,
  }, {
    targetProjectPath: normalizeTargetProjectPath(args),
  });
}

function createSchematicHandlers(runtimeClient) {
  return {
    generate_schematic: (args) => runGenerateSchematic(runtimeClient, args),
    get_pinmap_summary: (args) => runGetPinmapSummary(runtimeClient, args),
    get_component_catalog: (args) => runGetComponentCatalog(runtimeClient, args),
    get_project_context: (args) => runGetProjectContext(runtimeClient, args),
    validate_schematic: (args) => runValidateSchematic(runtimeClient, args),
    get_current_schematic: (args) => runGetCurrentSchematic(runtimeClient, args),
    generate_pinmap: (args) => runGeneratePinmap(runtimeClient, args),
    save_pinmap: (args) => runSavePinmap(runtimeClient, args),
  };
}

module.exports = {
  createSchematicHandlers,
};
