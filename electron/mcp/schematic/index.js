const { createProjectContext } = require('./project-context');
const { createCatalogService } = require('./catalog-service');
const { createPinmapService } = require('./pinmap-service');
const { createAwsService } = require('./aws-service');
const { createRuntimeAdapter } = require('./runtime-adapter');

function createSchematicServices(runtimeClient, options = {}) {
  const projectContext = createProjectContext(options);
  const catalogService = createCatalogService(projectContext);
  const pinmapService = createPinmapService(projectContext, catalogService);
  const awsService = createAwsService(projectContext, pinmapService);
  const runtimeAdapter = createRuntimeAdapter(runtimeClient);

  return {
    projectContext,
    catalogService,
    pinmapService,
    awsService,
    runtimeAdapter,
  };
}

module.exports = {
  createSchematicServices,
};
