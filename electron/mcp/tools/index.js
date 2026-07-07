const { createSchematicServices } = require('../schematic');
const { createErrorToolResult } = require('../schematic/result');
const { SchematicRuntimeClient } = require('../schematic/runtime-client');

const publicToolModules = [
  require('./list_dir'),
  require('./read_file'),
  require('./glob_search'),
  require('./grep_search'),
  require('./get_project_context'),
];

const schematicToolModules = [
  require('./get_component_catalog'),
  require('./get_pinmap_summary'),
  require('./generate_pinmap'),
  require('./save_pinmap'),
  require('./get_current_schematic'),
  require('./generate_schematic'),
  require('./validate_schematic'),
];

const toolModules = [
  ...publicToolModules,
  ...schematicToolModules,
];

function createLocalToolSource(rendererBridge, options = {}) {
  const runtimeClient = new SchematicRuntimeClient(rendererBridge);
  const services = createSchematicServices(runtimeClient, options);
  const definitionMap = new Map();
  const handlerMap = new Map();

  for (const toolModule of toolModules) {
    definitionMap.set(toolModule.definition.name, toolModule.definition);
    handlerMap.set(toolModule.definition.name, toolModule.createHandler(services));
  }

  return {
    getTools() {
      return Array.from(definitionMap.values()).map((tool) => ({ ...tool }));
    },
    hasTool(toolName) {
      return definitionMap.has(toolName);
    },
    async invoke(toolName, args = {}) {
      const handler = handlerMap.get(toolName);
      if (!handler) {
        return createErrorToolResult(`No tool handler registered for ${toolName}.`);
      }
      const toolResult = await handler(args);
      return toolResult?.is_error === true
        ? createErrorToolResult(toolResult.content)
        : {
            content: [{ type: 'text', text: typeof toolResult?.content === 'string' ? toolResult.content : JSON.stringify(toolResult?.content ?? '', null, 2) }],
            isError: false,
          };
    },
  };
}

module.exports = {
  createLocalToolSource,
};
