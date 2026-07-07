const fs = require('fs');
const path = require('path');

const {
  ensureDirectory,
  resolveWorkspacePath,
} = require('./workspace-common');

const definition = {
  name: 'list_dir',
  description: '列出当前项目内目录的直接子项。用于先查看目录结构，再决定读取哪些文件。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径。默认为当前项目根目录。' },
      limit: { type: 'number', default: 200, minimum: 1, description: '最大返回数量' },
    },
    required: [],
  },
};

function createHandler(services) {
  return async function listDir(args = {}) {
    try {
      const resolved = resolveWorkspacePath(services.projectContext, args.path, { allowProjectRoot: true });
      ensureDirectory(resolved.absolutePath);
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 200;
      const entries = fs.readdirSync(resolved.absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, limit)
        .map((entry) => {
          const absolutePath = path.join(resolved.absolutePath, entry.name);
          const stat = fs.statSync(absolutePath);
          return {
            name: entry.name,
            path: path.relative(resolved.projectRoot, absolutePath).replace(/\\/g, '/'),
            absolutePath,
            type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        });

      return {
        is_error: false,
        content: JSON.stringify({
          path: resolved.relativePath || '.',
          absolutePath: resolved.absolutePath,
          count: entries.length,
          entries,
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
