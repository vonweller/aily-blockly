const { createProjectContext } = require('../schematic/project-context');
const { createArchSaveService } = require('./save-service');

function createArchServices(options = {}) {
  const projectContext = options.projectContext || createProjectContext(options);
  const archSaveService = createArchSaveService(projectContext);

  return {
    projectContext,
    archSaveService,
  };
}

module.exports = {
  createArchServices,
};
