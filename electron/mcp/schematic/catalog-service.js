const fs = require('fs');
const path = require('path');

function createCatalogService(projectContext) {
  function parsePinmapId(fullId) {
    const parts = String(fullId || '').split(':');
    return {
      fullId: String(fullId || ''),
      packageSlug: parts[0] || '',
      modelId: parts[1] || '',
      variantId: parts[2] || 'default',
    };
  }

  function resolveCatalogPath(packagePath) {
    const newPath = path.join(packagePath, 'pinmaps', 'pinmap_catalog.json');
    if (fs.existsSync(newPath)) {
      return newPath;
    }
    const legacyPath = path.join(packagePath, 'pinmap_catalog.json');
    if (fs.existsSync(legacyPath)) {
      return legacyPath;
    }
    return null;
  }

  function readPinmapCatalog(packagePath) {
    const catalogPath = resolveCatalogPath(packagePath);
    if (!catalogPath) {
      return null;
    }
    try {
      return projectContext.readJsonFile(catalogPath);
    } catch (_error) {
      return null;
    }
  }

  function getCatalogByFullId(fullId, packagesBasePath) {
    const { packageSlug } = parsePinmapId(fullId);
    return readPinmapCatalog(path.join(packagesBasePath, '@aily-project', packageSlug));
  }

  function checkSoftwareComponent(fullId, packagesBasePath) {
    const catalog = getCatalogByFullId(fullId, packagesBasePath);
    return {
      isSoftware: catalog?.type === 'software',
      catalog: catalog?.type === 'software' ? catalog : undefined,
    };
  }

  function scanPinmapCatalogs(packagesBasePath) {
    const catalogs = [];
    const root = path.join(packagesBasePath, '@aily-project');
    if (!fs.existsSync(root)) {
      return catalogs;
    }

    for (const pkgName of fs.readdirSync(root)) {
      const pkgPath = path.join(root, pkgName);
      if (!fs.statSync(pkgPath).isDirectory()) {
        continue;
      }
      const catalog = readPinmapCatalog(pkgPath);
      if (catalog) {
        catalogs.push(catalog);
      }
    }

    return catalogs;
  }

  function scanAllLibraries(packagesBasePath) {
    const results = [];
    const root = path.join(packagesBasePath, '@aily-project');
    if (!fs.existsSync(root)) {
      return results;
    }

    for (const pkgName of fs.readdirSync(root)) {
      if (!pkgName.startsWith('lib-')) {
        continue;
      }
      const pkgPath = path.join(root, pkgName);
      if (!fs.statSync(pkgPath).isDirectory()) {
        continue;
      }

      let displayName = pkgName;
      const pkgJsonPath = path.join(pkgPath, 'package.json');
      try {
        if (fs.existsSync(pkgJsonPath)) {
          const pkgJson = projectContext.readJsonFile(pkgJsonPath);
          displayName = pkgJson.displayName || pkgJson.name || pkgName;
        }
      } catch (_error) {
        // ignore
      }

      const catalog = readPinmapCatalog(pkgPath);
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

  function getAvailablePinmapIds(packagesBasePath, filter = {}) {
    const ids = [];
    for (const catalog of scanPinmapCatalogs(packagesBasePath)) {
      if (filter.type && catalog.type !== filter.type) {
        continue;
      }
      for (const model of catalog.models || []) {
        for (const variant of model.variants || []) {
          if (filter.status && variant.status !== filter.status) {
            continue;
          }
          if (filter.protocol && variant.protocol !== filter.protocol) {
            continue;
          }
          ids.push(variant.fullId);
        }
      }
    }
    return ids;
  }

  return {
    parsePinmapId,
    resolveCatalogPath,
    readPinmapCatalog,
    getCatalogByFullId,
    checkSoftwareComponent,
    scanPinmapCatalogs,
    scanAllLibraries,
    getAvailablePinmapIds,
  };
}

module.exports = {
  createCatalogService,
};
