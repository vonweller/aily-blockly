const { createProjectContext } = require('./project-context');
const { createCatalogService } = require('./catalog-service');
const { createPinmapService } = require('./pinmap-service');
const { createAwsService } = require('./aws-service');
const { createRuntimeAdapter } = require('./runtime-adapter');

function createSchematicServices(runtimeClient, options = {}) {
  const projectContext = createProjectContext(options);
  const catalogService = createCatalogService(projectContext);
  const runtimeAdapter = createRuntimeAdapter(runtimeClient);
  const pinmapService = createPinmapService(projectContext, catalogService, runtimeAdapter);
  const awsService = createAwsService(projectContext, pinmapService);

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
