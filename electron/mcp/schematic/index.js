const { SCHEMATIC_TOOL_DEFINITIONS } = require('./tool-definitions');
const { SchematicRuntimeClient } = require('./runtime-client');
const { createSchematicHandlers } = require('./handlers');
const { createErrorToolResult } = require('./result');
const { SchematicBackendService } = require('./backend-service');
const { createBackendSchematicTools } = require('./backend-tools');

const TOOL_DEFINITION_MAP = new Map(
  SCHEMATIC_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
);

function createSchematicToolSource(rendererBridge, options = {}) {
  const runtimeClient = new SchematicRuntimeClient(rendererBridge);
  const backendService = new SchematicBackendService({
    getCurrentProjectPath: options.getCurrentProjectPath,
  });
  const handlers = createSchematicHandlers(runtimeClient);
  const backendTools = createBackendSchematicTools(backendService, runtimeClient);

  return {
    getTools() {
      return SCHEMATIC_TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
    },

    hasTool(toolName) {
      return TOOL_DEFINITION_MAP.has(toolName);
    },

    async invoke(toolName, args = {}) {
      if (!TOOL_DEFINITION_MAP.has(toolName)) {
        throw new Error(`Unknown schematic tool: ${toolName}`);
      }
      const handler = handlers[toolName];
      const backendTool = backendTools[toolName];
      if (backendTool) {
        return backendTool(args);
      }
      if (!handler) {
        return createErrorToolResult(`No schematic handler registered for ${toolName}.`);
      }
      return handler(args);
    },
  };
}

module.exports = {
  createSchematicToolSource,
};
