const fs = require('fs');

const {
  ensureFile,
  detectBinaryBuffer,
  formatReadResult,
  resolveWorkspacePath,
} = require('./workspace-common');

const DEFAULT_MAX_SIZE = 1024 * 1024;

const definition = {
  name: 'read_file',
  description: '读取当前项目内指定文件的内容。支持完整读取、按行读取和按字节范围读取。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要读取的文件路径。支持项目内相对路径和绝对路径。' },
      encoding: { type: 'string', description: '文本编码格式', default: 'utf-8' },
      startLine: { type: 'number', minimum: 1, description: '起始行号（从 1 开始）' },
      lineCount: { type: 'number', minimum: 1, description: '读取行数' },
      startByte: { type: 'number', minimum: 0, description: '起始字节偏移（从 0 开始）' },
      byteCount: { type: 'number', minimum: 1, description: '读取字节数' },
      maxSize: { type: 'number', minimum: 1024, default: DEFAULT_MAX_SIZE, description: '完整读取时允许的最大字节数' },
    },
    required: ['path'],
  },
};

function createHandler(services) {
  return async function readFile(args = {}) {
    try {
      const resolved = resolveWorkspacePath(services.projectContext, args.path);
      const stat = ensureFile(resolved.absolutePath);
      const encoding = typeof args.encoding === 'string' && args.encoding.trim() ? args.encoding.trim() : 'utf-8';
      const maxSize = Number.isFinite(args.maxSize) && args.maxSize > 0 ? Math.floor(args.maxSize) : DEFAULT_MAX_SIZE;
      const hasByteRange = Number.isFinite(args.startByte) || Number.isFinite(args.byteCount);
      const hasLineRange = Number.isFinite(args.startLine) || Number.isFinite(args.lineCount);

      let text = '';
      let rangeLabel = 'full';
      let truncated = false;

      if (hasByteRange) {
        const startByte = Math.max(0, Number.isFinite(args.startByte) ? Math.floor(args.startByte) : 0);
        const byteCount = Number.isFinite(args.byteCount) && args.byteCount > 0
          ? Math.floor(args.byteCount)
          : Math.max(0, stat.size - startByte);
        const fd = fs.openSync(resolved.absolutePath, 'r');
        try {
          const buffer = Buffer.alloc(Math.max(0, Math.min(byteCount, Math.max(0, stat.size - startByte))));
          const bytesRead = buffer.length > 0 ? fs.readSync(fd, buffer, 0, buffer.length, startByte) : 0;
          const slice = buffer.subarray(0, bytesRead);
          if (detectBinaryBuffer(slice)) {
            throw new Error('目标文件看起来是二进制文件，read_file 仅支持文本内容。');
          }
          text = slice.toString(encoding);
          rangeLabel = `bytes ${startByte}-${Math.max(startByte, startByte + Math.max(bytesRead - 1, 0))}`;
          truncated = startByte + bytesRead < stat.size;
        } finally {
          fs.closeSync(fd);
        }
      } else {
        if (!hasLineRange && stat.size > maxSize) {
          throw new Error(`文件过大 (${stat.size} bytes)。请使用 startByte/byteCount 或 startLine/lineCount 分段读取。`);
        }
        const buffer = fs.readFileSync(resolved.absolutePath);
        if (detectBinaryBuffer(buffer)) {
          throw new Error('目标文件看起来是二进制文件，read_file 仅支持文本内容。');
        }
        const fullText = buffer.toString(encoding);
        if (hasLineRange) {
          const startLine = Math.max(1, Number.isFinite(args.startLine) ? Math.floor(args.startLine) : 1);
          const lineCount = Number.isFinite(args.lineCount) && args.lineCount > 0
            ? Math.floor(args.lineCount)
            : Number.MAX_SAFE_INTEGER;
          const lines = fullText.split(/\r?\n/);
          const startIndex = Math.min(lines.length, startLine - 1);
          const endIndex = Math.min(lines.length, startIndex + lineCount);
          text = lines.slice(startIndex, endIndex).join('\n');
          rangeLabel = `lines ${startIndex + 1}-${endIndex}`;
          truncated = endIndex < lines.length;
        } else {
          text = fullText;
        }
      }

      return {
        is_error: false,
        content: formatReadResult({
          absolutePath: resolved.absolutePath,
          projectRoot: resolved.projectRoot,
          size: stat.size,
          rangeLabel,
          truncated,
        }, text),
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
