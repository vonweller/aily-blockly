const fs = require('fs');

const {
  detectBinaryBuffer,
  ensureDirectory,
  escapeRegex,
  globToRegExp,
  resolveWorkspacePath,
  walkFiles,
} = require('./workspace-common');

const definition = {
  name: 'grep_search',
  description: '在当前项目内按内容搜索文件。支持正则表达式，或作为普通文本搜索。',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '要搜索的模式（正则或普通文本）' },
      path: { type: 'string', description: '搜索根目录。默认为当前项目根目录。' },
      include: { type: 'string', description: '可选的文件 glob 过滤，例如 "**/*.ts"、"*.json"' },
      isRegex: { type: 'boolean', default: true, description: 'pattern 是否按正则表达式解释' },
      returnContent: { type: 'boolean', default: false, description: '是否返回匹配行内容和行号' },
      contextLines: { type: 'number', default: 0, minimum: 0, description: '返回匹配行前后上下文行数' },
      maxLineLength: { type: 'number', default: 200, minimum: 20, description: '返回内容时每行最大字符数' },
      maxResults: { type: 'number', default: 20, minimum: 1, description: '最大返回结果数量' },
    },
    required: ['pattern'],
  },
};

function truncateLine(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function createHandler(services) {
  return async function grepSearch(args = {}) {
    try {
      const resolved = resolveWorkspacePath(services.projectContext, args.path, { allowProjectRoot: true });
      ensureDirectory(resolved.absolutePath);
      const rawPattern = typeof args.pattern === 'string' ? args.pattern : '';
      if (!rawPattern.trim()) {
        throw new Error('缺少 pattern');
      }

      const isRegex = args.isRegex !== false;
      const matcher = new RegExp(isRegex ? rawPattern : escapeRegex(rawPattern), 'i');
      const includeMatcher = typeof args.include === 'string' && args.include.trim()
        ? globToRegExp(args.include.trim())
        : null;
      const returnContent = args.returnContent === true;
      const contextLines = Number.isFinite(args.contextLines) && args.contextLines >= 0
        ? Math.floor(args.contextLines)
        : 0;
      const maxLineLength = Number.isFinite(args.maxLineLength) && args.maxLineLength >= 20
        ? Math.floor(args.maxLineLength)
        : 200;
      const maxResults = Number.isFinite(args.maxResults) && args.maxResults > 0
        ? Math.floor(args.maxResults)
        : 20;
      const candidateFiles = walkFiles(resolved.absolutePath, {
        limit: Math.max(maxResults * 100, 2000),
        includePattern: args.include,
      });

      const fileMatches = [];
      const contentMatches = [];

      for (const file of candidateFiles) {
        if (includeMatcher && !includeMatcher.test(file.relativePath)) {
          continue;
        }
        const buffer = fs.readFileSync(file.absolutePath);
        if (detectBinaryBuffer(buffer)) {
          continue;
        }
        const text = buffer.toString('utf-8');

        if (!returnContent) {
          if (matcher.test(text)) {
            fileMatches.push({
              path: file.relativePath,
              absolutePath: file.absolutePath,
            });
          }
          if (fileMatches.length >= maxResults) {
            break;
          }
          continue;
        }

        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (!matcher.test(lines[index])) {
            continue;
          }
          const contextStart = Math.max(0, index - contextLines);
          const contextEnd = Math.min(lines.length, index + contextLines + 1);
          contentMatches.push({
            path: file.relativePath,
            absolutePath: file.absolutePath,
            line: index + 1,
            match: truncateLine(lines[index], maxLineLength),
            context: lines.slice(contextStart, contextEnd).map((line, offset) => ({
              line: contextStart + offset + 1,
              text: truncateLine(line, maxLineLength),
            })),
          });
          if (contentMatches.length >= maxResults) {
            break;
          }
        }

        if (contentMatches.length >= maxResults) {
          break;
        }
      }

      return {
        is_error: false,
        content: JSON.stringify({
          rootPath: resolved.absolutePath,
          pattern: rawPattern,
          isRegex,
          returnContent,
          count: returnContent ? contentMatches.length : fileMatches.length,
          matches: returnContent ? contentMatches : fileMatches,
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
