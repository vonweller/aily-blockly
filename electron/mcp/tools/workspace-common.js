const fs = require('fs');
const path = require('path');

function normalizePath(value) {
  return typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
}

function isWithinRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveProjectRoot(projectContext) {
  const projectRoot = projectContext.resolveProjectPath('') || projectContext.readCurrentProjectPath();
  if (!projectRoot) {
    throw new Error('当前没有打开的项目。');
  }
  return path.resolve(projectRoot);
}

function resolveWorkspacePath(projectContext, rawPath, options = {}) {
  const projectRoot = resolveProjectRoot(projectContext);
  const normalizedInput = normalizePath(rawPath);
  const candidate = normalizedInput
    ? (path.isAbsolute(normalizedInput)
        ? path.resolve(normalizedInput)
        : path.resolve(projectRoot, normalizedInput))
    : projectRoot;

  if (options.allowProjectRoot !== true && candidate === projectRoot) {
    throw new Error('请提供项目内的具体文件或目录路径。');
  }

  if (!isWithinRoot(projectRoot, candidate)) {
    throw new Error(`路径超出当前项目范围: ${candidate}`);
  }

  return {
    projectRoot,
    absolutePath: candidate,
    relativePath: path.relative(projectRoot, candidate).replace(/\\/g, '/'),
  };
}

function ensurePathExists(absolutePath) {
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`路径不存在: ${absolutePath}`);
  }
}

function ensureFile(absolutePath) {
  ensurePathExists(absolutePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件: ${absolutePath}`);
  }
  return stat;
}

function ensureDirectory(absolutePath) {
  ensurePathExists(absolutePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error(`不是目录: ${absolutePath}`);
  }
  return stat;
}

function detectBinaryBuffer(buffer) {
  const limit = Math.min(buffer.length, 4096);
  let suspicious = 0;
  for (let index = 0; index < limit; index += 1) {
    const value = buffer[index];
    if (value === 0) {
      return true;
    }
    if (value < 7 || (value > 14 && value < 32)) {
      suspicious += 1;
    }
  }
  return suspicious > 24;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern || '**/*') || '**/*';
  let regex = '^';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '*') {
      if (next === '*') {
        const nextNext = normalized[index + 2];
        if (nextNext === '/') {
          regex += '(?:.*/)?';
          index += 2;
        } else {
          regex += '.*';
          index += 1;
        }
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '.';
      continue;
    }

    if (char === '{') {
      const endIndex = normalized.indexOf('}', index);
      if (endIndex > index) {
        const segment = normalized.slice(index + 1, endIndex);
        const options = segment.split(',').map((item) => escapeRegex(item));
        regex += `(?:${options.join('|')})`;
        index = endIndex;
        continue;
      }
    }

    if (char === '/') {
      regex += '/';
      continue;
    }

    regex += escapeRegex(char);
  }

  regex += '$';
  return new RegExp(regex);
}

function walkFiles(rootPath, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 100;
  const includePattern = typeof options.includePattern === 'string' && options.includePattern.trim()
    ? globToRegExp(options.includePattern)
    : null;
  const queue = [path.resolve(rootPath)];
  const files = [];
  const ignoredDirNames = new Set(['.git', '.svn', '.hg']);

  while (queue.length > 0 && files.length < limit) {
    const currentPath = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (_error) {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirNames.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, '/');
      if (includePattern && !includePattern.test(relativePath)) {
        continue;
      }
      files.push({ absolutePath, relativePath });
      if (files.length >= limit) {
        break;
      }
    }
  }

  return files;
}

function formatReadResult(metadata, content) {
  const lines = [
    `Path: ${metadata.absolutePath}`,
    `ProjectPath: ${metadata.projectRoot}`,
    `Size: ${metadata.size} bytes`,
  ];

  if (metadata.rangeLabel) {
    lines.push(`Range: ${metadata.rangeLabel}`);
  }
  if (metadata.truncated === true) {
    lines.push('Truncated: true');
  }

  lines.push('', content);
  return lines.join('\n');
}

module.exports = {
  normalizePath,
  resolveProjectRoot,
  resolveWorkspacePath,
  ensureFile,
  ensureDirectory,
  detectBinaryBuffer,
  escapeRegex,
  globToRegExp,
  walkFiles,
  formatReadResult,
};
