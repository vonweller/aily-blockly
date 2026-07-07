const fs = require('fs');

const {
  ensureDirectory,
  globToRegExp,
  resolveWorkspacePath,
  walkFiles,
} = require('./workspace-common');

const definition = {
  name: 'glob_search',
  description: '在当前项目内按文件名模式搜索文件。支持常见 glob 语法，如 "**/*.ts"、"src/**/*.json"。',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，例如 "**/*.ts"、"*boards.json"' },
      path: { type: 'string', description: '搜索根目录。默认为当前项目根目录。' },
      limit: { type: 'number', default: 100, minimum: 1, description: '最大返回数量' },
    },
    required: ['pattern'],
  },
};

function createHandler(services) {
  return async function globSearch(args = {}) {
    try {
      const resolved = resolveWorkspacePath(services.projectContext, args.path, { allowProjectRoot: true });
      ensureDirectory(resolved.absolutePath);
      const pattern = typeof args.pattern === 'string' && args.pattern.trim() ? args.pattern.trim() : '';
      if (!pattern) {
        throw new Error('缺少 pattern');
      }
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 100;
      const matcher = globToRegExp(pattern);
      const files = walkFiles(resolved.absolutePath, { limit: Math.max(limit * 50, 2000) })
        .filter((entry) => matcher.test(entry.relativePath))
        .slice(0, limit)
        .map((entry) => {
          const stat = fs.statSync(entry.absolutePath);
          return {
            path: entry.relativePath,
            absolutePath: entry.absolutePath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        });

      return {
        is_error: false,
        content: JSON.stringify({
          rootPath: resolved.absolutePath,
          pattern,
          count: files.length,
          matches: files,
        }, null, 2),
      };
    } catch (error) {
      return {
        is_error: true,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

module.exports = {
  definition,
  createHandler,
};
