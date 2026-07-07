const fs = require('fs');
const path = require('path');

function createProjectContext(options = {}) {
  const getCurrentProjectPath = typeof options.getCurrentProjectPath === 'function'
    ? options.getCurrentProjectPath
    : () => '';

  function normalizeProjectPath(value) {
    return typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
  }

  function readCurrentProjectPath() {
    return normalizeProjectPath(getCurrentProjectPath());
  }

  function resolveProjectPath(projectPath) {
    const candidate = normalizeProjectPath(projectPath) || readCurrentProjectPath();
    if (!candidate) {
      return null;
    }
    return fs.existsSync(path.join(candidate, 'package.json')) ? candidate : null;
  }

  function resolvePackagesBasePath(projectPath) {
    const resolvedProjectPath = resolveProjectPath(projectPath);
    return resolvedProjectPath ? path.join(resolvedProjectPath, 'node_modules') : null;
  }

  function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function resolveBoardPackagePath(projectPath) {
    const resolvedProjectPath = resolveProjectPath(projectPath);
    if (!resolvedProjectPath) {
      return null;
    }

    const packageJsonPath = path.join(resolvedProjectPath, 'package.json');
    let packageJson = null;
    try {
      if (fs.existsSync(packageJsonPath)) {
        packageJson = readJsonFile(packageJsonPath);
      }
    } catch (_error) {
      packageJson = null;
    }

    const dependencyBlocks = [packageJson?.dependencies, packageJson?.boardDependencies];
    for (const block of dependencyBlocks) {
      if (!block || typeof block !== 'object') {
        continue;
      }
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
        const aci = readJsonFile(aciPath);
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

  return {
    normalizeProjectPath,
    readCurrentProjectPath,
    resolveProjectPath,
    resolvePackagesBasePath,
    resolveBoardPackagePath,
    readJsonFile,
  };
}

module.exports = {
  createProjectContext,
};
